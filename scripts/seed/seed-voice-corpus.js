'use strict';

// ---------------------------------------------------------------------------
// seed-voice-corpus.js
//
// One-time script that reads voice samples from a JSON file and creates
// airbnb_messages docs in Firestore. Used to seed the AI draft corpus with
// examples of the host's writing voice for few-shot prompting.
//
// Usage:
//   node scripts/seed/seed-voice-corpus.js samples.json
//
// Input JSON format:
//   [{ "reply": "text of reply", "context": "optional context" }, ...]
//
// Prerequisites:
//   FIREBASE_SERVICE_ACCOUNT_KEY must be set in the environment, or the
//   script must run in an environment with Application Default Credentials.
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');

// Load environment variables from .env.local if present (local development).
const envPath = path.resolve(__dirname, '../../.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ---------------------------------------------------------------------------
// Firebase Admin initialization (same pattern as functions/firebaseInit.js)
// ---------------------------------------------------------------------------
function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[seed] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', err.message);
    process.exit(1);
  }
}

let adminApp;
if (getApps().length === 0) {
  const serviceAccount = getServiceAccount();
  const config = {};
  if (serviceAccount) {
    config.credential = cert(serviceAccount);
  }
  if (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
    config.storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  }
  adminApp = initializeApp(config);
} else {
  adminApp = getApps()[0];
}

const db = getFirestore(adminApp);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const inputArg = process.argv[2];

  if (!inputArg) {
    console.error('Usage: node scripts/seed/seed-voice-corpus.js <samples.json>');
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);

  if (!fs.existsSync(inputPath)) {
    console.error(`[seed] File not found: ${inputPath}`);
    process.exit(1);
  }

  let samples;
  try {
    const raw = fs.readFileSync(inputPath, 'utf8');
    samples = JSON.parse(raw);
  } catch (err) {
    console.error('[seed] Failed to read or parse input file:', err.message);
    process.exit(1);
  }

  if (!Array.isArray(samples)) {
    console.error('[seed] Input JSON must be an array of sample objects.');
    process.exit(1);
  }

  console.log(`[seed] Loaded ${samples.length} sample(s) from ${inputPath}`);

  const collection = db.collection('airbnb_messages');
  const now = new Date().toISOString();

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    if (!sample.reply || typeof sample.reply !== 'string') {
      console.warn(`[seed] Sample ${i + 1}: missing or invalid "reply" field — skipping.`);
      errorCount++;
      continue;
    }

    const doc = {
      direction: 'outbound_draft',
      draftStatus: 'sent',
      editedReply: sample.reply,
      draftReply: sample.reply,
      body: sample.context || '',
      guestName: 'Voice Corpus Seed',
      sentAt: now,
      createdAt: now,
      bookingId: null,
      rawEmailS3Key: null,
      messageId: null,
      airbnbConfirmationCode: null,
    };

    try {
      const ref = await collection.add(doc);
      successCount++;
      console.log(`[seed] (${i + 1}/${samples.length}) Created doc ${ref.id}`);
    } catch (err) {
      errorCount++;
      console.error(`[seed] (${i + 1}/${samples.length}) Failed to create doc:`, err.message);
    }
  }

  console.log(`\n[seed] Done. ${successCount} created, ${errorCount} failed.`);

  // Allow Node to exit cleanly after Firestore flushes.
  process.exit(errorCount > 0 ? 1 : 0);
}

main();
