const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

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
const auth = getAuth(app);

async function diag() {
  // 1. Find cleaner user(s)
  console.log('=== CLEANER USERS ===');
  const cleanerSnap = await db.collection('users').where('role', '==', 'cleaner').get();
  console.log('  Found:', cleanerSnap.size);
  cleanerSnap.docs.forEach(d => {
    const data = d.data();
    console.log('  UID:', d.id, '| status:', data.status, '| name:', data.displayName, '| email:', data.email);
  });

  const cleanerUids = cleanerSnap.docs.map(d => d.id);

  // 2. Check cleaner's custom claims
  console.log('\n=== CLEANER AUTH CLAIMS ===');
  for (const uid of cleanerUids) {
    try {
      const userRecord = await auth.getUser(uid);
      console.log('  UID:', uid, '| claims:', JSON.stringify(userRecord.customClaims));
    } catch (e) {
      console.log('  UID:', uid, '| ERROR:', e.message);
    }
  }

  // 3. Check FCM tokens for cleaners
  console.log('\n=== ALL STAFF FCM TOKENS ===');
  const allTokens = await db.collection('fcm_tokens').get();
  console.log('  Total token docs:', allTokens.size);
  const staffTokens = allTokens.docs.filter(d => d.data().staffId);
  staffTokens.forEach(d => {
    const data = d.data();
    console.log('  staffId:', data.staffId, '| token:', (data.token || '').slice(0, 30) + '...', '| platform:', data.platform);
  });

  console.log('\n=== CLEANER-SPECIFIC FCM TOKENS ===');
  for (const uid of cleanerUids) {
    const tSnap = await db.collection('fcm_tokens').where('staffId', '==', uid).get();
    console.log('  Cleaner', uid, ': found', tSnap.size, 'tokens');
    tSnap.docs.forEach(d => {
      const data = d.data();
      console.log('    token:', (data.token || '').slice(0, 30) + '...', '| platform:', data.platform);
    });
  }

  // 4. Recent cleaning_jobs
  console.log('\n=== RECENT CLEANING JOBS (last 5) ===');
  const jobSnap = await db.collection('cleaning_jobs').orderBy('createdAt', 'desc').limit(5).get();
  jobSnap.docs.forEach(d => {
    const data = d.data();
    console.log('  id:', d.id, '| unit:', data.unit, '| date:', data.scheduledDate, '| status:', data.status,
      '| assigneeId:', data.assigneeId, '| bookingId:', data.bookingId, '| createdBy:', data.createdBy,
      '| created:', data.createdAt);
  });

  // 5. Recent staff_notifications (all types)
  console.log('\n=== RECENT STAFF NOTIFICATIONS (last 10) ===');
  const notifSnap = await db.collection('staff_notifications').orderBy('createdAt', 'desc').limit(10).get();
  notifSnap.docs.forEach(d => {
    const data = d.data();
    console.log(' ', data.createdAt, '| to:', data.recipientId, '| type:', data.type,
      '| method:', data.method, '| title:', (data.title || '').slice(0, 60));
  });

  // 6. Check if cleaner's recipientId appears in staff_notifications at all
  console.log('\n=== STAFF NOTIFICATIONS FOR CLEANER ===');
  for (const uid of cleanerUids) {
    const cNotifSnap = await db.collection('staff_notifications')
      .where('recipientId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    console.log('  Cleaner', uid, ': found', cNotifSnap.size, 'notifications');
    cNotifSnap.docs.forEach(d => {
      const data = d.data();
      console.log('   ', data.createdAt, '| type:', data.type, '| method:', data.method, '| title:', data.title);
    });
  }

  process.exit(0);
}
diag().catch(err => { console.error(err); process.exit(1); });
