const { readFileSync } = require('fs');
const { resolve } = require('path');
const admin = require('firebase-admin');

// Load .env.local manually
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

const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const db = admin.firestore();

async function check() {
  const list = await admin.auth().listUsers(20);
  console.log('=== AUTH USERS ===');
  for (const u of list.users) {
    console.log(u.uid, u.email, u.displayName, 'claims:', JSON.stringify(u.customClaims || {}));
  }

  console.log('');
  console.log('=== FIRESTORE USERS DOCS ===');
  const snap = await db.collection('users').get();
  if (snap.empty) {
    console.log('(no docs found)');
  } else {
    snap.forEach((d) => {
      console.log(d.id, JSON.stringify(d.data()));
    });
  }
}

check().catch(console.error);
