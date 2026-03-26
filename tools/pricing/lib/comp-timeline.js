/**
 * Competitor Timeline Layer — cross-run price movement + availability transitions.
 *
 * Reads from run_observations and calendar_availability (both populated by the
 * research scraper). All functions return null or empty results gracefully when
 * data is sparse.
 *
 * Used by the AI advisor to cite observed competitor behavior across runs.
 */

'use strict';

// Minimum % change to count as a price movement (avoids noise)
const MOVE_THRESHOLD_PCT = 2;

// ---------------------------------------------------------------------------
// getCompetitorHistory — all observations for a single competitor
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} competitorId
 * @param {{ fromDate?: string, stayNights?: number }} [opts]
 * @returns {Array<{run_id: number, check_date: string, stay_nights: number,
 *   nightly_rate: number, tcpn: number, available: number, captured_at: string}>}
 */
function getCompetitorHistory(db, competitorId, opts = {}) {
  let query = `
    SELECT run_id, check_date, stay_nights, nightly_rate, tcpn, available, captured_at
    FROM run_observations
    WHERE competitor_id = ?
  `;
  const params = [competitorId];

  if (opts.fromDate) {
    query += ' AND check_date >= ?';
    params.push(opts.fromDate);
  }
  if (opts.stayNights) {
    query += ' AND stay_nights = ?';
    params.push(opts.stayNights);
  }

  query += ' ORDER BY check_date ASC, captured_at ASC';

  return db.prepare(query).all(...params);
}

// ---------------------------------------------------------------------------
// getPriceMovements — who raised / lowered between last two research runs
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} unitId
 * @param {string} targetDate  YYYY-MM-DD (or null for aggregate across dates)
 * @param {{ lastRunId?: number, prevRunId?: number }} [opts]
 * @returns {{ movers: Array, summary: Object, lastRunId: number, prevRunId: number } | null}
 */
function getPriceMovements(db, unitId, targetDate, opts = {}) {
  // Resolve last two research runs
  const runs = resolveLastTwoRuns(db, opts);
  if (!runs) return null;
  const { lastRunId, prevRunId } = runs;

  // Get comp IDs for this unit
  const compIds = getUnitCompIds(db, unitId);
  if (compIds.length === 0) return null;
  const placeholders = compIds.map(() => '?').join(',');

  // Get TCPN observations for both runs — use the best available stay_nights per comp
  // We compare TCPN (not raw rate) to normalize across different stay lengths
  const lastObs = db.prepare(`
    SELECT ro.competitor_id, ro.airbnb_id, c.name, c.url, ro.tcpn, ro.nightly_rate, ro.stay_nights
    FROM run_observations ro
    JOIN competitors c ON ro.competitor_id = c.id
    WHERE ro.run_id = ? AND ro.run_source = 'research'
      AND ro.competitor_id IN (${placeholders})
      ${targetDate ? 'AND ro.check_date = ?' : ''}
      AND ro.tcpn IS NOT NULL AND ro.tcpn > 0
  `).all(lastRunId, ...compIds, ...(targetDate ? [targetDate] : []));

  const prevObs = db.prepare(`
    SELECT ro.competitor_id, ro.airbnb_id, c.name, c.url, ro.tcpn, ro.nightly_rate, ro.stay_nights
    FROM run_observations ro
    JOIN competitors c ON ro.competitor_id = c.id
    WHERE ro.run_id = ? AND ro.run_source = 'research'
      AND ro.competitor_id IN (${placeholders})
      ${targetDate ? 'AND ro.check_date = ?' : ''}
      AND ro.tcpn IS NOT NULL AND ro.tcpn > 0
  `).all(prevRunId, ...compIds, ...(targetDate ? [targetDate] : []));

  // Index previous by comp ID → best observation (prefer shorter stays for TCPN stability)
  const prevByComp = new Map();
  for (const o of prevObs) {
    const existing = prevByComp.get(o.competitor_id);
    if (!existing || o.stay_nights < existing.stay_nights) {
      prevByComp.set(o.competitor_id, o);
    }
  }

  // Index latest by comp ID similarly
  const lastByComp = new Map();
  for (const o of lastObs) {
    const existing = lastByComp.get(o.competitor_id);
    if (!existing || o.stay_nights < existing.stay_nights) {
      lastByComp.set(o.competitor_id, o);
    }
  }

  // Compare
  const movers = [];
  let raised = 0, lowered = 0, unchanged = 0, newComps = 0, disappeared = 0;

  for (const [compId, last] of lastByComp) {
    const prev = prevByComp.get(compId);
    if (!prev) {
      newComps++;
      continue;
    }
    const delta = last.tcpn - prev.tcpn;
    const deltaPct = prev.tcpn > 0 ? (delta / prev.tcpn) * 100 : 0;

    if (Math.abs(deltaPct) < MOVE_THRESHOLD_PCT) {
      unchanged++;
    } else if (deltaPct > 0) {
      raised++;
      movers.push({
        competitorId: compId,
        airbnbId: last.airbnb_id,
        name: last.name,
        url: last.url,
        direction: 'raised',
        lastRate: Math.round(last.tcpn),
        prevRate: Math.round(prev.tcpn),
        delta: Math.round(delta),
        deltaPct: Math.round(deltaPct * 10) / 10,
      });
    } else {
      lowered++;
      movers.push({
        competitorId: compId,
        airbnbId: last.airbnb_id,
        name: last.name,
        url: last.url,
        direction: 'lowered',
        lastRate: Math.round(last.tcpn),
        prevRate: Math.round(prev.tcpn),
        delta: Math.round(delta),
        deltaPct: Math.round(deltaPct * 10) / 10,
      });
    }
  }

  // Comps that disappeared (were in prev but not latest)
  for (const [compId] of prevByComp) {
    if (!lastByComp.has(compId)) disappeared++;
  }

  // Sort movers by absolute delta descending
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    movers: movers.slice(0, 5),
    summary: {
      raised,
      lowered,
      unchanged,
      newComps,
      disappeared,
      totalTracked: lastByComp.size,
    },
    lastRunId,
    prevRunId,
  };
}

// ---------------------------------------------------------------------------
// getAvailabilityTransitions — who became unavailable/available between runs
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} unitId
 * @param {string} targetDate  YYYY-MM-DD
 * @param {{ lastRunId?: number, prevRunId?: number }} [opts]
 * @returns {{ transitions: Array, summary: Object, tighteningSignal: string|null } | null}
 */
function getAvailabilityTransitions(db, unitId, targetDate, opts = {}) {
  // Resolve last two calendar runs (calendar_availability may have different run IDs)
  const runs = resolveLastTwoCalendarRuns(db, opts);
  if (!runs) return null;
  const { lastRunId, prevRunId } = runs;

  const compIds = getUnitCompIds(db, unitId);
  if (compIds.length === 0) return null;
  const placeholders = compIds.map(() => '?').join(',');

  const lastAvail = db.prepare(`
    SELECT ca.competitor_id, ca.airbnb_id, c.name, c.url, ca.display_status
    FROM calendar_availability ca
    JOIN competitors c ON ca.competitor_id = c.id
    WHERE ca.run_id = ? AND ca.run_source = 'research'
      AND ca.competitor_id IN (${placeholders})
      AND ca.date = ?
  `).all(lastRunId, ...compIds, targetDate);

  const prevAvail = db.prepare(`
    SELECT ca.competitor_id, ca.airbnb_id, c.name, c.url, ca.display_status
    FROM calendar_availability ca
    JOIN competitors c ON ca.competitor_id = c.id
    WHERE ca.run_id = ? AND ca.run_source = 'research'
      AND ca.competitor_id IN (${placeholders})
      AND ca.date = ?
  `).all(prevRunId, ...compIds, targetDate);

  const prevByComp = new Map();
  for (const r of prevAvail) prevByComp.set(r.competitor_id, r);

  const transitions = [];
  let becameUnavailable = 0, becameAvailable = 0, stayedAvailable = 0, stayedUnavailable = 0;

  for (const last of lastAvail) {
    const prev = prevByComp.get(last.competitor_id);
    if (!prev) continue; // new comp, skip

    const lastStatus = last.display_status === 'available' ? 'available' : 'not_available';
    const prevStatus = prev.display_status === 'available' ? 'available' : 'not_available';

    if (prevStatus === 'available' && lastStatus === 'not_available') {
      becameUnavailable++;
      transitions.push({
        competitorId: last.competitor_id,
        airbnbId: last.airbnb_id,
        name: last.name,
        url: last.url,
        from: 'available',
        to: 'not_available',
      });
    } else if (prevStatus === 'not_available' && lastStatus === 'available') {
      becameAvailable++;
      transitions.push({
        competitorId: last.competitor_id,
        airbnbId: last.airbnb_id,
        name: last.name,
        url: last.url,
        from: 'not_available',
        to: 'available',
      });
    } else if (lastStatus === 'available') {
      stayedAvailable++;
    } else {
      stayedUnavailable++;
    }
  }

  // Tightening signal
  let tighteningSignal = null;
  if (becameUnavailable + becameAvailable > 0) {
    if (becameUnavailable > becameAvailable * 2) {
      tighteningSignal = 'tightening';
    } else if (becameAvailable > becameUnavailable * 2) {
      tighteningSignal = 'loosening';
    } else {
      tighteningSignal = 'stable';
    }
  }

  return {
    transitions,
    summary: { becameUnavailable, becameAvailable, stayedAvailable, stayedUnavailable },
    tighteningSignal,
  };
}

// ---------------------------------------------------------------------------
// getRepeatCompStats — how many comps appear in 2+ research runs
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} unitId
 * @returns {{ repeatComps: number, singleRunComps: number, totalComps: number, pctRepeat: number }}
 */
function getRepeatCompStats(db, unitId) {
  const compIds = getUnitCompIds(db, unitId);
  if (compIds.length === 0) return { repeatComps: 0, singleRunComps: 0, totalComps: 0, pctRepeat: 0 };
  const placeholders = compIds.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT competitor_id, COUNT(DISTINCT run_id) as run_count
    FROM run_observations
    WHERE competitor_id IN (${placeholders}) AND run_source = 'research'
    GROUP BY competitor_id
  `).all(...compIds);

  const repeatComps = rows.filter(r => r.run_count >= 2).length;
  const singleRunComps = rows.filter(r => r.run_count === 1).length;
  const totalComps = rows.length;

  return {
    repeatComps,
    singleRunComps,
    totalComps,
    pctRepeat: totalComps > 0 ? Math.round((repeatComps / totalComps) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// getMarketMovementSummary — top-level function for the advisor
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} unitId
 * @param {{ days?: number }} [opts]
 * @returns {Object|null}  null when < 2 research runs exist
 */
function getMarketMovementSummary(db, unitId, opts = {}) {
  // Need at least 2 completed research runs
  const runCheck = db.prepare(`
    SELECT COUNT(*) as cnt FROM research_runs WHERE status = 'completed' AND excluded = 0
  `).get();
  if (!runCheck || runCheck.cnt < 2) return null;

  // Use tomorrow as representative target date (most relevant for pricing)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const priceResult = getPriceMovements(db, unitId, null); // aggregate across all dates
  const availResult = getAvailabilityTransitions(db, unitId, tomorrow);
  const reliability = getRepeatCompStats(db, unitId);

  // Run context
  const runs = resolveLastTwoRuns(db, {});
  let lastRunAt = null, daysBetween = null;
  if (runs) {
    const lastRun = db.prepare('SELECT started_at FROM research_runs WHERE id = ?').get(runs.lastRunId);
    const prevRun = db.prepare('SELECT started_at FROM research_runs WHERE id = ?').get(runs.prevRunId);
    if (lastRun) lastRunAt = lastRun.started_at;
    if (lastRun && prevRun) {
      daysBetween = Math.round((new Date(lastRun.started_at) - new Date(prevRun.started_at)) / 86400000);
    }
  }

  // Determine dominant direction
  let dominantDirection = 'mixed';
  if (priceResult) {
    const { raised, lowered } = priceResult.summary;
    if (raised > lowered * 2) dominantDirection = 'raising';
    else if (lowered > raised * 2) dominantDirection = 'lowering';
  }

  return {
    priceMovement: priceResult ? {
      raised: priceResult.summary.raised,
      lowered: priceResult.summary.lowered,
      unchanged: priceResult.summary.unchanged,
      dominantDirection,
      topMovers: priceResult.movers.slice(0, 5).map(m => ({
        name: m.name?.substring(0, 40),
        url: m.url,
        direction: m.direction,
        delta: m.delta,
        pctChange: m.deltaPct,
      })),
    } : null,
    availabilityEvidence: availResult ? {
      signal: availResult.tighteningSignal,
      becameUnavailable: availResult.summary.becameUnavailable,
      becameAvailable: availResult.summary.becameAvailable,
      topContributors: availResult.transitions.slice(0, 3).map(tr => ({
        name: tr.name?.substring(0, 40),
        url: tr.url,
        from: tr.from,
        to: tr.to,
      })),
    } : null,
    compReliability: reliability,
    runContext: {
      lastRunId: runs?.lastRunId || null,
      prevRunId: runs?.prevRunId || null,
      lastRunAt,
      daysBetween,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get active competitor IDs for a unit */
function getUnitCompIds(db, unitId) {
  return db.prepare(
    'SELECT id FROM competitors WHERE comp_unit = ? AND active = 1'
  ).all(unitId).map(r => r.id);
}

/** Resolve last two completed research runs (for run_observations) */
function resolveLastTwoRuns(db, opts) {
  if (opts.lastRunId && opts.prevRunId) {
    return { lastRunId: opts.lastRunId, prevRunId: opts.prevRunId };
  }
  try {
    const runs = db.prepare(`
      SELECT id FROM research_runs
      WHERE status = 'completed' AND excluded = 0
      ORDER BY started_at DESC
      LIMIT 2
    `).all();
    if (runs.length < 2) return null;
    return { lastRunId: runs[0].id, prevRunId: runs[1].id };
  } catch {
    return null;
  }
}

/** Resolve last two calendar runs (calendar_availability may differ from run_observations) */
function resolveLastTwoCalendarRuns(db, opts) {
  if (opts.lastRunId && opts.prevRunId) {
    return { lastRunId: opts.lastRunId, prevRunId: opts.prevRunId };
  }
  try {
    const runs = db.prepare(`
      SELECT DISTINCT ca.run_id FROM calendar_availability ca
      JOIN research_runs rr ON ca.run_id = rr.id
      WHERE ca.run_source = 'research' AND rr.excluded = 0
      ORDER BY ca.run_id DESC
      LIMIT 2
    `).all();
    if (runs.length < 2) return null;
    return { lastRunId: runs[0].run_id, prevRunId: runs[1].run_id };
  } catch {
    return null;
  }
}

module.exports = {
  getCompetitorHistory,
  getPriceMovements,
  getAvailabilityTransitions,
  getRepeatCompStats,
  getMarketMovementSummary,
};
