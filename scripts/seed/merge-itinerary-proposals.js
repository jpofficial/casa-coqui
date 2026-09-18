#!/usr/bin/env node
/**
 * merge-itinerary-proposals.js
 *
 * Reads tasks/itinerary-research/proposed/<date>-<scout>.json files, picks
 * items with `approved: true`, fuzzy-dedupes against seed-final/, appends to
 * the right category file, and archives the processed proposal file.
 *
 * Usage:
 *   node scripts/seed/merge-itinerary-proposals.js          # dry-run, prints plan
 *   node scripts/seed/merge-itinerary-proposals.js --apply  # actually merge
 *   node scripts/seed/merge-itinerary-proposals.js --apply --seed
 *       # merge AND re-run seed-activities.js to push to DynamoDB
 *
 * Category routing: each proposed item must include a `category` field that
 * maps to a seed-final/*.json filename. Valid values:
 *   adventure-activities, family-kid-activities, foodie-spots,
 *   nightlife-experiences, outdoor-activities, unique-experiences,
 *   culture-history.
 *
 * The merge script does NOT silently fix bad routings — it errors with a
 * descriptive message so the proposal can be corrected before re-running.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROPOSED_DIR = path.join(REPO_ROOT, 'data/itinerary-research/proposed');
const ARCHIVED_DIR = path.join(PROPOSED_DIR, 'archived');
const SEED_DIR = path.join(REPO_ROOT, 'data/itinerary-research/seed-final');

const APPLY = process.argv.includes('--apply');
const SEED = process.argv.includes('--seed');

const VALID_CATEGORIES = new Set([
  'adventure-activities',
  'culture-history',
  'family-kid-activities',
  'foodie-spots',
  'nightlife-experiences',
  'outdoor-activities',
  'unique-experiences',
]);

function log(...args) {
  console.log(...args);
}

function fuzzyName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function loadAllSeedActivityNames() {
  const names = new Map(); // fuzzy name → { category, original_name }
  for (const file of fs.readdirSync(SEED_DIR)) {
    if (!file.endsWith('.json')) continue;
    const category = file.replace(/\.json$/, '');
    const data = JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), 'utf-8'));
    for (const item of data.items || []) {
      names.set(fuzzyName(item.name), { category, name: item.name });
    }
  }
  return names;
}

function validateItem(item) {
  const errors = [];
  if (typeof item.approved !== 'boolean')
    errors.push('approved must be boolean');
  if (item.schema_version !== 1)
    errors.push('schema_version must be 1');
  if (!['high', 'medium', 'low'].includes(item.confidence))
    errors.push('confidence must be one of: high, medium, low');
  if (!item.name || typeof item.name !== 'string') errors.push('name required');
  if (!item.category) errors.push('category required (one of: ' + [...VALID_CATEGORIES].join(', ') + ')');
  if (!VALID_CATEGORIES.has(item.category))
    errors.push(`category "${item.category}" not in valid set`);
  if (!item.why_it_matters || typeof item.why_it_matters !== 'string' || item.why_it_matters.length < 30)
    errors.push('why_it_matters must be >=30 chars (differentiator rule)');
  return errors;
}

function main() {
  if (!fs.existsSync(PROPOSED_DIR)) {
    console.error(`No proposed dir at ${PROPOSED_DIR}`);
    process.exit(2);
  }
  if (!APPLY) log('=== DRY RUN === (use --apply to write changes)\n');

  const proposalFiles = fs
    .readdirSync(PROPOSED_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
    .map((f) => path.join(PROPOSED_DIR, f));

  if (proposalFiles.length === 0) {
    log('No proposal files found.');
    return;
  }

  log(`Found ${proposalFiles.length} proposal file(s):`);
  for (const f of proposalFiles) log(`  - ${path.basename(f)}`);
  log('');

  const existingNames = loadAllSeedActivityNames();
  log(`Existing catalog: ${existingNames.size} activities across ${VALID_CATEGORIES.size} categories.\n`);

  // Aggregate approvals per category
  const toAppend = {}; // category → [item, ...]
  const skipped = []; // { reason, name, file }
  const errors = []; // { name, file, errors }

  for (const filepath of proposalFiles) {
    const raw = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const file = path.basename(filepath);
    for (const item of raw.items || []) {
      if (item.approved !== true) {
        skipped.push({ reason: 'not approved', name: item.name, file });
        continue;
      }
      const errs = validateItem(item);
      if (errs.length) {
        errors.push({ name: item.name, file, errors: errs });
        continue;
      }
      const dupe = existingNames.get(fuzzyName(item.name));
      if (dupe) {
        skipped.push({ reason: `duplicate of ${dupe.category}/${dupe.name}`, name: item.name, file });
        continue;
      }
      const { category, approved, schema_version, confidence, ...activityFields } = item;
      // Reconstruct the entry in the same shape as seed-final entries — drop
      // proposal-only meta fields (approved, category) but keep schema_version
      // and confidence on the live record.
      const live = { ...activityFields, schema_version, confidence };
      toAppend[category] = toAppend[category] || [];
      toAppend[category].push(live);
    }
  }

  // Print plan
  log('--- MERGE PLAN ---');
  const categories = Object.keys(toAppend).sort();
  if (categories.length === 0) {
    log('No approved entries to merge.');
  } else {
    for (const cat of categories) {
      log(`  [+${toAppend[cat].length}] ${cat}.json`);
      for (const item of toAppend[cat]) log(`         - ${item.name}`);
    }
  }
  log('');

  if (skipped.length) {
    log(`--- SKIPPED (${skipped.length}) ---`);
    for (const s of skipped) log(`  ${s.file}: ${s.name} — ${s.reason}`);
    log('');
  }

  if (errors.length) {
    log(`--- VALIDATION ERRORS (${errors.length}) ---`);
    for (const e of errors) {
      log(`  ${e.file}: ${e.name}`);
      for (const err of e.errors) log(`    - ${err}`);
    }
    log('');
    console.error('ERROR: validation errors must be fixed before merge.');
    process.exit(1);
  }

  if (!APPLY) {
    log('Dry-run complete. Re-run with --apply to write changes.');
    return;
  }

  if (categories.length === 0) {
    log('Nothing to apply.');
    return;
  }

  // Apply
  for (const cat of categories) {
    const targetPath = path.join(SEED_DIR, `${cat}.json`);
    const existing = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    existing.items = existing.items.concat(toAppend[cat]);
    existing.count = existing.items.length;
    existing.last_merged_at = new Date().toISOString().slice(0, 10);
    // Atomic write (tmp + rename)
    const tmpPath = targetPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, targetPath);
    log(`  wrote ${cat}.json (now ${existing.count} items)`);
  }

  // Archive processed files
  if (!fs.existsSync(ARCHIVED_DIR)) fs.mkdirSync(ARCHIVED_DIR);
  for (const filepath of proposalFiles) {
    const dest = path.join(ARCHIVED_DIR, path.basename(filepath));
    fs.renameSync(filepath, dest);
    log(`  archived ${path.basename(filepath)} → archived/`);
  }

  if (SEED) {
    log('\nRe-seeding DynamoDB via scripts/seed/seed-activities.js...');
    execSync('node scripts/seed/seed-activities.js', { cwd: REPO_ROOT, stdio: 'inherit' });
  } else {
    log('\nDone. Re-seed DynamoDB with: node scripts/seed/seed-activities.js');
  }
}

main();
