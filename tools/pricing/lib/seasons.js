/**
 * Seasonal intelligence for Smart Pricing Autopilot.
 *
 * Exports:
 *   getSeason(db, dateStr)            — { name, target_pctl }
 *   getLeadTimeAdjustment(days, season) — multiplier (graduated per-season)
 *   getWeekdayMultiplier(dayOfWeek, seasonName) — day-of-week pricing multiplier
 *   getTrendMultiplier(deltaPct)       — market trend pricing multiplier
 *   getDemandMultiplier(availSignal)   — availability-based pricing multiplier
 *   getSeasonPriceLadder(seasonName)   — { floor, target, stretch } percentile targets
 */

// Puerto Rico defaults — used when the seasons table is empty or missing.
const PR_DEFAULTS = [
  { start_month: 12, end_month: 4, name: 'high', target_pctl: 60 },
  { start_month: 5, end_month: 6, name: 'shoulder', target_pctl: 50 },
  { start_month: 7, end_month: 11, name: 'low', target_pctl: 40 },
];

/**
 * Determine the season for a given date.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {{ name: string, target_pctl: number }}
 */
function getSeason(db, dateStr) {
  let rows;
  try {
    rows = db.prepare('SELECT * FROM seasons ORDER BY start_month').all();
  } catch {
    // Table may not exist yet — fall through to defaults.
    rows = [];
  }

  const seasons = rows.length > 0 ? rows : PR_DEFAULTS;
  const month = parseInt(dateStr.split('-')[1], 10);

  for (const s of seasons) {
    if (s.start_month > s.end_month) {
      // Cross-year range (e.g. Dec-Apr = 12-4)
      if (month >= s.start_month || month <= s.end_month) {
        return { name: s.name, target_pctl: s.target_pctl };
      }
    } else {
      if (month >= s.start_month && month <= s.end_month) {
        return { name: s.name, target_pctl: s.target_pctl };
      }
    }
  }

  // Fallback — should not happen if seasons cover all 12 months.
  return { name: 'shoulder', target_pctl: 50 };
}

// ---------------------------------------------------------------------------
// Lead-time pricing — graduated per-season curve
// ---------------------------------------------------------------------------

/**
 * Graduated lead-time multiplier table.
 * Each row: [maxDays, highMultiplier, shoulderMultiplier, lowMultiplier]
 * Checked in order — first match wins.
 */
const LEAD_TIME_CURVE = [
  [3,   0.85, 0.85, 0.82],   // 0-3 days: last minute discount
  [7,   0.90, 0.92, 0.88],   // 4-7 days: short lead
  [14,  0.95, 0.95, 0.92],   // 8-14 days: near-term
  [21,  1.00, 1.00, 0.95],   // 15-21 days: base
  [30,  1.05, 1.00, 1.00],   // 22-30 days: advance booking
  [45,  1.10, 1.00, 1.00],   // 31-45 days: peak advance premium
  [60,  1.08, 1.00, 1.00],   // 46-60 days: slight pullback
  [Infinity, 1.05, 1.00, 1.00], // 61+ days: moderate premium
];

const SEASON_COL = { high: 1, shoulder: 2, low: 3 };

/**
 * Lead-time pricing adjustment multiplier (graduated per-season curve).
 *
 * @param {number} leadTimeDays  Days between now and check-in date.
 * @param {{ name: string }} season  Season object (from getSeason).
 * @returns {number}  Multiplier to apply to the recommended rate.
 */
function getLeadTimeAdjustment(leadTimeDays, season) {
  const col = SEASON_COL[season.name] || SEASON_COL.shoulder;
  for (const row of LEAD_TIME_CURVE) {
    if (leadTimeDays <= row[0]) return row[col];
  }
  return 1.0;
}

// ---------------------------------------------------------------------------
// Weekday / weekend multipliers
// ---------------------------------------------------------------------------

/**
 * Day-of-week pricing multipliers by season.
 *
 * | Season   | Weekday | Friday | Saturday | Sunday |
 * |----------|---------|--------|----------|--------|
 * | High     | 0.95    | 1.05   | 1.08     | 0.97   |
 * | Shoulder | 0.92    | 1.08   | 1.10     | 0.95   |
 * | Low      | 0.88    | 1.12   | 1.15     | 0.93   |
 */
const WEEKDAY_MULTIPLIERS = {
  high:     { weekday: 0.95, friday: 1.05, saturday: 1.08, sunday: 0.97 },
  shoulder: { weekday: 0.92, friday: 1.08, saturday: 1.10, sunday: 0.95 },
  low:      { weekday: 0.88, friday: 1.12, saturday: 1.15, sunday: 0.93 },
};

/**
 * Get the day-of-week pricing multiplier.
 *
 * @param {string} dayOfWeek  'weekday' | 'friday' | 'saturday' | 'sunday'
 * @param {string} seasonName 'high' | 'shoulder' | 'low'
 * @returns {number} Multiplier (e.g. 1.10 for Saturday in low season)
 */
function getWeekdayMultiplier(dayOfWeek, seasonName) {
  const season = WEEKDAY_MULTIPLIERS[seasonName] || WEEKDAY_MULTIPLIERS.shoulder;
  return season[dayOfWeek] || season.weekday;
}

// ---------------------------------------------------------------------------
// Trend multiplier
// ---------------------------------------------------------------------------

/**
 * Market trend multiplier based on week-over-week TCPN delta.
 *
 * @param {number|null} deltaPct  Week-over-week TCPN change percentage
 * @returns {number} Multiplier
 */
function getTrendMultiplier(deltaPct) {
  if (deltaPct == null) return 1.00;
  if (deltaPct > 5)  return 1.05;  // Strongly strengthening
  if (deltaPct > 2)  return 1.02;  // Rising
  if (deltaPct >= -2) return 1.00; // Stable
  if (deltaPct >= -5) return 0.98; // Softening
  return 0.95;                      // Falling
}

// ---------------------------------------------------------------------------
// Demand multiplier
// ---------------------------------------------------------------------------

/**
 * Demand multiplier based on availability signal.
 *
 * @param {string|null} availSignal  'tight' | 'mixed' | 'open' | null
 * @returns {number} Multiplier
 */
function getDemandMultiplier(availSignal) {
  if (availSignal === 'tight') return 1.05;
  if (availSignal === 'open')  return 0.95;
  return 1.00; // mixed or null
}

// ---------------------------------------------------------------------------
// Season-varying price ladder percentiles
// ---------------------------------------------------------------------------

/**
 * Get the price ladder percentile targets for a season.
 *
 * | Level   | High | Shoulder | Low  |
 * |---------|------|----------|------|
 * | Floor   | P30  | P25      | P20  |
 * | Target  | P60  | P50      | P40  |
 * | Stretch | P80  | P75      | P65  |
 */
const PRICE_LADDER = {
  high:     { floor: 30, target: 60, stretch: 80 },
  shoulder: { floor: 25, target: 50, stretch: 75 },
  low:      { floor: 20, target: 40, stretch: 65 },
};

/**
 * Get the price ladder percentile targets for the given season.
 *
 * @param {string} seasonName 'high' | 'shoulder' | 'low'
 * @returns {{ floor: number, target: number, stretch: number }}
 */
function getSeasonPriceLadder(seasonName) {
  return PRICE_LADDER[seasonName] || PRICE_LADDER.shoulder;
}

module.exports = {
  getSeason,
  getLeadTimeAdjustment,
  getWeekdayMultiplier,
  getTrendMultiplier,
  getDemandMultiplier,
  getSeasonPriceLadder,
  PR_DEFAULTS,
  LEAD_TIME_CURVE,
  WEEKDAY_MULTIPLIERS,
  PRICE_LADDER,
};
