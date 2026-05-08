#!/usr/bin/env node

/**
 * Backfill base_rate for existing competitors that have an Airbnb URL.
 *
 * Uses Playwright to render each listing page and extract the nightly rate.
 *
 * Usage:
 *   node tools/pricing/scripts/backfill-base-rates.js [--dry-run]
 */

const { chromium } = require('playwright');
const { getDb, closeDb, DB_PATH } = require('../lib/db');
const { scrapeBaseRate } = require('../lib/scrape-price');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

// Run V3 migration first to ensure column exists
const db = getDb();
const migratePath = path.join(__dirname, '..', 'migrate-v3.sql');
try {
  const migration = fs.readFileSync(migratePath, 'utf8');
  db.exec(migration);
} catch { /* column already exists */ }

async function main() {
  console.log('Backfill base_rate for competitors with Airbnb URLs');
  console.log(`  Database: ${DB_PATH}`);
  if (DRY_RUN) console.log('  *** DRY RUN — no updates will be written ***');
  console.log();

  const comps = db.prepare(
    "SELECT id, name, url, airbnb_id FROM competitors WHERE url IS NOT NULL AND url != '' AND active = 1 AND (base_rate IS NULL OR base_rate = 0)"
  ).all();

  if (comps.length === 0) {
    console.log('  No competitors need backfilling.');
    closeDb();
    return;
  }

  console.log(`  Found ${comps.length} competitor(s) to backfill.\n`);

  // Share a single browser instance across all scrapes
  const browser = await chromium.launch({ headless: true });
  const update = db.prepare("UPDATE competitors SET base_rate = ?, updated_at = datetime('now') WHERE id = ?");
  let updated = 0;
  let failed = 0;

  for (const comp of comps) {
    process.stdout.write(`  ${comp.name} ... `);

    // Throttle between requests
    if (updated + failed > 0) {
      await new Promise((r) => setTimeout(r, 3000));
    }

    const result = await scrapeBaseRate(comp.url, { browser });

    if (result.base_rate) {
      if (!DRY_RUN) {
        update.run(result.base_rate, comp.id);
      }
      console.log(`$${result.base_rate}/night (${result.source}, $${result.total} / ${result.nights}n)`);
      updated++;
    } else {
      console.log(`could not extract rate${result.error ? ': ' + result.error : ''}`);
      failed++;
    }
  }

  await browser.close();
  closeDb();
  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
