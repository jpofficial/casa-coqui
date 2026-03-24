#!/usr/bin/env node

/**
 * Market Research Engine — CLI runner.
 *
 * Reads search config from DB, searches Airbnb for competing listings,
 * scrapes full details + pricing for the configured date range, and saves
 * results to the pricing database.
 *
 * Usage:
 *   node tools/pricing/scripts/market-research.js --unit unit-a
 *   node tools/pricing/scripts/market-research.js --unit unit-a --dry-run
 *   node tools/pricing/scripts/market-research.js --unit unit-a --headful
 */

const { getDb, closeDb, DB_PATH, purgeUnitSnapshots } = require('../lib/db');
const {
  launchBrowser,
  createContext,
  computeDateRanges,
  scrapeSearchResults,
  scrapeListingDetails,
} = require('../lib/market-research');
const { computeTcpn } = require('../lib/normalize');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const unitIdx = args.indexOf('--unit');
const unit = unitIdx !== -1 ? args[unitIdx + 1] : null;
const DRY_RUN = args.includes('--dry-run');
const HEADFUL = args.includes('--headful');

if (!unit) {
  console.error('Usage: market-research.js --unit <unit-id> [--dry-run] [--headful]');
  console.error('  --unit      Comp unit ID (e.g. unit-a)');
  console.error('  --dry-run   Search only, do not save to DB');
  console.error('  --headful   Show browser window (for CAPTCHA solving)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// DB setup — run migrations
// ---------------------------------------------------------------------------

const db = getDb();

// Run schema + migrations
const schemaPath = path.join(__dirname, '..', 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));
for (const mig of ['migrate-v3.sql', 'migrate-v4.sql', 'migrate-v5.sql']) {
  const migPath = path.join(__dirname, '..', mig);
  try {
    const sql = fs.readFileSync(migPath, 'utf8');
    const stripped = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
    const stmts = stripped.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      try { db.exec(stmt); } catch { /* already exists */ }
    }
  } catch { /* file not found */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();

  // 1. Load config
  const config = db.prepare('SELECT * FROM research_config WHERE comp_unit = ?').get(unit);
  if (!config) {
    console.error(`No research config found for ${unit}.`);
    console.error('Save config in the admin dashboard (Pricing → Research tab) first.');
    process.exit(1);
  }

  // 2. Build date range from config (single range = your configured dates)
  let dateRanges;
  if (config.start_date && config.checkout_date) {
    const nights = Math.round(
      (new Date(config.checkout_date) - new Date(config.start_date)) / 86400000
    );
    dateRanges = [{
      label: `${nights}n`,
      nights,
      checkin: config.start_date,
      checkout: config.checkout_date,
    }];
  } else {
    // Fallback: 1-week from start_date or tomorrow
    dateRanges = [computeDateRanges(config.start_date)[0]];
  }

  console.log('=== Market Research Engine ===');
  console.log(`  Unit:       ${unit}`);
  console.log(`  Location:   ${config.location}`);
  console.log(`  Bedrooms:   ${config.min_bedrooms}${config.max_bedrooms ? `–${config.max_bedrooms}` : '+'}`);

  console.log(`  Bathrooms:  ${config.min_bathrooms}+`);
  if (config.min_price || config.max_price) {
    console.log(`  Price:      $${config.min_price || '0'}–$${config.max_price || '∞'}/night`);
  }
  console.log(`  Search:     ${dateRanges[0].checkin} → ${dateRanges[0].checkout} (${dateRanges[0].nights} nights)`);
  console.log(`  Max results: ${config.max_results}`);
  console.log(`  Database:   ${DB_PATH}`);
  if (DRY_RUN) console.log('  *** DRY RUN — no DB writes ***');
  if (HEADFUL) console.log('  *** HEADFUL — browser visible ***');
  console.log();

  // 3. Create research_runs record
  let runId = null;
  if (!DRY_RUN) {
    const result = db.prepare(
      `INSERT INTO research_runs (comp_unit, config_snapshot, status) VALUES (?, ?, 'running')`
    ).run(unit, JSON.stringify(config));
    runId = result.lastInsertRowid;
  }

  // 3b. Purge stale snapshots for this unit (skip in dry-run)
  // Recommendations are NOT purged — they use upsert and remain valid until
  // the next analysis run overwrites them with fresh data.
  if (!DRY_RUN) {
    const purged = purgeUnitSnapshots(db, unit);
    console.log(`Purged: ${purged} stale snapshots`);
    console.log();
  }

  let listingsFound = 0;
  let listingsSaved = 0;
  let snapshotsSaved = 0;
  let errors = 0;

  try {
    // 4. Launch browser + search
    console.log('Launching browser...');
    const browser = await launchBrowser({ headful: HEADFUL });
    const context = await createContext(browser);
    const page = await context.newPage();

    console.log('Searching Airbnb...\n');
    const listings = await scrapeSearchResults(page, config, (msg) => console.log(`  ${msg}`));
    listingsFound = listings.length;

    console.log(`\nFound ${listingsFound} unique listings.\n`);

    if (listingsFound === 0) {
      console.log('No listings found. Check search criteria or try --headful for CAPTCHA.');
      await context.close();
      await browser.close();
      if (!DRY_RUN && runId) {
        db.prepare(
          `UPDATE research_runs SET status = 'completed', listings_found = 0, completed_at = datetime('now'), duration_ms = ? WHERE id = ?`
        ).run(Date.now() - startTime, runId);
      }
      closeDb();
      return;
    }

    if (DRY_RUN) {
      console.log('Listings found:');
      for (const l of listings) {
        console.log(`  ${l.airbnb_id}: ${l.name || '(unnamed)'}${l.base_rate ? ` — $${l.base_rate}/night` : ''}`);
      }
      await context.close();
      await browser.close();
      closeDb();
      return;
    }

    // 5. Scrape details for each listing (one visit per listing using configured dates)
    console.log('Scraping listing details...\n');

    // Prepared statements for DB writes
    const upsertComp = db.prepare(`
      INSERT INTO competitors (airbnb_id, name, url, host_name, neighborhood, bedrooms, bathrooms, max_guests, amenities, rating, review_count, superhost, min_nights, cleaning_fee, base_rate, source, comp_unit, active)
      VALUES (@airbnb_id, @name, @url, @host_name, @neighborhood, @bedrooms, @bathrooms, @max_guests, @amenities, @rating, @review_count, @superhost, @min_nights, @cleaning_fee, @base_rate, 'research', @comp_unit, 1)
      ON CONFLICT(airbnb_id) DO UPDATE SET
        name = COALESCE(excluded.name, competitors.name),
        url = COALESCE(excluded.url, competitors.url),
        host_name = COALESCE(excluded.host_name, competitors.host_name),
        neighborhood = COALESCE(excluded.neighborhood, competitors.neighborhood),
        bedrooms = COALESCE(excluded.bedrooms, competitors.bedrooms),
        bathrooms = COALESCE(excluded.bathrooms, competitors.bathrooms),
        max_guests = COALESCE(excluded.max_guests, competitors.max_guests),
        amenities = COALESCE(excluded.amenities, competitors.amenities),
        rating = COALESCE(excluded.rating, competitors.rating),
        review_count = COALESCE(excluded.review_count, competitors.review_count),
        superhost = COALESCE(excluded.superhost, competitors.superhost),
        min_nights = COALESCE(excluded.min_nights, competitors.min_nights),
        cleaning_fee = COALESCE(excluded.cleaning_fee, competitors.cleaning_fee),
        base_rate = COALESCE(excluded.base_rate, competitors.base_rate),
        source = 'research',
        active = 1,
        updated_at = datetime('now')
    `);

    // Write to snapshots_v2 only (V1 snapshots table is deprecated)
    const insertSnapshotV2 = db.prepare(`
      INSERT OR REPLACE INTO snapshots_v2 (competitor_id, check_date, stay_nights, nightly_rate, cleaning_fee, total_cost, tcpn, available)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const getCompId = db.prepare('SELECT id FROM competitors WHERE airbnb_id = ?');

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      console.log(`[${i + 1}/${listings.length}] ${listing.name || listing.airbnb_id}`);

      try {
        const details = await scrapeListingDetails(page, listing.airbnb_id, dateRanges, (msg) => console.log(msg));

        // Skip listings that exceed the bedroom ceiling
        if (config.max_bedrooms && details.bedrooms && details.bedrooms > config.max_bedrooms) {
          console.log(`  ✗ Skipped — ${details.bedrooms}BR exceeds max ${config.max_bedrooms}BR`);
          continue;
        }

        // Upsert competitor
        const compData = {
          airbnb_id: details.airbnb_id,
          name: details.name || listing.name || `Listing ${details.airbnb_id}`,
          url: details.url,
          host_name: details.host_name || null,
          neighborhood: details.neighborhood || null,
          bedrooms: details.bedrooms || config.min_bedrooms,
          bathrooms: details.bathrooms || config.min_bathrooms,
          max_guests: details.max_guests || null,
          amenities: details.amenities || null,
          rating: details.rating || listing.rating || null,
          review_count: details.review_count || listing.review_count || null,
          superhost: details.superhost ? 1 : 0,
          min_nights: details.min_nights || null,
          cleaning_fee: details.cleaning_fee || null,
          base_rate: details.base_rate || listing.base_rate || null,
          comp_unit: unit,
        };

        upsertComp.run(compData);
        listingsSaved++;

        // Get the competitor ID for snapshots
        const comp = getCompId.get(details.airbnb_id);
        if (comp) {
          for (const range of dateRanges) {
            const price = details.prices[range.label];
            if (price && price.nightly_rate && !price.error) {
              const cleaningFee = price.cleaning_fee || details.cleaning_fee || 0;
              const total = price.total || (price.nightly_rate * range.nights + cleaningFee);
              const tcpn = Math.round((total / range.nights) * 100) / 100;

              // Write only the actually-scraped stay length (no synthetic derivation)
              insertSnapshotV2.run(
                comp.id, range.checkin, range.nights,
                price.nightly_rate, cleaningFee, total, tcpn
              );
              snapshotsSaved++;
            }
          }
        }

        console.log(`  ✓ Saved — $${compData.base_rate || '?'}/night, cleaning $${compData.cleaning_fee || '?'}`);
      } catch (err) {
        console.log(`  ✗ Error: ${err.message}`);
        errors++;
      }
    }

    await context.close();
    await browser.close();

    // 6. Update research_runs record
    if (runId) {
      db.prepare(`
        UPDATE research_runs SET
          status = 'completed',
          listings_found = ?,
          listings_saved = ?,
          snapshots_saved = ?,
          errors = ?,
          duration_ms = ?,
          completed_at = datetime('now')
        WHERE id = ?
      `).run(listingsFound, listingsSaved, snapshotsSaved, errors, Date.now() - startTime, runId);
    }

  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    if (runId) {
      db.prepare(`
        UPDATE research_runs SET
          status = 'failed',
          listings_found = ?,
          listings_saved = ?,
          snapshots_saved = ?,
          errors = ?,
          error_log = ?,
          duration_ms = ?,
          completed_at = datetime('now')
        WHERE id = ?
      `).run(listingsFound, listingsSaved, snapshotsSaved, errors + 1, err.message, Date.now() - startTime, runId);
    }
    closeDb();
    process.exit(1);
  }

  // 7. Print summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Summary ===');
  console.log(`  Listings found:    ${listingsFound}`);
  console.log(`  Competitors saved: ${listingsSaved}`);
  console.log(`  Snapshots saved:   ${snapshotsSaved}`);
  console.log(`  Errors:            ${errors}`);
  console.log(`  Duration:          ${duration}s`);
  console.log(`  Run ID:            ${runId || 'N/A'}`);

  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
