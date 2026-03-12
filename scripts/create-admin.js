const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

// Load .env.local manually (no dotenv dependency needed)
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

const app = initializeApp({
  credential: cert(serviceAccount),
});

const auth = getAuth(app);
const db = getFirestore(app);

async function createAdmin() {
  const email = env.ADMIN_EMAIL || 'admin@casacoqui.com';
  const password = env.ADMIN_PASSWORD;
  if (!password) {
    console.error('ADMIN_PASSWORD must be set in .env.local');
    process.exit(1);
  }
  let uid;

  try {
    const user = await auth.createUser({
      email,
      password,
      displayName: 'Casa Coqui Admin',
    });
    uid = user.uid;
    console.log('Admin user created successfully:');
    console.log('  UID:', user.uid);
    console.log('  Email:', user.email);
    console.log('  Display Name:', user.displayName);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
      console.log('Admin user already exists with email:', email);
      console.log('  UID:', existing.uid);
    } else {
      console.error('Failed to create admin user:', err.message);
      process.exit(1);
    }
  }

  // Set custom claims
  await auth.setCustomUserClaims(uid, { role: 'admin' });
  console.log('  Custom claims set: { role: "admin" }');

  // Write Firestore users doc
  await db.collection('users').doc(uid).set(
    {
      email,
      role: 'admin',
      displayName: 'Casa Coqui Admin',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log('  Firestore users doc written');

  process.exit(0);
}

createAdmin();
