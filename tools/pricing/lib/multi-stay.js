/**
 * Multi-stay analysis engine -- produces actionable Airbnb pricing recommendations.
 *
 * For each date, analyzes 5 stay lengths (1, 2, 3, 4, 7 nights), then derives:
 * - Recommended nightly rate (anchored to 2-night TCPN)
 * - Weekly discount % (from 7n vs 2n comparison)
 * - Monthly discount % (extrapolated from weekly)
 *
 * V2: Now delegates verdict/action to decision-engine.js (Layer 2).
 * The decision engine applies structured rules; the AI (Layer 3) explains.
 */

const { percentile, trimOutliers, computePercentileRank, computeConfidence, coefficientOfVariation } = require('./stats');
const { computeTcpn, tcpnToNightlyRate } = require('./normalize');
const { getCompSnapshotsV2 } = require('./db');
const { getSeason, getLeadTimeAdjustment } = require('./seasons');
const { getDayOfWeek, isHoliday } = require('./dates');
const { classifyMarketTrend, makeDecision, summarizeDecisions } = require('./decision-engine');
const { classifyAvailability } = require('./availability');

const STAY_LENGTHS = [1, 2, 3, 4, 7];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a multi-stay recommendation for a single (unit, date) pair.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} unitId
 * @param {string} date  YYYY-MM-DD
 * @param {Object} [opts] Optional context to avoid repeated DB queries
 * @param {Object} [opts.trend] Pre-computed market trend (from classifyMarketTrend)
 * @param {number} [opts.runCount] Number of runs in last 30 days
 * @returns {object}  Recommendation object (backward-compatible + new decision fields)
 */
function analyzeDateMultiStay(db, unitId, date, opts = {}) {
  const dayOfWeek = getDayOfWeek(date);
  const holiday = isHoliday(date);
  const season = getSeason(db, date);

  // Compute lead time
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date + 'T12:00:00');
  const leadTimeDays = Math.max(0, Math.round((checkDate - today) / 86400000));

  // Get my rate
  const myRate = db.prepare('SELECT * FROM my_rates WHERE unit_id = ? AND check_date = ?').get(unitId, date);

  // 1. For each stay length, gather comp TCPN values from snapshots_v2
  const stayData = {};
  let totalComps = 0;
  let newestCapturedAt = null;

  for (const nights of STAY_LENGTHS) {
    const snapshots = getCompSnapshotsV2(db, unitId, date, nights);
    if (snapshots.length === 0) {
      stayData[nights] = { tcpns: [], trimmed: [], marketTcpn: null };
      continue;
    }

    const tcpns = snapshots
      .map(s => s.tcpn || computeTcpn(s.nightly_rate, s.cleaning_fee || s.comp_cleaning_fee || 0, nights))
      .filter(v => v != null && v > 0)
      .sort((a, b) => a - b);

    const trimmed = trimOutliers(tcpns);
    totalComps = Math.max(totalComps, trimmed.length);

    // Track actual freshness from captured_at
    for (const s of snapshots) {
      if (s.captured_at) {
        const cap = new Date(s.captured_at).getTime();
        if (!newestCapturedAt || cap > newestCapturedAt) {
          newestCapturedAt = cap;
        }
      }
    }

    // Compute market TCPN at seasonal percentile
    const marketTcpn = trimmed.length > 0 ? percentile(trimmed, season.target_pctl) : null;

    stayData[nights] = { tcpns, trimmed, marketTcpn };
  }

  // Compute actual data age (FIX: was hardcoded to 1)
  const dataAgeDays = newestCapturedAt
    ? (Date.now() - newestCapturedAt) / 86400000
    : 999; // No data = treat as very stale

  // If no data at all, return insufficient_data result
  if (totalComps === 0) {
    return buildMultiStayResult({
      date, dayOfWeek, holiday, season, leadTimeDays, myRate,
      verdict: 'insufficient_data',
      reasoning: `No multi-stay competitor data for ${date}.`,
      confidence: 0, compCount: 0,
      decision: null,
    });
  }

  // 2. Derive recommended nightly rate (anchored to 2-night TCPN)
  const anchorStay = stayData[2]?.marketTcpn ? 2
    : stayData[3]?.marketTcpn ? 3
    : stayData[1]?.marketTcpn ? 1
    : stayData[4]?.marketTcpn ? 4
    : stayData[7]?.marketTcpn ? 7 : null;

  if (!anchorStay) {
    return buildMultiStayResult({
      date, dayOfWeek, holiday, season, leadTimeDays, myRate,
      verdict: 'insufficient_data',
      reasoning: 'No usable TCPN data across any stay length.',
      confidence: 0, compCount: 0,
      decision: null,
    });
  }

  const anchorTcpn = stayData[anchorStay].marketTcpn;
  const anchorData = stayData[anchorStay];

  // Compute price points from anchor stay data
  const floor = percentile(anchorData.trimmed, 25);
  const target = anchorTcpn; // = percentile at season target
  const stretch = percentile(anchorData.trimmed, 75);

  // Assume cleaning fee of $75 if not known from my_rates
  const cleaningFee = myRate?.cleaning_fee || 75;

  // rec_nightly = market_tcpn(anchor) - cleaning_fee / anchor_nights, rounded to nearest $5
  let recNightly = anchorTcpn - (cleaningFee / anchorStay);
  recNightly = Math.round(recNightly / 5) * 5;

  // 3. Derive weekly discount %
  const weeklyPct = computeWeeklyDiscount(stayData);

  // 4. Derive monthly discount %
  const monthlyPct = computeMonthlyDiscount(weeklyPct);

  // 5. Apply overlays (legacy — kept for backward-compat rec_nightly_rate)
  const leadAdj = getLeadTimeAdjustment(leadTimeDays, season);
  recNightly = Math.round((recNightly * leadAdj) / 5) * 5;

  // Holiday multiplier — only when data is old
  let holidayAdjusted = false;
  if (holiday) {
    const anchorSnaps = getCompSnapshotsV2(db, unitId, date, anchorStay);
    const now = Date.now();
    const freshest = anchorSnaps.reduce((min, s) => {
      const age = (now - new Date(s.captured_at).getTime()) / 86400000;
      return Math.min(min, age);
    }, Infinity);
    if (freshest > 3) {
      recNightly = Math.round((recNightly * (holiday.peak_multiplier || 1)) / 5) * 5;
      holidayAdjusted = true;
    }
  }

  // 6. Confidence scoring (FIXED: actual data age, not hardcoded)
  const cv = anchorData.trimmed.length > 1 ? coefficientOfVariation(anchorData.trimmed) : 0;

  // Get market trend (use cached if provided, else compute)
  const trend = opts.trend || classifyMarketTrend(db, unitId);
  const runCount = opts.runCount || trend.runsAnalyzed || 1;

  // Get availability signal
  const availability = classifyAvailability(db, unitId, date);

  // Compute confidence with new structured model
  const confidenceResult = computeConfidence({
    compCount: anchorData.trimmed.length,
    dataAgeDays,
    tcpnCV: cv,
    runCount,
    signalsAgree: true, // Will be updated by decision engine
    leadTimeDays,
  });

  // 7. Decision engine — Layer 2 structured decision
  const decision = makeDecision({
    marketData: {
      anchorTcpn,
      trimmedValues: anchorData.trimmed,
      compCount: totalComps,
    },
    myRate,
    season,
    trend,
    availability,
    confidence: confidenceResult,
    holiday,
    dayOfWeek,
    leadTimeDays,
    dataAgeDays,
    anchorNights: anchorStay,
  });

  // 8. Backward-compatible verdict (from decision engine)
  let verdict = decision.action;
  if (verdict === 'suppress') verdict = 'insufficient_data';
  if (verdict === 'hold') verdict = 'keep'; // Legacy compat: 'keep' = 'hold'

  let pctRank = decision.percentile;
  let reasoning = decision.decisionReason;
  reasoning += ` Based on ${totalComps} listings. Season: ${season.name} (P${season.target_pctl}).`;
  if (holidayAdjusted) reasoning += ` ${holiday.name} premium applied.`;

  return buildMultiStayResult({
    date, dayOfWeek, holiday, season, leadTimeDays, myRate,
    tcpn_1n: stayData[1]?.marketTcpn || null,
    tcpn_2n: stayData[2]?.marketTcpn || null,
    tcpn_3n: stayData[3]?.marketTcpn || null,
    tcpn_4n: stayData[4]?.marketTcpn || null,
    tcpn_7n: stayData[7]?.marketTcpn || null,
    recNightlyRate: recNightly,
    recWeeklyPct: weeklyPct,
    recMonthlyPct: monthlyPct,
    floor: round2(floor),
    target: round2(target),
    stretch: round2(stretch),
    verdict,
    reasoning: reasoning.trim(),
    confidence: confidenceResult.score,
    percentile: pctRank,
    compCount: totalComps,
    demandSignal: availability.signal,
    holidayAdjusted,
    // New structured fields from decision engine
    decision,
    dataAgeDays: Math.round(dataAgeDays * 10) / 10,
  });
}

// ---------------------------------------------------------------------------
// Discount derivation
// ---------------------------------------------------------------------------

/**
 * Compute weekly discount %: compare 7n TCPN vs 2n TCPN.
 * weekly_pct = (1 - market_rate_7n / market_rate_2n) x 100, clamped [5, 30].
 * Falls back to 10% if insufficient data.
 */
function computeWeeklyDiscount(stayData) {
  const tcpn2 = stayData[2]?.marketTcpn;
  const tcpn7 = stayData[7]?.marketTcpn;

  if (!tcpn2 || !tcpn7 || tcpn2 <= 0) return 10; // default 10%

  const pct = Math.round((1 - tcpn7 / tcpn2) * 100);
  return Math.max(5, Math.min(30, pct));
}

/**
 * Compute monthly discount %: weekly_pct x 2.5, clamped [15, 40].
 */
function computeMonthlyDiscount(weeklyPct) {
  const raw = Math.round(weeklyPct * 2.5);
  return Math.max(15, Math.min(40, raw));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(v) {
  return v != null ? Math.round(v * 100) / 100 : null;
}

/**
 * Build a consistent multi-stay result object.
 * Backward-compatible with existing consumers + new decision fields.
 */
function buildMultiStayResult({
  date, dayOfWeek, holiday, season, leadTimeDays, myRate,
  tcpn_1n = null, tcpn_2n = null, tcpn_3n = null, tcpn_4n = null, tcpn_7n = null,
  recNightlyRate = null, recWeeklyPct = null, recMonthlyPct = null,
  floor = null, target = null, stretch = null,
  verdict = 'insufficient_data', reasoning = '', confidence = 0,
  percentile = null, compCount = 0, demandSignal = null, holidayAdjusted = false,
  decision = null, dataAgeDays = null,
}) {
  return {
    date,
    dayType: dayOfWeek,
    holiday: holiday ? holiday.name : null,
    season: season.name,
    seasonPctl: season.target_pctl,
    leadTimeDays,
    tcpn_1n: round2(tcpn_1n),
    tcpn_2n: round2(tcpn_2n),
    tcpn_3n: round2(tcpn_3n),
    tcpn_4n: round2(tcpn_4n),
    tcpn_7n: round2(tcpn_7n),
    recNightlyRate,
    recWeeklyPct,
    recMonthlyPct,
    floor,
    target,
    stretch,
    yourRate: myRate?.nightly_rate || null,
    yourTcpn: myRate?.tcpn || null,
    percentile,
    verdict,
    reasoning,
    confidence,
    compCount,
    demandSignal,
    holidayAdjusted,
    isBooked: myRate?.is_booked === 1,
    // New structured fields
    decision,
    dataAgeDays,
  };
}

module.exports = {
  analyzeDateMultiStay,
  computeWeeklyDiscount,
  computeMonthlyDiscount,
  STAY_LENGTHS,
};
