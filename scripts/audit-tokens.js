const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const envPath = resolve(__dirname, '..', '.env.local');
const envFile = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  env[t.slice(0, eq)] = t.slice(eq + 1);
}

const app = initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
const db = getFirestore(app);
const messaging = getMessaging(app);

async function audit() {
  const snap = await db.collection('fcm_tokens').get();
  console.log('Token audit (' + snap.size + ' docs):\n');

  const staleIds = [];

  for (const d of snap.docs) {
    const data = d.data();
    let status = 'unknown';
    try {
      await messaging.send({ token: d.id, data: { test: '1' } }, true); // dryRun=true
      status = 'VALID';
    } catch (err) {
      status = 'STALE (' + (err.code || err.message) + ')';
      staleIds.push(d.id);
    }
    console.log(d.id.slice(0, 24) + '...');
    console.log('  status:      ' + status);
    console.log('  platform:    ' + (data.platform || '(none)'));
    console.log('  bookingCode: ' + (data.bookingCode || '-'));
    console.log('  staffId:     ' + (data.staffId || '-'));
    console.log('  updatedAt:   ' + (data.updatedAt || data.createdAt || '(none)'));
    console.log('');
  }

  if (staleIds.length > 0) {
    console.log('--- ' + staleIds.length + ' stale token(s) found ---');
    console.log('Run with --clean to delete them.\n');

    if (process.argv.includes('--clean')) {
      for (const id of staleIds) {
        await db.collection('fcm_tokens').doc(id).delete();
        console.log('  Deleted: ' + id.slice(0, 24) + '...');
      }
      console.log('\nDone. Deleted ' + staleIds.length + ' stale token(s).');
    }
  } else {
    console.log('All tokens are valid.');
  }

  process.exit(0);
}

audit().catch(e => { console.error(e); process.exit(1); });
