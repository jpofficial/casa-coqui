const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

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
const messaging = getMessaging(app);

// Replicate the exact logic from lib/staff-notifications.js
function isStaleTokenError(error) {
  const code = error?.code || error?.errorInfo?.code || '';
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token'
  );
}

async function notifyStaff({ staffIds, title, body, type = 'staff', data = {} }) {
  try {
    if (!staffIds || staffIds.length === 0) {
      console.log('  [notifyStaff] No staff IDs provided, returning early');
      return { success: true, data: { push: 0, failed: 0 } };
    }

    let pushCount = 0;
    let failedCount = 0;

    for (const uid of staffIds) {
      let method = 'none';
      console.log(`  [notifyStaff] Processing UID: ${uid}`);

      const tokenSnap = await db
        .collection('fcm_tokens')
        .where('staffId', '==', uid)
        .get();

      console.log(`    FCM tokens found: ${tokenSnap.size}`);

      let pushSent = false;
      if (!tokenSnap.empty) {
        for (const tokenDocSnap of tokenSnap.docs) {
          const token = tokenDocSnap.data().token;
          if (!token) continue;
          try {
            console.log(`    Sending FCM to token: ${token.slice(0, 20)}...`);
            await messaging.send({
              token,
              notification: { title, body },
              data: { type, ...data },
            });
            pushSent = true;
            pushCount++;
            method = 'push';
            console.log(`    FCM sent successfully`);
            break;
          } catch (fcmErr) {
            console.error(`    FCM failed: ${fcmErr.code || fcmErr.message}`);
            if (isStaleTokenError(fcmErr)) {
              console.log(`    Cleaning up stale token`);
              tokenDocSnap.ref.delete().catch(() => {});
            }
          }
        }
      }

      if (!pushSent) {
        failedCount++;
        method = 'none';
        console.log(`    No push sent for ${uid}`);
      }

      // Write staff_notification doc
      console.log(`    Writing staff_notifications doc (method: ${method})`);
      await db.collection('staff_notifications').add({
        recipientId: uid,
        title,
        body,
        type,
        method,
        read: false,
        data,
        createdAt: new Date().toISOString(),
      });
      console.log(`    Doc written successfully`);
    }

    return { success: true, data: { push: pushCount, failed: failedCount } };
  } catch (error) {
    console.error('[notifyStaff] Error:', error);
    return { success: false, error: error.message };
  }
}

async function notifyAdminAndCohost({ title, body, type = 'staff', data = {} }) {
  try {
    console.log('[notifyAdminAndCohost] Querying users...');
    const usersSnap = await db
      .collection('users')
      .where('role', 'in', ['admin', 'cohost'])
      .where('status', '==', 'active')
      .get();

    const staffIds = usersSnap.docs.map((d) => d.id);
    console.log(`[notifyAdminAndCohost] Found ${staffIds.length} staff:`, staffIds);
    return notifyStaff({ staffIds, title, body, type, data });
  } catch (error) {
    console.error('[notifyAdminAndCohost] Error:', error);
    return { success: false, error: error.message };
  }
}

async function test() {
  console.log('=== Testing notifyAdminAndCohost (DRY RUN with real Firestore) ===\n');

  const result = await notifyAdminAndCohost({
    title: 'TEST: Maintenance: water (medium)',
    body: 'This is a test notification from diagnostic script',
    type: 'maintenance',
    data: { requestId: 'test-diag', category: 'water', urgency: 'medium', targetPath: '/admin/maintenance' },
  });

  console.log('\n=== Result ===');
  console.log(JSON.stringify(result, null, 2));

  // Verify the docs were written
  console.log('\n=== Checking if test docs appeared ===');
  const snap = await db.collection('staff_notifications')
    .where('data.requestId', '==', 'test-diag')
    .get();
  console.log(`Found ${snap.size} test notification docs`);
  snap.docs.forEach(d => {
    const data = d.data();
    console.log(`  to: ${data.recipientId} | method: ${data.method} | created: ${data.createdAt}`);
  });

  process.exit(0);
}

test().catch(err => { console.error('FATAL:', err); process.exit(1); });
