#!/usr/bin/env node

/**
 * Seed voice_conversations in Firestore from S3 voice-sample markdown files.
 *
 * Pipeline:
 *   1. Download all voice-samples/*.md from S3
 *   2. Parse into guest→host conversation pairs
 *   3. Embed guest messages via OpenAI (batch)
 *   4. Write to Firestore with FieldValue.vector()
 *
 * Usage:
 *   node scripts/seed-voice-from-s3.js            # full seed
 *   node scripts/seed-voice-from-s3.js --dry-run   # parse only, no writes
 *
 * Requires: OPENAI_API_KEY + FIREBASE_SERVICE_ACCOUNT_KEY in .env.local
 *           aws CLI configured with access to s3://casa-coqui-inbound-email
 */

'use strict';

const { execSync } = require('child_process');
const { readFileSync, mkdirSync, existsSync, readdirSync } = require('fs');
const { resolve, join, relative } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { parseConversation } = require('../functions/lib/parse-voice-conversations');
const { embedBatch } = require('../functions/lib/embeddings');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const S3_BUCKET = 's3://casa-coqui-inbound-email';
const S3_PREFIX = 'voice-samples/';
const LOCAL_DIR = resolve(__dirname, '..', '.tmp-voice-samples');
const COLLECTION = 'voice_conversations';
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------

const envPath = resolve(__dirname, '..', '.env.local');
const envFile = readFileSync(envPath, 'utf-8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) continue;
  const key = trimmed.slice(0, eqIndex);
  if (!process.env[key]) {
    process.env[key] = trimmed.slice(eqIndex + 1);
  }
}

// ---------------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------------

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

// ---------------------------------------------------------------------------
// S3 download
// ---------------------------------------------------------------------------

function downloadFromS3() {
  if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });

  console.log(`Downloading ${S3_BUCKET}/${S3_PREFIX} → ${LOCAL_DIR}`);
  execSync(`aws s3 sync "${S3_BUCKET}/${S3_PREFIX}" "${LOCAL_DIR}" --quiet`, {
    stdio: 'inherit',
  });

  // Collect all .md files recursively
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  }
  walk(LOCAL_DIR);
  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (no writes) ===' : '=== SEEDING voice_conversations ===');
  console.log();

  // 1. Download
  const files = downloadFromS3();
  console.log(`Found ${files.length} markdown files\n`);

  // 2. Parse all files
  let allPairs = [];
  for (const file of files) {
    const markdown = readFileSync(file, 'utf-8');
    const s3Key = S3_PREFIX + relative(LOCAL_DIR, file);
    const { pairs } = parseConversation(markdown, s3Key);
    allPairs.push(...pairs);
  }

  console.log(`Extracted ${allPairs.length} guest→host pairs from ${files.length} files`);

  // Filter out pairs with very short guest messages (< 10 chars) or host replies
  allPairs = allPairs.filter(
    (p) => p.guestMessage.length >= 10 && p.hostReply.length >= 10
  );
  console.log(`After filtering short messages: ${allPairs.length} pairs\n`);

  if (DRY_RUN) {
    // Print sample pairs
    const sample = allPairs.slice(0, 10);
    for (const p of sample) {
      console.log(`--- [${p.guestName}] ${p.date} ---`);
      console.log(`  Guest: ${p.guestMessage.slice(0, 120)}${p.guestMessage.length > 120 ? '...' : ''}`);
      console.log(`  Host:  ${p.hostReply.slice(0, 120)}${p.hostReply.length > 120 ? '...' : ''}`);
      console.log();
    }
    console.log(`Total pairs: ${allPairs.length}`);
    console.log('Dry run complete — no Firestore writes.');
    process.exit(0);
  }

  // 3. Embed guest messages
  console.log('Embedding guest messages via OpenAI...');
  const guestTexts = allPairs.map((p) => p.guestMessage);
  const embeddings = await embedBatch(guestTexts);
  console.log(`Got ${embeddings.length} embeddings\n`);

  // 4. Clear existing collection
  console.log('Clearing existing voice_conversations...');
  const existing = await db.collection(COLLECTION).listDocuments();
  if (existing.length > 0) {
    const batches = [];
    let batch = db.batch();
    let count = 0;
    for (const doc of existing) {
      batch.delete(doc);
      count++;
      if (count % 500 === 0) {
        batches.push(batch);
        batch = db.batch();
      }
    }
    batches.push(batch);
    await Promise.all(batches.map((b) => b.commit()));
    console.log(`Deleted ${existing.length} existing docs\n`);
  }

  // 5. Write new docs
  console.log('Writing to Firestore...');
  const now = new Date().toISOString();
  let written = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (let i = 0; i < allPairs.length; i++) {
    const pair = allPairs[i];
    const ref = db.collection(COLLECTION).doc();
    batch.set(ref, {
      guestMessage: pair.guestMessage,
      hostReply: pair.hostReply,
      guestName: pair.guestName,
      date: pair.date,
      s3Key: pair.s3Key,
      listing: pair.listing,
      checkIn: pair.checkIn,
      checkOut: pair.checkOut,
      confirmationCode: pair.confirmationCode,
      embedding: FieldValue.vector(embeddings[i]),
      embeddingModel: 'text-embedding-3-small',
      createdAt: now,
    });

    batchCount++;
    if (batchCount === 500) {
      await batch.commit();
      written += batchCount;
      console.log(`  Written ${written}/${allPairs.length}`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    written += batchCount;
  }

  console.log(`\nDone! Wrote ${written} docs to ${COLLECTION}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
