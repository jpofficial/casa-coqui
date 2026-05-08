/**
 * Scheduled sweeper for welcome message lifecycle.
 *
 * Runs every 15 minutes and:
 *   1. Flips bookings with welcomeStatus='snoozed' + welcomeSnoozedUntil <= now
 *      back to 'ready' and fires a staff push.
 *   2. Flips bookings with welcomeStatus='pending' + createdAt older than 10 min
 *      to 'error' so they surface with a Retry button.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const { db } = require('./firebaseInit');
const { FieldValue } = require('firebase-admin/firestore');

/**
 * Write in-app staff_notifications docs for all active admin/cohost users.
 * Mirrors the pattern used in onAirbnbMessageCreated (index.js) and cleaningReminder.js.
 */
async function notifyAdminAndCohost({ title, body, type, data = {} }) {
  const usersSnap = await db
    .collection('users')
    .where('role', 'in', ['admin', 'cohost'])
    .where('status', '==', 'active')
    .get();

  const staffIds = usersSnap.docs.map((d) => d.id);
  if (staffIds.length === 0) return;

  const now = new Date().toISOString();

  await Promise.all(
    staffIds.map((uid) =>
      db.collection('staff_notifications').add({
        recipientId: uid,
        title,
        body,
        type,
        data,
        read: false,
        createdAt: now,
      })
    )
  );
}

exports.welcomeSweeper = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Puerto_Rico',
    memory: '256MiB',
    region: 'us-east1',
    timeoutSeconds: 60,
  },
  async () => {
    const now = new Date();
    const nowIso = now.toISOString();
    const tenMinAgoIso = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    // --- 1. Snoozed → Ready ---
    const snoozedSnap = await db
      .collection('bookings')
      .where('welcomeStatus', '==', 'snoozed')
      .where('welcomeSnoozedUntil', '<=', nowIso)
      .get();

    logger.info(`[welcomeSweeper] ${snoozedSnap.size} snoozed drafts are due`);

    for (const doc of snoozedSnap.docs) {
      const booking = doc.data();
      try {
        await doc.ref.update({
          welcomeStatus: 'ready',
          welcomeSnoozedUntil: FieldValue.delete(),
        });
        await notifyAdminAndCohost({
          title: 'Welcome draft ready',
          body: `${booking.guestName || 'Guest'} — review and mark as sent`,
          type: 'welcome_ready',
          data: { bookingId: doc.id, targetPath: '/admin/bookings' },
        });
      } catch (err) {
        logger.error('[welcomeSweeper] snooze flip failed', { id: doc.id, err: err.message });
      }
    }

    // --- 2. Stuck pending → Error ---
    const pendingSnap = await db
      .collection('bookings')
      .where('welcomeStatus', '==', 'pending')
      .where('createdAt', '<=', tenMinAgoIso)
      .get();

    logger.info(`[welcomeSweeper] ${pendingSnap.size} pending drafts are stuck (>10 min)`);

    for (const doc of pendingSnap.docs) {
      try {
        await doc.ref.update({
          welcomeStatus: 'error',
          welcomeError: 'Generation timed out — click Retry',
        });
      } catch (err) {
        logger.error('[welcomeSweeper] pending→error failed', { id: doc.id, err: err.message });
      }
    }
  }
);

// ---------------------------------------------------------------------------
// lockSweeper
//
// Flips airbnb_processing_locks from status:'processing' → 'reclaimable' when
// claimedAt is older than LOCK_STALE_THRESHOLD_MS. Crashed Lambda invocations
// leave locks in 'processing'; the next Lambda to see the lock can reclaim
// via its transactional slow-path once this sweeper marks it reclaimable.
// ---------------------------------------------------------------------------
const LOCK_STALE_THRESHOLD_MS = 5 * 60 * 1000;

exports.lockSweeper = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Puerto_Rico',
    memory: '256MiB',
    region: 'us-east1',
    timeoutSeconds: 60,
  },
  async () => {
    const cutoff = new Date(Date.now() - LOCK_STALE_THRESHOLD_MS);
    const snap = await db
      .collection('airbnb_processing_locks')
      .where('status', '==', 'processing')
      .where('claimedAt', '<', cutoff)
      .limit(50)
      .get();

    if (snap.empty) {
      logger.info('[lockSweeper] no stale tombstones');
      return;
    }

    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'reclaimable',
        reclaimedAt: new Date().toISOString(),
      });
    });
    await batch.commit();

    logger.info(`[lockSweeper] reclaimed ${snap.size} stale tombstones`);
  }
);
