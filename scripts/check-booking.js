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

const code = process.argv[2] || 'aJmAw-57ZQ';

(async () => {
  const snap = await db.collection('bookings').where('code', '==', code).get();
  if (snap.empty) {
    console.log('No booking found for code', code);
  } else {
    snap.docs.forEach(d => {
      const b = d.data();
      console.log('Booking:', JSON.stringify({
        id: d.id, status: b.status, unit: b.unit, unitId: b.unitId,
        guestName: b.guestName, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate,
      }, null, 2));
    });
  }

  const checkinSnap = await db.collection('checkins').doc(code).get();
  if (checkinSnap.exists) {
    const c = checkinSnap.data();
    console.log('Checkin:', JSON.stringify({ checkedIn: c.checkedIn, checkedInAt: c.checkedInAt }, null, 2));
  } else {
    console.log('No checkin doc for', code);
  }

  process.exit(0);
})();
