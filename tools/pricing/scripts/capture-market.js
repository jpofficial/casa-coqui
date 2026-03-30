#!/usr/bin/env node

/**
 * Batch Market Capture CLI — captures competitor pricing across an entire month.
 *
 * Runs one browser session, iterating over anchor dates (every 7 days) within
 * a target month. Each anchor produces a research_run record linked by batch_id.
 *
 * Usage:
 *   node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04
 *   node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04 --capture-calendar
 *   node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04 --dry-run
 *   node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04 --headful
 */

const path = require('path');
const fs = require('fs');
const {
  getDb, closeDb, DB_PATH,
  purgeUnitSnapshots, saveRunObservations, saveCalendarAvailability,
  createCaptureBatch, updateCaptureBatch,
} = require('../lib/db');
const {
  launchBrowser, createContext, scrapeSearchResults, scrapeListingDetails, getRelevantMonths,
} = require('../lib/market-research');
const { computeTcpn } = require('../lib/normalize');
const { classifyDayType } = require('../lib/dates');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const UNIT = getArg('unit');
const MONTH = getArg('month'); // e.g. "2026-04"
const DRY_RUN = args.includes('--dry-run');
const HEADFUL = args.includes('--headful');
const CAPTURE_CALENDAR = args.includes('--capture-calendar');

// Stay lengths for discount tier capture (short, weekly, bi-weekly, monthly)
const STAY_LENGTHS = [3, 7, 15, 30];

// Anti-detection delay between anchors (ms)
const ANCHOR_DELAY_BASE = 45000;
const ANCHOR_DELAY_JITTER = 15000;

if (!UNIT || !MONTH) {
  console.error('Usage: capture-market.js --unit <unit-id> --month <YYYY-MM> [--dry-run] [--headful] [--capture-calendar]');
  console.error('  --unit              Comp unit ID (e.g. unit-a)');
  console.error('  --month             Target month (e.g. 2026-04)');
  console.error('  --dry-run           Parse config + anchors, do not scrape');
  console.error('  --headful           Show browser window');
  console.error('  --capture-calendar  Capture calendar availability');
  process.exit(1);
}

if (!/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error(`Invalid month format "${MONTH}" — expected YYYY-MM`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// DB setup — run migrations
// ---------------------------------------------------------------------------

const db = getDb();
const schemaPath = path.join(__dirname, '..', 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

const migrations = [
  'migrate-v3.sql', 'migrate-v4.sql', 'migrate-v5.sql', 'migrate-v6.sql',
  'migrate-v7.sql', 'migrate-v8.sql', 'migrate-v9.sql', 'migrate-v10.sql',
  'migrate-v11.sql', 'migrate-v12.sql', 'migrate-v13.sql', 'migrate-v14.sql',
];
for (const mig of migrations) {
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
// Anchor date computation
// ---------------------------------------------------------------------------

function computeAnchorDates(month) {
  const year = parseInt(month.split('-')[0]);
  const mon = parseInt(month.split('-')[1]) - 1;
  const firstDay = new Date(year, mon, 1);
  const lastDay = new Date(year, mon + 1, 0);

  // Ensure anchors are in the future (at least tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const anchors = [];
  const d = new Date(firstDay);
  while (d <= lastDay) {
    if (d >= tomorrow) {
      anchors.push(d.toISOString().split('T')[0]);
    }
    d.setDate(d.getDate() + 7);
  }
  return anchors;
}

/**
 * Build date ranges for a single anchor date across all stay lengths.
 * Returns array of { label, nights, checkin, checkout }.
 */
function buildDateRanges(anchorDate) {
  return STAY_LENGTHS.map(nights => {
    const checkin = new Date(anchorDate + 'T12:00:00');
    const checkout = new Date(checkin);
    checkout.setDate(checkout.getDate() + nights);
    return {
      label: `${nights}n`,
      nights,
      checkin: anchorDate,
      checkout: checkout.toISOString().split('T')[0],
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  const anchorDates = computeAnchorDates(MONTH);

  if (anchorDates.length === 0) {
    console.error(`No future anchor dates in ${MONTH}. All dates are in the past.`);
    process.exit(1);
  }

  // Load research config
  const config = db.prepare('SELECT * FROM research_config WHERE comp_unit = ?').get(UNIT);
  if (!config) {
    console.error(`No research config found for ${UNIT}.`);
    console.error('Save config in the admin dashboard (Pricing → Research tab) first.');
    process.exit(1);
  }

  console.log('=== Batch Market Capture ===');
  console.log(`  Unit:         ${UNIT}`);
  console.log(`  Month:        ${MONTH}`);
  console.log(`  Anchors:      ${anchorDates.join(', ')} (${anchorDates.length} dates)`);
  console.log(`  Stay lengths: ${STAY_LENGTHS.join(', ')} nights`);
  console.log(`  Location:     ${config.location}`);
  console.log(`  Bedrooms:     ${config.min_bedrooms}${config.max_bedrooms ? `–${config.max_bedrooms}` : '+'}`);
  console.log(`  Max results:  ${config.max_results}`);
  if (config.min_price || config.max_price) {
    console.log(`  Price:        $${config.min_price || '0'}–$${config.max_price || '∞'}/night`);
  }
  console.log(`  Database:     ${DB_PATH}`);
  if (DRY_RUN) console.log('  *** DRY RUN — no scraping ***');
  if (HEADFUL) console.log('  *** HEADFUL — browser visible ***');
  if (CAPTURE_CALENDAR) console.log('  *** CAPTURE CALENDAR ***');
  console.log();

  if (DRY_RUN) {
    console.log('Anchor schedule:');
    for (const anchor of anchorDates) {
      const ranges = buildDateRanges(anchor);
      console.log(`  ${anchor}: ${ranges.map(r => `${r.checkin}→${r.checkout} (${r.label})`).join(', ')}`);
    }
    console.log(`\nTotal runs: ${anchorDates.length}`);
    console.log(`Total scrape passes: ${anchorDates.length} anchors × ${STAY_LENGTHS.length} stay lengths = ${anchorDates.length * STAY_LENGTHS.length}`);
    closeDb();
    return;
  }

  // Create batch record
  const batchId = createCaptureBatch(db, {
    label: `${UNIT} ${MONTH}`,
    unitId: UNIT,
    month: MONTH,
    anchorDates,
    stayLengths: STAY_LENGTHS,
    runsPlanned: anchorDates.length,
    configSnapshot: config,
  });
  console.log(`Batch ID: ${batchId}\n`);

  // Purge stale snapshots ONCE at batch start
  const purged = purgeUnitSnapshots(db, UNIT);
  console.log(`Purged: ${purged} stale snapshots\n`);

  // Launch browser
  console.log('Launching browser...');
  const browser = await launchBrowser({ headful: HEADFUL });
  const context = await createContext(browser);
  const page = await context.newPage();

  // Prep DB statements
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
      source = 'research', active = 1, updated_at = datetime('now')
  `);

  const insertSnapshotV2 = db.prepare(`
    INSERT OR REPLACE INTO snapshots_v2 (competitor_id, check_date, stay_nights, nightly_rate, cleaning_fee, total_cost, tcpn, available)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const getCompId = db.prepare('SELECT id FROM competitors WHERE airbnb_id = ?');

  let runsCompleted = 0;
  let runsFailed = 0;
  let totalObservations = 0;
  let totalCalendarRows = 0;

  // Search ONCE — reuse listings across all anchors
  console.log('Searching Airbnb...\n');
  let listings;
  try {
    listings = await scrapeSearchResults(page, config, (msg) => console.log(`  ${msg}`));
  } catch (err) {
    console.error(`Search failed: ${err.message}`);
    updateCaptureBatch(db, batchId, { status: 'failed', completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime });
    await context.close();
    await browser.close();
    closeDb();
    process.exit(1);
  }

  console.log(`\nFound ${listings.length} unique listings.\n`);

  if (listings.length === 0) {
    console.log('No listings found. Check search criteria or try --headful for CAPTCHA.');
    updateCaptureBatch(db, batchId, { status: 'completed', runs_completed: 0, completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime });
    await context.close();
    await browser.close();
    closeDb();
    return;
  }

  // Iterate anchors
  for (let a = 0; a < anchorDates.length; a++) {
    const anchor = anchorDates[a];
    const dateRanges = buildDateRanges(anchor);
    const anchorStart = Date.now();

    console.log(`--- Anchor ${a + 1}/${anchorDates.length}: ${anchor} ---`);
    console.log(`  Ranges: ${dateRanges.map(r => r.label).join(', ')}\n`);

    // Create research_runs record for this anchor
    const runResult = db.prepare(
      `INSERT INTO research_runs (comp_unit, config_snapshot, status, batch_id) VALUES (?, ?, 'running', ?)`
    ).run(UNIT, JSON.stringify({ ...config, anchor, stayLengths: STAY_LENGTHS }), batchId);
    const runId = Number(runResult.lastInsertRowid);

    const observations = [];
    const calendarRows = [];
    const scrapedSummary = [];
    const relevantMonths = CAPTURE_CALENDAR ? getRelevantMonths(anchor, dateRanges[dateRanges.length - 1].checkout) : null;

    let listingsSaved = 0;
    let snapshotsSaved = 0;
    let errors = 0;

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      console.log(`  [${i + 1}/${listings.length}] ${listing.name || listing.airbnb_id}`);

      try {
        const details = await scrapeListingDetails(page, listing.airbnb_id, dateRanges, (msg) => console.log(`    ${msg}`), { captureCalendar: CAPTURE_CALENDAR });

        // Skip listings that exceed the bedroom ceiling (null bedrooms = unknown, skip to be safe)
        if (config.max_bedrooms) {
          if (details.bedrooms == null) {
            scrapedSummary.push({ name: details.name || listing.name || listing.airbnb_id, bedrooms: '?', rate: details.base_rate || listing.base_rate, rating: details.rating || listing.rating, status: 'skipped (BR unknown)' });
            console.log(`    ✗ Skipped — bedrooms unknown, cannot verify ≤ ${config.max_bedrooms}BR ceiling`);
            continue;
          }
          if (details.bedrooms > config.max_bedrooms) {
            scrapedSummary.push({ name: details.name || listing.name || listing.airbnb_id, bedrooms: details.bedrooms, rate: details.base_rate || listing.base_rate, rating: details.rating || listing.rating, status: `skipped (${details.bedrooms}BR)` });
            console.log(`    ✗ Skipped — ${details.bedrooms}BR exceeds max ${config.max_bedrooms}BR`);
            continue;
          }
        }

        // Upsert competitor
        upsertComp.run({
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
          comp_unit: UNIT,
        });
        listingsSaved++;

        const comp = getCompId.get(details.airbnb_id);
        if (comp) {
          for (const range of dateRanges) {
            const price = details.prices[range.label];
            if (price && price.nightly_rate && !price.error) {
              const cleaningFee = price.cleaning_fee || details.cleaning_fee || 0;
              const total = price.total || (price.nightly_rate * range.nights + cleaningFee);
              const tcpn = Math.round((total / range.nights) * 100) / 100;

              insertSnapshotV2.run(comp.id, range.checkin, range.nights, price.nightly_rate, cleaningFee, total, tcpn);
              snapshotsSaved++;

              observations.push({
                runId, runSource: 'research', compUnit: UNIT,
                competitorId: comp.id, airbnbId: details.airbnb_id,
                listingName: details.name || listing.name || null,
                listingUrl: details.url || null,
                bedrooms: details.bedrooms || null, bathrooms: details.bathrooms || null,
                rating: details.rating || listing.rating || null,
                reviewCount: details.review_count || listing.review_count || null,
                superhost: details.superhost || false,
                checkDate: range.checkin, stayNights: range.nights,
                nightlyRate: price.nightly_rate, cleaningFee,
                totalCost: total, tcpn, available: 1,
                dayType: classifyDayType(range.checkin),
              });
            }
          }
        }

        // Calendar availability
        if (CAPTURE_CALENDAR && comp && details.calendarRaw && details.calendarRaw.length > 0) {
          const filtered = details.calendarRaw.filter(d => relevantMonths.has(d.date.slice(0, 7)));
          for (const day of filtered) {
            calendarRows.push({
              runId, runSource: 'research',
              competitorId: comp.id, airbnbId: details.airbnb_id,
              listingName: details.name || listing.name || null,
              listingUrl: details.url || null,
              date: day.date,
              rawStatus: day.rawStatus,
              displayStatus: day.displayStatus,
              minNights: day.minNights, maxNights: day.maxNights,
              availableForCheckin: day.availableForCheckin,
              availableForCheckout: day.availableForCheckout,
            });
          }
          if (filtered.length > 0) console.log(`    Calendar: ${filtered.length} days`);
        }

        scrapedSummary.push({ name: details.name || listing.name || listing.airbnb_id, bedrooms: details.bedrooms || config.min_bedrooms, rate: details.base_rate || listing.base_rate, rating: details.rating || listing.rating, status: 'saved' });
        console.log(`    OK — $${details.base_rate || '?'}/night`);
      } catch (err) {
        console.log(`    Error: ${err.message}`);
        errors++;
      }
    }

    // Print scraped listings summary table
    if (scrapedSummary.length > 0) {
      console.log('\n  --- Scraped Listings ---');
      console.log('    Name                                        BR    $/night  Rating  Status');
      console.log('    ' + '-'.repeat(74));
      for (const s of scrapedSummary) {
        const name = String(s.name).slice(0, 44).padEnd(44);
        const br = String(s.bedrooms).padStart(2);
        const rate = s.rate ? `$${s.rate}`.padStart(7) : '     —'.padStart(7);
        const rating = s.rating ? String(s.rating).padStart(6) : '     —';
        console.log(`    ${name}  ${br}  ${rate}  ${rating}  ${s.status}`);
      }
    }

    // Flush Layer 2 observations
    if (observations.length > 0) {
      saveRunObservations(db, observations);
      totalObservations += observations.length;
    }

    // Flush calendar rows
    if (calendarRows.length > 0) {
      saveCalendarAvailability(db, calendarRows);
      totalCalendarRows += calendarRows.length;

      const dates = calendarRows.map(r => r.date).sort();
      db.prepare('UPDATE research_runs SET calendar_start_date = ?, calendar_end_date = ? WHERE id = ?')
        .run(dates[0], dates[dates.length - 1], runId);
    }

    // Update research_runs
    const anchorDuration = Date.now() - anchorStart;
    const runStatus = errors > listingsSaved ? 'failed' : 'completed';
    db.prepare(`
      UPDATE research_runs SET
        status = ?, listings_found = ?, listings_saved = ?,
        snapshots_saved = ?, errors = ?, duration_ms = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(runStatus, listings.length, listingsSaved, snapshotsSaved, errors, anchorDuration, runId);

    if (runStatus === 'completed') {
      runsCompleted++;
    } else {
      runsFailed++;
    }
    updateCaptureBatch(db, batchId, { runs_completed: runsCompleted, runs_failed: runsFailed });

    console.log(`\n  Anchor ${anchor}: ${observations.length} observations, ${snapshotsSaved} snapshots, ${errors} errors (${(anchorDuration / 1000).toFixed(1)}s)\n`);

    // Anti-detection delay between anchors (skip after last)
    if (a < anchorDates.length - 1) {
      const delay = ANCHOR_DELAY_BASE + Math.floor(Math.random() * ANCHOR_DELAY_JITTER);
      console.log(`  Waiting ${(delay / 1000).toFixed(0)}s before next anchor...\n`);
      await page.waitForTimeout(delay);
    }
  }

  // Clean up browser
  await context.close();
  await browser.close();

  // Finalize batch
  const totalDuration = Date.now() - startTime;
  const batchStatus = runsFailed > runsCompleted ? 'failed' : 'completed';
  updateCaptureBatch(db, batchId, {
    status: batchStatus,
    completed_at: new Date().toISOString(),
    duration_ms: totalDuration,
  });

  // Summary
  const duration = (totalDuration / 1000).toFixed(1);
  console.log('=== Batch Summary ===');
  console.log(`  Batch ID:      ${batchId}`);
  console.log(`  Unit:          ${UNIT}`);
  console.log(`  Month:         ${MONTH}`);
  console.log(`  Runs:          ${runsCompleted} completed, ${runsFailed} failed / ${anchorDates.length} planned`);
  console.log(`  Observations:  ${totalObservations}`);
  console.log(`  Listings:      ${listings.length}`);
  if (CAPTURE_CALENDAR) {
    console.log(`  Calendar rows: ${totalCalendarRows}`);
  }
  console.log(`  Duration:      ${duration}s`);
  console.log(`  Status:        ${batchStatus}`);

  closeDb();
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  console.error(err.stack);
  closeDb();
  process.exit(1);
});
