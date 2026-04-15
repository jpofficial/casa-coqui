#!/usr/bin/env node

/**
 * Convert "messages copy.json" (Airbnb data export) → threads.jsonl
 * for the voice corpus seed script.
 *
 * Output format (one JSON object per line):
 *   { threadId, year, messages: [{ role: 'Guest'|'Host', text, createdAt }] }
 *
 * Usage:
 *   node scripts/convert-messages-to-jsonl.js
 */

'use strict';

const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const INPUT = resolve(__dirname, '..', 'messages copy.json');
const OUTPUT = resolve(__dirname, '..', '..', 'JulioOS', '01 - Projects',
  'Casa Coqui Content', 'RAG Corpus', 'threads.jsonl');

// Also write a local copy in case the JulioOS path isn't available
const LOCAL_OUTPUT = resolve(__dirname, '..', 'threads.jsonl');

const HOST_ID = 60303487;

function getText(mc) {
  if (!mc.messageContent) return '';
  const c = mc.messageContent;
  return (c.textContent?.body || c.textAndReferenceContent?.text || '').trim();
}

console.log('Reading', INPUT);
const data = require(INPUT);
const threads = data[0].messageThreads;
console.log(`Found ${threads.length} threads\n`);

const jsonlLines = [];

for (const thread of threads) {
  const msgs = thread.messagesAndContents;
  const messages = [];

  for (const mc of msgs) {
    const aid = mc.message.accountId;
    const text = getText(mc);
    if (!text || aid === undefined) continue;

    messages.push({
      role: aid === HOST_ID ? 'Host' : 'Guest',
      text,
      createdAt: mc.message.createdAt || null,
    });
  }

  if (messages.length < 2) continue; // Need at least one exchange

  // Derive year from first message
  const firstDate = messages[0].createdAt || '';
  const year = firstDate ? parseInt(firstDate.slice(0, 4), 10) : null;

  jsonlLines.push(JSON.stringify({
    threadId: thread.id,
    year,
    messages,
  }));
}

console.log(`Converted ${jsonlLines.length} threads to JSONL`);

const output = jsonlLines.join('\n') + '\n';

// Write local copy always
writeFileSync(LOCAL_OUTPUT, output);
console.log(`Written to ${LOCAL_OUTPUT}`);

// Try JulioOS path
try {
  const { mkdirSync } = require('fs');
  mkdirSync(resolve(OUTPUT, '..'), { recursive: true });
  writeFileSync(OUTPUT, output);
  console.log(`Written to ${OUTPUT}`);
} catch (e) {
  console.log(`Could not write to JulioOS path (${e.message}) — local copy is fine`);
}

console.log('\nDone! Now run: node scripts/seed-voice-from-s3.js');
