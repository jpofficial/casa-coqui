#!/usr/bin/env node
/**
 * One-time backfill: compute `threadKey` for every existing airbnb_messages doc
 * that doesn't yet have one.
 *
 * Usage:
 *   node scripts/backfill-thread-keys.js          # dry run (prints what would change)
 *   node scripts/backfill-thread-keys.js --apply  # actually writes
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env or the service-account JSON
 * at casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json (already in repo root).
 */

const path = require('path');
const admin = require('firebase-admin');
const { buildThreadKey } = require('../lib/thread-key');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

async function main() {
  if (!admin.apps.length) {
    const keyPath = path.resolve(
      __dirname,
      '..',
      'casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json'
    );
    admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
  }

  const db = admin.firestore();
  const snap = await db.collection('airbnb_messages').get();

  console.log(`Scanned ${snap.size} airbnb_messages docs`);
  let planned = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.threadKey) continue; // already backfilled

    const newKey = buildThreadKey({
      bookingCode: data.bookingCode || null,
      senderEmail: data.senderEmail || data.fromAddress || null,
      senderName: data.guestName || data.fromName || null,
    });

    planned++;
    if (APPLY) {
      batch.update(doc.ref, { threadKey: newKey });
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`  committed batch (${batchCount} updates)`);
        batch = db.batch();
        batchCount = 0;
      }
    } else {
      console.log(`  would set ${doc.id}.threadKey = "${newKey}"`);
    }
  }

  if (APPLY && batchCount > 0) {
    await batch.commit();
    console.log(`  committed final batch (${batchCount} updates)`);
  }

  console.log(
    APPLY
      ? `Done. Updated ${planned} docs.`
      : `Dry run. Would update ${planned} docs. Re-run with --apply to commit.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
