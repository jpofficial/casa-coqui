const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const envPath = resolve('/Users/jperez/dev/casa-coqui', '.env.local');
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
  // 1. Check users with admin/cohost role + active status
  console.log('=== Users with role admin/cohost ===');
  const usersSnap = await db.collection('users').where('role', 'in', ['admin', 'cohost']).get();
  usersSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  UID: ${d.id} | role: ${data.role} | status: "${data.status}" | email: ${data.email}`);
  });

  // 2. Now check with the exact query notifyAdminAndCohost uses
  console.log('\n=== notifyAdminAndCohost query (role in [admin,cohost] AND status == active) ===');
  const activeSnap = await db.collection('users')
    .where('role', 'in', ['admin', 'cohost'])
    .where('status', '==', 'active')
    .get();
  console.log(`  Found: ${activeSnap.size} users`);
  activeSnap.docs.forEach(d => console.log(`  UID: ${d.id} | role: ${d.data().role}`));

  // 3. Check FCM tokens for staff
  console.log('\n=== FCM Tokens with staffId ===');
  const tokenSnap = await db.collection('fcm_tokens').get();
  const staffTokens = tokenSnap.docs.filter(d => d.data().staffId);
  console.log(`  Total tokens: ${tokenSnap.size} | Staff tokens: ${staffTokens.length}`);
  staffTokens.forEach(d => {
    const data = d.data();
    console.log(`  staffId: ${data.staffId} | token: ${data.token?.slice(0, 20)}... | platform: ${data.platform}`);
  });

  // 4. Check staff_notifications collection
  console.log('\n=== Staff Notifications (last 5) ===');
  const notifSnap = await db.collection('staff_notifications')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();
  console.log(`  Total found: ${notifSnap.size}`);
  notifSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  ${data.createdAt} | to: ${data.recipientId} | type: ${data.type} | method: ${data.method} | title: ${data.title?.slice(0, 50)}`);
  });

  // 5. Check recent maintenance requests
  console.log('\n=== Recent Maintenance Requests (last 3) ===');
  const maintSnap = await db.collection('maintenance')
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get();
  maintSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  ${data.createdAt} | ${data.category} | ${data.urgency} | status: ${data.status} | booking: ${data.bookingCode}`);
  });

  process.exit(0);
}

check().catch(err => { console.error(err); process.exit(1); });
