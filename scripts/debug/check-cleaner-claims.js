const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

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

const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY || '""');
const app = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);

const CLEANER_UID = 'vLxYbETlPWMCzzLLr2DKADkkXoU2';

async function main() {
  const user = await auth.getUser(CLEANER_UID);
  console.log('Display Name:', user.displayName);
  console.log('Email:', user.email);
  console.log('Phone:', user.phoneNumber);
  console.log('Custom Claims:', JSON.stringify(user.customClaims, null, 2));

  const claims = user.customClaims || {};
  if (claims.role === 'cleaner') {
    console.log('\nClaims are CORRECT — role is "cleaner".');
  } else {
    console.log('\nCLAIMS ARE WRONG — role is "' + (claims.role || 'missing') + '", expected "cleaner".');
    console.log('This would cause Firestore rules isStaff() to return false.');
    console.log('The cleaner onSnapshot query would silently fail.');
  }
}

main().catch(console.error);
