/**
 * Backfill bookings.checkedIn for existing bookings that have a checkins doc.
 *
 * Usage:
 *   node scripts/migrations/backfill-checkedin.js          # dry-run (default)
 *   node scripts/migrations/backfill-checkedin.js --apply   # apply changes
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

  // 1. Get all bookings where checkedIn is false or missing
  const bookingsSnap = await db.collection('bookings').get();
  const bookings = bookingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`Found ${bookings.length} total bookings`);

  const needsFix = [];

  for (const booking of bookings) {
    if (booking.checkedIn) continue; // already correct

    const code = booking.code;
    if (!code) continue;

    // Check if checkins/{code} exists
    const checkinDoc = await db.collection('checkins').doc(code).get();
    if (checkinDoc.exists && checkinDoc.data().checkedIn) {
      const checkedInAt = checkinDoc.data().checkedInAt || null;
      needsFix.push({ id: booking.id, code, checkedInAt });
    }
  }

  console.log(`Found ${needsFix.length} bookings needing checkedIn backfill:\n`);

  for (const fix of needsFix) {
    console.log(`  booking ${fix.id} (code: ${fix.code}) → checkedIn: true, checkedInAt: ${fix.checkedInAt}`);

    if (!dryRun) {
      const update = { checkedIn: true };
      if (fix.checkedInAt) update.checkedInAt = fix.checkedInAt;
      await db.collection('bookings').doc(fix.id).update(update);
      console.log(`    ✓ updated`);
    }
  }

  if (dryRun && needsFix.length > 0) {
    console.log(`\nRe-run with --apply to write changes.`);
  }

  console.log('\nDone.');
}

main().catch(console.error);
