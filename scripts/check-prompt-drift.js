#!/usr/bin/env node
/**
 * check-prompt-drift.js — fails build if the canonical SYSTEM_PROMPT
 * has drifted across its three source files.
 *
 * Three sources hold the same prompt content (a 9000+ character host-voice
 * spec). Until Phase 4.5 decommissions the legacy JS chain, all three MUST
 * stay byte-identical:
 *
 *   1. lib/reply-ai.js                            (Next.js admin/API)
 *   2. functions/lib/reply-ai.js                  (Cloud Functions legacy chain)
 *   3. infra/sam/reply-agent/config/system-prompt.seed.json
 *      → field `system_prompt_text`               (AppConfig Hosted Configuration)
 *
 * If any one drifts from the others, drafts produced by different code paths
 * will sound different. Comment-based "keep in sync" warnings have already
 * been proven insufficient (Issue #1, commit c49adf3) — this script is the
 * durable enforcement.
 *
 * Exit codes:
 *   0  — all three sources hash identically
 *   1  — drift detected
 *   2  — one or more sources could not be read/parsed
 *
 * Usage:
 *   node scripts/check-prompt-drift.js          # exit non-zero on drift
 *   node scripts/check-prompt-drift.js --quiet  # only print on drift
 *
 * Wire into CI as a required check before merge to main.
 *
 * Will be deleted in Phase 4.5 (JS chain decommission) — once
 * AppConfig is the sole source, drift is impossible by construction.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

function log(...args) {
  if (!QUIET) console.log(...args);
}

function readJsSystemPrompt(relPath) {
  const fullPath = path.join(REPO_ROOT, relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  // Match `const SYSTEM_PROMPT = `...`;` (template literal). Non-greedy.
  const match = src.match(/const SYSTEM_PROMPT = `([\s\S]+?)`;/);
  if (!match) {
    throw new Error(`Could not find \`const SYSTEM_PROMPT = \`...\`\` in ${relPath}`);
  }
  return match[1];
}

function readJsonSystemPrompt(relPath, field) {
  const fullPath = path.join(REPO_ROOT, relPath);
  const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (typeof json[field] !== 'string') {
    throw new Error(`Field "${field}" missing or not a string in ${relPath}`);
  }
  return json[field];
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const SOURCES = [
  { label: 'lib/reply-ai.js (Next.js)', read: () => readJsSystemPrompt('lib/reply-ai.js') },
  { label: 'functions/lib/reply-ai.js (Cloud Functions)', read: () => readJsSystemPrompt('functions/lib/reply-ai.js') },
  {
    label: 'infra/sam/reply-agent/config/system-prompt.seed.json#system_prompt_text (AppConfig)',
    read: () => readJsonSystemPrompt('infra/sam/reply-agent/config/system-prompt.seed.json', 'system_prompt_text'),
  },
];

const results = [];
const missing = [];

for (const src of SOURCES) {
  try {
    const text = src.read();
    results.push({ label: src.label, length: text.length, hash: sha256(text) });
  } catch (err) {
    // ENOENT for an optional source (e.g. AppConfig seed JSON missing from a
    // Vercel deploy that did not include the full repo) is a soft warning,
    // not a build failure. Drift detection between the remaining readable
    // sources still runs. Any other error (parse failure, permission, etc.)
    // is still treated as a hard failure.
    if (err && err.code === 'ENOENT') {
      console.warn(`WARN: source not present, skipping — ${src.label}`);
      missing.push(src.label);
      continue;
    }
    console.error(`ERROR reading ${src.label}: ${err.message}`);
    process.exit(2);
  }
}

if (results.length < 2) {
  console.error(
    `ERROR: fewer than 2 readable sources (${results.length}); cannot perform drift check.`
  );
  process.exit(2);
}

const uniqueHashes = new Set(results.map((r) => r.hash));

if (uniqueHashes.size === 1) {
  const checked = results.length;
  const total = SOURCES.length;
  log(`✓ SYSTEM_PROMPT in sync across ${checked}/${total} readable source${checked === 1 ? '' : 's'}`);
  if (missing.length) {
    log(`  (skipped: ${missing.length} missing source${missing.length === 1 ? '' : 's'})`);
  }
  log(`  hash:   ${results[0].hash.slice(0, 16)}…`);
  log(`  length: ${results[0].length} chars`);
  process.exit(0);
}

// Drift detected — always print, even in --quiet mode
console.error('✗ SYSTEM_PROMPT DRIFT DETECTED');
console.error('');
console.error('  The following sources do NOT match:');
console.error('');
for (const r of results) {
  console.error(`    ${r.hash.slice(0, 16)}…  (${r.length} chars)  ${r.label}`);
}
console.error('');
console.error('  Fix: edit each source so they hold byte-identical prompt content.');
console.error('  Reference source: pick whichever you most recently updated.');
console.error('  See scripts/check-prompt-drift.js header for context.');
process.exit(1);
