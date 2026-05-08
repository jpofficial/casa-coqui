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

const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY || '""');
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

// Map old hardcoded names → correct settings names
const FIX_MAP = {
  'Casa Coqui Cielo': 'Coquí Cielo',
  'Casa Coqui Tierra': 'Coquí Tierra',
};

async function main() {
  const snap = await db.collection('cleaning_jobs').get();
  let fixed = 0;
  for (const doc of snap.docs) {
    const unit = doc.data().unit;
    if (FIX_MAP[unit]) {
      await doc.ref.update({ unit: FIX_MAP[unit] });
      console.log(doc.id, ':', unit, '→', FIX_MAP[unit]);
      fixed++;
    }
  }
  console.log(fixed > 0 ? `\nFixed ${fixed} job(s).` : 'No jobs needed fixing.');
}

main().catch(console.error);
