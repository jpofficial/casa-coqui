/**
 * Decision Engine — Deterministic pricing rule engine (Layer 2).
 *
 * Takes structured facts from the data pipeline (Layer 1) and outputs:
 * - action: raise / hold / lower
 * - suggested rate
 * - price ladder (floor / target / stretch)
 * - warnings
 * - confidence tier
 *
 * The LLM (Layer 3) explains this output. It cannot override it.
 *
 * Rate formula:
 *   baseRate = anchorTCPN - (cleaningFee / anchorNights)
 *   → × weekdayMultiplier → × leadTimeMultiplier → × trendMultiplier
 *   → × holidayMultiplier → × demandMultiplier → round to $5
 *   → clamp between floor and stretch × 1.10
 */

const { percentile, computePercentileRank, computeConfidence, generateWarnings } = require('./stats');
const { getWeekdayMultiplier, getTrendMultiplier, getDemandMultiplier, getSeasonPriceLadder, getLeadTimeAdjustment } = require('./seasons');

// ---------------------------------------------------------------------------
// Constants / guardrails
// ---------------------------------------------------------------------------

const MAX_RAISE_DOLLARS = 15;
const MAX_RAISE_PCT = 0.12;
const MAX_LOWER_DOLLARS = 15;
const MAX_LOWER_PCT = 0.12;
const FIRE_SALE_MAX_DOLLARS = 25;
const FIRE_SALE_MAX_PCT = 0.20;
const MIN_CHANGE_THRESHOLD = 5;    // Suppress changes smaller than $5
const COOLDOWN_DAYS = 3;           // If rate changed recently, dampen by 50%
const SUPPRESS_CONFIDENCE = 25;    // Below this: suppress recommendation entirely
const HOLD_CONFIDENCE = 40;        // Below this: always HOLD (never recommend changes on thin data)

// ---------------------------------------------------------------------------
// Market trend classification
// ---------------------------------------------------------------------------

/**
 * Classify market trend from market_history data.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} unitId
 * @returns {{ direction: 'strengthening'|'stable'|'softening'|null, deltaPct: number|null, runsAnalyzed: number, medianDates: number }}
 */
function classifyMarketTrend(db, unitId) {
  try {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const today = new Date().toISOString().split('T')[0];

    const runs = db.prepare(`
      SELECT id, started_at FROM autopilot_runs
      WHERE started_at >= ? AND status = 'completed' AND excluded = 0
      ORDER BY started_at ASC
    `).all(cutoff);

    if (runs.length < 2) {
      return { direction: null, deltaPct: null, runsAnalyzed: runs.length, medianDates: 0 };
    }

    const lastRun = runs[runs.length - 1];
    const prevRun = runs[runs.length - 2];

    // Get market_history for both runs — only future dates
    const lastData = db.prepare(
      'SELECT check_date, median_tcpn_2n FROM market_history WHERE unit_id = ? AND run_id = ? AND check_date >= ? AND median_tcpn_2n IS NOT NULL'
    ).all(unitId, lastRun.id, today);

    const prevData = db.prepare(
      'SELECT check_date, median_tcpn_2n FROM market_history WHERE unit_id = ? AND run_id = ? AND check_date >= ? AND median_tcpn_2n IS NOT NULL'
    ).all(unitId, prevRun.id, today);

    if (lastData.length === 0 || prevData.length === 0) {
      return { direction: null, deltaPct: null, runsAnalyzed: runs.length, medianDates: 0 };
    }

    // Find overlapping dates for apples-to-apples comparison
    const prevByDate = new Map(prevData.map(d => [d.check_date, d.median_tcpn_2n]));
    const overlapping = lastData.filter(d => prevByDate.has(d.check_date));

    if (overlapping.length < 3) {
      return { direction: null, deltaPct: null, runsAnalyzed: runs.length, medianDates: overlapping.length };
    }

    // Use median (not mean) for outlier resistance
    const deltas = overlapping.map(d => {
      const prev = prevByDate.get(d.check_date);
      return ((d.median_tcpn_2n - prev) / prev) * 100;
    }).sort((a, b) => a - b);

    const medianDelta = deltas[Math.floor(deltas.length / 2)];
    const risingCount = deltas.filter(d => d > 0).length;
    const risingPct = (risingCount / deltas.length) * 100;

    let direction;
    if (medianDelta > 2 && risingPct > 60) {
      direction = 'strengthening';
    } else if (medianDelta < -2 && risingPct < 40) {
      direction = 'softening';
    } else {
      direction = 'stable';
    }

    return {
      direction,
      deltaPct: Math.round(medianDelta * 10) / 10,
      runsAnalyzed: runs.length,
      medianDates: overlapping.length,
    };
  } catch {
    return { direction: null, deltaPct: null, runsAnalyzed: 0, medianDates: 0 };
  }
}

// ---------------------------------------------------------------------------
// Decision matrix
// ---------------------------------------------------------------------------

/**
 * Apply the decision matrix to determine action.
 *
 * | Your Position | Base Verdict | Modifiers                                          |
 * |---------------|--------------|----------------------------------------------------|
 * | < P20         | RAISE        | Strongest signal regardless of trend                |
 * | P20-P35       | RAISE        | Dampened if market softening                        |
 * | P35-P55       | HOLD         | → RAISE if strengthening + tight                   |
 * | P55-P70       | HOLD         | → LOWER if softening + open                        |
 * | P70-P85       | LOWER        | → HOLD if tight                                    |
 * | > P85         | LOWER        | Strongest signal regardless of trend                |
 *
 * @param {number} pctRank - Percentile rank (0-100)
 * @param {string|null} trendDirection - 'strengthening' | 'stable' | 'softening'
 * @param {string|null} availSignal - 'tight' | 'mixed' | 'open'
 * @param {number} confidenceScore - 0-100
 * @returns {{ action: 'raise'|'hold'|'lower'|'suppress', reason: string }}
 */
function applyDecisionMatrix(pctRank, trendDirection, availSignal, confidenceScore) {
  // Confidence gates
  if (confidenceScore < SUPPRESS_CONFIDENCE) {
    return { action: 'suppress', reason: 'Confidence too low for any recommendation' };
  }
  if (confidenceScore < HOLD_CONFIDENCE) {
    return { action: 'hold', reason: 'Low confidence — defaulting to HOLD (thin data)' };
  }

  if (pctRank == null) {
    return { action: 'hold', reason: 'No rate recorded — cannot determine position' };
  }

  // < P20: RAISE regardless
  if (pctRank < 20) {
    return { action: 'raise', reason: `At P${pctRank} — well below market, strong raise signal` };
  }

  // P20-P35: RAISE, dampened if softening
  if (pctRank < 35) {
    if (trendDirection === 'softening') {
      return { action: 'raise', reason: `At P${pctRank} — below market. Raise dampened (market softening)` };
    }
    return { action: 'raise', reason: `At P${pctRank} — below most competitors` };
  }

  // P35-P55: HOLD, upgrade to RAISE if strengthening + tight
  if (pctRank <= 55) {
    if (trendDirection === 'strengthening' && availSignal === 'tight') {
      return { action: 'raise', reason: `At P${pctRank} — market strengthening with tight availability` };
    }
    return { action: 'hold', reason: `At P${pctRank} — well-positioned in the market` };
  }

  // P55-P70: HOLD, downgrade to LOWER if softening + open
  if (pctRank <= 70) {
    if (trendDirection === 'softening' && availSignal === 'open') {
      return { action: 'lower', reason: `At P${pctRank} — market softening with open availability` };
    }
    return { action: 'hold', reason: `At P${pctRank} — slightly above center but within range` };
  }

  // P70-P85: LOWER, strengthen to HOLD if tight
  if (pctRank <= 85) {
    if (availSignal === 'tight') {
      return { action: 'hold', reason: `At P${pctRank} — above market, but availability is tight` };
    }
    return { action: 'lower', reason: `At P${pctRank} — above most competitors` };
  }

  // > P85: LOWER regardless
  return { action: 'lower', reason: `At P${pctRank} — well above market, strong lower signal` };
}

// ---------------------------------------------------------------------------
// Rate computation
// ---------------------------------------------------------------------------

/**
 * Compute the suggested rate using the full multiplier stack.
 *
 * baseRate = anchorTCPN - (cleaningFee / anchorNights)
 * → × weekdayMultiplier → × leadTimeMultiplier → × trendMultiplier
 * → × holidayMultiplier → × demandMultiplier → round to $5
 * → clamp between floor and stretch × 1.10
 *
 * @param {Object} params
 * @returns {{ suggestedRate: number, baseRate: number, multipliers: Object }}
 */
function computeSuggestedRate({
  anchorTcpn,
  anchorNights,
  cleaningFee,
  dayOfWeek,
  seasonName,
  leadTimeDays,
  trendDeltaPct,
  availSignal,
  holiday,
  freshData,
  floorRate,
  stretchRate,
}) {
  // Base rate from anchor TCPN
  let rate = anchorTcpn - (cleaningFee / anchorNights);

  const multipliers = {};

  // Weekday/weekend
  const weekdayMult = getWeekdayMultiplier(dayOfWeek, seasonName);
  rate *= weekdayMult;
  multipliers.weekday = weekdayMult;

  // Lead time
  const leadMult = getLeadTimeAdjustment(leadTimeDays, { name: seasonName });
  rate *= leadMult;
  multipliers.leadTime = leadMult;

  // Market trend
  const trendMult = getTrendMultiplier(trendDeltaPct);
  rate *= trendMult;
  multipliers.trend = trendMult;

  // Holiday — only apply when data is NOT fresh (>3 days old)
  // because fresh scrapes already reflect holiday premium in market prices
  let holidayMult = 1.0;
  if (holiday && !freshData) {
    holidayMult = holiday.peak_multiplier || 1.0;
    rate *= holidayMult;
  }
  multipliers.holiday = holidayMult;

  // Demand / availability
  const demandMult = getDemandMultiplier(availSignal);
  rate *= demandMult;
  multipliers.demand = demandMult;

  // Round to nearest $5
  rate = Math.round(rate / 5) * 5;

  // Clamp between floor and stretch × 1.10
  const ceiling = stretchRate ? Math.round((stretchRate * 1.10) / 5) * 5 : Infinity;
  const floor = floorRate ? Math.round(floorRate / 5) * 5 : 0;
  rate = Math.max(floor, Math.min(ceiling, rate));

  return {
    suggestedRate: rate,
    baseRate: Math.round((anchorTcpn - (cleaningFee / anchorNights)) / 5) * 5,
    multipliers,
  };
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

/**
 * Apply rate change guardrails.
 *
 * @param {string} action - 'raise' | 'lower' | 'hold'
 * @param {number} suggestedRate - From computeSuggestedRate
 * @param {number|null} currentRate - Host's current rate
 * @param {number} leadTimeDays - Days to check-in
 * @param {number} floorRate - Floor rate
 * @param {boolean} [isBooked=false] - Whether the date is already booked
 * @param {number|null} [lastChangeAgeDays=null] - Days since last rate change
 * @returns {{ finalRate: number, action: string, delta: number, deltaPct: number, guardrailApplied: string|null }}
 */
function applyGuardrails(action, suggestedRate, currentRate, leadTimeDays, floorRate, isBooked = false, lastChangeAgeDays = null) {
  // If booked, no change needed
  if (isBooked) {
    return { finalRate: currentRate || suggestedRate, action: 'hold', delta: 0, deltaPct: 0, guardrailApplied: 'booked' };
  }

  // No current rate — suggest the computed rate
  if (!currentRate) {
    return { finalRate: suggestedRate, action, delta: 0, deltaPct: 0, guardrailApplied: null };
  }

  let delta = suggestedRate - currentRate;
  const absDelta = Math.abs(delta);
  const absPct = currentRate > 0 ? absDelta / currentRate : 0;

  // Fire sale: lead time ≤3 days + unbooked + above P50
  const isFireSale = leadTimeDays <= 3 && action === 'lower';

  // Max change limits
  const maxDollars = isFireSale ? FIRE_SALE_MAX_DOLLARS : (action === 'raise' ? MAX_RAISE_DOLLARS : MAX_LOWER_DOLLARS);
  const maxPct = isFireSale ? FIRE_SALE_MAX_PCT : (action === 'raise' ? MAX_RAISE_PCT : MAX_LOWER_PCT);

  let guardrailApplied = null;

  // Cap by dollar amount
  if (absDelta > maxDollars) {
    delta = delta > 0 ? maxDollars : -maxDollars;
    guardrailApplied = 'max_dollar';
  }

  // Cap by percentage
  if (absPct > maxPct) {
    const cappedDelta = currentRate * maxPct;
    if (Math.abs(delta) > cappedDelta) {
      delta = delta > 0 ? cappedDelta : -cappedDelta;
      guardrailApplied = 'max_pct';
    }
  }

  // Cooldown: recent change dampens by 50%
  if (lastChangeAgeDays != null && lastChangeAgeDays <= COOLDOWN_DAYS) {
    delta = delta * 0.5;
    guardrailApplied = guardrailApplied ? guardrailApplied + '+cooldown' : 'cooldown';
  }

  // Round to nearest $5
  delta = Math.round(delta / 5) * 5;

  // Min change threshold: suppress tiny deltas
  if (Math.abs(delta) < MIN_CHANGE_THRESHOLD) {
    return {
      finalRate: currentRate,
      action: 'hold',
      delta: 0,
      deltaPct: 0,
      guardrailApplied: absDelta > 0 ? 'below_threshold' : null,
    };
  }

  const finalRate = Math.max(floorRate || 0, currentRate + delta);
  const finalDelta = finalRate - currentRate;

  return {
    finalRate,
    action: finalDelta > 0 ? 'raise' : finalDelta < 0 ? 'lower' : 'hold',
    delta: finalDelta,
    deltaPct: currentRate > 0 ? Math.round((finalDelta / currentRate) * 1000) / 10 : 0,
    guardrailApplied,
  };
}

// ---------------------------------------------------------------------------
// Main entry point — produce a complete decision for one date
// ---------------------------------------------------------------------------

/**
 * Produce a complete pricing decision for a single (unit, date) pair.
 *
 * This is the Layer 2 output that gets passed to the AI (Layer 3) for explanation.
 *
 * @param {Object} params
 * @param {Object} params.marketData - From multi-stay analysis (anchorTcpn, trimmedValues, etc.)
 * @param {Object} params.myRate - { nightly_rate, tcpn, cleaning_fee, is_booked }
 * @param {Object} params.season - { name, target_pctl }
 * @param {Object} params.trend - From classifyMarketTrend()
 * @param {Object} params.availability - From classifyAvailability()
 * @param {Object} params.confidence - From computeConfidence()
 * @param {Object|null} params.holiday - Holiday object or null
 * @param {string} params.dayOfWeek - 'weekday' | 'friday' | 'saturday' | 'sunday'
 * @param {number} params.leadTimeDays
 * @param {number} params.dataAgeDays - Actual freshness of snapshot data
 * @param {number} params.anchorNights - Stay length used for anchor TCPN
 * @returns {Object} Complete decision with action, rate, signals, warnings
 */
function makeDecision({
  marketData,
  myRate,
  season,
  trend,
  availability,
  confidence,
  holiday,
  dayOfWeek,
  leadTimeDays,
  dataAgeDays,
  anchorNights,
}) {
  const cleaningFee = myRate?.cleaning_fee || 75;
  const currentRate = myRate?.nightly_rate || null;
  const isBooked = myRate?.is_booked === 1;
  const pctRank = myRate?.tcpn && marketData.trimmedValues?.length > 0
    ? computePercentileRank(marketData.trimmedValues, myRate.tcpn)
    : null;

  // Season-varying price ladder
  const ladder = getSeasonPriceLadder(season.name);
  const floorRate = marketData.trimmedValues?.length > 0
    ? Math.round(percentile(marketData.trimmedValues, ladder.floor) / 5) * 5
    : null;
  const targetRate = marketData.trimmedValues?.length > 0
    ? Math.round(percentile(marketData.trimmedValues, ladder.target) / 5) * 5
    : null;
  const stretchRate = marketData.trimmedValues?.length > 0
    ? Math.round(percentile(marketData.trimmedValues, ladder.stretch) / 5) * 5
    : null;

  // Decision matrix
  const decision = applyDecisionMatrix(
    pctRank,
    trend.direction,
    availability.signal,
    confidence.score
  );

  // Compute suggested rate with full multiplier stack
  let rateResult = null;
  if (marketData.anchorTcpn && decision.action !== 'suppress') {
    rateResult = computeSuggestedRate({
      anchorTcpn: marketData.anchorTcpn,
      anchorNights,
      cleaningFee,
      dayOfWeek,
      seasonName: season.name,
      leadTimeDays,
      trendDeltaPct: trend.deltaPct,
      availSignal: availability.signal,
      holiday,
      freshData: dataAgeDays <= 3,
      floorRate,
      stretchRate,
    });
  }

  // Apply guardrails
  let guardrailResult;
  if (rateResult && decision.action !== 'suppress') {
    guardrailResult = applyGuardrails(
      decision.action,
      rateResult.suggestedRate,
      currentRate,
      leadTimeDays,
      floorRate,
      isBooked,
      null // lastChangeAgeDays — would need my_rates_history lookup, skip for now
    );
  } else {
    guardrailResult = {
      finalRate: currentRate || (rateResult?.suggestedRate) || null,
      action: decision.action === 'suppress' ? 'suppress' : 'hold',
      delta: 0,
      deltaPct: 0,
      guardrailApplied: null,
    };
  }

  // Generate warnings
  const warnings = generateWarnings({
    compCount: marketData.compCount || 0,
    dataAgeDays,
    confidenceTier: confidence.tier,
    runCount: trend.runsAnalyzed || 1,
    signalsAgree: checkSignalAgreement(decision.action, trend.direction, availability.signal),
  });

  // Lead-time override: ≤7 days + above P50 + unbooked → bias toward lower
  let leadTimeOverride = null;
  if (leadTimeDays <= 7 && pctRank != null && pctRank > 50 && !isBooked && guardrailResult.action !== 'lower') {
    leadTimeOverride = 'short_lead_bias';
    // Don't force lower, just note it as a signal
  }

  return {
    // Core decision
    action: guardrailResult.action,
    suggestedRate: guardrailResult.finalRate,
    currentRate,
    delta: guardrailResult.delta,
    deltaPct: guardrailResult.deltaPct,
    guardrailApplied: guardrailResult.guardrailApplied,

    // Price ladder
    floor: floorRate,
    target: targetRate,
    stretch: stretchRate,

    // Position
    percentile: pctRank,
    decisionReason: decision.reason,

    // Signals
    marketTrend: trend.direction || 'unknown',
    trendDeltaPct: trend.deltaPct,
    availabilitySignal: availability.signal || 'unknown',
    unavailablePct: availability.unavailablePct,

    // Confidence
    confidence: confidence.tier,
    confidenceScore: confidence.score,
    confidenceFactors: confidence.factors,

    // Context
    season: season.name,
    dayOfWeek,
    holiday: holiday ? holiday.name : null,
    leadTimeDays,
    isBooked,
    leadTimeOverride,

    // Data quality
    compCount: marketData.compCount || 0,
    dataAgeDays: Math.round(dataAgeDays * 10) / 10,

    // Multipliers (for transparency)
    multipliers: rateResult?.multipliers || null,
    baseRate: rateResult?.baseRate || null,

    // Warnings
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether trend, availability, and position action agree.
 */
function checkSignalAgreement(action, trendDirection, availSignal) {
  if (!trendDirection || !availSignal) return true; // Can't disagree if no data

  // Raising: strengthening trend + tight availability = agree
  if (action === 'raise') {
    if (trendDirection === 'softening') return false;
    if (availSignal === 'open') return false;
    return true;
  }

  // Lowering: softening trend + open availability = agree
  if (action === 'lower') {
    if (trendDirection === 'strengthening') return false;
    if (availSignal === 'tight') return false;
    return true;
  }

  // Hold: anything is fine
  return true;
}

// ---------------------------------------------------------------------------
// Aggregate decision — summary across all dates in a window
// ---------------------------------------------------------------------------

/**
 * Compute a summary decision from an array of per-date decisions.
 * This is what gets shown in the advisor card header.
 *
 * @param {Object[]} decisions - Array of makeDecision() outputs
 * @returns {Object} Aggregate summary
 */
function summarizeDecisions(decisions) {
  const active = decisions.filter(d => d.action !== 'suppress' && !d.isBooked);
  if (active.length === 0) {
    return {
      action: 'hold',
      suggestedRate: null,
      confidence: 'low',
      verdictDistribution: { raise: 0, hold: 0, lower: 0, suppress: 0 },
      avgPercentile: null,
      avgDelta: 0,
    };
  }

  const raiseCount = active.filter(d => d.action === 'raise').length;
  const holdCount = active.filter(d => d.action === 'hold').length;
  const lowerCount = active.filter(d => d.action === 'lower').length;
  const suppressCount = decisions.filter(d => d.action === 'suppress').length;

  // Majority action
  let action;
  if (raiseCount > holdCount && raiseCount > lowerCount) action = 'raise';
  else if (lowerCount > holdCount && lowerCount > raiseCount) action = 'lower';
  else action = 'hold';

  // Average suggested rate (for dates with rates)
  const withRates = active.filter(d => d.suggestedRate != null);
  const avgRate = withRates.length > 0
    ? Math.round(withRates.reduce((s, d) => s + d.suggestedRate, 0) / withRates.length / 5) * 5
    : null;

  // Average percentile
  const withPct = active.filter(d => d.percentile != null);
  const avgPercentile = withPct.length > 0
    ? Math.round(withPct.reduce((s, d) => s + d.percentile, 0) / withPct.length)
    : null;

  // Average delta
  const withDelta = active.filter(d => d.delta !== 0);
  const avgDelta = withDelta.length > 0
    ? Math.round(withDelta.reduce((s, d) => s + d.delta, 0) / withDelta.length)
    : 0;

  // Confidence: use the mode of tiers
  const tiers = active.map(d => d.confidence);
  const highCount = tiers.filter(t => t === 'high').length;
  const medCount = tiers.filter(t => t === 'medium').length;
  const lowCount = tiers.filter(t => t === 'low').length;
  let confidence;
  if (highCount >= medCount && highCount >= lowCount) confidence = 'high';
  else if (medCount >= lowCount) confidence = 'medium';
  else confidence = 'low';

  // Market trend: pick the most common (from first decision with data)
  const withTrend = active.find(d => d.marketTrend && d.marketTrend !== 'unknown');
  const marketTrend = withTrend?.marketTrend || 'stable';
  const trendDeltaPct = withTrend?.trendDeltaPct || null;

  // Availability signal: pick the most common
  const availSignals = active.map(d => d.availabilitySignal).filter(s => s && s !== 'unknown');
  const availCounts = {};
  for (const s of availSignals) availCounts[s] = (availCounts[s] || 0) + 1;
  const availabilitySignal = Object.entries(availCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Aggregate warnings (deduplicated by code)
  const allWarnings = active.flatMap(d => d.warnings || []);
  const warningsByCode = new Map();
  for (const w of allWarnings) {
    if (!warningsByCode.has(w.code) || w.severity === 'critical') {
      warningsByCode.set(w.code, w);
    }
  }

  return {
    action,
    suggestedRate: avgRate,
    currentRate: active[0]?.currentRate || null,
    delta: avgDelta,
    confidence,
    confidenceScore: Math.round(active.reduce((s, d) => s + d.confidenceScore, 0) / active.length),
    marketTrend,
    trendDeltaPct,
    availabilitySignal,
    verdictDistribution: { raise: raiseCount, hold: holdCount, lower: lowerCount, suppress: suppressCount },
    avgPercentile,
    compCount: active[0]?.compCount || 0,
    season: active[0]?.season || 'shoulder',
    warnings: Array.from(warningsByCode.values()),
  };
}

module.exports = {
  classifyMarketTrend,
  applyDecisionMatrix,
  computeSuggestedRate,
  applyGuardrails,
  makeDecision,
  summarizeDecisions,
  checkSignalAgreement,
  // Constants (exported for testing)
  MAX_RAISE_DOLLARS,
  MAX_LOWER_DOLLARS,
  MIN_CHANGE_THRESHOLD,
  HOLD_CONFIDENCE,
  SUPPRESS_CONFIDENCE,
};
