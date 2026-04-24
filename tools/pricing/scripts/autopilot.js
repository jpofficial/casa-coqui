#!/usr/bin/env node

/**
 * Smart Pricing Autopilot — orchestrator CLI.
 *
 * Runs the full pipeline: scrape → analyze → archive → update run.
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
const { getDb, closeDb, getCompetitorsForUnit, DB_PATH, purgeUnitSnapshots, archiveMarketData, saveRunObservations, saveCalendarAvailability } = require('../lib/db');
const { generateDateRange } = require('../lib/dates');
const { analyzeDateMultiStay } = require('../lib/multi-stay');
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
const S3_SYNC = args.includes('--s3-sync');

// Trigger detection: env var (set by launchd/dashboard), or heuristic
const TRIGGER = process.env.AUTOPILOT_TRIGGER ||
  (process.ppid === 1 ? 'scheduled' : 'terminal');

// DB setup
const db = getDb();
const schemaPath = path.join(__dirname, '..', 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));
for (const mig of ['migrate-v3.sql', 'migrate-v4.sql', 'migrate-v5.sql', 'migrate-v6.sql', 'migrate-v7.sql', 'migrate-v8.sql', 'migrate-v9.sql', 'migrate-v10.sql', 'migrate-v11.sql', 'migrate-v12.sql', 'migrate-v13.sql', 'migrate-v14.sql']) {
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
  console.log(`  Trigger:     ${TRIGGER}`);
  console.log(`  Database:    ${DB_PATH}`);
  if (DRY_RUN) console.log('  *** DRY RUN ***');
  console.log();

  // Build config snapshot
  const configSnapshot = { units: unitIds, days: DAYS, skipScrape: SKIP_SCRAPE };
  for (const uid of unitIds) {
    const rc = db.prepare('SELECT * FROM research_config WHERE comp_unit = ?').get(uid);
    if (rc) configSnapshot[uid] = { location: rc.location, minBedrooms: rc.min_bedrooms, maxBedrooms: rc.max_bedrooms, maxResults: rc.max_results };
    const compCount = db.prepare('SELECT COUNT(*) as n FROM competitors WHERE comp_unit = ? AND active = 1').get(uid);
    if (compCount) configSnapshot[`${uid}_comps`] = compCount.n;
  }

  // Warnings collector
  const warnings = [];

  // 1. Log run
  let runId = null;
  if (!DRY_RUN) {
    const result = db.prepare(
      `INSERT INTO autopilot_runs (run_type, units_processed, status, trigger, config_snapshot) VALUES (?, ?, 'running', ?, ?)`
    ).run(SKIP_SCRAPE ? 'analysis' : 'full', unitIds.join(','), TRIGGER, JSON.stringify(configSnapshot));
    runId = result.lastInsertRowid;
  }

  let scrapeOk = 0, scrapeErrors = 0, analysisOk = 0;
  let compsFound = 0, compsActive = 0;
  let totalHistoryRows = 0, totalAvailRows = 0;
  let scrapeStartMs = null, scrapeEndMs = null;
  let analyzeStartMs = null, analyzeEndMs = null;
  let archiveStartMs = null, archiveEndMs = null;

  try {
    // 2. SCRAPE phase (unless --skip-scrape)
    if (!SKIP_SCRAPE) {
      console.log('--- SCRAPE PHASE ---\n');
      scrapeStartMs = Date.now();

      // Dynamically load market-research (has playwright dependency)
      const { launchBrowser, createContext, computeDateRangesV2, scrapeSearchResults, scrapeListingDetails, getRelevantMonths } = require('../lib/market-research');
      const { computeTcpn } = require('../lib/normalize');

      const browser = await launchBrowser({ headful: HEADFUL });
      const context = await createContext(browser);
      const page = await context.newPage();

      for (const unitId of unitIds) {
        const config = db.prepare('SELECT * FROM research_config WHERE comp_unit = ?').get(unitId);
        if (!config) {
          console.log(`  ${unitId}: No research config — skipping scrape.`);
          warnings.push({ code: 'no_config', unit: unitId, message: 'No research config found' });
          continue;
        }

        // Purge stale snapshots before scraping fresh data
        if (!DRY_RUN) {
          const purged = purgeUnitSnapshots(db, unitId);
          console.log(`  ${unitId}: Purged ${purged} stale v2 snapshots.`);
        }

        // Accumulate observations for Layer 2 append-only capture
        const unitObservations = [];
        // Accumulate calendar_availability rows for the current unit's scrape.
        // Capturing calendar alongside price snapshots is what keeps the
        // demand_signal fresh — without this, `calendar_availability` stays
        // stale and the Rate Calendar's "tight/mixed/open" reflects last scrape.
        const unitCalendarRows = [];
        // Relevant months = today through today+60d, matching the analysis horizon.
        const calendarStart = new Date().toISOString().slice(0, 10);
        const calendarEnd = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
        const relevantMonths = getRelevantMonths(calendarStart, calendarEnd);

        console.log(`  ${unitId}: Searching Airbnb...`);

        try {
          const listings = await scrapeSearchResults(page, config, (msg) => console.log(`    ${msg}`));
          console.log(`  ${unitId}: Found ${listings.length} listings.`);
          compsFound += listings.length;

          if (listings.length === 0) {
            warnings.push({ code: 'no_listings', unit: unitId, message: 'Scrape found 0 results' });
            continue;
          }

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
            INSERT INTO snapshots_v2 (competitor_id, check_date, stay_nights, day_type, nightly_rate, cleaning_fee, total_cost, tcpn, available, run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(competitor_id, check_date, stay_nights) DO UPDATE SET
              day_type=excluded.day_type, nightly_rate=excluded.nightly_rate,
              cleaning_fee=excluded.cleaning_fee, total_cost=excluded.total_cost,
              tcpn=excluded.tcpn, available=excluded.available,
              run_id=excluded.run_id,
              captured_at=datetime('now')
          `);

          const getCompId = db.prepare('SELECT id FROM competitors WHERE airbnb_id = ?');

          for (let i = 0; i < listings.length; i++) {
            const listing = listings[i];
            console.log(`    [${i + 1}/${listings.length}] ${listing.name || listing.airbnb_id}`);

            try {
              const details = await scrapeListingDetails(page, listing.airbnb_id, dateRanges, (msg) => console.log(`      ${msg}`), { captureCalendar: true });

              // Skip listings that exceed the bedroom ceiling (null bedrooms = unknown, skip to be safe)
              if (config.max_bedrooms) {
                if (details.bedrooms == null) {
                  console.log(`      ✗ Skipped — bedrooms unknown, cannot verify ≤ ${config.max_bedrooms}BR ceiling`);
                  continue;
                }
                if (details.bedrooms > config.max_bedrooms) {
                  console.log(`      ✗ Skipped — ${details.bedrooms}BR exceeds max ${config.max_bedrooms}BR`);
                  continue;
                }
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
                        price.nightly_rate, fee, total, tcpn,
                        runId
                      );

                      // Accumulate for Layer 2 raw capture
                      if (runId) {
                        unitObservations.push({
                          runId, runSource: 'autopilot', compUnit: unitId,
                          competitorId: comp.id, airbnbId: details.airbnb_id,
                          listingName: details.name || listing.name || null,
                          listingUrl: details.url || null,
                          bedrooms: details.bedrooms || null, bathrooms: details.bathrooms || null,
                          rating: details.rating || listing.rating || null,
                          reviewCount: details.review_count || listing.review_count || null,
                          superhost: details.superhost || false,
                          checkDate: range.checkin, stayNights: range.nights,
                          nightlyRate: price.nightly_rate, cleaningFee: fee,
                          totalCost: total, tcpn, available: 1,
                          dayType: getDayOfWeek(range.checkin),
                        });
                      }
                    }
                  }
                }
              }

              // Collect calendar availability rows (filtered to the relevant
              // 60-day forward window) for post-loop flush.
              if (details.calendarRaw && details.calendarRaw.length > 0) {
                const comp = getCompId.get(details.airbnb_id);
                if (comp) {
                  for (const day of details.calendarRaw) {
                    if (!relevantMonths.has(day.date.slice(0, 7))) continue;
                    unitCalendarRows.push({
                      runId, runSource: 'autopilot',
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
                }
              }

              scrapeOk++;
              console.log(`      OK — $${details.base_rate || '?'}/night`);
            } catch (err) {
              console.log(`      ERROR: ${err.message}`);
              scrapeErrors++;
            }
          }
          // Flush Layer 2 observations for this unit
          if (unitObservations.length > 0) {
            saveRunObservations(db, unitObservations);
            console.log(`  ${unitId}: Saved ${unitObservations.length} raw observations.`);
          }
          // Flush calendar availability rows for this unit. These power the
          // Rate Calendar's demand_signal + per-comp booked badges and must
          // be refreshed each scheduled run to avoid stale occupancy data.
          if (unitCalendarRows.length > 0) {
            saveCalendarAvailability(db, unitCalendarRows);
            console.log(`  ${unitId}: Saved ${unitCalendarRows.length} calendar_availability rows.`);
          }
        } catch (err) {
          console.log(`  ${unitId}: Scrape failed — ${err.message}`);
          scrapeErrors++;
        }
      }

      // Check for scrape majority failure
      if (scrapeErrors > scrapeOk && (scrapeOk + scrapeErrors) > 0) {
        warnings.push({ code: 'scrape_majority_fail', unit: null, message: `${scrapeErrors} errors vs ${scrapeOk} OK` });
      }

      await context.close();
      await browser.close();
      scrapeEndMs = Date.now();
      console.log();
    }

    // Count active comps after scrape
    for (const uid of unitIds) {
      const count = db.prepare('SELECT COUNT(*) as n FROM competitors WHERE comp_unit = ? AND active = 1').get(uid);
      compsActive += count.n;
      if (count.n < 5) {
        warnings.push({ code: 'thin_data', unit: uid, message: `Only ${count.n} active comps` });
      }
    }

    // 3. ANALYZE phase
    console.log('--- ANALYZE PHASE ---\n');
    analyzeStartMs = Date.now();
    const today = new Date().toISOString().split('T')[0];
    const dates = generateDateRange(today, DAYS);
    let insufficientCount = 0;

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
            }, runId);
            unitOk++;
          } else if (rec.verdict === 'insufficient_data') {
            insufficientCount++;
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

    // Check for low confidence
    const totalDates = dates.length * unitIds.length;
    if (totalDates > 0 && insufficientCount / totalDates > 0.3) {
      warnings.push({ code: 'low_confidence', unit: null, message: `${insufficientCount}/${totalDates} dates had insufficient data` });
    }

    analyzeEndMs = Date.now();
    console.log();

    // 4. ARCHIVE phase — persist market data to history tables
    if (!DRY_RUN && runId) {
      console.log('--- ARCHIVE PHASE ---\n');
      archiveStartMs = Date.now();
      const scrapedAt = new Date().toISOString();
      for (const unitId of unitIds) {
        const { historyRows, availRows } = archiveMarketData(db, unitId, runId, scrapedAt);
        totalHistoryRows += historyRows;
        totalAvailRows += availRows;
        console.log(`  ${unitId}: Archived ${historyRows} history rows, ${availRows} availability rows.`);
      }
      archiveEndMs = Date.now();
      console.log();
    }

    // 5. Update run log with enriched metadata
    if (!DRY_RUN && runId) {
      db.prepare(`
        UPDATE autopilot_runs SET
          status = 'completed', scrape_ok = ?, scrape_errors = ?,
          analysis_ok = ?, report_written = 0,
          duration_ms = ?, completed_at = datetime('now'),
          comps_found = ?, comps_active = ?,
          recs_written = ?, history_rows = ?, avail_rows = ?,
          warnings = ?,
          scrape_start_ms = ?, scrape_end_ms = ?,
          analyze_start_ms = ?, analyze_end_ms = ?,
          archive_start_ms = ?, archive_end_ms = ?
        WHERE id = ?
      `).run(
        scrapeOk, scrapeErrors, analysisOk, Date.now() - startTime,
        compsFound, compsActive,
        analysisOk, totalHistoryRows, totalAvailRows,
        warnings.length > 0 ? JSON.stringify(warnings) : null,
        scrapeStartMs, scrapeEndMs,
        analyzeStartMs, analyzeEndMs,
        archiveStartMs, archiveEndMs,
        runId
      );
    }

  } catch (err) {
    console.error(`\nFatal: ${err.message}`);
    console.error(err.stack);
    if (!DRY_RUN && runId) {
      db.prepare(`
        UPDATE autopilot_runs SET
          status = 'failed', scrape_ok = ?, scrape_errors = ?,
          analysis_ok = ?, error_log = ?,
          duration_ms = ?, completed_at = datetime('now'),
          comps_found = ?, comps_active = ?,
          recs_written = ?, history_rows = ?, avail_rows = ?,
          warnings = ?,
          scrape_start_ms = ?, scrape_end_ms = ?,
          analyze_start_ms = ?, analyze_end_ms = ?,
          archive_start_ms = ?, archive_end_ms = ?
        WHERE id = ?
      `).run(
        scrapeOk, scrapeErrors, analysisOk, err.message, Date.now() - startTime,
        compsFound, compsActive,
        analysisOk, totalHistoryRows, totalAvailRows,
        warnings.length > 0 ? JSON.stringify(warnings) : null,
        scrapeStartMs, scrapeEndMs,
        analyzeStartMs, analyzeEndMs,
        archiveStartMs, archiveEndMs,
        runId
      );
    }
    closeDb();
    process.exit(1);
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('=== Summary ===');
  console.log(`  Trigger:   ${TRIGGER}`);
  console.log(`  Scrape:    ${scrapeOk} OK, ${scrapeErrors} errors`);
  console.log(`  Analysis:  ${analysisOk} recommendations`);
  console.log(`  Comps:     ${compsFound} found, ${compsActive} active`);
  console.log(`  Duration:  ${duration}s`);
  console.log(`  Run ID:    ${runId || 'N/A (dry-run)'}`);
  if (warnings.length > 0) {
    console.log(`  Warnings:  ${warnings.length}`);
    for (const w of warnings) console.log(`    - [${w.code}] ${w.unit ? w.unit + ': ' : ''}${w.message}`);
  }

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

  // S3 sync — produce a consistent snapshot via better-sqlite3 backup API.
  // .backup() checkpoints the WAL and produces a single-file snapshot
  // safe to upload as an atomic artifact.
  if (S3_SYNC) {
    const snapshotPath = path.join(path.dirname(DB_PATH), 'pricing.db.snapshot');
    await db.backup(snapshotPath);
    console.log(`Snapshot written: ${snapshotPath}`);
  }

  closeDb();
}

main().catch(err => {
  console.error(err);
  closeDb();
  process.exit(1);
});
