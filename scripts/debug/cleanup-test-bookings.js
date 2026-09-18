#!/usr/bin/env node
/**
 * Remove all docs tagged with { _test: true } by seed-test-bookings.js.
 * Safe to run multiple times.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json \
 *     node scripts/debug/cleanup-test-bookings.js
 */

const admin = require('firebase-admin');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS before running this script.');
  process.exit(1);
}
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const db = admin.firestore();
const COLLECTIONS = ['bookings', 'airbnb_messages'];

async function main() {
  let totalDeleted = 0;
  for (const coll of COLLECTIONS) {
    const snap = await db.collection(coll).where('_test', '==', true).get();
    if (snap.empty) {
      console.log(`  ${coll}: no test docs`);
      continue;
    }
    let batch = db.batch();
    let count = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      count++;
      if (count % 500 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (count % 500 !== 0) await batch.commit();
    console.log(`  ${coll}: deleted ${count}`);
    totalDeleted += count;
  }
  console.log(`\nDone. Removed ${totalDeleted} test docs.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
