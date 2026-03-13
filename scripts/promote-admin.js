const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
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
const authAdmin = getAuth(app);
const db = getFirestore(app);

async function promote() {
  const email = '01juliop@gmail.com';
  const user = await authAdmin.getUserByEmail(email);
  console.log('Found user:', user.uid, user.email);
  console.log('Current claims:', user.customClaims);

  await authAdmin.setCustomUserClaims(user.uid, { role: 'admin' });
  console.log('Custom claims set to: { role: "admin" }');

  await db.collection('users').doc(user.uid).set(
    { role: 'admin', status: 'active' },
    { merge: true }
  );
  console.log('Firestore users doc updated to role: admin');
  process.exit(0);
}

promote().catch((err) => {
  console.error(err);
  process.exit(1);
});
