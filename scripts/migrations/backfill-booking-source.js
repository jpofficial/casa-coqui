/**
 * Backfill source/sync fields on bookings and cleaning_jobs for ICS sync support.
 *
 * Bookings get:  source="manual", externalId=null, lastSyncedAt=null, syncHash=null
 * Cleaning jobs get: manualOverride=false, source="manual"
 *
 * Also reports any cleaning_jobs with stale scheduledDate vs linked booking checkOutDate.
 *
 * Usage:
 *   node scripts/migrations/backfill-booking-source.js          # dry-run (default)
 *   node scripts/migrations/backfill-booking-source.js --apply   # apply changes
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const envPath = resolve(__dirname, '..', '..', '.env.local');
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

const dryRun = !process.argv.includes('--apply');

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}\n`);

  // ── Backfill bookings ──────────────────────────────────────────────
  const bookingsSnap = await db.collection('bookings').get();
  const bookings = bookingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`Found ${bookings.length} total bookings`);

  let bookingsUpdated = 0;
  for (const booking of bookings) {
    const needsUpdate =
      booking.source === undefined ||
      booking.externalId === undefined ||
      booking.lastSyncedAt === undefined ||
      booking.syncHash === undefined;

    if (!needsUpdate) continue;

    const updates = {};
    if (booking.source === undefined) updates.source = 'manual';
    if (booking.externalId === undefined) updates.externalId = null;
    if (booking.lastSyncedAt === undefined) updates.lastSyncedAt = null;
    if (booking.syncHash === undefined) updates.syncHash = null;

    console.log(`  Booking ${booking.id} (${booking.guestName || 'unnamed'}) — adding: ${Object.keys(updates).join(', ')}`);

    if (!dryRun) {
      await db.collection('bookings').doc(booking.id).update(updates);
    }
    bookingsUpdated++;
  }
  console.log(`\nBookings: ${bookingsUpdated} ${dryRun ? 'would be' : ''} updated\n`);

  // ── Backfill cleaning_jobs ──────────────────────────────────────────
  const jobsSnap = await db.collection('cleaning_jobs').get();
  const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`Found ${jobs.length} total cleaning_jobs`);

  let jobsUpdated = 0;
  for (const job of jobs) {
    const needsUpdate =
      job.manualOverride === undefined ||
      job.source === undefined;

    if (!needsUpdate) continue;

    const updates = {};
    if (job.manualOverride === undefined) updates.manualOverride = false;
    if (job.source === undefined) updates.source = 'manual';

    console.log(`  Job ${job.id} (${job.unit} ${job.scheduledDate}) — adding: ${Object.keys(updates).join(', ')}`);

    if (!dryRun) {
      await db.collection('cleaning_jobs').doc(job.id).update(updates);
    }
    jobsUpdated++;
  }
  console.log(`\nCleaning jobs: ${jobsUpdated} ${dryRun ? 'would be' : ''} updated\n`);

  // ── Check for stale cleaning dates ─────────────────────────────────
  const bookingMap = new Map(bookings.map((b) => [b.id, b]));
  let staleCount = 0;

  console.log('── Stale cleaning date check ──');
  for (const job of jobs) {
    if (!job.bookingId) continue;
    if (['completed', 'archived', 'deleted', 'cancelled'].includes(job.status)) continue;

    const booking = bookingMap.get(job.bookingId);
    if (!booking) {
      console.log(`  ORPHAN: Job ${job.id} references missing booking ${job.bookingId}`);
      continue;
    }

    if (job.scheduledDate !== booking.checkOutDate) {
      console.log(`  STALE: Job ${job.id} (${job.unit}) scheduled=${job.scheduledDate} but booking checkout=${booking.checkOutDate}`);
      staleCount++;
    }
  }

  if (staleCount === 0) {
    console.log('  No stale cleaning dates found');
  } else {
    console.log(`\n  Found ${staleCount} stale cleaning date(s). These can be fixed by editing the booking dates in the admin UI (which now cascades to cleaning jobs).`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
