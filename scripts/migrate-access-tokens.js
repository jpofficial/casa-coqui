/**
 * Generate access tokens for existing active bookings that don't have one.
 * Also creates guest_access_log docs if missing.
 *
 * Usage:
 *   node scripts/migrate-access-tokens.js          # dry-run (default)
 *   node scripts/migrate-access-tokens.js --apply   # apply changes
 */

const crypto = require('crypto');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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

const dryRun = !process.argv.includes('--apply');
const appUrl = env.NEXT_PUBLIC_APP_URL || 'https://casa-coqui.cc';

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`App URL: ${appUrl}\n`);

  const bookingsSnap = await db.collection('bookings')
    .where('status', '==', 'active')
    .get();

  console.log(`Found ${bookingsSnap.size} active bookings\n`);

  let migrated = 0;
  let skipped = 0;

  for (const doc of bookingsSnap.docs) {
    const booking = doc.data();
    const code = booking.code;

    if (booking.accessTokenHash) {
      console.log(`  [skip] ${code} — already has access token`);
      skipped++;
      continue;
    }

    const accessToken = crypto.randomBytes(32).toString('base64url');
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    const now = new Date().toISOString();
    const newGuestLink = `${appUrl}/g/${code}?t=${accessToken}`;

    console.log(`  [migrate] ${code}`);
    console.log(`    guest: ${booking.guestName || '(unnamed)'}`);
    console.log(`    new link: ${newGuestLink}`);

    if (!dryRun) {
      await doc.ref.update({
        accessTokenHash,
        accessTokenCreatedAt: now,
        accessTokenRevokedAt: null,
        guestLink: newGuestLink,
      });

      // Create guest_access_log if missing
      const logRef = db.collection('guest_access_log').doc(code);
      const logDoc = await logRef.get();
      if (!logDoc.exists) {
        await logRef.set({
          bookingCode: code,
          inviteCreatedAt: booking.createdAt || now,
          linkCopiedAt: null,
          linkOpenedAt: null,
          portalViewedAt: null,
          checkedInAt: booking.checkedInAt || null,
          lastSeenAt: null,
          expiredAt: null,
          revokedAt: null,
          pushEnabled: false,
          accessCount: 0,
        });
      }

      console.log(`    ✓ updated`);
    }

    migrated++;
  }

  console.log(`\n${migrated} bookings ${dryRun ? 'would be' : ''} migrated, ${skipped} skipped.`);

  if (dryRun && migrated > 0) {
    console.log(`\nRe-run with --apply to write changes.`);
    console.log(`IMPORTANT: After applying, you must re-send the new guest links to active guests via Airbnb.`);
  }

  console.log('\nDone.');
}

main().catch(console.error);
