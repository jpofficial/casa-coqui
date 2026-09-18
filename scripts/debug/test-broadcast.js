const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

// Load .env.local
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
const messaging = getMessaging(app);

async function testBroadcast() {
  const title = 'Test Broadcast';
  const body = 'Hello guests! This is a test notification.';
  const type = 'general';

  console.log('Sending test broadcast...\n');

  // 1. Fetch active bookings
  const bookingsSnap = await db
    .collection('bookings')
    .where('status', '==', 'active')
    .get();

  if (bookingsSnap.empty) {
    console.log('No active bookings found. Run `node scripts/seed/seed-data.js` first.');
    process.exit(1);
  }

  const bookingCodes = bookingsSnap.docs.map((doc) => doc.data().code).filter(Boolean);
  console.log(`Found ${bookingCodes.length} active booking(s): ${bookingCodes.join(', ')}`);

  // 2. Fetch FCM tokens
  const tokensByCode = {};
  const tokensSnap = await db.collection('fcm_tokens').get();
  tokensSnap.docs.forEach((doc) => {
    const { bookingCode, token } = doc.data();
    if (bookingCode && token) {
      if (!tokensByCode[bookingCode]) tokensByCode[bookingCode] = [];
      tokensByCode[bookingCode].push(token);
    }
  });

  const fcmTokens = [];
  for (const code of bookingCodes) {
    const tokens = tokensByCode[code] || [];
    fcmTokens.push(...tokens);
  }

  console.log(`Found ${fcmTokens.length} FCM token(s) to push to`);

  // 3. Send push (if tokens exist)
  let pushCount = 0;
  let failedCount = 0;

  if (fcmTokens.length > 0) {
    const result = await messaging.sendEachForMulticast({
      tokens: fcmTokens,
      notification: { title, body },
      data: { type },
    });
    pushCount = result.successCount;
    failedCount = result.failureCount;
    console.log(`Push results: ${pushCount} sent, ${failedCount} failed`);
  } else {
    console.log('No FCM tokens — push skipped (notification will be in-app only)');
  }

  // 4. Write Firestore doc (the critical part we fixed)
  const docRef = await db.collection('notifications').add({
    type,
    title,
    message: body,
    broadcast: true,
    category: type,
    readBy: [],
    createdAt: new Date().toISOString(),
    sentBy: 'admin',
    recipientCount: pushCount + failedCount,
    results: { push: pushCount, failed: failedCount },
  });

  console.log(`\nFirestore doc created: notifications/${docRef.id}`);
  console.log('Fields: broadcast=true, category="general", readBy=[]');
  console.log('\nDone! Check the guest notification center to see it appear.');
  process.exit(0);
}

testBroadcast().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
