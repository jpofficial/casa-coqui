#!/usr/bin/env node
/**
 * Evaluate the new decision engine against real data.
 *
 * Usage: node tools/pricing/scripts/evaluate-advisor.js [unit-a|unit-b]
 *
 * Tests each component of the 3-layer architecture:
 * - Layer 1: Market trend, availability signal, confidence
 * - Layer 2: Decision matrix, rate computation, guardrails
 * - Layer 3: Structured input builder
 */

const path = require('path');
const fs = require('fs');

const dbLib = require(path.join(__dirname, '..', 'lib', 'db.js'));
const multiStay = require(path.join(__dirname, '..', 'lib', 'multi-stay.js'));
const decisionEngine = require(path.join(__dirname, '..', 'lib', 'decision-engine.js'));
const availabilityLib = require(path.join(__dirname, '..', 'lib', 'availability.js'));
const { computeConfidence, generateWarnings, percentile, trimOutliers, coefficientOfVariation } = require(path.join(__dirname, '..', 'lib', 'stats.js'));
const { getSeason, getWeekdayMultiplier, getLeadTimeAdjustment, getTrendMultiplier, getDemandMultiplier, getSeasonPriceLadder } = require(path.join(__dirname, '..', 'lib', 'seasons.js'));
const { getDayOfWeek, isHoliday } = require(path.join(__dirname, '..', 'lib', 'dates.js'));

const unitId = process.argv[2] || 'unit-a';

function main() {
  const db = dbLib.initDb();

  // Run migrations
  for (const mig of ['migrate-v3.sql', 'migrate-v4.sql', 'migrate-v5.sql', 'migrate-v6.sql', 'migrate-v7.sql', 'migrate-v8.sql', 'migrate-v9.sql', 'migrate-v10.sql']) {
    const migPath = path.join(__dirname, '..', mig);
    try {
      const sql = fs.readFileSync(migPath, 'utf8');
      const stripped = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
      const stmts = stripped.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of stmts) { try { db.exec(stmt); } catch { /* ok */ } }
    } catch { /* skip */ }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  DECISION ENGINE EVALUATION — ${unitId}`);
  console.log(`${'='.repeat(60)}\n`);

  // ---------------------------------------------------------------
  // 1. DATA INVENTORY
  // ---------------------------------------------------------------
  console.log('--- 1. DATA INVENTORY ---\n');

  const today = new Date().toISOString().split('T')[0];
  console.log(`Today: ${today}`);

  const snapCount = db.prepare('SELECT COUNT(*) as cnt, MIN(captured_at) as oldest, MAX(captured_at) as newest FROM snapshots_v2').get();
  console.log(`Snapshots: ${snapCount.cnt} rows (${snapCount.oldest} to ${snapCount.newest})`);

  const snapDates = db.prepare('SELECT DISTINCT check_date, stay_nights, COUNT(*) as cnt FROM snapshots_v2 GROUP BY check_date, stay_nights ORDER BY check_date').all();
  console.log('Snapshot breakdown:');
  for (const d of snapDates) console.log(`  ${d.check_date} × ${d.stay_nights}n: ${d.cnt} comps`);

  const myRates = db.prepare('SELECT COUNT(*) as cnt FROM my_rates').get();
  console.log(`My rates: ${myRates.cnt} entries`);

  const comps = db.prepare('SELECT COUNT(*) as cnt FROM competitors WHERE comp_unit = ? AND active = 1').all(unitId);
  console.log(`Active competitors: ${comps[0]?.cnt || 0}`);

  let calAvail = { cnt: 0 };
  try {
    calAvail = db.prepare('SELECT COUNT(*) as cnt, COUNT(DISTINCT competitor_id) as comps, COUNT(DISTINCT date) as dates FROM calendar_availability').get();
    console.log(`Calendar availability: ${calAvail.cnt} rows, ${calAvail.comps} comps, ${calAvail.dates} dates`);
  } catch { console.log('Calendar availability: table not found'); }

  const runCount = db.prepare("SELECT COUNT(*) as cnt FROM autopilot_runs WHERE status = 'completed'").get()?.cnt || 0;
  console.log(`Completed runs: ${runCount}`);

  // ---------------------------------------------------------------
  // 2. MARKET TREND CLASSIFICATION
  // ---------------------------------------------------------------
  console.log('\n--- 2. MARKET TREND CLASSIFICATION ---\n');

  const trend = decisionEngine.classifyMarketTrend(db, unitId);
  console.log(`Direction: ${trend.direction || 'N/A'}`);
  console.log(`Delta: ${trend.deltaPct != null ? trend.deltaPct + '%' : 'N/A'}`);
  console.log(`Runs analyzed: ${trend.runsAnalyzed}`);
  console.log(`Overlapping dates: ${trend.medianDates}`);

  if (!trend.direction) {
    console.log('⚠ No trend computed — need ≥2 runs with ≥3 overlapping future dates');
  }

  // ---------------------------------------------------------------
  // 3. AVAILABILITY SIGNAL CLASSIFICATION
  // ---------------------------------------------------------------
  console.log('\n--- 3. AVAILABILITY SIGNAL CLASSIFICATION ---\n');

  // Test on dates that have calendar data
  let testDates = [];
  try {
    testDates = db.prepare('SELECT DISTINCT date FROM calendar_availability WHERE date >= ? ORDER BY date LIMIT 10').all(today).map(r => r.date);
  } catch { /* table missing */ }

  if (testDates.length === 0) {
    console.log('⚠ No calendar availability data — availability signal will be null');
  } else {
    console.log(`Testing ${testDates.length} dates:\n`);
    for (const date of testDates) {
      const avail = availabilityLib.classifyAvailability(db, unitId, date);
      const dow = getDayOfWeek(date);
      console.log(`  ${date} (${dow}): signal=${avail.signal || 'N/A'}, unavail=${avail.unavailablePct != null ? avail.unavailablePct + '%' : 'N/A'}, tracked=${avail.trackedComps}/${avail.compCount} comps, conf=${avail.confidence}`);
    }

    const summary = availabilityLib.computeAvailabilitySummary(db, unitId, testDates);
    console.log(`\n  Overall signal: ${summary.overall || 'N/A'}`);
    console.log(`  Tight: ${summary.tightPct}% | Mixed: ${summary.mixedPct}% | Open: ${summary.openPct}%`);
  }

  // ---------------------------------------------------------------
  // 4. CONFIDENCE MODEL (FIXED)
  // ---------------------------------------------------------------
  console.log('\n--- 4. CONFIDENCE MODEL ---\n');

  // Compute actual data age
  const newestSnap = db.prepare('SELECT MAX(captured_at) as newest FROM snapshots_v2').get();
  const actualAge = newestSnap?.newest
    ? (Date.now() - new Date(newestSnap.newest).getTime()) / 86400000
    : 999;
  console.log(`Actual data age: ${actualAge.toFixed(1)} days (was hardcoded to 1)`);

  // Test with different scenarios
  const scenarios = [
    { label: 'Current data (real)', compCount: comps[0]?.cnt || 5, dataAgeDays: actualAge, tcpnCV: 0.20, runCount, leadTimeDays: 14 },
    { label: 'Fresh + many comps', compCount: 8, dataAgeDays: 0.5, tcpnCV: 0.15, runCount: 6, leadTimeDays: 7 },
    { label: 'Stale + few comps', compCount: 3, dataAgeDays: 10, tcpnCV: 0.35, runCount: 1, leadTimeDays: 30 },
    { label: 'Very stale (>14d)', compCount: 5, dataAgeDays: 16, tcpnCV: 0.20, runCount: 2, leadTimeDays: 14 },
    { label: 'Below minimum (<3)', compCount: 2, dataAgeDays: 1, tcpnCV: 0.10, runCount: 4, leadTimeDays: 7 },
    { label: 'Far-out date', compCount: 6, dataAgeDays: 1, tcpnCV: 0.20, runCount: 3, leadTimeDays: 55 },
  ];

  for (const s of scenarios) {
    const conf = computeConfidence(s);
    console.log(`  ${s.label}: tier=${conf.tier}, score=${conf.score}`);
    console.log(`    factors: comp=${conf.factors.compCount} fresh=${conf.factors.freshness} spread=${conf.factors.spread} trend=${conf.factors.trendDepth} signal=${conf.factors.signalAgreement} prox=${conf.factors.proximity}`);
  }

  // ---------------------------------------------------------------
  // 5. WARNINGS
  // ---------------------------------------------------------------
  console.log('\n--- 5. WARNING GENERATION ---\n');

  const warnScenarios = [
    { label: 'Healthy data', compCount: 8, dataAgeDays: 1, confidenceTier: 'high', runCount: 5, signalsAgree: true },
    { label: 'Low sample', compCount: 3, dataAgeDays: 2, confidenceTier: 'medium', runCount: 3, signalsAgree: true },
    { label: 'Critical low sample', compCount: 2, dataAgeDays: 1, confidenceTier: 'low', runCount: 2, signalsAgree: true },
    { label: 'Stale data', compCount: 6, dataAgeDays: 8, confidenceTier: 'medium', runCount: 4, signalsAgree: true },
    { label: 'Mixed signals', compCount: 6, dataAgeDays: 1, confidenceTier: 'medium', runCount: 3, signalsAgree: false },
    { label: 'Everything wrong', compCount: 2, dataAgeDays: 12, confidenceTier: 'low', runCount: 1, signalsAgree: false, compSetChangePct: 50 },
  ];

  for (const s of warnScenarios) {
    const warnings = generateWarnings(s);
    console.log(`  ${s.label}: ${warnings.length} warnings`);
    for (const w of warnings) console.log(`    [${w.severity}] ${w.code}: ${w.message}`);
  }

  // ---------------------------------------------------------------
  // 6. DECISION MATRIX
  // ---------------------------------------------------------------
  console.log('\n--- 6. DECISION MATRIX ---\n');

  const matrixTests = [
    { pct: 10, trend: 'stable', avail: 'mixed', conf: 70 },
    { pct: 10, trend: 'softening', avail: 'open', conf: 70 },
    { pct: 25, trend: 'stable', avail: 'mixed', conf: 70 },
    { pct: 25, trend: 'softening', avail: 'mixed', conf: 70 },
    { pct: 45, trend: 'stable', avail: 'mixed', conf: 70 },
    { pct: 45, trend: 'strengthening', avail: 'tight', conf: 70 },
    { pct: 60, trend: 'stable', avail: 'mixed', conf: 70 },
    { pct: 60, trend: 'softening', avail: 'open', conf: 70 },
    { pct: 75, trend: 'stable', avail: 'mixed', conf: 70 },
    { pct: 75, trend: 'stable', avail: 'tight', conf: 70 },
    { pct: 90, trend: 'strengthening', avail: 'tight', conf: 70 },
    { pct: 50, trend: 'stable', avail: 'mixed', conf: 30 },   // Low confidence
    { pct: 50, trend: 'stable', avail: 'mixed', conf: 20 },   // Suppress
  ];

  console.log('  P%  | Trend         | Avail | Conf | → Action');
  console.log('  ----|---------------|-------|------|----------');
  for (const t of matrixTests) {
    const result = decisionEngine.applyDecisionMatrix(t.pct, t.trend, t.avail, t.conf);
    console.log(`  P${String(t.pct).padStart(2)} | ${t.trend.padEnd(13)} | ${t.avail.padEnd(5)} | ${String(t.conf).padStart(4)} | ${result.action}`);
  }

  // ---------------------------------------------------------------
  // 7. SEASONS / MULTIPLIERS
  // ---------------------------------------------------------------
  console.log('\n--- 7. SEASON MULTIPLIERS ---\n');

  console.log('Weekday multipliers:');
  for (const season of ['high', 'shoulder', 'low']) {
    const vals = ['weekday', 'friday', 'saturday', 'sunday'].map(d => `${d}=${getWeekdayMultiplier(d, season)}`);
    console.log(`  ${season}: ${vals.join(', ')}`);
  }

  console.log('\nLead-time curve (selected):');
  for (const days of [1, 5, 10, 18, 25, 35, 50, 70]) {
    const vals = ['high', 'shoulder', 'low'].map(s => `${s}=${getLeadTimeAdjustment(days, { name: s })}`);
    console.log(`  ${days}d: ${vals.join(', ')}`);
  }

  console.log('\nTrend multipliers:');
  for (const delta of [-8, -3, 0, 3, 8]) {
    console.log(`  delta=${delta}%: ${getTrendMultiplier(delta)}`);
  }

  console.log('\nDemand multipliers:');
  for (const sig of ['tight', 'mixed', 'open', null]) {
    console.log(`  ${sig || 'null'}: ${getDemandMultiplier(sig)}`);
  }

  console.log('\nPrice ladder percentiles:');
  for (const season of ['high', 'shoulder', 'low']) {
    const ladder = getSeasonPriceLadder(season);
    console.log(`  ${season}: floor=P${ladder.floor} target=P${ladder.target} stretch=P${ladder.stretch}`);
  }

  // ---------------------------------------------------------------
  // 8. RATE COMPUTATION + GUARDRAILS
  // ---------------------------------------------------------------
  console.log('\n--- 8. RATE COMPUTATION + GUARDRAILS ---\n');

  // Simulate with realistic TCPN data from snapshots
  const sampleTcpns = db.prepare('SELECT tcpn FROM snapshots_v2 WHERE tcpn > 0 ORDER BY tcpn').all().map(r => r.tcpn);

  if (sampleTcpns.length > 0) {
    const trimmed = trimOutliers(sampleTcpns);
    const medianTcpn = percentile(trimmed, 50);
    const p25 = percentile(trimmed, 25);
    const p75 = percentile(trimmed, 75);
    const cv = coefficientOfVariation(trimmed);

    console.log(`Sample TCPN data (${trimmed.length} values after trimming):`);
    console.log(`  Range: $${trimmed[0]?.toFixed(0)} — $${trimmed[trimmed.length - 1]?.toFixed(0)}`);
    console.log(`  Median: $${medianTcpn?.toFixed(0)}, P25: $${p25?.toFixed(0)}, P75: $${p75?.toFixed(0)}`);
    console.log(`  CV: ${(cv * 100).toFixed(1)}%`);

    // Test rate computation for different scenarios
    const rateTests = [
      { label: 'High season weekday', dayOfWeek: 'weekday', seasonName: 'high', leadTimeDays: 14, trendDeltaPct: 0, availSignal: 'mixed' },
      { label: 'High season Saturday', dayOfWeek: 'saturday', seasonName: 'high', leadTimeDays: 14, trendDeltaPct: 0, availSignal: 'mixed' },
      { label: 'Low season weekday', dayOfWeek: 'weekday', seasonName: 'low', leadTimeDays: 14, trendDeltaPct: 0, availSignal: 'mixed' },
      { label: 'Last minute (2 days)', dayOfWeek: 'friday', seasonName: 'high', leadTimeDays: 2, trendDeltaPct: 0, availSignal: 'mixed' },
      { label: 'Strengthening + tight', dayOfWeek: 'weekday', seasonName: 'high', leadTimeDays: 14, trendDeltaPct: 6, availSignal: 'tight' },
      { label: 'Softening + open', dayOfWeek: 'weekday', seasonName: 'low', leadTimeDays: 14, trendDeltaPct: -6, availSignal: 'open' },
    ];

    console.log('\nRate computation tests (anchor TCPN = $' + medianTcpn?.toFixed(0) + ', fee=$75, 2n):');
    for (const t of rateTests) {
      const result = decisionEngine.computeSuggestedRate({
        anchorTcpn: medianTcpn,
        anchorNights: 2,
        cleaningFee: 75,
        freshData: true,
        floorRate: p25,
        stretchRate: p75,
        ...t,
      });
      const mults = Object.entries(result.multipliers).map(([k, v]) => v !== 1.0 ? `${k}=${v}` : null).filter(Boolean);
      console.log(`  ${t.label}: $${result.suggestedRate} (base=$${result.baseRate}${mults.length ? ', ' + mults.join(', ') : ''})`);
    }

    // Guardrail tests
    console.log('\nGuardrail tests:');
    const guardrailTests = [
      { label: 'Small raise ($5)', action: 'raise', suggested: 205, current: 200, lead: 14, floor: 150 },
      { label: 'Large raise ($25)', action: 'raise', suggested: 225, current: 200, lead: 14, floor: 150 },
      { label: 'Small lower ($5)', action: 'lower', suggested: 195, current: 200, lead: 14, floor: 150 },
      { label: 'Large lower ($30)', action: 'lower', suggested: 170, current: 200, lead: 14, floor: 150 },
      { label: 'Fire sale (3d lead)', action: 'lower', suggested: 160, current: 200, lead: 2, floor: 150 },
      { label: 'Below threshold ($3)', action: 'raise', suggested: 203, current: 200, lead: 14, floor: 150 },
      { label: 'Already booked', action: 'lower', suggested: 170, current: 200, lead: 14, floor: 150, booked: true },
      { label: 'No current rate', action: 'raise', suggested: 195, current: null, lead: 14, floor: 150 },
    ];

    for (const t of guardrailTests) {
      const result = decisionEngine.applyGuardrails(t.action, t.suggested, t.current, t.lead, t.floor, t.booked || false);
      console.log(`  ${t.label}: $${t.current || '?'} → $${result.finalRate} (${result.action}, delta=${result.delta >= 0 ? '+' : ''}$${result.delta}${result.guardrailApplied ? ', guardrail=' + result.guardrailApplied : ''})`);
    }
  } else {
    console.log('⚠ No TCPN data available for rate computation tests');
  }

  // ---------------------------------------------------------------
  // 9. FULL DECISION ENGINE — LIVE DATA
  // ---------------------------------------------------------------
  console.log('\n--- 9. FULL DECISION ENGINE (live data) ---\n');

  const recDates = db.prepare('SELECT DISTINCT check_date FROM recommendations_v2 WHERE unit_id = ? AND check_date >= ? ORDER BY check_date LIMIT 10').all(unitId, today).map(r => r.check_date);

  if (recDates.length === 0) {
    console.log('⚠ No future recommendation dates — cannot test full engine');
  } else {
    console.log(`Testing ${recDates.length} dates with live data:\n`);

    const decisions = [];
    for (const date of recDates) {
      try {
        const result = multiStay.analyzeDateMultiStay(db, unitId, date, { trend, runCount });
        const d = result.decision;

        if (d) {
          decisions.push(d);
          console.log(`  ${date} (${result.dayType}, ${result.season}, lead=${result.leadTimeDays}d):`);
          console.log(`    Action: ${d.action} | Rate: $${d.suggestedRate || '?'} | Conf: ${d.confidence}(${d.confidenceScore})`);
          console.log(`    Percentile: P${d.percentile || '?'} | Floor: $${d.floor || '?'} | Target: $${d.target || '?'} | Stretch: $${d.stretch || '?'}`);
          console.log(`    Trend: ${d.marketTrend} | Avail: ${d.availabilitySignal} | Comps: ${d.compCount} | Age: ${d.dataAgeDays}d`);
          if (d.warnings?.length > 0) console.log(`    Warnings: ${d.warnings.map(w => w.code).join(', ')}`);
          console.log(`    Reason: ${d.decisionReason}`);
        } else {
          console.log(`  ${date}: No decision produced (insufficient data)`);
        }
      } catch (err) {
        console.log(`  ${date}: ERROR — ${err.message}`);
      }
    }

    // Test summarizeDecisions
    if (decisions.length > 0) {
      const summary = decisionEngine.summarizeDecisions(decisions);
      console.log(`\n  AGGREGATE SUMMARY:`);
      console.log(`    Action: ${summary.action}`);
      console.log(`    Suggested rate: $${summary.suggestedRate || '?'}`);
      console.log(`    Confidence: ${summary.confidence} (${summary.confidenceScore})`);
      console.log(`    Trend: ${summary.marketTrend}`);
      console.log(`    Availability: ${summary.availabilitySignal || 'N/A'}`);
      console.log(`    Distribution: raise=${summary.verdictDistribution.raise} hold=${summary.verdictDistribution.hold} lower=${summary.verdictDistribution.lower}`);
      if (summary.warnings?.length > 0) console.log(`    Warnings: ${summary.warnings.map(w => w.code).join(', ')}`);
    }
  }

  // ---------------------------------------------------------------
  // 10. BACKWARD COMPATIBILITY
  // ---------------------------------------------------------------
  console.log('\n--- 10. BACKWARD COMPATIBILITY ---\n');

  if (recDates.length > 0) {
    const date = recDates[0];
    const result = multiStay.analyzeDateMultiStay(db, unitId, date, { trend, runCount });

    // Check all legacy fields exist
    const requiredFields = ['date', 'dayType', 'season', 'seasonPctl', 'leadTimeDays',
      'tcpn_1n', 'tcpn_2n', 'tcpn_3n', 'tcpn_4n', 'tcpn_7n',
      'recNightlyRate', 'recWeeklyPct', 'recMonthlyPct',
      'floor', 'target', 'stretch', 'yourRate', 'yourTcpn',
      'percentile', 'verdict', 'reasoning', 'confidence',
      'compCount', 'demandSignal', 'holidayAdjusted', 'isBooked'];

    const missing = requiredFields.filter(f => !(f in result));
    if (missing.length === 0) {
      console.log('✓ All legacy fields present');
    } else {
      console.log(`✗ Missing fields: ${missing.join(', ')}`);
    }

    // Check new fields
    const newFields = ['decision', 'dataAgeDays'];
    const newMissing = newFields.filter(f => !(f in result));
    if (newMissing.length === 0) {
      console.log('✓ All new fields present');
    } else {
      console.log(`✗ Missing new fields: ${newMissing.join(', ')}`);
    }

    console.log(`\n  Sample result structure:`);
    console.log(`    verdict: ${result.verdict}`);
    console.log(`    confidence: ${result.confidence}`);
    console.log(`    decision.action: ${result.decision?.action || 'N/A'}`);
    console.log(`    decision.confidence: ${result.decision?.confidence || 'N/A'}`);
    console.log(`    dataAgeDays: ${result.dataAgeDays}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('  EVALUATION COMPLETE');
  console.log(`${'='.repeat(60)}\n`);

  dbLib.closeDb();
}

main();
