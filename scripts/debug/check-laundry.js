const fs = require('fs');
const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
const line = lines.find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='));
const val = line.substring('FIREBASE_SERVICE_ACCOUNT_KEY='.length);
const cred = JSON.parse(val);
const admin = require('firebase-admin');
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();

async function check() {
  const sessionOwnerUid = 'wv0rIw6assdOMR839hpffoDBlBj1';
  
  const codes = ['oJGBwkrUDo', 'Y_1IL00Q0W', 'tXr-wcs9Oy', 'DBNV-jqH24'];
  for (const code of codes) {
    const snap = await db.collection('guests').where('bookingCode', '==', code).get();
    if (snap.empty) {
      console.log(code, '-> NO GUEST DOC');
    } else {
      for (const d of snap.docs) {
        const g = d.data();
        const uid = d.id;
        const match = uid === sessionOwnerUid ? ' *** MATCHES SESSION OWNER ***' : '';
        console.log(`${code} -> UID: ${uid} | name: ${g.name || g.fullName || 'unknown'}${match}`);
      }
    }
  }
  
  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });
