#!/usr/bin/env node
/**
 * sync-shared.js — one source of truth for modules that ship in more than one
 * deploy package.
 *
 * Firebase deploys only the functions/ directory, so a module the web app and
 * the Cloud Functions both need has to physically exist in both places. Hand-
 * maintained copies with a "keep in sync" comment drifted (see git history of
 * thread-key.js); this script makes the copies generated and checkable instead.
 *
 *   node scripts/sync-shared.js            # (re)write every generated copy
 *   node scripts/sync-shared.js --check    # exit 1 if any copy differs from its source
 *
 * Each generated copy is the source file verbatim, prefixed with a banner
 * that names the source. Edit the source, run `npm run sync:shared`, commit
 * both. `npm run check:shared` runs in `npm test`, `prebuild` and CI.
 *
 * Exit codes: 0 ok · 1 drift (check mode) · 2 a source file is missing
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const QUIET = process.argv.includes('--quiet');

/**
 * Source → generated copies (paths relative to the repo root).
 * Sources are plain CommonJS so Node (Cloud Functions, node:test) and
 * Next.js (webpack CJS interop) can both load them unchanged.
 */
const SHARED = [
  {
    source: 'lib/thread-key.js',
    targets: ['functions/lib/thread-key.js'],
  },
  {
    source: 'lib/welcome-ai-core.js',
    targets: ['functions/lib/welcome-ai-core.js'],
  },
];

function banner(source) {
  return [
    `// @generated — DO NOT EDIT. Copied verbatim from ${source} by scripts/sync-shared.js.`,
    '// Edit the source file, then run `npm run sync:shared`. `npm run check:shared` (CI) fails on drift.',
    '',
  ].join('\n');
}

function log(...args) {
  if (!QUIET) console.log(...args);
}

let drift = 0;
let written = 0;

for (const { source, targets } of SHARED) {
  const sourcePath = path.join(REPO_ROOT, source);
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: shared source missing: ${source}`);
    process.exit(2);
  }
  const expected = banner(source) + fs.readFileSync(sourcePath, 'utf8');

  for (const target of targets) {
    const targetPath = path.join(REPO_ROOT, target);
    const actual = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
    if (actual === expected) {
      log(`✓ ${target} in sync with ${source}`);
      continue;
    }
    if (CHECK) {
      drift++;
      console.error(`✗ ${target} ${actual === null ? 'is missing' : 'differs from'} ${source}`);
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, expected);
    written++;
    log(`→ wrote ${target} from ${source}`);
  }
}

if (CHECK && drift > 0) {
  console.error('');
  console.error(`${drift} generated cop${drift === 1 ? 'y is' : 'ies are'} out of date. Run: npm run sync:shared`);
  process.exit(1);
}
if (!CHECK) log(written ? `${written} file(s) written.` : 'Nothing to do.');
