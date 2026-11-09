#!/usr/bin/env node
/**
 * check-admin-claims.js — preflight before deploying firestore.rules.
 *
 * firestore.rules grants admin access solely on the custom claim
 * { role: "admin" } (no hardcoded email). This script verifies the admin
 * account actually carries that claim so a rules deploy can't lock the host
 * out of the admin dashboard.
 *
 * Usage (from the repo root, with FIREBASE_SERVICE_ACCOUNT_KEY in .env.local):
 *   node scripts/debug/check-admin-claims.js                # uses NEXT_PUBLIC_ADMIN_EMAIL / ADMIN_EMAIL
 *   node scripts/debug/check-admin-claims.js host@example.com
 *
 * Exit codes: 0 = claim present, 1 = missing/mismatch, 2 = setup error.
 * Fix for a missing claim:  node scripts/seed/promote-admin.js <email>
 */

const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');
const admin = require('firebase-admin');

// Load .env.local manually (same pattern as the other debug scripts).
const envPath = resolve(__dirname, '..', '..', '.env.local');
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    if (!(key in env)) env[key] = trimmed.slice(eqIndex + 1);
  }
}

const email = process.argv[2] || env.NEXT_PUBLIC_ADMIN_EMAIL || env.ADMIN_EMAIL;
if (!email) {
  console.error('ERROR: pass the admin email as an argument or set NEXT_PUBLIC_ADMIN_EMAIL / ADMIN_EMAIL.');
  process.exit(2);
}
if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_KEY not set (expected in .env.local).');
  process.exit(2);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
}

async function main() {
  const user = await admin.auth().getUserByEmail(email);
  const claims = user.customClaims || {};
  const userDoc = await admin.firestore().collection('users').doc(user.uid).get();
  const docRole = userDoc.exists ? userDoc.data().role : null;

  console.log(`Auth user:        ${user.uid} <${user.email}>`);
  console.log(`Custom claims:    ${JSON.stringify(claims)}`);
  console.log(`users/{uid}.role: ${docRole === null ? '(no doc)' : JSON.stringify(docRole)}`);

  if (claims.role === 'admin') {
    console.log('\nOK — firestore.rules isAdmin() will match this account.');
    process.exit(0);
  }
  console.error('\nFAIL — custom claim role != "admin". Deploying firestore.rules now would lock this account out.');
  console.error(`Fix:  node scripts/seed/promote-admin.js ${email}`);
  console.error('Then sign out/in (or wait for the ID token to refresh) and re-run this check.');
  process.exit(1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(2);
});
