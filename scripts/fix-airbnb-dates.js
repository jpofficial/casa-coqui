/**
 * One-shot backfill: re-derive Airbnb booking dates from live ICS feeds
 * using the fixed parser in functions/lib/ics-date.js, and correct any
 * bookings whose stored checkInDate/checkOutDate disagree with the feed.
 *
 * Cascades corrected checkout dates to linked cleaning_jobs via the same
 * rules as the Cloud Function cascade (respects manualOverride,
 * in-progress statuses, historical statuses).
 *
 * Usage:
 *   node scripts/fix-airbnb-dates.js                 # dry-run (default)
 *   node scripts/fix-airbnb-dates.js --apply         # write changes
 *   node scripts/fix-airbnb-dates.js --feed unit-a   # restrict to one feed
 *
 * Idempotent: a second run after --apply produces zero corrections.
 */

'use strict';

const { readFileSync } = require('fs');
const { resolve } = require('path');
const crypto = require('crypto');
const ical = require('node-ical');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const { veventDateToYMD } = require('../functions/lib/ics-date');

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const feedFilterIdx = args.indexOf('--feed');
const feedFilter = feedFilterIdx >= 0 ? args[feedFilterIdx + 1] : null;

// ── Firebase init (same pattern as other scripts) ──────────────────────────
const envPath = resolve(__dirname, '..', '.env.local');
const envFile = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) continue;
  env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
}
const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

// ── Cascade logic (mirrors functions/icsSync.js) ───────────────────────────
const HISTORICAL_STATUSES = ['completed', 'archived', 'deleted', 'cancelled'];
const IN_PROGRESS_STATUSES = [
  'en_route', 'arrived', 'before_photos', 'cleaning', 'after_photos', 'laundry_check',
];
const RESCHEDULABLE_STATUSES = ['scheduled', 'acknowledged', 'declined'];

function computeSyncHash(uid, dtstart, dtend, summary) {
  return crypto
    .createHash('sha256')
    .update(`${uid}|${dtstart}|${dtend}|${summary || ''}`)
    .digest('hex')
    .slice(0, 16);
}

async function cascadeForBacklog(bookingId, newCheckOutDate, oldCheckOutDate) {
  const result = { updated: 0, skippedOverride: 0, skippedInProgress: 0, skippedHistorical: 0 };
  if (!bookingId || newCheckOutDate === oldCheckOutDate) return result;

  const jobsSnap = await db
    .collection('cleaning_jobs')
    .where('bookingId', '==', bookingId)
    .get();
  if (jobsSnap.empty) return result;

  const now = new Date().toISOString();
  for (const jobDoc of jobsSnap.docs) {
    const job = jobDoc.data();
    if (HISTORICAL_STATUSES.includes(job.status)) { result.skippedHistorical++; continue; }
    if (IN_PROGRESS_STATUSES.includes(job.status)) { result.skippedInProgress++; continue; }
    if (job.manualOverride === true) { result.skippedOverride++; continue; }
    if (!RESCHEDULABLE_STATUSES.includes(job.status)) continue;
    if (job.scheduledDate === newCheckOutDate) continue;

    if (!dryRun) {
      await jobDoc.ref.update({
        scheduledDate: newCheckOutDate,
        status: 'scheduled',
        acknowledgedAt: null,
        declinedAt: null,
        declineReason: null,
        updatedAt: now,
      });
    }
    result.updated++;
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}${feedFilter ? ` (feed=${feedFilter})` : ''}\n`);

  const settingsDoc = await db.collection('settings').doc('property').get();
  if (!settingsDoc.exists) {
    console.error('settings/property does not exist. Aborting.');
    process.exit(1);
  }
  const feeds = (settingsDoc.data().icsFeeds || [])
    .filter((f) => f.enabled && f.icsUrl)
    .filter((f) => !feedFilter || f.unitId === feedFilter || f.unitName === feedFilter);

  if (feeds.length === 0) {
    console.error('No matching enabled ICS feeds found. Aborting.');
    process.exit(1);
  }

  const summary = {
    feeds: feeds.length,
    veventsSeen: 0,
    bookingsMatched: 0,
    bookingsCorrected: 0,
    bookingsUnchanged: 0,
    veventsUnmatched: 0,
    cleaningJobsUpdated: 0,
    cleaningJobsSkippedOverride: 0,
    cleaningJobsSkippedInProgress: 0,
    cleaningJobsSkippedHistorical: 0,
  };

  for (const feed of feeds) {
    console.log(`── Feed: ${feed.unitName} (${feed.unitId}) ──`);
    let parsed;
    try {
      parsed = await ical.async.fromURL(feed.icsUrl);
    } catch (err) {
      console.error(`  Failed to fetch: ${err.message}`);
      continue;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90); // wider window than sync (it uses -7)

    for (const event of Object.values(parsed)) {
      if (event.type !== 'VEVENT') continue;
      const isDateOnly = event.datetype === 'date';
      const newCheckIn = veventDateToYMD(event.start, { dateOnly: isDateOnly });
      const newCheckOut = veventDateToYMD(event.end, { dateOnly: isDateOnly });
      if (!newCheckIn || !newCheckOut) continue;
      if (new Date(newCheckOut) < cutoff) continue;
      summary.veventsSeen++;

      const existingSnap = await db
        .collection('bookings')
        .where('externalId', '==', event.uid)
        .where('unit', '==', feed.unitName)
        .get();

      if (existingSnap.empty) {
        summary.veventsUnmatched++;
        console.log(`  UNMATCHED  uid=${event.uid} ${newCheckIn} → ${newCheckOut}`);
        continue;
      }

      const bookingDoc = existingSnap.docs[0];
      const booking = bookingDoc.data();
      summary.bookingsMatched++;

      const needsUpdate =
        booking.checkInDate !== newCheckIn || booking.checkOutDate !== newCheckOut;

      if (!needsUpdate) {
        summary.bookingsUnchanged++;
        continue;
      }

      const newSyncHash = computeSyncHash(event.uid, newCheckIn, newCheckOut, event.summary || '');
      const now = new Date().toISOString();

      console.log(
        `  CORRECT    booking=${bookingDoc.id} unit=${feed.unitName} ` +
        `checkIn ${booking.checkInDate} → ${newCheckIn}, ` +
        `checkOut ${booking.checkOutDate} → ${newCheckOut}`
      );
      summary.bookingsCorrected++;

      if (!dryRun) {
        await bookingDoc.ref.update({
          checkInDate: newCheckIn,
          checkOutDate: newCheckOut,
          syncHash: newSyncHash,
          lastSyncedAt: now,
          updatedAt: now,
        });
      }

      const cascade = await cascadeForBacklog(
        bookingDoc.id,
        newCheckOut,
        booking.checkOutDate
      );
      summary.cleaningJobsUpdated += cascade.updated;
      summary.cleaningJobsSkippedOverride += cascade.skippedOverride;
      summary.cleaningJobsSkippedInProgress += cascade.skippedInProgress;
      summary.cleaningJobsSkippedHistorical += cascade.skippedHistorical;

      if (cascade.updated || cascade.skippedOverride || cascade.skippedInProgress || cascade.skippedHistorical) {
        console.log(
          `             cleaning: updated=${cascade.updated} ` +
          `skippedOverride=${cascade.skippedOverride} ` +
          `skippedInProgress=${cascade.skippedInProgress} ` +
          `skippedHistorical=${cascade.skippedHistorical}`
        );
      }
    }
  }

  console.log('\n── Summary ──');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  console.log(dryRun ? '\nDry-run complete. Re-run with --apply to write changes.' : '\nApplied.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
