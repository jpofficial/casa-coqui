#!/usr/bin/env node

/**
 * Smart Pricing Autopilot — orchestrator CLI.
 *
 * Runs the full pipeline: scrape → analyze → report.
 *
 * Usage:
 *   node tools/pricing/scripts/autopilot.js                  # all units
 *   node tools/pricing/scripts/autopilot.js --unit unit-a    # single unit
 *   node tools/pricing/scripts/autopilot.js --skip-scrape    # analysis only
 *   node tools/pricing/scripts/autopilot.js --dry-run        # preview, no writes
 *   node tools/pricing/scripts/autopilot.js --headful        # visible browser
 *   node tools/pricing/scripts/autopilot.js --days 60        # analysis horizon
 */

const path = require('path');
const fs = require('fs');
const { getDb, closeDb, getCompetitorsForUnit, getLatestAutopilotRun, DB_PATH, purgeUnitSnapshots } = require('../lib/db');
const { generateDateRange } = require('../lib/dates');
const { analyzeDateMultiStay, STAY_LENGTHS } = require('../lib/multi-stay');
const { saveRecommendationV2 } = require('../lib/db');
const { getDayOfWeek } = require('../lib/dates');

// CLI args parsing
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
const UNIT = getArg('unit'); // null = all units
const SKIP_SCRAPE = args.includes('--skip-scrape');
const DRY_RUN = args.includes('--dry-run');
const HEADFUL = args.includes('--headful');
const DAYS = parseInt(getArg('days') || '30');

const PUBLIC_JSON = path.join(__dirname, '..', '..', '..', 'public', 'data', 'pricing-report.json');

// DB setup
const db = getDb();
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

async function main() {
  const startTime = Date.now();

  // Determine units to process
  const unitIds = UNIT ? [UNIT] : ['unit-a', 'unit-b'];

  console.log('=== Smart Pricing Autopilot ===');
  console.log(`  Units:       ${unitIds.join(', ')}`);
  console.log(`  Days:        ${DAYS}`);
  console.log(`  Skip scrape: ${SKIP_SCRAPE}`);
  console.log(`  Database:    ${DB_PATH}`);
  if (DRY_RUN) console.log('  *** DRY RUN ***');
  console.log();

  // 1. Log run
  let runId = null;
  if (!DRY_RUN) {
    const result = db.prepare(
      `INSERT INTO autopilot_runs (run_type, units_processed, status) VALUES (?, ?, 'running')`
    ).run(SKIP_SCRAPE ? 'analysis' : 'full', unitIds.join(','));
    runId = result.lastInsertRowid;
  }

  let scrapeOk = 0, scrapeErrors = 0, analysisOk = 0;

  try {
    // 2. SCRAPE phase (unless --skip-scrape)
    if (!SKIP_SCRAPE) {
      console.log('--- SCRAPE PHASE ---\n');

      // Dynamically load market-research (has playwright dependency)
      const { launchBrowser, createContext, computeDateRangesV2, scrapeSearchResults, scrapeListingDetails } = require('../lib/market-research');
      const { computeTcpn } = require('../lib/normalize');

      const browser = await launchBrowser({ headful: HEADFUL });
      const context = await createContext(browser);
      const page = await context.newPage();

      for (const unitId of unitIds) {
        const config = db.prepare('SELECT * FROM research_config WHERE comp_unit = ?').get(unitId);
        if (!config) {
          console.log(`  ${unitId}: No research config — skipping scrape.`);
          continue;
        }

        // Purge stale snapshots before scraping fresh data
        if (!DRY_RUN) {
          const purged = purgeUnitSnapshots(db, unitId);
          console.log(`  ${unitId}: Purged ${purged} stale v2 snapshots.`);
        }

        console.log(`  ${unitId}: Searching Airbnb...`);

        try {
          const listings = await scrapeSearchResults(page, config, (msg) => console.log(`    ${msg}`));
          console.log(`  ${unitId}: Found ${listings.length} listings.`);

          if (listings.length === 0) continue;

          const dateRanges = computeDateRangesV2(config.start_date);

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
            INSERT INTO snapshots_v2 (competitor_id, check_date, stay_nights, day_type, nightly_rate, cleaning_fee, total_cost, tcpn, available)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(competitor_id, check_date, stay_nights) DO UPDATE SET
              day_type=excluded.day_type, nightly_rate=excluded.nightly_rate,
              cleaning_fee=excluded.cleaning_fee, total_cost=excluded.total_cost,
              tcpn=excluded.tcpn, available=excluded.available,
              captured_at=datetime('now')
          `);

          const getCompId = db.prepare('SELECT id FROM competitors WHERE airbnb_id = ?');

          for (let i = 0; i < listings.length; i++) {
            const listing = listings[i];
            console.log(`    [${i + 1}/${listings.length}] ${listing.name || listing.airbnb_id}`);

            try {
              const details = await scrapeListingDetails(page, listing.airbnb_id, dateRanges, (msg) => console.log(`      ${msg}`));

              // Skip listings that exceed the bedroom ceiling
              if (config.max_bedrooms && details.bedrooms && details.bedrooms > config.max_bedrooms) {
                console.log(`      ✗ Skipped — ${details.bedrooms}BR exceeds max ${config.max_bedrooms}BR`);
                continue;
              }

              if (!DRY_RUN) {
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
                  comp_unit: unitId,
                });

                const comp = getCompId.get(details.airbnb_id);
                if (comp) {
                  for (const range of dateRanges) {
                    const price = details.prices[range.label];
                    if (price && price.nightly_rate && !price.error) {
                      const fee = price.cleaning_fee || details.cleaning_fee || 0;
                      const total = price.total || (price.nightly_rate * range.nights + fee);
                      const tcpn = computeTcpn(price.nightly_rate, fee, range.nights);

                      insertSnapshotV2.run(
                        comp.id, range.checkin, range.nights,
                        getDayOfWeek(range.checkin),
                        price.nightly_rate, fee, total, tcpn
                      );
                    }
                  }
                }
              }

              scrapeOk++;
              console.log(`      OK — $${details.base_rate || '?'}/night`);
            } catch (err) {
              console.log(`      ERROR: ${err.message}`);
              scrapeErrors++;
            }
          }
        } catch (err) {
          console.log(`  ${unitId}: Scrape failed — ${err.message}`);
          scrapeErrors++;
        }
      }

      await context.close();
      await browser.close();
      console.log();
    }

    // 3. ANALYZE phase
    console.log('--- ANALYZE PHASE ---\n');
    const today = new Date().toISOString().split('T')[0];
    const dates = generateDateRange(today, DAYS);

    for (const unitId of unitIds) {
      console.log(`  ${unitId}: Analyzing ${dates.length} dates...`);
      let unitOk = 0;

      for (const date of dates) {
        try {
          const rec = analyzeDateMultiStay(db, unitId, date);

          if (!DRY_RUN && rec.verdict !== 'insufficient_data') {
            saveRecommendationV2(db, {
              unitId, checkDate: rec.date, dayType: rec.dayType,
              season: rec.season,
              tcpn_1n: rec.tcpn_1n, tcpn_2n: rec.tcpn_2n,
              tcpn_3n: rec.tcpn_3n, tcpn_4n: rec.tcpn_4n, tcpn_7n: rec.tcpn_7n,
              recNightlyRate: rec.recNightlyRate,
              recWeeklyPct: rec.recWeeklyPct,
              recMonthlyPct: rec.recMonthlyPct,
              floor: rec.floor, target: rec.target, stretch: rec.stretch,
              yourRate: rec.yourRate, yourTcpn: rec.yourTcpn,
              percentile: rec.percentile, verdict: rec.verdict,
              reasoning: rec.reasoning, confidence: rec.confidence,
              compCount: rec.compCount, demandSignal: rec.demandSignal,
              holidayAdjusted: rec.holidayAdjusted,
            });
            unitOk++;
          }

          if (DRY_RUN && rec.recNightlyRate) {
            console.log(`    ${date} [${rec.season}] → $${rec.recNightlyRate}/night, ${rec.recWeeklyPct}% weekly, ${rec.verdict}`);
          }
        } catch (err) {
          console.log(`    ${date}: Error — ${err.message}`);
        }
      }

      analysisOk += unitOk;
      console.log(`  ${unitId}: ${unitOk} recommendations saved.`);
    }
    console.log();

    // 4. REPORT phase — generate pricing-report.json with v2 data
    if (!DRY_RUN) {
      console.log('--- REPORT PHASE ---');
      const { getRecommendationsV2 } = require('../lib/db');

      const reportUnits = {};
      for (const unitId of unitIds) {
        const recs = getRecommendationsV2(db, unitId, DAYS);
        reportUnits[unitId] = {
          name: unitId === 'unit-a' ? 'Unit A' : 'Unit B',
          autopilot: recs.map(r => ({
            date: r.check_date,
            dayType: r.day_type,
            season: r.season,
            recNightlyRate: r.rec_nightly_rate,
            recWeeklyPct: r.rec_weekly_pct,
            recMonthlyPct: r.rec_monthly_pct,
            floor: r.floor_price,
            target: r.target_price,
            stretch: r.stretch_price,
            yourRate: r.your_rate,
            verdict: r.verdict,
            confidence: r.confidence,
            compCount: r.comp_count,
            demandSignal: r.demand_signal,
            holidayAdjusted: r.holiday_adjusted === 1,
          })),
        };
      }

      // Read existing report, merge autopilot data
      let existing = { units: {} };
      try {
        existing = JSON.parse(fs.readFileSync(PUBLIC_JSON, 'utf8'));
      } catch { /* no existing report */ }

      for (const uid of unitIds) {
        if (!existing.units[uid]) existing.units[uid] = {};
        existing.units[uid].autopilot = reportUnits[uid].autopilot;
      }
      existing.autopilotGeneratedAt = new Date().toISOString();

      fs.mkdirSync(path.dirname(PUBLIC_JSON), { recursive: true });
      fs.writeFileSync(PUBLIC_JSON, JSON.stringify(existing, null, 2));
      console.log(`  Report: ${PUBLIC_JSON}`);
      console.log();
    }

    // 5. Update run log
    if (!DRY_RUN && runId) {
      db.prepare(`
        UPDATE autopilot_runs SET
          status = 'completed', scrape_ok = ?, scrape_errors = ?,
          analysis_ok = ?, report_written = 1,
          duration_ms = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(scrapeOk, scrapeErrors, analysisOk, Date.now() - startTime, runId);
    }

  } catch (err) {
    console.error(`\nFatal: ${err.message}`);
    console.error(err.stack);
    if (!DRY_RUN && runId) {
      db.prepare(`
        UPDATE autopilot_runs SET
          status = 'failed', scrape_ok = ?, scrape_errors = ?,
          analysis_ok = ?, error_log = ?,
          duration_ms = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(scrapeOk, scrapeErrors, analysisOk, err.message, Date.now() - startTime, runId);
    }
    closeDb();
    process.exit(1);
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('=== Summary ===');
  console.log(`  Scrape:    ${scrapeOk} OK, ${scrapeErrors} errors`);
  console.log(`  Analysis:  ${analysisOk} recommendations`);
  console.log(`  Duration:  ${duration}s`);
  console.log(`  Run ID:    ${runId || 'N/A (dry-run)'}`);

  // Print top recommendations
  if (!DRY_RUN) {
    const { getRecommendationsV2 } = require('../lib/db');
    console.log('\n--- Top Recommendations ---');
    for (const unitId of unitIds) {
      const top = getRecommendationsV2(db, unitId, 14);
      if (top.length > 0) {
        console.log(`\n  ${unitId}:`);
        for (const r of top.slice(0, 7)) {
          const season = (r.season || '').padEnd(8);
          const rate = r.rec_nightly_rate ? `$${r.rec_nightly_rate}` : '  —  ';
          const weekly = r.rec_weekly_pct ? `${r.rec_weekly_pct}%w` : '';
          console.log(`    ${r.check_date} ${season} ${rate.padStart(5)}/night  ${weekly.padStart(4)}  ${r.verdict || ''}`);
        }
      }
    }
  }

  closeDb();
}

main().catch(err => {
  console.error(err);
  closeDb();
  process.exit(1);
});
