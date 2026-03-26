/**
 * Multi-stay analysis engine -- produces actionable Airbnb pricing recommendations.
 *
 * For each date, analyzes 5 stay lengths (1, 2, 3, 4, 7 nights), then derives:
 * - Recommended nightly rate (anchored to 2-night TCPN)
 * - Weekly discount % (from 7n vs 2n comparison)
 * - Monthly discount % (extrapolated from weekly)
 */

const { percentile, trimOutliers, computePercentileRank, computeConfidence, coefficientOfVariation } = require('./stats');
const { computeTcpn, tcpnToNightlyRate } = require('./normalize');
const { getCompSnapshotsV2 } = require('./db');
const { getSeason, getLeadTimeAdjustment } = require('./seasons');
const { getDayOfWeek, isHoliday } = require('./dates');

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
 * @returns {object}  Recommendation object
 */
function analyzeDateMultiStay(db, unitId, date) {
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

    // Compute market TCPN at seasonal percentile
    const marketTcpn = trimmed.length > 0 ? percentile(trimmed, season.target_pctl) : null;

    stayData[nights] = { tcpns, trimmed, marketTcpn };
  }

  // If no data at all, return insufficient_data result
  if (totalComps === 0) {
    return buildMultiStayResult({
      date, dayOfWeek, holiday, season, leadTimeDays, myRate,
      verdict: 'insufficient_data',
      reasoning: `No multi-stay competitor data for ${date}.`,
      confidence: 0, compCount: 0,
    });
  }

  // 2. Derive recommended nightly rate (anchored to 2-night TCPN)
  // Prefer 2-night data; fall back to whatever stay length has data
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
    });
  }

  const anchorTcpn = stayData[anchorStay].marketTcpn;
  const anchorData = stayData[anchorStay];

  // Compute price points from anchor stay data
  const floor = percentile(anchorData.trimmed, 25);
  const target = anchorTcpn; // = percentile at season target
  const stretch = percentile(anchorData.trimmed, 75);

  // Assume cleaning fee of $75 (typical for this market) if not known from my_rates
  const cleaningFee = myRate?.cleaning_fee || 75;

  // rec_nightly = market_tcpn(anchor) - cleaning_fee / anchor_nights, rounded to nearest $5
  let recNightly = anchorTcpn - (cleaningFee / anchorStay);
  recNightly = Math.round(recNightly / 5) * 5;

  // 3. Derive weekly discount %
  const weeklyPct = computeWeeklyDiscount(stayData);

  // 4. Derive monthly discount %
  const monthlyPct = computeMonthlyDiscount(weeklyPct);

  // 5. Apply overlays

  // Lead-time adjustment (getLeadTimeAdjustment expects the season object)
  const leadAdj = getLeadTimeAdjustment(leadTimeDays, season);
  recNightly = Math.round((recNightly * leadAdj) / 5) * 5;

  // Holiday multiplier — only apply when scraped data is old (>3 days),
  // because fresh scrapes already reflect holiday-premium pricing in the market.
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

  // Demand signal removed — snapshots_v2 only tracks available=1 listings,
  // so comp count vs snapshot count measures data completeness, not demand.
  // Real demand tracking requires availability history (future phase).
  const demandSignal = null;

  // Confidence scoring
  const cv = anchorData.trimmed.length > 1 ? coefficientOfVariation(anchorData.trimmed) : 0;
  const confidence = computeConfidence({
    compCount: anchorData.trimmed.length,
    snapshotMaxAgeDays: 1, // fresh from scrape
    isExactDate: true,
    tcpnCV: cv,
  });

  // Verdict — simplified to 3 actionable signals: raise, keep, lower
  let verdict = 'no_data';
  let pctRank = null;
  let reasoning = '';

  if (myRate?.tcpn && confidence >= 25) {
    pctRank = computePercentileRank(anchorData.trimmed, myRate.tcpn);

    if (pctRank < 35) {
      verdict = 'raise';
      reasoning = `Your rate is at the ${pctRank}th percentile — below most competitors. Consider raising to $${recNightly}.`;
    } else if (pctRank <= 70) {
      verdict = 'keep';
      reasoning = `Your rate is at the ${pctRank}th percentile — well-positioned vs competitors.`;
    } else {
      verdict = 'lower';
      reasoning = `Your rate is at the ${pctRank}th percentile — above most competitors. Consider lowering toward $${recNightly}.`;
    }
  } else if (confidence < 25) {
    verdict = 'insufficient_data';
    reasoning = `Not enough data to produce a reliable recommendation.`;
  } else {
    reasoning = `No rate recorded. Recommended: $${recNightly}/night.`;
  }

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
    confidence,
    percentile: pctRank,
    compCount: totalComps,
    demandSignal,
    holidayAdjusted,
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
 */
function buildMultiStayResult({
  date, dayOfWeek, holiday, season, leadTimeDays, myRate,
  tcpn_1n = null, tcpn_2n = null, tcpn_3n = null, tcpn_4n = null, tcpn_7n = null,
  recNightlyRate = null, recWeeklyPct = null, recMonthlyPct = null,
  floor = null, target = null, stretch = null,
  verdict = 'insufficient_data', reasoning = '', confidence = 0,
  percentile = null, compCount = 0, demandSignal = null, holidayAdjusted = false,
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
  };
}

module.exports = {
  analyzeDateMultiStay,
  computeWeeklyDiscount,
  computeMonthlyDiscount,
  STAY_LENGTHS,
};
