'use strict';

// ---------------------------------------------------------------------------
// icsSync.js
//
// Scheduled Cloud Function — runs every 30 minutes.
// Fetches Airbnb ICS calendar feeds, diffs against internal bookings,
// and creates/updates/cancels bookings + cascades to cleaning jobs.
//
// Source of truth rules:
//   - Airbnb ICS feed is truth for Airbnb reservation dates
//   - Internal booking model is the canonical app-facing object
//   - Cleaning jobs are derived from booking state + override rules
//   - Notifications are triggered from internal diffs, not raw ICS
// ---------------------------------------------------------------------------

const ical = require('node-ical');
const crypto = require('crypto');
const { db, messaging } = require('./firebaseInit');
const { generateWelcomeMessage } = require('./lib/welcome-ai');
const { extractConfirmationCodeFromVevent } = require('./lib/vevent-confirmation-code');

// Notification strings (CommonJS — can't import ES module)
const STRINGS = {
  es: {
    syncNewBooking_title: 'Nueva reserva de Airbnb',
    syncNewBooking_body: '{unit} — {checkIn} a {checkOut}',
    syncDateChanged_title: 'Fechas actualizadas',
    syncDateChanged_body: '{unit} — nueva fecha de checkout: {newDate} (antes: {oldDate})',
    syncBookingCancelled_title: 'Reserva de Airbnb cancelada',
    syncBookingCancelled_body: '{unit} — {checkIn} a {checkOut}',
    syncOverrideHeld_title: 'Limpieza con fecha manual',
    syncOverrideHeld_body: '{unit} — la reserva cambió pero la fecha de limpieza fue fijada manualmente',
    syncError_title: 'Error de sincronización ICS',
    syncError_body: 'No se pudo sincronizar {unit}: {error}',
    cleaningDateChanged_title: 'Fecha de limpieza actualizada',
    cleaningDateChanged_body: '{unit} — nueva fecha: {newDate} (antes: {oldDate})',
    newCleaningAssignment_title: 'Nueva asignación de limpieza',
    cleaningAssignment_body: '{unit} el {date} (checkout {time})',
  },
  en: {
    syncNewBooking_title: 'New Airbnb Booking',
    syncNewBooking_body: '{unit} — {checkIn} to {checkOut}',
    syncDateChanged_title: 'Dates Updated',
    syncDateChanged_body: '{unit} — new checkout date: {newDate} (was: {oldDate})',
    syncBookingCancelled_title: 'Airbnb Booking Cancelled',
    syncBookingCancelled_body: '{unit} — {checkIn} to {checkOut}',
    syncOverrideHeld_title: 'Manually Pinned Cleaning',
    syncOverrideHeld_body: '{unit} — booking changed but cleaning date was manually set',
    syncError_title: 'ICS Sync Error',
    syncError_body: 'Failed to sync {unit}: {error}',
    cleaningDateChanged_title: 'Cleaning Date Updated',
    cleaningDateChanged_body: '{unit} — new date: {newDate} (was: {oldDate})',
    newCleaningAssignment_title: 'New Cleaning Assignment',
    cleaningAssignment_body: '{unit} on {date} (checkout {time})',
  },
};

function nt(locale, key, params = {}) {
  const str = STRINGS[locale]?.[key] || STRINGS.en[key] || key;
  return Object.entries(params).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, v),
    str
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert VEVENT date to YYYY-MM-DD string */
function veventDateToYMD(dt) {
  if (!dt) return null;
  // node-ical returns Date objects or { tz, val } objects
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

/** Compute SHA-256 hash for change detection */
function computeSyncHash(uid, dtstart, dtend, summary) {
  return crypto
    .createHash('sha256')
    .update(`${uid}|${dtstart}|${dtend}|${summary || ''}`)
    .digest('hex')
    .slice(0, 16); // short hash is sufficient
}

/** Extract Airbnb confirmation code from VEVENT DESCRIPTION (e.g. HMABCD1234) */
function extractConfirmationCode(description) {
  if (!description) return null;
  // Airbnb confirmation codes are typically HM + alphanumeric
  const match = description.match(/\b(HM[A-Z0-9]{6,10})\b/i);
  return match ? match[1].toUpperCase() : null;
}

/** Extract guest name from VEVENT SUMMARY (best-effort) */
function extractGuestName(summary) {
  if (!summary) return 'Airbnb Guest';
  // Airbnb ICS uses "Reserved" or "Not available" for blocked dates
  const blockedPatterns = ['reserved', 'not available', 'airbnb', 'blocked'];
  if (blockedPatterns.some((p) => summary.toLowerCase().includes(p))) {
    return 'Airbnb Guest';
  }
  return summary.trim() || 'Airbnb Guest';
}

/** Send staff notification via FCM + write in-app doc */
async function notifyAdminAndCohost(title, body, type, data = {}) {
  try {
    const usersSnap = await db
      .collection('users')
      .where('role', 'in', ['admin', 'cohost'])
      .where('status', '==', 'active')
      .get();

    const staffIds = usersSnap.docs.map((d) => d.id);
    if (staffIds.length === 0) return;

    const now = new Date().toISOString();

    await Promise.all(
      staffIds.map(async (uid) => {
        // Resolve locale
        const userDoc = await db.collection('users').doc(uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const locale = userData.locale === 'es' ? 'es' : 'en';

        const localTitle = nt(locale, title.key, title.params);
        const localBody = nt(locale, body.key, body.params);

        // Write in-app notification
        await db.collection('staff_notifications').add({
          recipientId: uid,
          title: localTitle,
          body: localBody,
          type,
          data,
          read: false,
          createdAt: now,
        });

        // Send FCM push
        const tokensSnap = await db
          .collection('fcm_tokens')
          .where('staffId', '==', uid)
          .get();

        await Promise.all(
          tokensSnap.docs.map((tokenDoc) => {
            const { token } = tokenDoc.data();
            if (!token) return Promise.resolve();
            return messaging
              .send({
                token,
                data: {
                  title: localTitle,
                  body: localBody,
                  type,
                  ...Object.fromEntries(
                    Object.entries(data).map(([k, v]) => [k, String(v)])
                  ),
                },
              })
              .catch((err) => {
                console.error(`[icsSync] FCM error for ${uid}:`, err.message);
              });
          })
        );
      })
    );
  } catch (err) {
    console.error('[icsSync] notifyAdminAndCohost error:', err);
  }
}

/** Notify a specific cleaner */
async function notifyCleaner(assigneeId, titleKey, bodyKey, bodyParams, type, data = {}) {
  try {
    const userDoc = await db.collection('users').doc(assigneeId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const locale = userData.locale === 'es' ? 'es' : 'en';

    const title = nt(locale, titleKey);
    const body = nt(locale, bodyKey, bodyParams);
    const now = new Date().toISOString();

    await db.collection('staff_notifications').add({
      recipientId: assigneeId,
      title,
      body,
      type,
      data,
      read: false,
      createdAt: now,
    });

    const tokensSnap = await db
      .collection('fcm_tokens')
      .where('staffId', '==', assigneeId)
      .get();

    await Promise.all(
      tokensSnap.docs.map((tokenDoc) => {
        const { token } = tokenDoc.data();
        if (!token) return Promise.resolve();
        return messaging
          .send({
            token,
            data: {
              title,
              body,
              type,
              ...Object.fromEntries(
                Object.entries(data).map(([k, v]) => [k, String(v)])
              ),
            },
          })
          .catch((err) => {
            console.error(`[icsSync] FCM error for cleaner ${assigneeId}:`, err.message);
          });
      })
    );
  } catch (err) {
    console.error(`[icsSync] notifyCleaner error for ${assigneeId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Welcome message draft generation (non-blocking — booking creation is not gated)
// ---------------------------------------------------------------------------
async function generateWelcomeDraft(bookingRef, bookingData) {
  try {
    // Idempotency: skip if not pending
    if (bookingData.welcomeStatus !== 'pending') return;

    // Load property settings for context
    const settingsDoc = await db.collection('settings').doc('property').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};

    // Load welcome template if configured
    const template = settings.welcomeTemplate || null;

    const result = await generateWelcomeMessage({
      booking: { id: bookingRef.id, ...bookingData },
      settings,
      template,
    });

    // Defense-in-depth: the generator's internal guard returns skipped:true for
    // terminal states. The welcomeStatus !== 'pending' pre-check above should
    // normally prevent that, but if anyone regresses the pre-check we must not
    // clobber the terminal state here.
    if (result.skipped) {
      console.log('[icsSync] welcome generator skipped (terminal state) — not writing', {
        bookingId: bookingRef.id,
      });
      return;
    }

    // Update booking with draft
    await bookingRef.update({
      welcomeStatus: 'ready',
      welcomeMessage: result.message,
      welcomeDraftedAt: new Date().toISOString(),
    });

    // Log agent run
    if (result._agentRun) {
      result._agentRun.refId = bookingRef.id;
      await db.collection('agent_runs').add(result._agentRun);
    }

    console.log(`[icsSync] Welcome draft generated for booking ${bookingRef.id}`);
  } catch (err) {
    // Non-fatal: booking exists, welcome can be regenerated manually
    console.error(`[icsSync] Welcome draft failed for ${bookingRef.id}:`, err.message);
    await bookingRef.update({ welcomeStatus: 'pending' }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Cascade cleaning job dates (mirrors lib/booking-cleaning-cascade.js for CJS)
// ---------------------------------------------------------------------------
const HISTORICAL_STATUSES = ['completed', 'archived', 'deleted', 'cancelled'];
const IN_PROGRESS_STATUSES = [
  'en_route', 'arrived', 'before_photos', 'cleaning', 'after_photos', 'laundry_check',
];
const RESCHEDULABLE_STATUSES = ['scheduled', 'acknowledged', 'declined'];

async function cascadeCleaningJobs(bookingId, newCheckOutDate, oldCheckOutDate, unit) {
  if (!bookingId || newCheckOutDate === oldCheckOutDate) return;

  const jobsSnap = await db
    .collection('cleaning_jobs')
    .where('bookingId', '==', bookingId)
    .get();

  if (jobsSnap.empty) return;

  const now = new Date().toISOString();

  for (const jobDoc of jobsSnap.docs) {
    const job = jobDoc.data();

    if (HISTORICAL_STATUSES.includes(job.status)) continue;

    if (IN_PROGRESS_STATUSES.includes(job.status)) {
      await notifyAdminAndCohost(
        { key: 'syncOverrideHeld_title', params: {} },
        { key: 'syncOverrideHeld_body', params: { unit } },
        'cleaning_update',
        { jobId: jobDoc.id, targetPath: '/admin/cleaning' }
      );
      continue;
    }

    if (job.manualOverride === true) {
      await notifyAdminAndCohost(
        { key: 'syncOverrideHeld_title', params: {} },
        { key: 'syncOverrideHeld_body', params: { unit } },
        'cleaning_update',
        { jobId: jobDoc.id, targetPath: '/admin/cleaning' }
      );
      continue;
    }

    if (RESCHEDULABLE_STATUSES.includes(job.status) && job.scheduledDate !== newCheckOutDate) {
      await jobDoc.ref.update({
        scheduledDate: newCheckOutDate,
        status: 'scheduled',
        acknowledgedAt: null,
        declinedAt: null,
        declineReason: null,
        updatedAt: now,
      });

      if (job.assigneeId) {
        await notifyCleaner(
          job.assigneeId,
          'cleaningDateChanged_title',
          'cleaningDateChanged_body',
          { unit, oldDate: oldCheckOutDate, newDate: newCheckOutDate },
          'cleaning_update',
          { jobId: jobDoc.id, unit, scheduledDate: newCheckOutDate, targetPath: '/admin/cleaning' }
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-create cleaning job for a new booking
// ---------------------------------------------------------------------------
async function autoCreateCleaningJob(bookingId, unit, checkOutDate, guestName) {
  const cleanerSnap = await db
    .collection('users')
    .where('role', '==', 'cleaner')
    .where('status', '==', 'active')
    .get();

  if (cleanerSnap.empty) {
    console.log('[icsSync] No active cleaners — skipping job creation');
    return null;
  }

  const cleanerDoc = cleanerSnap.docs[0];
  const cleanerData = cleanerDoc.data();
  const cleanerUid = cleanerDoc.id;
  const allCleanerUids = cleanerSnap.docs.map((d) => d.id);
  const now = new Date().toISOString();

  const job = {
    unit,
    scheduledDate: checkOutDate,
    checkoutTime: '11:00 AM',
    assigneeId: cleanerUid,
    assigneeName: cleanerData.displayName || cleanerData.email,
    bookingId,
    status: 'scheduled',
    source: 'airbnb',
    manualOverride: false,
    notes: guestName ? `Guest: ${guestName}` : '',
    turnoverNotes: '',
    sameDayArrival: false,
    beforePhotos: [],
    afterPhotos: [],
    issues: [],
    laundryFound: null,
    laundryNote: '',
    laundryPhoto: null,
    acknowledgedAt: null,
    enRouteAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    createdBy: 'ics-sync',
  };

  const jobRef = await db.collection('cleaning_jobs').add(job);

  // Notify all cleaners
  for (const uid of allCleanerUids) {
    await notifyCleaner(
      uid,
      'newCleaningAssignment_title',
      'cleaningAssignment_body',
      { unit, date: checkOutDate, time: '11:00 AM' },
      'cleaning_assignment',
      { jobId: jobRef.id, unit, scheduledDate: checkOutDate, targetPath: '/admin/cleaning' }
    );
  }

  return jobRef.id;
}

// ---------------------------------------------------------------------------
// Main sync logic
// ---------------------------------------------------------------------------

/**
 * Process a single ICS feed for one unit.
 *
 * @param {object} feed  { unitId, unitName, icsUrl, enabled }
 * @returns {object}     { eventsFound, created, updated, cancelled, unchanged, errors }
 */
async function processFeed(feed) {
  const stats = { eventsFound: 0, created: 0, updated: 0, cancelled: 0, unchanged: 0, errors: [] };
  const { unitId, unitName, icsUrl } = feed;

  if (!icsUrl) {
    stats.errors.push('No ICS URL configured');
    return stats;
  }

  // 1. Fetch and parse ICS
  let events;
  try {
    events = await ical.async.fromURL(icsUrl);
  } catch (err) {
    console.error(`[icsSync] Failed to fetch ICS for ${unitName}:`, err.message);
    stats.errors.push(`Fetch failed: ${err.message}`);
    return stats;
  }

  // 2. Extract VEVENTs with future relevance (DTSTART >= 7 days ago)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const vevents = [];
  for (const [, event] of Object.entries(events)) {
    if (event.type !== 'VEVENT') continue;

    const dtstart = veventDateToYMD(event.start);
    const dtend = veventDateToYMD(event.end);
    if (!dtstart || !dtend) continue;

    // Skip events too far in the past
    if (new Date(dtend) < cutoff) continue;

    vevents.push({
      uid: event.uid,
      dtstart,
      dtend,
      summary: event.summary || '',
      description: event.description || '',
      confirmationCode: extractConfirmationCode(event.description),
    });
  }

  stats.eventsFound = vevents.length;
  console.log(`[icsSync] ${unitName}: ${vevents.length} relevant events found`);

  // 3. Track which externalIds we see (for cancellation detection)
  const seenExternalIds = new Set();

  // 4. Process each VEVENT
  for (const vevent of vevents) {
    try {
      seenExternalIds.add(vevent.uid);

      const syncHash = computeSyncHash(vevent.uid, vevent.dtstart, vevent.dtend, vevent.summary);
      const guestName = extractGuestName(vevent.summary);

      // Airbnb ICS: DTSTART = check-in, DTEND = checkout
      const checkInDate = vevent.dtstart;
      const checkOutDate = vevent.dtend;

      // Primary match: VEVENT UID (covers ICS-created bookings).
      let existingSnap = await db
        .collection('bookings')
        .where('externalId', '==', vevent.uid)
        .where('unit', '==', unitName)
        .get();

      // Fallback match: airbnbConfirmationCode (covers legacy Lambda-created
      // bookings whose externalId was set to the HM-code rather than the
      // VEVENT UID). On match, migrate externalId in place so subsequent
      // syncs use the primary path.
      if (existingSnap.empty) {
        const confirmationCode = extractConfirmationCodeFromVevent({
          summary: vevent.summary,
          description: vevent.description,
        });

        if (confirmationCode) {
          existingSnap = await db
            .collection('bookings')
            .where('airbnbConfirmationCode', '==', confirmationCode)
            .where('unit', '==', unitName)
            .get();

          if (!existingSnap.empty) {
            const doc = existingSnap.docs[0];
            await doc.ref.update({
              externalId: vevent.uid,
              source: 'airbnb',
              migratedFromEmailAt: new Date().toISOString(),
            });
            console.log('[icsSync] Migrated legacy Lambda-created booking to VEVENT UID', {
              bookingId: doc.id,
              confirmationCode,
              veventUid: vevent.uid,
            });
          }
        }
      }

      const now = new Date().toISOString();

      if (existingSnap.empty) {
        // ── New booking ──────────────────────────────────────────────

        // Check for overlap with existing manual bookings
        const overlapSnap = await db
          .collection('bookings')
          .where('unit', '==', unitName)
          .where('status', '==', 'active')
          .get();

        let hasManualOverlap = false;
        for (const overlapDoc of overlapSnap.docs) {
          const other = overlapDoc.data();
          if (other.source === 'airbnb') continue; // Airbnb vs Airbnb handled by UID
          if (checkInDate < other.checkOutDate && checkOutDate > other.checkInDate) {
            hasManualOverlap = true;
            console.warn(`[icsSync] Overlap: new Airbnb event ${vevent.uid} overlaps manual booking ${overlapDoc.id}`);
            stats.errors.push(`Overlap with manual booking ${overlapDoc.id} on ${unitName}`);
            break;
          }
        }

        if (hasManualOverlap) {
          // Notify admin instead of auto-creating
          await notifyAdminAndCohost(
            { key: 'syncError_title', params: {} },
            { key: 'syncError_body', params: { unit: unitName, error: 'New Airbnb reservation overlaps a manual booking' } },
            'sync_warning',
            { targetPath: '/admin/calendar' }
          );
          continue;
        }

        // Create the booking
        const bookingData = {
          code: crypto.randomBytes(5).toString('hex'), // 10-char hex code
          unit: unitName,
          ...(unitId && { unitId }),
          guestName,
          guestEmail: '',
          checkInDate,
          checkOutDate,
          status: 'active',
          checkedIn: false,
          source: 'airbnb',
          externalId: vevent.uid,
          lastSyncedAt: now,
          syncHash,
          syncMissCount: 0,
          createdAt: now,
          guestLink: '', // Airbnb bookings don't use guest links
          accessTokenHash: '',
          accessTokenCreatedAt: now,
          accessTokenRevokedAt: null,
          // Welcome message fields
          welcomeStatus: 'pending',
          welcomeMessage: null,
          welcomeDraftedAt: null,
          welcomeSentAt: null,
          // Airbnb confirmation code (parsed from ICS DESCRIPTION)
          airbnbConfirmationCode: vevent.confirmationCode || null,
        };

        const bookingRef = await db.collection('bookings').add(bookingData);
        stats.created++;

        // Reactive drain: consume email-arrived-first enrichment from quarantine.
        // Non-fatal — drain failure doesn't block booking creation.
        try {
          const quarantineSnap = await db
            .collection('airbnb_messages_quarantine')
            .where('airbnbConfirmationCode', '==', bookingData.airbnbConfirmationCode || '')
            .where('reason', '==', 'unmatched_awaiting_ics')
            .where('status', '==', 'pending')
            .get();

          if (!quarantineSnap.empty) {
            const fields = quarantineSnap.docs[0].data().enrichmentFields || {};
            const genericNames = ['airbnb guest', 'guest', ''];
            const nameGeneric = genericNames.includes(
              (bookingData.guestName || '').toLowerCase().trim()
            );

            const updates = {};
            if (fields.guestName && nameGeneric) updates.guestName = fields.guestName;
            if (fields.guestCount && !bookingData.guestCount) updates.guestCount = fields.guestCount;
            if (fields.payoutAmount && !bookingData.payoutAmount) updates.payoutAmount = fields.payoutAmount;
            if (fields.guestMessage && !bookingData.guestMessage) updates.guestMessage = fields.guestMessage;

            if (Object.keys(updates).length > 0) {
              updates.lastEnrichedFromEmailAt = new Date().toISOString();
              await bookingRef.update(updates);
            }

            const batch = db.batch();
            quarantineSnap.docs.forEach((doc) => {
              batch.update(doc.ref, {
                status: 'resolved',
                resolvedAt: new Date().toISOString(),
                resolvedBy: 'icsSync:drain',
                resolvedBookingId: bookingRef.id,
              });
            });
            await batch.commit();

            console.log('reactive drain applied email enrichment', {
              bookingId: bookingRef.id,
              airbnbConfirmationCode: bookingData.airbnbConfirmationCode,
              fieldsUpdated: Object.keys(updates),
              quarantineDocsResolved: quarantineSnap.size,
            });
          }
        } catch (err) {
          console.error('Reactive drain failed (non-fatal)', {
            bookingId: bookingRef.id,
            error: err.message,
          });
        }

        // Auto-create cleaning job
        await autoCreateCleaningJob(bookingRef.id, unitName, checkOutDate, guestName);

        // Generate welcome message draft (non-blocking — fires after notify)
        // Do NOT await inline to avoid slowing the sync loop; run after admin notify
        const welcomePromise = generateWelcomeDraft(bookingRef, bookingData);

        // Notify admin
        await notifyAdminAndCohost(
          { key: 'syncNewBooking_title', params: {} },
          { key: 'syncNewBooking_body', params: { unit: unitName, checkIn: checkInDate, checkOut: checkOutDate } },
          'sync_new',
          { bookingId: bookingRef.id, targetPath: '/admin/calendar' }
        );

        // Await welcome draft (non-critical — errors are caught internally)
        await welcomePromise;

        console.log(`[icsSync] Created booking for ${unitName}: ${checkInDate} → ${checkOutDate}`);
      } else {
        // ── Existing booking — check for changes ─────────────────────
        const bookingDoc = existingSnap.docs[0];
        const booking = bookingDoc.data();

        // Reset syncMissCount since we found it
        const baseUpdate = { lastSyncedAt: now, syncMissCount: 0 };

        if (booking.syncHash === syncHash) {
          // No changes
          await bookingDoc.ref.update(baseUpdate);
          stats.unchanged++;
          continue;
        }

        // Dates or summary changed
        const datesChanged =
          booking.checkInDate !== checkInDate || booking.checkOutDate !== checkOutDate;

        const updates = {
          ...baseUpdate,
          syncHash,
          guestName,
          checkInDate,
          checkOutDate,
          updatedAt: now,
        };

        await bookingDoc.ref.update(updates);
        stats.updated++;

        // Cascade cleaning jobs if checkout date changed
        if (booking.checkOutDate !== checkOutDate) {
          await cascadeCleaningJobs(bookingDoc.id, checkOutDate, booking.checkOutDate, unitName);
        }

        // Notify admin if dates changed
        if (datesChanged) {
          await notifyAdminAndCohost(
            { key: 'syncDateChanged_title', params: {} },
            { key: 'syncDateChanged_body', params: { unit: unitName, newDate: checkOutDate, oldDate: booking.checkOutDate } },
            'sync_update',
            { bookingId: bookingDoc.id, targetPath: '/admin/calendar' }
          );
          console.log(`[icsSync] Updated booking ${bookingDoc.id}: ${booking.checkOutDate} → ${checkOutDate}`);
        }
      }
    } catch (err) {
      console.error(`[icsSync] Error processing event ${vevent.uid}:`, err);
      stats.errors.push(`Event ${vevent.uid}: ${err.message}`);
    }
  }

  // 5. Cancellation detection — find active Airbnb bookings not in current feed
  try {
    const today = new Date().toISOString().split('T')[0];
    const airbnbSnap = await db
      .collection('bookings')
      .where('source', '==', 'airbnb')
      .where('unit', '==', unitName)
      .where('status', '==', 'active')
      .get();

    for (const bookingDoc of airbnbSnap.docs) {
      const booking = bookingDoc.data();

      // Only check future bookings
      if (booking.checkOutDate < today) continue;

      if (!seenExternalIds.has(booking.externalId)) {
        const missCount = (booking.syncMissCount || 0) + 1;

        if (missCount >= 2) {
          // Cancel after 2 consecutive misses
          const now = new Date().toISOString();
          await bookingDoc.ref.update({
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: 'ics-sync',
            syncMissCount: missCount,
            lastSyncedAt: now,
          });

          // Cancel linked cleaning jobs
          const jobsSnap = await db
            .collection('cleaning_jobs')
            .where('bookingId', '==', bookingDoc.id)
            .get();

          for (const jobDoc of jobsSnap.docs) {
            const job = jobDoc.data();
            if (RESCHEDULABLE_STATUSES.includes(job.status)) {
              await jobDoc.ref.update({
                status: 'cancelled',
                cancelledAt: now,
                cancelledBy: 'ics-sync',
              });

              if (job.assigneeId) {
                await notifyCleaner(
                  job.assigneeId,
                  'syncBookingCancelled_title',
                  'syncBookingCancelled_body',
                  { unit: unitName, checkIn: booking.checkInDate, checkOut: booking.checkOutDate },
                  'cleaning_update',
                  { jobId: jobDoc.id, targetPath: '/admin/cleaning' }
                );
              }
            }
          }

          await notifyAdminAndCohost(
            { key: 'syncBookingCancelled_title', params: {} },
            { key: 'syncBookingCancelled_body', params: { unit: unitName, checkIn: booking.checkInDate, checkOut: booking.checkOutDate } },
            'sync_cancel',
            { bookingId: bookingDoc.id, targetPath: '/admin/calendar' }
          );

          stats.cancelled++;
          console.log(`[icsSync] Cancelled booking ${bookingDoc.id} (missing from ICS 2+ syncs)`);
        } else {
          // Increment miss count
          await bookingDoc.ref.update({ syncMissCount: missCount });
          console.log(`[icsSync] Booking ${bookingDoc.id} missing from ICS (miss ${missCount}/2)`);
        }
      }
    }
  } catch (err) {
    console.error(`[icsSync] Cancellation detection error for ${unitName}:`, err);
    stats.errors.push(`Cancellation check: ${err.message}`);
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Main handler — called by the scheduled Cloud Function in index.js
// ---------------------------------------------------------------------------
async function icsSyncHandler() {
  const startTime = Date.now();

  // Load ICS feed config from settings
  const settingsDoc = await db.collection('settings').doc('property').get();
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  const feeds = (settings.icsFeeds || []).filter((f) => f.enabled && f.icsUrl);

  if (feeds.length === 0) {
    console.log('[icsSync] No enabled ICS feeds configured — skipping');
    return { feedsProcessed: 0, skipped: true };
  }

  console.log(`[icsSync] Processing ${feeds.length} feed(s)`);

  const totals = {
    feedsProcessed: feeds.length,
    eventsFound: 0,
    created: 0,
    updated: 0,
    cancelled: 0,
    unchanged: 0,
    errors: [],
  };

  // Process feeds sequentially (avoid overwhelming Firestore)
  for (const feed of feeds) {
    const stats = await processFeed(feed);
    totals.eventsFound += stats.eventsFound;
    totals.created += stats.created;
    totals.updated += stats.updated;
    totals.cancelled += stats.cancelled;
    totals.unchanged += stats.unchanged;
    totals.errors.push(...stats.errors);
  }

  totals.durationMs = Date.now() - startTime;
  totals.createdAt = new Date().toISOString();
  totals.triggeredBy = 'cron';

  // Write sync log
  await db.collection('sync_log').add(totals);

  // Notify admin on errors
  if (totals.errors.length > 0) {
    await notifyAdminAndCohost(
      { key: 'syncError_title', params: {} },
      { key: 'syncError_body', params: { unit: 'ICS Sync', error: `${totals.errors.length} error(s)` } },
      'sync_error',
      { targetPath: '/admin/settings' }
    );
  }

  console.log(`[icsSync] Complete: ${JSON.stringify(totals)}`);
  return totals;
}

module.exports = { icsSyncHandler, processFeed };
