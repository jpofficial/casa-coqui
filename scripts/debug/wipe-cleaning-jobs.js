/**
 * Wipe all cleaning_jobs documents from Firestore.
 * Usage: node scripts/debug/wipe-cleaning-jobs.js [--dry-run]
 *
 * Pass --dry-run to list jobs without deleting.
 */
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ── Parse .env.local ──
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

const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY || '""');
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const snap = await db.collection('cleaning_jobs').get();

  if (snap.empty) {
    console.log('No cleaning_jobs found. Collection is already clean.');
    return;
  }

  console.log(`Found ${snap.size} cleaning_jobs:\n`);
  console.log('ID'.padEnd(22), 'Status'.padEnd(16), 'Unit'.padEnd(20), 'Date'.padEnd(12), 'Assignee');
  console.log('-'.repeat(90));

  for (const doc of snap.docs) {
    const d = doc.data();
    console.log(
      doc.id.padEnd(22),
      (d.status || '?').padEnd(16),
      (d.unit || '?').padEnd(20),
      (d.scheduledDate || '?').padEnd(12),
      d.assigneeName || d.assigneeId || '—'
    );
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would delete ${snap.size} documents. Run without --dry-run to delete.`);
    return;
  }

  console.log(`\nDeleting ${snap.size} documents...`);

  // Batch delete (max 500 per batch)
  const batches = [];
  let batch = db.batch();
  let count = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    count++;
    if (count % 500 === 0) {
      batches.push(batch);
      batch = db.batch();
    }
  }
  if (count % 500 !== 0) batches.push(batch);

  for (const b of batches) {
    await b.commit();
  }

  console.log(`Deleted ${snap.size} cleaning_jobs. Collection is now empty.`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
