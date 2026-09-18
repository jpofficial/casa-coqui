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
const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
const app = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);

const CLEANER_UID = 'vLxYbETlPWMCzzLLr2DKADkkXoU2';

async function fix() {
  // Show current claims
  const before = await auth.getUser(CLEANER_UID);
  console.log('BEFORE claims:', JSON.stringify(before.customClaims));

  // Restore cleaner role
  await auth.setCustomUserClaims(CLEANER_UID, { role: 'cleaner' });

  // Verify
  const after = await auth.getUser(CLEANER_UID);
  console.log('AFTER claims:', JSON.stringify(after.customClaims));

  process.exit(0);
}
fix().catch(err => { console.error(err); process.exit(1); });
