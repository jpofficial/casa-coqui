/**
 * Availability signal classification for pricing decisions.
 *
 * Classifies competitor availability into: tight / mixed / open
 * Uses calendar_availability data from research runs.
 *
 * IMPORTANT: Never says "booked" — only "unavailable".
 * Unavailable could mean booked, blocked, or minimum-stay restricted.
 */

const MIN_COMPS_FOR_SIGNAL = 5;

/**
 * Classify the availability signal for a specific date.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} unitId - e.g. 'unit-a'
 * @param {string} date - YYYY-MM-DD
 * @returns {{ signal: 'tight'|'mixed'|'open'|null, unavailablePct: number|null, compCount: number, trackedComps: number, confidence: string }}
 */
function classifyAvailability(db, unitId, date) {
  try {
    // Get active comp IDs for this unit
    const comps = db.prepare(
      'SELECT id FROM competitors WHERE comp_unit = ? AND active = 1'
    ).all(unitId);

    if (comps.length === 0) {
      return { signal: null, unavailablePct: null, compCount: 0, trackedComps: 0, confidence: 'none' };
    }

    const compIds = comps.map(c => c.id);
    const placeholders = compIds.map(() => '?').join(',');

    // Get the most recent calendar_availability entry per competitor for this date
    // Use the latest run_id to get the freshest data
    const rows = db.prepare(`
      SELECT ca.competitor_id, ca.available_for_checkin, ca.display_status,
             ca.run_id, ca.captured_at
      FROM calendar_availability ca
      WHERE ca.competitor_id IN (${placeholders})
        AND ca.date = ?
      ORDER BY ca.captured_at DESC
    `).all(...compIds, date);

    // Deduplicate: keep only the latest entry per competitor
    const byComp = new Map();
    for (const row of rows) {
      if (!byComp.has(row.competitor_id)) {
        byComp.set(row.competitor_id, row);
      }
    }

    const trackedComps = byComp.size;

    if (trackedComps < MIN_COMPS_FOR_SIGNAL) {
      return {
        signal: null,
        unavailablePct: null,
        compCount: comps.length,
        trackedComps,
        confidence: trackedComps === 0 ? 'none' : 'insufficient',
      };
    }

    // Count unavailable comps
    let unavailableCount = 0;
    for (const entry of byComp.values()) {
      // available_for_checkin = 0 means unavailable (could be booked, blocked, or min-stay restricted)
      if (!entry.available_for_checkin) {
        unavailableCount++;
      }
    }

    const unavailablePct = (unavailableCount / trackedComps) * 100;

    let signal;
    if (unavailablePct >= 55) {
      signal = 'tight';
    } else if (unavailablePct >= 30) {
      signal = 'mixed';
    } else {
      signal = 'open';
    }

    return {
      signal,
      unavailablePct: Math.round(unavailablePct * 10) / 10,
      compCount: comps.length,
      trackedComps,
      confidence: trackedComps >= 8 ? 'high' : 'moderate',
    };
  } catch {
    // calendar_availability table might not exist yet
    return { signal: null, unavailablePct: null, compCount: 0, trackedComps: 0, confidence: 'none' };
  }
}

/**
 * Compute availability summary across a date range.
 * Returns aggregate signal + per-date breakdown.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} unitId
 * @param {string[]} dates - Array of YYYY-MM-DD
 * @returns {{ overall: string|null, tightPct: number, mixedPct: number, openPct: number, dates: Object[] }}
 */
function computeAvailabilitySummary(db, unitId, dates) {
  const results = dates.map(date => ({
    date,
    ...classifyAvailability(db, unitId, date),
  }));

  const withSignal = results.filter(r => r.signal != null);
  if (withSignal.length === 0) {
    return { overall: null, tightPct: 0, mixedPct: 0, openPct: 0, dates: results };
  }

  const tightCount = withSignal.filter(r => r.signal === 'tight').length;
  const mixedCount = withSignal.filter(r => r.signal === 'mixed').length;
  const openCount = withSignal.filter(r => r.signal === 'open').length;
  const total = withSignal.length;

  const tightPct = Math.round((tightCount / total) * 100);
  const mixedPct = Math.round((mixedCount / total) * 100);
  const openPct = Math.round((openCount / total) * 100);

  // Overall signal: majority rules
  let overall;
  if (tightPct >= 50) overall = 'tight';
  else if (openPct >= 50) overall = 'open';
  else overall = 'mixed';

  return { overall, tightPct, mixedPct, openPct, dates: results };
}

module.exports = {
  classifyAvailability,
  computeAvailabilitySummary,
  MIN_COMPS_FOR_SIGNAL,
};
