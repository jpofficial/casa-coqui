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
  // 1. Total staff_notifications count
  const allNotifs = await db.collection('staff_notifications').get();
  console.log('=== Total staff_notifications docs:', allNotifs.size, '===');
  allNotifs.docs.forEach(d => {
    const data = d.data();
    console.log('  ', data.createdAt, '| to:', data.recipientId, '| type:', data.type, '| method:', data.method, '| title:', (data.title || '').slice(0, 60));
  });

  // 2. Any docs created after the last known notification?
  console.log('\n=== Staff notifications after 2026-03-17T03:15:00Z ===');
  const recentSnap = await db.collection('staff_notifications')
    .where('createdAt', '>', '2026-03-17T03:15:00.000Z')
    .orderBy('createdAt', 'desc')
    .get();
  console.log('  Found:', recentSnap.size);
  recentSnap.docs.forEach(d => {
    const data = d.data();
    console.log('  ', data.createdAt, '|', data.type, '|', data.method, '|', data.title);
  });

  // 3. Last 5 maintenance requests + check for matching staff_notifications
  console.log('\n=== Last 5 maintenance requests + notification match ===');
  const maintSnap = await db.collection('maintenance')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();
  for (const d of maintSnap.docs) {
    const data = d.data();
    console.log('  ID:', d.id, '| created:', data.createdAt, '| category:', data.category, '| urgency:', data.urgency);
  }

  // 4. Staff user roles + custom claims check
  console.log('\n=== Admin UID (01juliop) token check ===');
  const adminUid = 'wv0rIw6assdOMR839hpffoDBlBj1';
  const adminTokens = await db.collection('fcm_tokens')
    .where('staffId', '==', adminUid)
    .get();
  console.log('  Tokens for admin:', adminTokens.size);
  adminTokens.docs.forEach(d => {
    const data = d.data();
    console.log('  token:', (data.token || '').slice(0, 30) + '...', '| platform:', data.platform, '| updated:', data.updatedAt);
  });

  process.exit(0);
}

check().catch(err => { console.error(err); process.exit(1); });
