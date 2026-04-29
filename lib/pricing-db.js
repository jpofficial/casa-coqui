/**
 * ESM bridge to the CJS pricing tools library.
 *
 * The pricing engine (tools/pricing/lib/) uses CommonJS + better-sqlite3
 * native addon. We use createRequire to load them from Next.js API routes.
 *
 * Usage:
 *   import { getPricingLib, getDb } from '@/lib/pricing-db';
 *   const { db, stats, multiStay, dates, normalize } = getPricingLib();
 */

import { createRequire } from 'module';
import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const _require = createRequire(import.meta.url);

let _cached = null;

/**
 * On Vercel, /var/task is read-only — SQLite cannot create the WAL/SHM
 * sidecar files there, so opening the bundled pricing.db throws
 * SQLITE_CANTOPEN. Copy it to /tmp (the only writable location) on cold
 * start and point PRICING_DB_PATH at that copy. The bundled file is
 * bundled at build time via outputFileTracingIncludes in next.config.mjs;
 * it lives next to the function output at process.cwd()/tools/pricing.
 */
function ensureRuntimeDbPath() {
  if (process.env.PRICING_DB_PATH) return;
  if (!process.env.VERCEL) return; // Local + EC2 use the cwd path directly.

  const bundled = join(process.cwd(), 'tools', 'pricing', 'pricing.db');
  const runtime = '/tmp/pricing.db';

  if (!existsSync(bundled)) {
    // Build trace failed to include pricing.db. Surface a clear message
    // so logs say what's wrong instead of just SQLITE_CANTOPEN.
    throw new Error(
      `pricing.db missing from function bundle at ${bundled}. ` +
      `Check next.config.mjs outputFileTracingIncludes and the prebuild ` +
      `script (scripts/fetch-pricing-db.sh) ran with valid AWS creds.`
    );
  }

  if (!existsSync(runtime)) {
    mkdirSync('/tmp', { recursive: true });
    copyFileSync(bundled, runtime);
  }

  process.env.PRICING_DB_PATH = runtime;
}

/**
 * Lazy-load all CJS pricing modules. Cached after first call.
 * Returns { db, stats, multiStay, dates, normalize }
 */
export function getPricingLib() {
  if (_cached) return _cached;

  /* eslint-disable no-undef -- createRequire paths resolved at runtime */
  const db = _require('../tools/pricing/lib/db.js');
  const stats = _require('../tools/pricing/lib/stats.js');
  const multiStay = _require('../tools/pricing/lib/multi-stay.js');
  const dates = _require('../tools/pricing/lib/dates.js');
  const normalize = _require('../tools/pricing/lib/normalize.js');
  const decisionEngine = _require('../tools/pricing/lib/decision-engine.js');
  const availability = _require('../tools/pricing/lib/availability.js');
  const seasons = _require('../tools/pricing/lib/seasons.js');
  const compTimeline = _require('../tools/pricing/lib/comp-timeline.js');
  /* eslint-enable no-undef */

  _cached = { db, stats, multiStay, dates, normalize, decisionEngine, availability, seasons, compTimeline };
  return _cached;
}

let _initialized = false;

/**
 * Shorthand: get the better-sqlite3 Database instance.
 * Runs schema.sql on first call to ensure tables exist.
 *
 * NOTE: We resolve schema.sql from process.cwd() because __dirname in
 * tools/pricing/lib/db.js is rewritten by webpack to .next/server/...
 */
export function getDb() {
  ensureRuntimeDbPath();
  const dbLib = getPricingLib().db;
  const db = dbLib.getDb();
  if (!_initialized) {
    const schemaPath = join(process.cwd(), 'tools', 'pricing', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // Run migrations (safe to re-run — ALTER ADD COLUMN is no-op if exists)
    for (const mig of ['migrate-v3.sql', 'migrate-v4.sql', 'migrate-v5.sql', 'migrate-v6.sql', 'migrate-v7.sql', 'migrate-v8.sql', 'migrate-v9.sql', 'migrate-v10.sql', 'migrate-v11.sql', 'migrate-v12.sql', 'migrate-v13.sql', 'migrate-v14.sql', 'migrate-v15.sql']) {
      const migratePath = join(process.cwd(), 'tools', 'pricing', mig);
      try {
        const migration = readFileSync(migratePath, 'utf8');
        // Strip comments, split on semicolons — ALTER TABLE throws if column exists
        const stripped = migration.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
        const stmts = stripped.split(';').map(s => s.trim()).filter(Boolean);
        for (const stmt of stmts) {
          try { db.exec(stmt); } catch { /* already exists */ }
        }
      } catch { /* file not found or parse error — skip */ }
    }

    _initialized = true;
  }
  return db;
}
