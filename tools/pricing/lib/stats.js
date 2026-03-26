/**
 * Statistical helpers for pricing analysis.
 *
 * Extracted from analysis.js — these are the only functions still used
 * by the multi-stay analysis engine.
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

/**
 * Compute confidence score (0-100) from 4 weighted inputs.
 *
 * | Factor        | Weight | Scoring                                     |
 * |---------------|--------|---------------------------------------------|
 * | Comp count    | 0.40   | <3→0, 3→30, 4→50, 5→70, 6→85, 7+→100      |
 * | Freshness     | 0.25   | ≤3d→100, 3-7d→80, 7-14d→50, >14d→20       |
 * | Data source   | 0.20   | Exact date→100, Fallback→40                 |
 * | Comp spread   | 0.15   | CV<0.15→100, 0.15-0.30→70, >0.30→40        |
 */
function computeConfidence({ compCount, snapshotMaxAgeDays, isExactDate, tcpnCV }) {
  // Hard zero: below 3 comps, no analysis is trustworthy
  if (compCount < 3) return 0;

  // Comp count score
  let compScore;
  if (compCount === 3) compScore = 30;
  else if (compCount === 4) compScore = 50;
  else if (compCount === 5) compScore = 70;
  else if (compCount === 6) compScore = 85;
  else compScore = 100;

  // Freshness score
  let freshnessScore;
  if (snapshotMaxAgeDays <= 3) freshnessScore = 100;
  else if (snapshotMaxAgeDays <= 7) freshnessScore = 80;
  else if (snapshotMaxAgeDays <= 14) freshnessScore = 50;
  else freshnessScore = 20;

  // Data source score
  const sourceScore = isExactDate ? 100 : 40;

  // Spread score
  let spreadScore;
  if (tcpnCV < 0.15) spreadScore = 100;
  else if (tcpnCV <= 0.30) spreadScore = 70;
  else spreadScore = 40;

  const composite = Math.round(
    compScore * 0.40 +
    freshnessScore * 0.25 +
    sourceScore * 0.20 +
    spreadScore * 0.15
  );

  return Math.max(0, Math.min(100, composite));
}

module.exports = {
  percentile,
  computePercentileRank,
  trimOutliers,
  coefficientOfVariation,
  computeConfidence,
};
