#!/usr/bin/env node

/**
 * Pricing Data Inspector — manual query CLI for runs, competitors, and market data.
 *
 * Usage:
 *   node tools/pricing/scripts/inspect.js <command> [options]
 *
 * Commands:
 *   runs                              List all pricing runs (autopilot + research)
 *   run <id>                          Detail view for a single autopilot run
 *   research-run <id>                 Detail view for a single research run
 *   batches                           List capture batches
 *   batch <id>                        Batch detail with constituent runs
 *   competitor <id|name>              Pricing history for one competitor across runs
 *   availability                      Per-competitor unavailability ranking
 *   market                            Market history with pricing trends
 *   comparison                        Cross-competitor pricing + availability snapshot
 *   gaps                              Dates with thin data coverage
 *   month <YYYY-MM>                   All runs covering a specific month
 *
 * Global options:
 *   --unit <unit-a|unit-b>            Scope to a specific unit (default: both)
 *   --days <n>                        Lookback window in days (default: 60)
 *                                     Used by: availability, market, comparison, competitor, gaps
 *   --limit <n>                       Max rows to show (default: 20)
 *   --active-only                     Only show currently active competitors
 *   --help                            Show this help message
 *
 * Default scoping rules:
 *   - No --unit flag → queries both units
 *   - No --days flag → 60-day lookback (for commands that support it)
 *   - Month commands without year → current year assumed
 *   - Historical queries include inactive competitors by default
 *
 * Examples:
 *   inspect runs --limit 10
 *   inspect run 42
 *   inspect availability --unit unit-a --days 30
 *   inspect competitor "Coqui Beach"
 *   inspect month 2026-04 --unit unit-a
 *   inspect comparison --unit unit-b
 *   inspect gaps --unit unit-a --min-comps 5
 */

const path = require('path');
const fs = require('fs');
const {
  getDb, closeDb,
  getCompetitor, getCompetitorsForUnit,
  getRunList, getRunById, getRunRecSummary, getRunMarketSummary,
  getRunObservations, getRunListingsSummary, getRunComparison,
  getResearchRuns, getResearchRunById, getRunObservationsSummary,
  getCaptureBatch, getCaptureBatches,
  getCompPriceHistory, getCompOccupancyTrend,
  getCompAvailabilitySummary, getCompAvailabilityAcrossRuns,
  getRunsForMonth, getCompPriceAndAvailComparison,
  getMarketHistory, getAvailabilityHistory, getAutopilotRuns,
  getMarketDataGaps, getWeekendPremium,
} = require('../lib/db');

// ---------------------------------------------------------------------------
// DB setup (same pattern as autopilot.js)
// ---------------------------------------------------------------------------

const db = getDb();
const schemaPath = path.join(__dirname, '..', 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));
for (const mig of ['migrate-v3.sql', 'migrate-v4.sql', 'migrate-v5.sql', 'migrate-v6.sql', 'migrate-v7.sql', 'migrate-v8.sql', 'migrate-v9.sql', 'migrate-v10.sql', 'migrate-v11.sql', 'migrate-v12.sql', 'migrate-v13.sql', 'migrate-v14.sql', 'migrate-v15.sql']) {
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
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const UNIT = getArg('unit') || null;
const DAYS = parseInt(getArg('days') || '60');
const LIMIT = parseInt(getArg('limit') || '20');
const ACTIVE_ONLY = args.includes('--active-only');
const HELP = args.includes('--help') || args.includes('-h');

/** Compute dateFrom cutoff from DAYS lookback. */
function dateFrom() {
  return new Date(Date.now() - DAYS * 86400000).toISOString().split('T')[0];
}

const command = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const commandIdx = args.indexOf(command);
const subArg = commandIdx !== -1 ? args[commandIdx + 1] : null;

// If subArg looks like a flag, ignore it
const positionalArg = subArg && !subArg.startsWith('--') ? subArg : null;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pad(str, len) {
  return String(str ?? '—').padEnd(len);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function fmtDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function fmtPct(v) {
  if (v == null) return '—';
  return `${v}%`;
}

function fmtMoney(v) {
  if (v == null) return '—';
  return `$${Number(v).toFixed(0)}`;
}

function printTable(headers, rows) {
  if (rows.length === 0) {
    console.log('  (no data)\n');
    return;
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] ?? '—').length))
  );
  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');
  console.log('  ' + headers.map((h, i) => pad(h, widths[i])).join(' │ '));
  console.log('  ' + sep);
  for (const row of rows) {
    console.log('  ' + row.map((c, i) => pad(c, widths[i])).join(' │ '));
  }
  console.log();
}

function section(title) {
  console.log(`\n━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}\n`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdHelp() {
  const src = fs.readFileSync(__filename, 'utf8');
  const match = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (match) {
    const lines = match[1].split('\n').map(l => l.replace(/^\s*\*\s?/, ''));
    console.log(lines.join('\n'));
  }
}

function cmdRuns() {
  section('Autopilot Runs');
  const { runs: autopilotRuns, total: aTotal } = getRunList(db, { limit: LIMIT, status: null });
  console.log(`  Showing ${autopilotRuns.length} of ${aTotal} autopilot runs\n`);
  printTable(
    ['ID', 'Type', 'Started', 'Status', 'Duration', 'Comps', 'Recs', 'History'],
    autopilotRuns.map(r => [
      r.id, r.run_type || 'full', fmtDate(r.started_at), r.status,
      fmtDuration(r.duration_ms), r.comps_found || 0, r.recs_written || 0, r.history_rows || 0,
    ])
  );

  section('Research Runs');
  const { runs: researchRuns, total: rTotal } = getResearchRuns(db, { limit: LIMIT });
  console.log(`  Showing ${researchRuns.length} of ${rTotal} research runs\n`);
  printTable(
    ['ID', 'Unit', 'Started', 'Status', 'Duration', 'Found', 'Saved', 'Batch'],
    researchRuns.map(r => [
      r.id, r.comp_unit, fmtDate(r.started_at), r.status,
      fmtDuration(r.duration_ms), r.listings_found || 0, r.listings_saved || 0, r.batch_id || '—',
    ])
  );
}

function cmdRunDetail() {
  const id = parseInt(positionalArg);
  if (!id) { console.error('Usage: inspect run <id>'); process.exit(1); }

  const run = getRunById(db, id);
  if (!run) { console.error(`Autopilot run #${id} not found.`); process.exit(1); }

  section(`Autopilot Run #${id}`);
  console.log(`  Status:     ${run.status}`);
  console.log(`  Type:       ${run.run_type || 'full'}`);
  console.log(`  Trigger:    ${run.trigger || '—'}`);
  console.log(`  Units:      ${run.units_processed || '—'}`);
  console.log(`  Started:    ${fmtDate(run.started_at)}`);
  console.log(`  Completed:  ${fmtDate(run.completed_at)}`);
  console.log(`  Duration:   ${fmtDuration(run.duration_ms)}`);
  console.log(`  Comps:      ${run.comps_found || 0} found, ${run.comps_active || 0} active`);
  console.log(`  Recs:       ${run.recs_written || 0}`);
  console.log(`  History:    ${run.history_rows || 0} rows archived`);
  console.log(`  Avail:      ${run.avail_rows || 0} rows archived`);

  // Observation summary
  const obs = getRunObservationsSummary(db, id, 'autopilot');
  if (obs && obs.total_obs > 0) {
    section('Observations');
    console.log(`  Total:      ${obs.total_obs} observations`);
    console.log(`  Comps:      ${obs.unique_comps} unique competitors`);
    console.log(`  Dates:      ${obs.unique_dates} dates (${obs.date_from} → ${obs.date_to})`);
    console.log(`  Stays:      ${obs.stay_lengths} nights`);
    console.log(`  Avg rate:   ${fmtMoney(obs.avg_rate)}`);
    console.log(`  Avg TCPN:   ${fmtMoney(obs.avg_tcpn)}`);
  }

  // Verdict breakdown per unit
  const units = run.units_processed ? run.units_processed.split(',').map(u => u.trim()) : ['unit-a', 'unit-b'];
  for (const unitId of units) {
    const recSum = getRunRecSummary(db, id, unitId);
    if (recSum && recSum.length > 0) {
      section(`Verdicts — ${unitId}`);
      printTable(
        ['Verdict', 'Count', 'Avg Rate', 'Avg Confidence'],
        recSum.map(r => [r.verdict, r.count, fmtMoney(r.avg_rate), r.avg_confidence?.toFixed(0) || '—'])
      );
    }
  }

  // Market summary
  const mkt = getRunMarketSummary(db, id);
  if (mkt && mkt.length > 0) {
    section('Market Summary');
    printTable(
      ['Unit', 'Dates', 'Avg Median TCPN', 'Avg Comps Avail', 'Avg Percentile'],
      mkt.map(r => [r.unit_id, r.dates_covered, fmtMoney(r.avg_median_tcpn), r.avg_comps_available?.toFixed(1), r.avg_percentile?.toFixed(1)])
    );
  }

  // Run comparison
  try {
    const cmp = getRunComparison(db, id);
    if (cmp && cmp.previous) {
      section('Delta vs Previous Run');
      console.log(`  Previous run: #${cmp.previous.id} (${fmtDate(cmp.previous.started_at)})`);
      if (cmp.deltas) {
        for (const [key, val] of Object.entries(cmp.deltas)) {
          console.log(`  ${key}: ${val > 0 ? '+' : ''}${typeof val === 'number' ? val.toFixed(2) : val}`);
        }
      }
    }
  } catch { /* comparison may not be available */ }
}

function cmdResearchRunDetail() {
  const id = parseInt(positionalArg);
  if (!id) { console.error('Usage: inspect research-run <id>'); process.exit(1); }

  const run = getResearchRunById(db, id);
  if (!run) { console.error(`Research run #${id} not found.`); process.exit(1); }

  section(`Research Run #${id}`);
  console.log(`  Status:     ${run.status}`);
  console.log(`  Unit:       ${run.comp_unit}`);
  console.log(`  Started:    ${fmtDate(run.started_at)}`);
  console.log(`  Completed:  ${fmtDate(run.completed_at)}`);
  console.log(`  Duration:   ${fmtDuration(run.duration_ms)}`);
  console.log(`  Found:      ${run.listings_found || 0} listings`);
  console.log(`  Saved:      ${run.listings_saved || 0} competitors`);
  console.log(`  Batch:      ${run.batch_id || '—'}`);
  if (run.calendar_start_date) {
    console.log(`  Calendar:   ${run.calendar_start_date} → ${run.calendar_end_date}`);
  }

  const obs = getRunObservationsSummary(db, id, 'research');
  if (obs && obs.total_obs > 0) {
    section('Observations');
    console.log(`  Total:      ${obs.total_obs} observations`);
    console.log(`  Comps:      ${obs.unique_comps} unique competitors`);
    console.log(`  Dates:      ${obs.unique_dates} dates (${obs.date_from} → ${obs.date_to})`);
    console.log(`  Stays:      ${obs.stay_lengths} nights`);
    console.log(`  Avg rate:   ${fmtMoney(obs.avg_rate)}`);
    console.log(`  Avg TCPN:   ${fmtMoney(obs.avg_tcpn)}`);
  }
}

function cmdBatches() {
  section('Capture Batches');
  const batches = getCaptureBatches(db, {
    unitId: UNIT, limit: LIMIT,
  });
  if (batches.length === 0) { console.log('  (no batches found)\n'); return; }
  printTable(
    ['ID', 'Label', 'Unit', 'Month', 'Status', 'Runs', 'Duration'],
    batches.map(b => [
      b.id, b.label || '—', b.unit_id, b.month, b.status,
      `${b.runs_completed || 0}/${b.runs_planned || 0}`, fmtDuration(b.duration_ms),
    ])
  );
}

function cmdBatchDetail() {
  const id = parseInt(positionalArg);
  if (!id) { console.error('Usage: inspect batch <id>'); process.exit(1); }

  const batch = getCaptureBatch(db, id);
  if (!batch) { console.error(`Batch #${id} not found.`); process.exit(1); }

  section(`Capture Batch #${id}`);
  console.log(`  Label:      ${batch.label || '—'}`);
  console.log(`  Unit:       ${batch.unit_id}`);
  console.log(`  Month:      ${batch.month}`);
  console.log(`  Status:     ${batch.status}`);
  console.log(`  Runs:       ${batch.runs_completed || 0} completed / ${batch.runs_planned || 0} planned`);
  console.log(`  Failed:     ${batch.runs_failed || 0}`);
  console.log(`  Duration:   ${fmtDuration(batch.duration_ms)}`);
  console.log(`  Anchors:    ${Array.isArray(batch.anchor_dates) ? batch.anchor_dates.join(', ') : '—'}`);
  console.log(`  Stays:      ${Array.isArray(batch.stay_lengths) ? batch.stay_lengths.join(', ') : '—'} nights`);

  // Constituent research runs
  const runs = db.prepare(
    'SELECT * FROM research_runs WHERE batch_id = ? ORDER BY started_at ASC'
  ).all(id);
  if (runs.length > 0) {
    section('Runs in Batch');
    printTable(
      ['ID', 'Started', 'Status', 'Duration', 'Found', 'Saved'],
      runs.map(r => [
        r.id, fmtDate(r.started_at), r.status,
        fmtDuration(r.duration_ms), r.listings_found || 0, r.listings_saved || 0,
      ])
    );
  }
}

function cmdCompetitor() {
  if (!positionalArg) { console.error('Usage: inspect competitor <id|name>'); process.exit(1); }

  // getCompetitor uses internal getDb() — does not take db param
  const comp = getCompetitor(positionalArg);
  if (!comp) { console.error(`Competitor "${positionalArg}" not found.`); process.exit(1); }

  section(`Competitor: ${comp.name}`);
  console.log(`  ID:         ${comp.id}`);
  console.log(`  Airbnb:     ${comp.airbnb_id}`);
  console.log(`  Unit:       ${comp.comp_unit}`);
  console.log(`  Active:     ${comp.active ? 'yes' : 'no'}`);
  console.log(`  Bedrooms:   ${comp.bedrooms}`);
  console.log(`  Bathrooms:  ${comp.bathrooms}`);
  console.log(`  Rating:     ${comp.rating} (${comp.review_count} reviews)`);
  console.log(`  Superhost:  ${comp.superhost ? 'yes' : 'no'}`);
  console.log(`  Base rate:  ${fmtMoney(comp.base_rate)}`);

  // Price history (scoped by --days)
  section(`Price History — last ${DAYS} days (2-night TCPN)`);
  const history = getCompPriceHistory(db, comp.id, {
    stayNights: 2, dateFrom: dateFrom(), limit: LIMIT * 2,
  });
  if (history.length > 0) {
    printTable(
      ['Date', 'TCPN', 'Nightly', 'Available', 'Run', 'Captured'],
      history.map(h => [
        h.check_date, fmtMoney(h.tcpn), fmtMoney(h.nightly_rate),
        h.available ? 'yes' : 'NO', h.run_id, fmtDate(h.captured_at),
      ])
    );
  }

  // Occupancy trend (scoped by --days)
  section(`Occupancy Trend — last ${DAYS} days`);
  const trend = getCompOccupancyTrend(db, comp.id, DAYS);
  if (trend.length > 0) {
    const booked = trend.filter(t => !t.available).length;
    const total = trend.length;
    console.log(`  ${booked}/${total} date-observations unavailable (${(100 * booked / total).toFixed(1)}%)\n`);
    printTable(
      ['Date', 'Available', 'Rate', 'TCPN', 'Scraped'],
      trend.slice(0, LIMIT).map(t => [
        t.check_date, t.available ? 'yes' : 'NO',
        fmtMoney(t.nightly_rate), fmtMoney(t.tcpn_2n), fmtDate(t.scraped_at),
      ])
    );
  }

  // Cross-run availability (scoped by --days)
  section(`Availability Across Runs — last ${DAYS} days`);
  const acrossRuns = getCompAvailabilityAcrossRuns(db, comp.id, {
    dateFrom: dateFrom(), limit: LIMIT * 2,
  });
  if (acrossRuns.length > 0) {
    const runIds = [...new Set(acrossRuns.map(a => a.run_id))];
    console.log(`  Observed in ${runIds.length} runs\n`);
    printTable(
      ['Run', 'Date', 'Available', 'Rate', 'TCPN'],
      acrossRuns.slice(0, LIMIT).map(a => [
        a.run_id, a.check_date, a.available ? 'yes' : 'NO',
        fmtMoney(a.nightly_rate), fmtMoney(a.tcpn_2n),
      ])
    );
  }
}

function cmdAvailability() {
  const units = UNIT ? [UNIT] : ['unit-a', 'unit-b'];
  const cutoff = dateFrom();

  for (const unitId of units) {
    section(`Competitor Availability — ${unitId} (last ${DAYS} days)`);
    const summary = getCompAvailabilitySummary(db, unitId, {
      activeOnly: ACTIVE_ONLY, dateFrom: cutoff,
    });
    if (summary.length === 0) { console.log('  (no availability data)\n'); continue; }

    // Aggregate stats
    const totalObs = summary.reduce((s, r) => s + r.total_observations, 0);
    const totalUnavail = summary.reduce((s, r) => s + r.unavailable_count, 0);
    const avgUnavailPct = totalObs > 0 ? (100 * totalUnavail / totalObs).toFixed(1) : 0;
    console.log(`  ${summary.length} competitors, ${totalObs} total observations`);
    console.log(`  Average unavailability: ${avgUnavailPct}%\n`);

    printTable(
      ['ID', 'Name', 'Active', 'Obs', 'Unavail', 'Unavail%', 'Runs', 'Avg Rate'],
      summary.slice(0, LIMIT).map(r => [
        r.competitor_id,
        (r.name || '—').substring(0, 30),
        r.active ? 'yes' : 'no',
        r.total_observations,
        r.unavailable_count,
        fmtPct(r.unavailable_pct),
        r.runs_observed,
        fmtMoney(r.avg_rate_when_available),
      ])
    );
  }
}

function cmdMarket() {
  const units = UNIT ? [UNIT] : ['unit-a', 'unit-b'];

  for (const unitId of units) {
    section(`Market History — ${unitId} (last ${DAYS} days)`);
    const history = getMarketHistory(db, unitId, DAYS);
    if (history.length === 0) { console.log('  (no market data)\n'); continue; }

    printTable(
      ['Date', 'Median TCPN', 'P25', 'P75', 'Comps Avail', 'Verdict', 'Season'],
      history.slice(0, LIMIT).map(h => [
        h.check_date, fmtMoney(h.median_tcpn_2n), fmtMoney(h.p25_tcpn_2n),
        fmtMoney(h.p75_tcpn_2n), `${h.comp_count_avail}/${h.comp_count_total}`,
        h.verdict || '—', h.season || '—',
      ])
    );

    // Weekend premium
    const wp = getWeekendPremium(db, unitId, DAYS);
    if (wp && wp.weekend_median && wp.weekday_median) {
      const premium = ((wp.weekend_median / wp.weekday_median - 1) * 100).toFixed(1);
      console.log(`  Weekend premium: ${fmtMoney(wp.weekend_median)} vs ${fmtMoney(wp.weekday_median)} weekday (+${premium}%)`);
      console.log(`  Sample sizes: ${wp.weekend_count} weekend, ${wp.weekday_count} weekday\n`);
    }
  }
}

function cmdComparison() {
  const units = UNIT ? [UNIT] : ['unit-a', 'unit-b'];
  const cutoff = dateFrom();

  for (const unitId of units) {
    section(`Cross-Competitor Comparison — ${unitId} (last ${DAYS} days)`);
    const rows = getCompPriceAndAvailComparison(db, unitId, {
      activeOnly: ACTIVE_ONLY, dateFrom: cutoff, limit: LIMIT,
    });
    if (rows.length === 0) { console.log('  (no data)\n'); continue; }

    printTable(
      ['ID', 'Name', 'Act', 'BR', 'Rating', 'Runs', 'Avg TCPN', 'Min', 'Max', 'Unavail%', 'Latest Rate'],
      rows.map(r => [
        r.competitor_id,
        (r.name || '—').substring(0, 25),
        r.active ? 'Y' : 'N',
        r.bedrooms || '—',
        r.rating || '—',
        r.runs_observed,
        fmtMoney(r.avg_tcpn),
        fmtMoney(r.min_tcpn),
        fmtMoney(r.max_tcpn),
        fmtPct(r.unavailable_pct),
        fmtMoney(r.latest_rate),
      ])
    );
  }
}

function cmdGaps() {
  section('Data Coverage Gaps');
  const minComps = parseInt(getArg('min-comps') || '3');
  const cutoff = dateFrom();
  const gaps = getMarketDataGaps(db, { unitId: UNIT, minComps, dateFrom: cutoff });
  if (gaps.length === 0) {
    console.log(`  No dates with fewer than ${minComps} competitors in last ${DAYS} days. Data looks healthy.\n`);
    return;
  }
  console.log(`  ${gaps.length} date/stay combos with fewer than ${minComps} competitors (last ${DAYS} days)\n`);
  printTable(
    ['Date', 'Stay Nights', 'Unit', 'Unique Comps', 'Obs Count', 'Freshest'],
    gaps.slice(0, LIMIT).map(g => [
      g.check_date, g.stay_nights, g.comp_unit, g.unique_comps, g.obs_count, fmtDate(g.freshest),
    ])
  );
}

function cmdMonth() {
  let month = positionalArg;
  if (!month) { console.error('Usage: inspect month <YYYY-MM>'); process.exit(1); }

  // If user gives just a month number (e.g., "04"), assume current year
  if (/^\d{1,2}$/.test(month)) {
    const year = new Date().getFullYear();
    month = `${year}-${month.padStart(2, '0')}`;
  }

  section(`Runs Covering ${month}`);
  const runs = getRunsForMonth(db, month, { unitId: UNIT });
  if (runs.length === 0) { console.log('  (no runs found for this month)\n'); return; }

  console.log(`  ${runs.length} runs found\n`);
  printTable(
    ['ID', 'Type', 'Started', 'Status', 'Obs/Comps', 'Units'],
    runs.map(r => [
      r.run_id, r.type, fmtDate(r.started_at), r.status,
      r.obs_count || 0, r.units_processed || '—',
    ])
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const COMMANDS = {
  runs: cmdRuns,
  run: cmdRunDetail,
  'research-run': cmdResearchRunDetail,
  batches: cmdBatches,
  batch: cmdBatchDetail,
  competitor: cmdCompetitor,
  comp: cmdCompetitor,
  availability: cmdAvailability,
  avail: cmdAvailability,
  market: cmdMarket,
  comparison: cmdComparison,
  compare: cmdComparison,
  gaps: cmdGaps,
  month: cmdMonth,
  help: cmdHelp,
};

if (HELP || !command) {
  cmdHelp();
  closeDb();
  process.exit(command ? 0 : 1);
}

const handler = COMMANDS[command];
if (!handler) {
  console.error(`Unknown command: "${command}"`);
  console.error(`Available: ${Object.keys(COMMANDS).join(', ')}`);
  closeDb();
  process.exit(1);
}

try {
  handler();
} catch (err) {
  console.error(`Error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
} finally {
  closeDb();
}
