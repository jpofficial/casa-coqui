/**
 * Seasonal intelligence for Smart Pricing Autopilot.
 *
 * Exports:
 *   getSeason(db, dateStr)  — { name, target_pctl }
 *   getLeadTimeAdjustment(leadTimeDays, season) — multiplier
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

/**
 * Lead-time pricing adjustment multiplier.
 *
 * @param {number} leadTimeDays  Days between now and check-in date.
 * @param {{ name: string }} season  Season object (from getSeason).
 * @returns {number}  Multiplier to apply to the recommended rate.
 */
function getLeadTimeAdjustment(leadTimeDays, season) {
  // Last minute (3 days or less) — discount 15%
  if (leadTimeDays <= 3) return 0.85;

  // Low season + short lead (14 days or less) — discount 10%
  if (season.name === 'low' && leadTimeDays <= 14) return 0.90;

  // High season + advance booking (more than 30 days) — premium 10%
  if (season.name === 'high' && leadTimeDays > 30) return 1.10;

  // Default — no adjustment
  return 1.0;
}

module.exports = { getSeason, getLeadTimeAdjustment, PR_DEFAULTS };
