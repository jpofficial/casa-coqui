/**
 * Fix mangled units data in Firestore settings/property.
 *
 * Problem: The `units` array contains mangled objects like:
 *   { "0":"U", "1":"n", "2":"i", "3":"t", "4":" ", "5":"A", name: "Coquí Cielo" }
 * These came from spreading a string (`{...'Unit A', name: 'new'}`) in the admin UI.
 *
 * Fix: Replace with clean [{id, name}] objects using the positional index
 * to assign stable ids (unit-a, unit-b).
 *
 * Also: Find any booking without a `unitId` and assign it based on unit name match.
 */

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

const DEFAULT_IDS = ['unit-a', 'unit-b'];

async function fixUnits() {
  // 1. Fix settings/property units array
  const settingsRef = db.doc('settings/property');
  const settingsSnap = await settingsRef.get();
  const settings = settingsSnap.data();

  console.log('Current units:', JSON.stringify(settings.units, null, 2));

  const fixedUnits = (settings.units || []).map((entry, i) => {
    const id = DEFAULT_IDS[i] || `unit-${String.fromCharCode(97 + i)}`;
    const name = typeof entry === 'string' ? entry : (entry?.name || `Unit ${String.fromCharCode(65 + i)}`);
    return { id, name };
  });

  console.log('\nFixed units:', JSON.stringify(fixedUnits, null, 2));

  await settingsRef.update({ units: fixedUnits });
  console.log('\n✓ settings/property.units updated');

  // 2. Fix bookings missing unitId
  const bookingsSnap = await db.collection('bookings').where('status', '==', 'active').get();
  let fixed = 0;

  for (const doc of bookingsSnap.docs) {
    const booking = doc.data();
    if (booking.unitId) continue; // already has unitId

    if (!booking.unit) {
      console.log(`  Skipping ${doc.id} (no unit field)`);
      continue;
    }

    // Match unit display name to fixed units
    const match = fixedUnits.find(
      (u) => u.name === booking.unit || u.name.toLowerCase() === booking.unit.toLowerCase()
    );

    if (match) {
      console.log(`  Fixing booking ${doc.id}: unit="${booking.unit}" → unitId="${match.id}"`);
      await doc.ref.update({ unitId: match.id });
      fixed++;
    } else {
      console.log(`  WARNING: booking ${doc.id} unit="${booking.unit}" — no match found in fixed units`);
    }
  }

  console.log(`\n✓ Fixed ${fixed} booking(s) with missing unitId`);
  process.exit(0);
}

fixUnits().catch((err) => {
  console.error('Fix failed:', err);
  process.exit(1);
});
