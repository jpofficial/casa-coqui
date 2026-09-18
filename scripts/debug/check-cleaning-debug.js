const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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
const db = getFirestore(app);

async function main() {
  // Get all cleaning jobs
  const jobs = await db.collection('cleaning_jobs').get();
  console.log('=== CLEANING JOBS ===');
  if (jobs.empty) {
    console.log('(none)');
  } else {
    jobs.docs.forEach(d => {
      const j = d.data();
      console.log(d.id, '|', j.status, '|', j.unit, '|', 'assigneeId:', j.assigneeId, '|', j.assigneeName);
    });
  }

  // Get all users with cleaner role
  const users = await db.collection('users').where('role', '==', 'cleaner').get();
  console.log('\n=== CLEANER USERS ===');
  if (users.empty) {
    console.log('(none)');
  } else {
    users.docs.forEach(d => {
      const u = d.data();
      console.log('uid:', d.id, '|', u.displayName || u.email, '|', 'status:', u.status, '|', 'role:', u.role);
    });
  }

  // Check match
  if (!jobs.empty && !users.empty) {
    console.log('\n=== MATCH CHECK ===');
    const cleanerIds = new Set(users.docs.map(d => d.id));
    jobs.docs.forEach(d => {
      const j = d.data();
      const match = cleanerIds.has(j.assigneeId);
      console.log(d.id, '| assigneeId:', j.assigneeId, '| matches cleaner user?', match);
    });
  }
}

main().catch(console.error);
