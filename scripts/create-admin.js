const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

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

async function createAdmin() {
  const email = 'admin@casacoqui.com';
  const password = 'CasaCoqui2026!';

  try {
    const user = await auth.createUser({
      email,
      password,
      displayName: 'Casa Coqui Admin',
    });
    console.log('Admin user created successfully:');
    console.log('  UID:', user.uid);
    console.log('  Email:', user.email);
    console.log('  Display Name:', user.displayName);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      console.log('Admin user already exists with email:', email);
      const existing = await auth.getUserByEmail(email);
      console.log('  UID:', existing.uid);
    } else {
      console.error('Failed to create admin user:', err.message);
      process.exit(1);
    }
  }

  process.exit(0);
}

createAdmin();
