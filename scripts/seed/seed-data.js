const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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
const appUrl = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

async function seed() {
  console.log('Seeding Firestore...\n');

  // 1. Laundry machines
  console.log('1. Laundry machines (washer + dryer)...');
  await db.doc('laundry/washer').set({
    status: 'available',
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  }, { merge: true });
  await db.doc('laundry/dryer').set({
    status: 'available',
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  }, { merge: true });
  console.log('   Created: laundry/washer, laundry/dryer');

  // 2. Test booking with the code from the URL the user tested
  console.log('2. Test booking...');
  const testCode = 'CEnyZ3dm2l';
  const existingBooking = await db.collection('bookings').where('code', '==', testCode).get();
  if (existingBooking.empty) {
    const today = new Date();
    const checkOut = new Date(today);
    checkOut.setDate(checkOut.getDate() + 3);
    const formatDate = (d) => d.toISOString().split('T')[0];

    await db.collection('bookings').add({
      code: testCode,
      unit: 'Unit A',
      guestName: 'Test Guest',
      checkInDate: formatDate(today),
      checkOutDate: formatDate(checkOut),
      status: 'active',
      checkedIn: false,
      createdAt: new Date().toISOString(),
      guestLink: `${appUrl}/g/${testCode}`,
    });
    console.log(`   Created booking with code: ${testCode}`);
    console.log(`   Guest link: ${appUrl}/g/${testCode}`);
  } else {
    console.log(`   Booking with code ${testCode} already exists, skipping.`);
  }

  // 3. App settings
  console.log('3. App settings...');
  await db.doc('settings/property').set({
    name: 'Casa Coqui',
    address: 'Rincon, Puerto Rico',
    units: ['Unit A', 'Unit B'],
    wifiNetwork: 'CasaCoqui-Guest',
    wifiPassword: 'Welcome2025!',
    gateCode: '1234',
    checkInTime: '3:00 PM',
    checkOutTime: '11:00 AM',
  }, { merge: true });
  console.log('   Created: settings/property');

  // 4. Sample supplies (for testing the supply inventory page)
  console.log('4. Sample supplies...');
  const supplies = [
    { name: 'Toilet Paper', quantity: 12, minimum: 6, autoReorder: true, amazonUrl: 'https://www.amazon.com/dp/B08B4112MN', createdAt: new Date().toISOString() },
    { name: 'Paper Towels', quantity: 4, minimum: 4, autoReorder: true, amazonUrl: 'https://www.amazon.com/dp/B079NB9YZ1', createdAt: new Date().toISOString() },
    { name: 'Dish Soap', quantity: 2, minimum: 1, autoReorder: false, amazonUrl: '', createdAt: new Date().toISOString() },
    { name: 'Trash Bags', quantity: 1, minimum: 3, autoReorder: true, amazonUrl: 'https://www.amazon.com/dp/B07BKQMMGS', createdAt: new Date().toISOString() },
  ];

  const existingSupplies = await db.collection('supplies').limit(1).get();
  if (existingSupplies.empty) {
    for (const supply of supplies) {
      await db.collection('supplies').add(supply);
    }
    console.log(`   Created ${supplies.length} sample supplies`);
  } else {
    console.log('   Supplies already exist, skipping.');
  }

  console.log('\nSeed complete!');
  process.exit(0);
}

seed();
