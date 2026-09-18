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

async function diagnose() {
  // 1. Active bookings
  const bookings = await db.collection('bookings').where('status', '==', 'active').get();
  console.log('=== Active Bookings ===');
  bookings.docs.forEach(d => console.log(d.id, '| code:', d.data().code, '| guest:', d.data().guestName));

  // 2. FCM tokens
  const tokens = await db.collection('fcm_tokens').get();
  console.log('\n=== FCM Tokens (' + tokens.size + ' total) ===');
  tokens.docs.forEach(d => {
    const data = d.data();
    console.log('  ', d.id.slice(0, 20) + '...', '| bookingCode:', data.bookingCode || 'NONE', '| staffId:', data.staffId || 'n/a');
  });

  // 3. Recent notifications (last 5)
  const notifs = await db.collection('notifications').orderBy('createdAt', 'desc').limit(5).get();
  console.log('\n=== Recent Notifications ===');
  notifs.docs.forEach(d => {
    const data = d.data();
    console.log('  ', d.id, '|', data.type, '|', JSON.stringify(data.title), '|', data.createdAt, '| push:', data.results?.push, 'failed:', data.results?.failed);
  });

  // 4. Recent community posts
  const posts = await db.collection('community').orderBy('createdAt', 'desc').limit(5).get();
  console.log('\n=== Recent Community Posts ===');
  posts.docs.forEach(d => {
    const data = d.data();
    console.log('  ', d.id, '|', data.type, '|', data.postedByRole, '|', data.createdAt);
  });

  // 5. Cooldown check
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const cooldown = await db.collection('notifications').where('type', '==', 'parking').where('createdAt', '>', cutoff).limit(1).get();
  console.log('\n=== Parking Cooldown Active? ===', !cooldown.empty);
  if (!cooldown.empty) {
    const cd = cooldown.docs[0].data();
    console.log('  Last parking broadcast:', cd.createdAt);
  }

  // 6. Notification prefs
  const prefs = await db.collection('notification_prefs').get();
  console.log('\n=== Notification Prefs ===');
  if (prefs.empty) {
    console.log('  (none set)');
  } else {
    prefs.docs.forEach(d => console.log('  ', d.id, ':', JSON.stringify(d.data())));
  }

  process.exit(0);
}

diagnose().catch(e => { console.error(e); process.exit(1); });
