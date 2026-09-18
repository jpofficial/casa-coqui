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

const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY || '""');
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

async function main() {
  const doc = await db.collection('settings').doc('property').get();
  if (!doc.exists) {
    console.log('settings/property does NOT exist — will use defaults: Unit A, Unit B');
    return;
  }
  const data = doc.data();
  console.log('settings/property.units:', JSON.stringify(data.units, null, 2));

  // What CleanerHome sees
  const unitNames = (data.units || []).map(u => u.name);
  console.log('\nUnit names CleanerHome uses:', unitNames);

  // What the form hardcodes
  console.log('Form hardcodes:', ['Casa Coqui Tierra', 'Casa Coqui Cielo']);

  // Check the job
  const jobs = await db.collection('cleaning_jobs').get();
  jobs.docs.forEach(d => {
    const j = d.data();
    const match = unitNames.includes(j.unit);
    console.log('\nJob unit:', JSON.stringify(j.unit), '| matches settings?', match);
    if (!match) {
      console.log('>>> MISMATCH! Job won\'t appear in CleanerHome unit sections.');
    }
  });
}

main().catch(console.error);
