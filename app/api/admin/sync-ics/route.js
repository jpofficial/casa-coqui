import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import ical from 'node-ical';
import crypto from 'crypto';
import { cascadeCleaningJobDates } from '@/lib/booking-cleaning-cascade';
import { notifyStaff, notifyAdminAndCohost } from '@/lib/staff-notifications';
import { nt } from '@/lib/notification-strings';

// ---------------------------------------------------------------------------
// POST /api/admin/sync-ics
//
// Manual trigger for ICS calendar sync. Admin-only.
// Optionally accepts { unitId } to sync a single feed.
// ---------------------------------------------------------------------------

/** Convert VEVENT date to YYYY-MM-DD string */
function veventDateToYMD(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function computeSyncHash(uid, dtstart, dtend, summary) {
  return crypto
    .createHash('sha256')
    .update(`${uid}|${dtstart}|${dtend}|${summary || ''}`)
    .digest('hex')
    .slice(0, 16);
}

function extractGuestName(summary) {
  if (!summary) return 'Airbnb Guest';
  const blocked = ['reserved', 'not available', 'airbnb', 'blocked'];
  if (blocked.some((p) => summary.toLowerCase().includes(p))) return 'Airbnb Guest';
  return summary.trim() || 'Airbnb Guest';
}

const RESCHEDULABLE = ['scheduled', 'acknowledged', 'declined'];

async function autoCreateCleaningJob(bookingId, unit, checkOutDate, guestName) {
  const cleanerSnap = await adminDb
    .collection('users')
    .where('role', '==', 'cleaner')
    .where('status', '==', 'active')
    .get();

  if (cleanerSnap.empty) return null;

  const cleaner = cleanerSnap.docs[0];
  const cleanerData = cleaner.data();
  const now = new Date().toISOString();

  const job = {
    unit,
    scheduledDate: checkOutDate,
    checkoutTime: '11:00 AM',
    assigneeId: cleaner.id,
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

  const jobRef = await adminDb.collection('cleaning_jobs').add(job);

  // Notify all cleaners
  const allCleanerUids = cleanerSnap.docs.map((d) => d.id);
  await notifyStaff({
    staffIds: allCleanerUids,
    title: nt('en', 'newCleaningAssignment_title'),
    body: nt('en', 'cleaningAssignment_body', { unit, date: checkOutDate, time: '11:00 AM' }),
    type: 'cleaning_assignment',
    data: { jobId: jobRef.id, unit, scheduledDate: checkOutDate, targetPath: '/admin/cleaning' },
    localizer: (locale) => ({
      title: nt(locale, 'newCleaningAssignment_title'),
      body: nt(locale, 'cleaningAssignment_body', { unit, date: checkOutDate, time: '11:00 AM' }),
    }),
  }).catch((err) => console.error('[sync-ics] Cleaning notify error:', err));

  return jobRef.id;
}

async function processFeed(feed) {
  const stats = { eventsFound: 0, created: 0, updated: 0, cancelled: 0, unchanged: 0, errors: [] };
  const { unitId, unitName, icsUrl } = feed;

  if (!icsUrl) {
    stats.errors.push('No ICS URL configured');
    return stats;
  }

  let events;
  try {
    events = await ical.async.fromURL(icsUrl);
  } catch (err) {
    stats.errors.push(`Fetch failed: ${err.message}`);
    return stats;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const vevents = [];
  for (const [, event] of Object.entries(events)) {
    if (event.type !== 'VEVENT') continue;
    const dtstart = veventDateToYMD(event.start);
    const dtend = veventDateToYMD(event.end);
    if (!dtstart || !dtend) continue;
    if (new Date(dtend) < cutoff) continue;
    vevents.push({ uid: event.uid, dtstart, dtend, summary: event.summary || '' });
  }

  stats.eventsFound = vevents.length;
  const seenExternalIds = new Set();

  for (const vevent of vevents) {
    try {
      seenExternalIds.add(vevent.uid);
      const syncHash = computeSyncHash(vevent.uid, vevent.dtstart, vevent.dtend, vevent.summary);
      const guestName = extractGuestName(vevent.summary);
      const checkInDate = vevent.dtstart;
      const checkOutDate = vevent.dtend;
      const now = new Date().toISOString();

      const existingSnap = await adminDb
        .collection('bookings')
        .where('externalId', '==', vevent.uid)
        .where('unit', '==', unitName)
        .get();

      if (existingSnap.empty) {
        // Check for manual booking overlap
        const overlapSnap = await adminDb
          .collection('bookings')
          .where('unit', '==', unitName)
          .where('status', '==', 'active')
          .get();

        let overlap = false;
        for (const d of overlapSnap.docs) {
          const o = d.data();
          if (o.source === 'airbnb') continue;
          if (checkInDate < o.checkOutDate && checkOutDate > o.checkInDate) {
            overlap = true;
            stats.errors.push(`Overlap with manual booking ${d.id}`);
            break;
          }
        }
        if (overlap) continue;

        const bookingData = {
          code: crypto.randomBytes(5).toString('hex'),
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
          guestLink: '',
          accessTokenHash: '',
          accessTokenCreatedAt: now,
          accessTokenRevokedAt: null,
        };

        const ref = await adminDb.collection('bookings').add(bookingData);
        await autoCreateCleaningJob(ref.id, unitName, checkOutDate, guestName);
        stats.created++;
      } else {
        const bookingDoc = existingSnap.docs[0];
        const booking = bookingDoc.data();
        const baseUpdate = { lastSyncedAt: now, syncMissCount: 0 };

        if (booking.syncHash === syncHash) {
          await bookingDoc.ref.update(baseUpdate);
          stats.unchanged++;
          continue;
        }

        await bookingDoc.ref.update({
          ...baseUpdate,
          syncHash,
          guestName,
          checkInDate,
          checkOutDate,
          updatedAt: now,
        });
        stats.updated++;

        if (booking.checkOutDate !== checkOutDate) {
          await cascadeCleaningJobDates({
            bookingId: bookingDoc.id,
            newCheckOutDate: checkOutDate,
            oldCheckOutDate: booking.checkOutDate,
            unit: unitName,
            guestName,
          });
        }
      }
    } catch (err) {
      stats.errors.push(`Event ${vevent.uid}: ${err.message}`);
    }
  }

  // Cancellation detection
  const today = new Date().toISOString().split('T')[0];
  const airbnbSnap = await adminDb
    .collection('bookings')
    .where('source', '==', 'airbnb')
    .where('unit', '==', unitName)
    .where('status', '==', 'active')
    .get();

  for (const bookingDoc of airbnbSnap.docs) {
    const booking = bookingDoc.data();
    if (booking.checkOutDate < today) continue;
    if (!seenExternalIds.has(booking.externalId)) {
      const missCount = (booking.syncMissCount || 0) + 1;
      if (missCount >= 2) {
        const now = new Date().toISOString();
        await bookingDoc.ref.update({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'ics-sync',
          syncMissCount: missCount,
          lastSyncedAt: now,
        });

        const jobsSnap = await adminDb
          .collection('cleaning_jobs')
          .where('bookingId', '==', bookingDoc.id)
          .get();

        for (const jobDoc of jobsSnap.docs) {
          if (RESCHEDULABLE.includes(jobDoc.data().status)) {
            await jobDoc.ref.update({ status: 'cancelled', cancelledAt: now, cancelledBy: 'ics-sync' });
          }
        }
        stats.cancelled++;
      } else {
        await bookingDoc.ref.update({ syncMissCount: missCount });
      }
    }
  }

  return stats;
}

export async function POST(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json().catch(() => ({}));
    const targetUnitId = body.unitId || null;

    const settingsDoc = await adminDb.collection('settings').doc('property').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    let feeds = (settings.icsFeeds || []).filter((f) => f.enabled && f.icsUrl);

    if (targetUnitId) {
      feeds = feeds.filter((f) => f.unitId === targetUnitId);
    }

    if (feeds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { feedsProcessed: 0, message: 'No enabled ICS feeds configured' },
      });
    }

    const totals = {
      feedsProcessed: feeds.length,
      eventsFound: 0,
      created: 0,
      updated: 0,
      cancelled: 0,
      unchanged: 0,
      errors: [],
    };

    for (const feed of feeds) {
      const stats = await processFeed(feed);
      totals.eventsFound += stats.eventsFound;
      totals.created += stats.created;
      totals.updated += stats.updated;
      totals.cancelled += stats.cancelled;
      totals.unchanged += stats.unchanged;
      totals.errors.push(...stats.errors);
    }

    totals.durationMs = Date.now();
    totals.triggeredBy = 'manual';
    totals.triggeredByUid = caller.uid;
    totals.createdAt = new Date().toISOString();

    await adminDb.collection('sync_log').add(totals);

    return NextResponse.json({ success: true, data: totals });
  } catch (error) {
    console.error('[POST /api/admin/sync-ics]', error);
    return NextResponse.json(
      { success: false, error: 'Sync failed.' },
      { status: 500 }
    );
  }
}
