const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Load .env.local
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

(async () => {
  const settings = await db.doc('settings/property').get();
  const s = settings.data();
  console.log('=== settings/property WiFi fields ===');
  console.log('wifiNetwork:', JSON.stringify(s.wifiNetwork));
  console.log('wifiPassword:', JSON.stringify(s.wifiPassword));
  console.log('unitWifi:', JSON.stringify(s.unitWifi, null, 2));

  const bookings = await db.collection('bookings').where('status', '==', 'active').get();
  console.log('\n=== Active bookings ===');
  bookings.forEach(doc => {
    const d = doc.data();
    console.log('Booking:', doc.id, '| code:', d.code, '| unitId:', d.unitId, '| unit:', d.unit);
  });

  process.exit(0);
})();
