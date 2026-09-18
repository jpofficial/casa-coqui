#!/usr/bin/env node
/**
 * One-time backfill: compute `threadKey` for every existing airbnb_messages doc
 * that doesn't yet have one.
 *
 * Usage:
 *   node scripts/migrations/backfill-thread-keys.js          # dry run (prints what would change)
 *   node scripts/migrations/backfill-thread-keys.js --apply  # actually writes
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env pointing to an admin-SDK
 * service-account JSON. Do NOT commit the key file — .gitignore covers
 * *firebase-adminsdk*.json.
 */

const admin = require('firebase-admin');
const { buildThreadKey } = require('../../lib/thread-key');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      'Set GOOGLE_APPLICATION_CREDENTIALS to the path of your admin-SDK JSON key before running.'
    );
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  const db = admin.firestore();
  const snap = await db.collection('airbnb_messages').get();

  console.log(`Scanned ${snap.size} airbnb_messages docs`);
  let planned = 0;
  let unresolved = 0;
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

    if (newKey === 'unknown') {
      console.warn(`  [WARN] ${doc.id} resolved to "unknown" — no bookingCode/email/name`);
      unresolved++;
    }

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

  if (unresolved > 0) {
    console.warn(`${unresolved} doc(s) resolved to "unknown" — manual review recommended.`);
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
