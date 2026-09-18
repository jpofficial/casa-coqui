#!/usr/bin/env node

/**
 * Seed voice_conversations in Firestore from Airbnb conversation data.
 *
 * Primary source: RAG Corpus threads.jsonl (387 threads, structured JSON)
 * Fallback:       S3 voice-samples/*.md (62 markdown files)
 *
 * Pipeline:
 *   1. Load threads from JSONL (or download markdown from S3)
 *   2. Extract guest→host conversation pairs
 *   3. Embed guest messages via OpenAI (batch)
 *   4. Write to Firestore with FieldValue.vector()
 *
 * Usage:
 *   node scripts/seed/seed-voice-from-s3.js              # full seed from JSONL
 *   node scripts/seed/seed-voice-from-s3.js --dry-run     # parse only, no writes
 *   node scripts/seed/seed-voice-from-s3.js --source=s3   # force S3 markdown source
 *
 * Requires: OPENAI_API_KEY + FIREBASE_SERVICE_ACCOUNT_KEY in .env.local
 */

'use strict';

const { execSync } = require('child_process');
const { readFileSync, mkdirSync, existsSync, readdirSync } = require('fs');
const { resolve, join, relative } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { parseConversation } = require('../../functions/lib/parse-voice-conversations');
const { embedBatch } = require('../../functions/lib/embeddings');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const JSONL_PATH = resolve(__dirname, '..', '..', '..', 'JulioOS', '01 - Projects', 'Casa Coqui Content', 'RAG Corpus', 'threads.jsonl');
const S3_BUCKET = 's3://casa-coqui-inbound-email';
const S3_PREFIX = 'voice-samples/';
const LOCAL_DIR = resolve(__dirname, '..', '..', '.tmp-voice-samples');
const COLLECTION = 'voice_conversations';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE_S3 = process.argv.includes('--source=s3');

// Julio started hosting Casa Coqui in late 2022. Earlier threads are Julio
// as a guest at other properties — not useful for RAG.
const MIN_YEAR = '2022';

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------

const envPath = resolve(__dirname, '..', '..', '.env.local');
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
// JSONL source — structured Airbnb message export
// ---------------------------------------------------------------------------

function loadFromJSONL() {
  console.log(`Loading threads from ${JSONL_PATH}`);
  const lines = readFileSync(JSONL_PATH, 'utf-8').trim().split('\n');
  const threads = lines.map((line) => JSON.parse(line));
  console.log(`Loaded ${threads.length} threads\n`);

  // Filter: only Casa Coqui hosting threads (2022+, guest messages first)
  const hostingThreads = threads.filter((t) => t.year >= MIN_YEAR);
  console.log(`After filtering to ${MIN_YEAR}+: ${hostingThreads.length} hosting threads`);

  // Extract guest→host pairs
  const pairs = [];
  for (const thread of hostingThreads) {
    const msgs = thread.messages || [];
    let pendingGuestTexts = [];

    for (const msg of msgs) {
      if (msg.role === 'Guest') {
        pendingGuestTexts.push(msg.text);
      } else if (msg.role === 'Host' && pendingGuestTexts.length > 0) {
        pairs.push({
          guestMessage: pendingGuestTexts.join('\n\n'),
          hostReply: msg.text,
          guestName: null, // JSONL doesn't have guest names
          date: (msg.createdAt || '').slice(0, 10),
          threadId: String(thread.threadId),
          source: 'jsonl',
          listing: null,
          checkIn: null,
          checkOut: null,
          confirmationCode: null,
        });
        pendingGuestTexts = [];
      } else if (msg.role === 'Host') {
        // Host message with no preceding guest — reset
        pendingGuestTexts = [];
      }
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// S3 markdown source (fallback)
// ---------------------------------------------------------------------------

function loadFromS3() {
  if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });

  console.log(`Downloading ${S3_BUCKET}/${S3_PREFIX} → ${LOCAL_DIR}`);
  execSync(`aws s3 sync "${S3_BUCKET}/${S3_PREFIX}" "${LOCAL_DIR}" --quiet`, {
    stdio: 'inherit',
  });

  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  }
  walk(LOCAL_DIR);
  console.log(`Found ${files.length} markdown files\n`);

  const pairs = [];
  for (const file of files) {
    const markdown = readFileSync(file, 'utf-8');
    const s3Key = S3_PREFIX + relative(LOCAL_DIR, file);
    const { pairs: filePairs } = parseConversation(markdown, s3Key);
    pairs.push(...filePairs);
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (no writes) ===' : '=== SEEDING voice_conversations ===');
  console.log();

  // 1. Load pairs from best available source
  let allPairs;
  if (!FORCE_S3 && existsSync(JSONL_PATH)) {
    console.log('Source: threads.jsonl (Airbnb full export)\n');
    allPairs = loadFromJSONL();
  } else {
    console.log('Source: S3 markdown files (fallback)\n');
    allPairs = loadFromS3();
  }

  console.log(`Extracted ${allPairs.length} guest→host pairs`);

  // Filter out very short messages (noise)
  allPairs = allPairs.filter(
    (p) => p.guestMessage.length >= 10 && p.hostReply.length >= 10
  );
  console.log(`After filtering short messages: ${allPairs.length} pairs\n`);

  if (DRY_RUN) {
    const sample = allPairs.slice(0, 5).concat(allPairs.slice(-5));
    for (const p of sample) {
      console.log(`--- [${p.guestName || 'Guest'}] ${p.date} ---`);
      console.log(`  Guest: ${p.guestMessage.slice(0, 120)}${p.guestMessage.length > 120 ? '...' : ''}`);
      console.log(`  Host:  ${p.hostReply.slice(0, 120)}${p.hostReply.length > 120 ? '...' : ''}`);
      console.log();
    }
    console.log(`Total pairs: ${allPairs.length}`);
    console.log('Dry run complete — no Firestore writes.');
    process.exit(0);
  }

  // 2. Embed guest messages
  console.log('Embedding guest messages via OpenAI...');
  const guestTexts = allPairs.map((p) => p.guestMessage);
  const embeddings = await embedBatch(guestTexts);
  console.log(`Got ${embeddings.length} embeddings\n`);

  // 3. Clear existing collection
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

  // 4. Write new docs
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
      threadId: pair.threadId || null,
      s3Key: pair.s3Key || null,
      source: pair.source || 'markdown',
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
