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

async function cleanup() {
  const snap = await db.collection('staff_notifications')
    .where('data.requestId', '==', 'test-diag')
    .get();
  console.log(`Deleting ${snap.size} test notification docs...`);
  for (const d of snap.docs) {
    await d.ref.delete();
  }
  console.log('Done.');
  process.exit(0);
}

cleanup().catch(err => { console.error(err); process.exit(1); });
