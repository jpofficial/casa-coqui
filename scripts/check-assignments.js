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

async function check() {
  // The failing maintenance request IDs
  const failingIds = ['c4tqyyQJBzwURHfcsaD6', '5pHebLFX2WnKPK1PVUjo'];
  // The working maintenance request IDs
  const workingIds = ['oVdN8xO8H95EHKetebCM', 'nxi94iH7LfGft39W9gRF'];

  console.log('=== Assignments for FAILING maintenance requests ===');
  for (const id of failingIds) {
    const snap = await db.collection('assignments')
      .where('maintenanceId', '==', id)
      .get();
    console.log(`  maintenanceId: ${id} | assignments found: ${snap.size}`);
  }

  console.log('\n=== Assignments for WORKING maintenance requests ===');
  for (const id of workingIds) {
    const snap = await db.collection('assignments')
      .where('maintenanceId', '==', id)
      .get();
    console.log(`  maintenanceId: ${id} | assignments found: ${snap.size}`);
  }

  console.log('\n=== All recent assignments (last 5) ===');
  const allSnap = await db.collection('assignments')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();
  allSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  ${data.createdAt} | source: ${data.source} | maintenanceId: ${data.maintenanceId || 'n/a'} | title: ${(data.title || '').slice(0, 50)}`);
  });

  process.exit(0);
}

check().catch(err => { console.error(err); process.exit(1); });
