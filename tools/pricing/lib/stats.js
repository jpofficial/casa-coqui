/**
 * Statistical helpers for pricing analysis.
 *
 * Extracted from analysis.js — used by multi-stay analysis engine
 * and decision engine.
 */

/**
 * Compute percentile from a sorted array of values.
 * Uses linear interpolation.
 */
function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

/**
 * Find where a value sits in a sorted array (0-100 percentile).
 */
function computePercentileRank(sortedValues, value) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) {
    return value <= sortedValues[0] ? 50 : 100;
  }

  let countBelow = 0;
  let countEqual = 0;
  for (const v of sortedValues) {
    if (v < value) countBelow++;
    else if (v === value) countEqual++;
  }

  // Percentile rank using midpoint of equal values
  const rank = ((countBelow + countEqual * 0.5) / sortedValues.length) * 100;
  return Math.round(rank);
}

/**
 * IQR-based outlier trimming.
 * Removes values below Q1 - 1.5*IQR or above Q3 + 1.5*IQR.
 * Floor: never trim below 3 values.
 */
function trimOutliers(sortedValues) {
  if (sortedValues.length <= 3) return sortedValues;

  const q1 = percentile(sortedValues, 25);
  const q3 = percentile(sortedValues, 75);
  const iqr = q3 - q1;

  // If IQR is 0 (all values identical or nearly so), skip trimming
  if (iqr === 0) return sortedValues;

  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const trimmed = sortedValues.filter((v) => v >= lowerBound && v <= upperBound);

  // Never trim below 3 values — return original if trimming is too aggressive
  return trimmed.length >= 3 ? trimmed : sortedValues;
}

/**
 * Coefficient of variation (standard deviation / mean).
 */
function coefficientOfVariation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// ---------------------------------------------------------------------------
// Confidence scoring — restructured with 6 factors + structured output
// ---------------------------------------------------------------------------

/**
 * Compute structured confidence score from weighted factors.
 *
 * | Factor            | Weight | Key Change                                     |
 * |-------------------|--------|------------------------------------------------|
 * | Comp count        | 0.30   | <3: hard zero. 5: 60 (was 70). Realistic.     |
 * | Data freshness    | 0.20   | Uses actual scrape age, not hardcoded 1        |
 * | Market spread (CV)| 0.15   | Unchanged                                      |
 * | Trend depth       | 0.15   | NEW — rewards historical data accumulation     |
 * | Signal agreement  | 0.10   | NEW — penalizes conflicting signals            |
 * | Calendar proximity| 0.10   | NEW — far-out dates are inherently speculative |
 *
 * @param {Object} params
 * @param {number} params.compCount - Number of comps after outlier trimming
 * @param {number} params.dataAgeDays - Age of most recent snapshot in days (actual, not hardcoded)
 * @param {number} params.tcpnCV - Coefficient of variation of TCPNs
 * @param {number} [params.runCount=1] - Number of autopilot runs in last 30 days
 * @param {boolean} [params.signalsAgree=true] - Whether trend + availability + percentile point same direction
 * @param {number} [params.leadTimeDays=14] - Days until check-in
 * @returns {{ tier: 'high'|'medium'|'low', score: number, factors: Object }}
 */
function computeConfidence({
  compCount,
  dataAgeDays,
  tcpnCV,
  runCount = 1,
  signalsAgree = true,
  leadTimeDays = 14,
  // Legacy compat — if old callers pass these, convert
  snapshotMaxAgeDays,
  isExactDate,
}) {
  // Legacy compat bridge: if old callers pass snapshotMaxAgeDays, use it as dataAgeDays
  const ageDays = dataAgeDays != null ? dataAgeDays : (snapshotMaxAgeDays != null ? snapshotMaxAgeDays : 1);

  // Hard zero: below 3 comps, no analysis is trustworthy
  if (compCount < 3) {
    return {
      tier: 'low',
      score: 0,
      factors: { compCount: 0, freshness: 0, spread: 0, trendDepth: 0, signalAgreement: 0, proximity: 0 },
    };
  }

  // Hard suppress: data older than 14 days = unreliable
  if (ageDays > 14) {
    return {
      tier: 'low',
      score: Math.min(15, compCount * 2),
      factors: { compCount: compCount * 2, freshness: 0, spread: 0, trendDepth: 0, signalAgreement: 0, proximity: 0 },
    };
  }

  // --- Factor 1: Comp count (weight 0.30) ---
  let compScore;
  if (compCount === 3) compScore = 25;
  else if (compCount === 4) compScore = 45;
  else if (compCount === 5) compScore = 60;
  else if (compCount === 6) compScore = 75;
  else if (compCount === 7) compScore = 90;
  else compScore = 100;

  // --- Factor 2: Data freshness (weight 0.20) — actual scrape age ---
  let freshnessScore;
  if (ageDays <= 1) freshnessScore = 100;
  else if (ageDays <= 3) freshnessScore = 90;
  else if (ageDays <= 5) freshnessScore = 70;
  else if (ageDays <= 7) freshnessScore = 50;
  else if (ageDays <= 10) freshnessScore = 30;
  else freshnessScore = 15; // 10-14 days

  // --- Factor 3: Market spread / CV (weight 0.15) ---
  let spreadScore;
  if (tcpnCV < 0.10) spreadScore = 100;
  else if (tcpnCV < 0.15) spreadScore = 85;
  else if (tcpnCV <= 0.25) spreadScore = 65;
  else if (tcpnCV <= 0.35) spreadScore = 45;
  else spreadScore = 25;

  // --- Factor 4: Trend depth — runs in last 30 days (weight 0.15) ---
  let trendDepthScore;
  if (runCount >= 6) trendDepthScore = 100;
  else if (runCount >= 4) trendDepthScore = 80;
  else if (runCount >= 3) trendDepthScore = 60;
  else if (runCount >= 2) trendDepthScore = 40;
  else trendDepthScore = 20; // single run = no trend

  // --- Factor 5: Signal agreement (weight 0.10) ---
  const signalScore = signalsAgree ? 100 : 30;

  // --- Factor 6: Calendar proximity (weight 0.10) ---
  let proximityScore;
  if (leadTimeDays <= 7) proximityScore = 100;       // Near-term: high visibility
  else if (leadTimeDays <= 14) proximityScore = 85;
  else if (leadTimeDays <= 21) proximityScore = 70;
  else if (leadTimeDays <= 30) proximityScore = 55;
  else if (leadTimeDays <= 45) proximityScore = 40;
  else proximityScore = 25;                            // 45+ days: speculative

  const score = Math.round(
    compScore * 0.30 +
    freshnessScore * 0.20 +
    spreadScore * 0.15 +
    trendDepthScore * 0.15 +
    signalScore * 0.10 +
    proximityScore * 0.10
  );

  const clampedScore = Math.max(0, Math.min(100, score));

  let tier;
  if (clampedScore >= 70) tier = 'high';
  else if (clampedScore >= 40) tier = 'medium';
  else tier = 'low';

  return {
    tier,
    score: clampedScore,
    factors: {
      compCount: compScore,
      freshness: freshnessScore,
      spread: spreadScore,
      trendDepth: trendDepthScore,
      signalAgreement: signalScore,
      proximity: proximityScore,
    },
  };
}

// ---------------------------------------------------------------------------
// Warnings — structured actionable warnings
// ---------------------------------------------------------------------------

/**
 * Generate structured warnings from analysis context.
 *
 * @param {Object} params
 * @param {number} params.compCount - Number of comps
 * @param {number} params.dataAgeDays - Age of most recent snapshot
 * @param {string} params.confidenceTier - 'high' | 'medium' | 'low'
 * @param {number} [params.runCount=1] - Runs in last 30 days
 * @param {boolean} [params.signalsAgree=true] - Whether signals agree
 * @param {number} [params.compSetChangePct=0] - % of comp set that changed between runs
 * @returns {Array<{ code: string, severity: 'critical'|'caution'|'info', message: string }>}
 */
function generateWarnings({
  compCount,
  dataAgeDays,
  confidenceTier,
  runCount = 1,
  signalsAgree = true,
  compSetChangePct = 0,
}) {
  const warnings = [];

  // Low sample
  if (compCount < 3) {
    warnings.push({
      code: 'low_sample',
      severity: 'critical',
      message: `Only ${compCount} competitors — below minimum for statistical reliability`,
    });
  } else if (compCount < 5) {
    warnings.push({
      code: 'low_sample',
      severity: 'caution',
      message: `Only ${compCount} competitors — percentile estimates have wide error bars`,
    });
  }

  // Stale data
  if (dataAgeDays > 7) {
    warnings.push({
      code: 'stale_data',
      severity: 'critical',
      message: `Data is ${Math.round(dataAgeDays)} days old — recommendations may not reflect current market`,
    });
  } else if (dataAgeDays > 4) {
    warnings.push({
      code: 'stale_data',
      severity: 'caution',
      message: `Data is ${Math.round(dataAgeDays)} days old — consider running a fresh scrape`,
    });
  }

  // Mixed signals
  if (!signalsAgree) {
    warnings.push({
      code: 'mixed_signals',
      severity: 'caution',
      message: 'Market trend and availability signal point in different directions',
    });
  }

  // Weak confidence
  if (confidenceTier === 'low') {
    warnings.push({
      code: 'weak_confidence',
      severity: 'caution',
      message: 'Low overall confidence — treat recommendation as directional guidance only',
    });
  }

  // Comp set drift
  if (compSetChangePct > 30) {
    warnings.push({
      code: 'comp_set_drift',
      severity: 'info',
      message: `${Math.round(compSetChangePct)}% of comp set changed since last run — trends may not be comparable`,
    });
  }

  // Insufficient history
  if (runCount < 3) {
    warnings.push({
      code: 'insufficient_history',
      severity: 'info',
      message: runCount < 2
        ? 'Only 1 data run — no trend analysis possible yet'
        : 'Limited run history — trend signals are preliminary',
    });
  }

  return warnings;
}

module.exports = {
  percentile,
  computePercentileRank,
  trimOutliers,
  coefficientOfVariation,
  computeConfidence,
  generateWarnings,
};
