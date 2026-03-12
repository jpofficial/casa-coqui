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

async function seed() {
  console.log('Seeding settings/property...\n');

  await db.doc('settings/property').set(
    {
      propertyName: 'Casa Coqui',
      address: '',
      wifiNetwork: '',
      wifiPassword: '',
      lockboxCode: '',
      gateCode: '',
      checkInTime: '3:00 PM',
      checkOutTime: '11:00 AM',
      checkInSteps: [
        { title: 'Find the property', description: '', imageUrl: '' },
        { title: 'Enter through gate', description: '', imageUrl: '' },
        { title: 'Find your unit', description: '', imageUrl: '' },
        { title: 'Open lockbox', description: '', imageUrl: '' },
        { title: 'Enter and enjoy', description: '', imageUrl: '' },
      ],
      parkingInfo: {
        apartmentA: {
          instructions: 'Your parking spot is on the left side of the driveway.',
          steps: [
            { stepNumber: 1, description: 'Enter through the main gate using the gate code', imageUrl: '' },
            { stepNumber: 2, description: 'Drive straight and park on the LEFT side', imageUrl: '' },
            { stepNumber: 3, description: 'Ensure you are not blocking the walkway', imageUrl: '' },
          ],
          mapImageUrl: '',
        },
        apartmentB: {
          instructions: 'Your parking spot is on the right side of the driveway.',
          steps: [
            { stepNumber: 1, description: 'Enter through the main gate using the gate code', imageUrl: '' },
            { stepNumber: 2, description: 'Drive straight and park on the RIGHT side', imageUrl: '' },
            { stepNumber: 3, description: 'Pull forward so the gate can close behind you', imageUrl: '' },
          ],
          mapImageUrl: '',
        },
        generalNotes: 'No overnight street parking.\nEnsure the gate closes fully behind you.\nDo not block the driveway or walkway.',
      },
      houseRules: [
        { icon: 'clock', title: 'Quiet Hours', description: '', imageUrl: '' },
        { icon: 'no-smoking', title: 'Smoking', description: '', imageUrl: '' },
        { icon: 'pet', title: 'Pets', description: '', imageUrl: '' },
        { icon: 'trash', title: 'Garbage & Recycling', description: '', imageUrl: '' },
        { icon: 'pool', title: 'Pool & Common Areas', description: '', imageUrl: '' },
        { icon: 'checkout', title: 'Checkout', description: '', imageUrl: '' },
      ],
      propertyPhotos: [],
      emergencyContact: { name: '', phone: '' },
      units: ['Unit A', 'Unit B'],
    },
    { merge: true }
  );

  console.log('Done! settings/property seeded.\n');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
