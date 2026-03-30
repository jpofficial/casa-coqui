/**
 * Evidence retrieval layer for the pricing advisor.
 *
 * Gathers historical data from the SQLite database and formats it
 * as compact payloads for AI-powered natural language answers.
 *
 * Token budget target: ~2000 tokens max per evidence payload.
 * Each gatherer caps result sets to stay within budget.
 *
 * SCOPING RULES:
 * - Every payload includes `unitScope` ('unit-a', 'unit-b', or 'all')
 *   so the AI always knows the boundary of its answer.
 * - When unit is null/undefined, multi-unit functions query BOTH units
 *   and report per-unit results. Single-unit library functions (e.g.
 *   compTimeline) are called once per unit and results are merged.
 * - Date scope defaults to 60-day lookback. Declared in payload as `dateScope`.
 */

import { getPricingLib } from '@/lib/pricing-db';

// ---------------------------------------------------------------------------
// Scoping helpers
// ---------------------------------------------------------------------------

const LOOKBACK_DAYS = 60;
const BOTH_UNITS = ['unit-a', 'unit-b'];

function defaultDateFrom() {
  return new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().split('T')[0];
}

function resolveUnits(unit) {
  if (unit === 'unit-a' || unit === 'unit-b') return [unit];
  return BOTH_UNITS;
}

function unitScopeLabel(unit) {
  if (unit === 'unit-a' || unit === 'unit-b') return unit;
  return 'all';
}

/**
 * Resolve date scope: use explicit dateRange if provided, else default 60-day lookback.
 * Returns { dateFrom, dateTo, label } for inclusion in evidence payloads.
 */
function resolveDateScope(dateRange) {
  if (dateRange && dateRange.dateFrom) {
    return {
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo || null,
      label: dateRange.dateTo
        ? `${dateRange.dateFrom} → ${dateRange.dateTo}`
        : `from ${dateRange.dateFrom}`,
    };
  }
  return {
    dateFrom: defaultDateFrom(),
    dateTo: null,
    label: `last ${LOOKBACK_DAYS} days`,
  };
}

// ---------------------------------------------------------------------------
// Evidence gatherers — one per intent type
// ---------------------------------------------------------------------------

/**
 * Availability evidence: per-competitor booking rankings + aggregate stats.
 *
 * Uses TWO data sources:
 * - calendar_availability (primary): tracks full calendar state including booked dates.
 *   This is the correct source for "who's booked?" questions.
 * - run_observations (fallback): only captures available listings with pricing.
 *   Used when calendar data is unavailable, and for pricing context.
 *
 * Payload shape:
 * {
 *   unitScope, dateScope,
 *   units: [{
 *     unitId, compCount, datesTracked, avgBookedPct,
 *     competitors: [{ name, url, active, bookedPct, bookedDates, totalDates, datesTracked }] (max 20)
 *   }],
 *   dataSource: 'calendar' | 'observations',
 *   transitions: { becameUnavailable, becameAvailable, total } | null
 * }
 */
export function gatherAvailabilityEvidence(db, unit, dateRange = null) {
  const { db: dbLib, compTimeline } = getPricingLib();
  const units = resolveUnits(unit);
  const scope = resolveDateScope(dateRange);

  let dataSource = 'calendar';
  const unitResults = units.map(unitId => {
    // Primary: calendar_availability (real booking data)
    const calComps = dbLib.getCalendarBookingSummary(db, unitId, {
      dateFrom: scope.dateFrom, dateTo: scope.dateTo, limit: 25,
    });

    if (calComps.length > 0) {
      const totalDates = calComps.reduce((s, r) => s + r.total_dates, 0);
      const totalBooked = calComps.reduce((s, r) => s + r.booked_dates, 0);
      return {
        unitId,
        compCount: calComps.length,
        datesTracked: calComps[0]?.dates_tracked || 0,
        avgBookedPct: totalDates > 0 ? Math.round(1000 * totalBooked / totalDates) / 10 : 0,
        competitors: calComps.slice(0, 20).map(r => ({
          name: (r.name || '').substring(0, 35),
          url: r.url || r.listing_url || null,
          active: !!r.active,
          bookedPct: r.booked_pct,
          bookedDates: r.booked_dates,
          totalDates: r.total_dates,
          datesTracked: r.dates_tracked,
        })),
      };
    }

    // Fallback: run_observations (only captures available listings)
    dataSource = 'observations';
    const obsComps = dbLib.getCompPriceAndAvailComparison(db, unitId, {
      dateFrom: scope.dateFrom, dateTo: scope.dateTo, stayNights: null, limit: 25,
    });
    const sorted = [...obsComps].sort((a, b) =>
      (b.unavailable_pct || 0) - (a.unavailable_pct || 0)
    );
    const totalObs = sorted.reduce((s, r) => s + r.obs_count, 0);
    const totalUnavail = sorted.reduce((s, r) => s + r.unavailable_count, 0);
    return {
      unitId,
      compCount: sorted.length,
      datesTracked: 0,
      avgBookedPct: totalObs > 0 ? Math.round(1000 * totalUnavail / totalObs) / 10 : 0,
      competitors: sorted.slice(0, 20).map(r => ({
        name: (r.name || '').substring(0, 35),
        url: r.url || null,
        active: !!r.active,
        bookedPct: r.unavailable_pct,
        bookedDates: r.unavailable_count,
        totalDates: r.obs_count,
        datesTracked: 0,
      })),
    };
  });

  // Availability transitions from comp-timeline (last 2 runs, per unit)
  let transitions = null;
  try {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    for (const unitId of units) {
      const t = compTimeline.getAvailabilityTransitions(db, unitId, tomorrow);
      if (t) {
        if (!transitions) transitions = { becameUnavailable: 0, becameAvailable: 0, total: 0 };
        transitions.becameUnavailable += t.becameUnavailable?.length || 0;
        transitions.becameAvailable += t.becameAvailable?.length || 0;
        transitions.total += t.totalComps || 0;
      }
    }
  } catch { /* may not have 2 runs yet */ }

  return {
    unitScope: unitScopeLabel(unit),
    dateScope: { from: scope.dateFrom, to: scope.dateTo, label: scope.label },
    units: unitResults,
    dataSource,
    transitions,
  };
}

/**
 * Competitor pricing evidence: price movements + top competitor histories.
 *
 * Payload shape:
 * {
 *   unitScope, dateScope: { from, lookbackDays },
 *   units: [{
 *     unitId,
 *     movements: { raised, lowered, unchanged, topMovers: [{ name, delta }] } | null,
 *     competitors: [{ name, bedrooms, rating, avgTcpn, minTcpn, maxTcpn, unavailPct, obs }]  (max 10)
 *   }],
 *   weekendPremium: { unitId, weekendMedian, weekdayMedian, premiumPct } [] | null
 * }
 */
export function gatherCompetitorPricingEvidence(db, unit, dateRange = null) {
  const { db: dbLib, compTimeline } = getPricingLib();
  const units = resolveUnits(unit);
  const scope = resolveDateScope(dateRange);

  const unitResults = units.map(unitId => {
    // Price movements between last two runs for this unit
    let movements = null;
    try {
      const m = compTimeline.getPriceMovements(db, unitId, null);
      if (m) {
        movements = {
          raised: m.raised?.length || 0,
          lowered: m.lowered?.length || 0,
          unchanged: m.unchanged?.length || 0,
          topMovers: (m.raised || []).concat(m.lowered || [])
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 5)
            .map(c => ({ name: (c.name || '').substring(0, 30), delta: Math.round(c.delta) })),
        };
      }
    } catch { /* may not have 2 runs */ }

    // Cross-competitor comparison snapshot
    const comps = dbLib.getCompPriceAndAvailComparison(db, unitId, {
      dateFrom: scope.dateFrom, dateTo: scope.dateTo, limit: 15,
    });
    const competitors = comps.map(c => ({
      name: (c.name || '').substring(0, 30),
      url: c.url || null,
      bedrooms: c.bedrooms,
      rating: c.rating,
      avgTcpn: c.avg_tcpn,
      minTcpn: c.min_tcpn,
      maxTcpn: c.max_tcpn,
      unavailPct: c.unavailable_pct,
      obs: c.obs_count,
    }));

    return { unitId, movements, competitors };
  });

  // Weekend premium per unit
  const weekendPremiums = [];
  for (const unitId of units) {
    try {
      const wp = dbLib.getWeekendPremium(db, unitId, LOOKBACK_DAYS);
      if (wp && wp.weekend_median && wp.weekday_median) {
        weekendPremiums.push({
          unitId,
          weekendMedian: wp.weekend_median,
          weekdayMedian: wp.weekday_median,
          premiumPct: Math.round(10 * (wp.weekend_median / wp.weekday_median - 1) * 100) / 10,
        });
      }
    } catch { /* ok */ }
  }

  return {
    unitScope: unitScopeLabel(unit),
    dateScope: { from: scope.dateFrom, to: scope.dateTo, label: scope.label },
    units: unitResults,
    weekendPremium: weekendPremiums.length > 0 ? weekendPremiums : null,
  };
}

/**
 * Run detail evidence: metadata + observation summary + verdict breakdown.
 * Always shows all units that the run covered (unitScope is 'all' for the run).
 *
 * Payload shape:
 * {
 *   unitScope: 'all',
 *   run: { id, type, status, startedAt, duration, compsFound, recsWritten },
 *   obsSummary: { totalObs, uniqueComps, uniqueDates, dateRange, avgRate, avgTcpn } | null,
 *   verdicts: { [unitId]: [{ verdict, count, avgRate }] },
 *   marketSummary: [{ unitId, datesCovered, avgMedianTcpn, avgCompsAvail }]
 * }
 */
export function gatherRunDetailEvidence(db, unit, runIdHint) {
  const { db: dbLib } = getPricingLib();

  let runId = runIdHint;
  if (!runId) {
    const latest = dbLib.getLatestAutopilotRun(db);
    runId = latest?.id;
  }
  if (!runId) return null;

  const run = dbLib.getRunById(db, runId);
  if (!run) return null;

  const obsSummary = dbLib.getRunObservationsSummary(db, runId, 'autopilot');

  // Verdicts for all units the run covered
  const runUnits = run.units_processed
    ? run.units_processed.split(',').map(u => u.trim())
    : BOTH_UNITS;
  const verdicts = {};
  for (const unitId of runUnits) {
    const v = dbLib.getRunRecSummary(db, runId, unitId);
    if (v && v.length > 0) {
      verdicts[unitId] = v.map(r => ({
        verdict: r.verdict, count: r.count, avgRate: r.avg_rate,
      }));
    }
  }

  const marketSummary = dbLib.getRunMarketSummary(db, runId);

  return {
    unitScope: 'all',
    run: {
      id: run.id, type: run.run_type, status: run.status,
      startedAt: run.started_at, duration: run.duration_ms,
      compsFound: run.comps_found, recsWritten: run.recs_written,
    },
    obsSummary: obsSummary && obsSummary.total_obs > 0 ? {
      totalObs: obsSummary.total_obs, uniqueComps: obsSummary.unique_comps,
      uniqueDates: obsSummary.unique_dates,
      dateRange: `${obsSummary.date_from} → ${obsSummary.date_to}`,
      avgRate: obsSummary.avg_rate, avgTcpn: obsSummary.avg_tcpn,
    } : null,
    verdicts,
    marketSummary: (marketSummary || []).map(m => ({
      unitId: m.unit_id, datesCovered: m.dates_covered,
      avgMedianTcpn: m.avg_median_tcpn, avgCompsAvail: m.avg_comps_available,
    })),
  };
}

/**
 * Market trend evidence: direction + recent market history + movement summary.
 * Per-unit when both are queried.
 *
 * Payload shape:
 * {
 *   unitScope, dateScope: { from, lookbackDays },
 *   units: [{
 *     unitId,
 *     trend: { direction, deltaPct },
 *     recentHistory: [{ date, medianTcpn, compsAvail, compsTotal, verdict, season }]  (max 15),
 *     movementSummary: { raised, lowered, becameUnavail, becameAvail, reliability } | null,
 *     weekendPremium: { weekendMedian, weekdayMedian, premiumPct } | null
 *   }]
 * }
 */
export function gatherMarketTrendEvidence(db, unit, dateRange = null) {
  const { db: dbLib, decisionEngine, compTimeline } = getPricingLib();
  const units = resolveUnits(unit);

  const unitResults = units.map(unitId => {
    let trend = { direction: 'unknown', deltaPct: 0 };
    try { trend = decisionEngine.classifyMarketTrend(db, unitId); } catch { /* ok */ }

    const history = dbLib.getMarketHistory(db, unitId, LOOKBACK_DAYS);
    const recentHistory = history.slice(0, 15).map(h => ({
      date: h.check_date,
      medianTcpn: h.median_tcpn_2n,
      compsAvail: h.comp_count_avail,
      compsTotal: h.comp_count_total,
      verdict: h.verdict,
      season: h.season,
    }));

    let movementSummary = null;
    try {
      const ms = compTimeline.getMarketMovementSummary(db, unitId);
      if (ms) {
        movementSummary = {
          raised: ms.priceMovement?.raised?.length || 0,
          lowered: ms.priceMovement?.lowered?.length || 0,
          becameUnavail: ms.availability?.becameUnavailable?.length || 0,
          becameAvail: ms.availability?.becameAvailable?.length || 0,
          reliability: ms.reliability ? {
            repeatComps: ms.reliability.repeatComps,
            totalComps: ms.reliability.totalComps,
            pctRepeat: ms.reliability.pctRepeat,
          } : null,
        };
      }
    } catch { /* may not have enough runs */ }

    let weekendPremium = null;
    try {
      const wp = dbLib.getWeekendPremium(db, unitId, LOOKBACK_DAYS);
      if (wp && wp.weekend_median && wp.weekday_median) {
        weekendPremium = {
          weekendMedian: wp.weekend_median,
          weekdayMedian: wp.weekday_median,
          premiumPct: Math.round(10 * (wp.weekend_median / wp.weekday_median - 1) * 100) / 10,
        };
      }
    } catch { /* ok */ }

    return { unitId, trend, recentHistory, movementSummary, weekendPremium };
  });

  const scope = resolveDateScope(dateRange);
  return {
    unitScope: unitScopeLabel(unit),
    dateScope: { from: scope.dateFrom, to: scope.dateTo, label: scope.label },
    units: unitResults,
  };
}

/**
 * Data coverage evidence: gaps + recent run list.
 * Scoped to 60-day lookback (consistent with other evidence gatherers).
 *
 * Payload shape:
 * {
 *   unitScope, dateScope: { from, lookbackDays },
 *   gaps: [{ date, stayNights, unit, uniqueComps, obsCount }]  (max 15),
 *   recentAutopilotRuns: [{ id, status, startedAt, comps, recs }]  (max 5),
 *   recentResearchRuns: [{ id, unit, status, startedAt, saved }]  (max 5)
 * }
 */
export function gatherDataCoverageEvidence(db, unit) {
  const { db: dbLib } = getPricingLib();
  const cutoff = defaultDateFrom();

  const gaps = dbLib.getMarketDataGaps(db, {
    unitId: unit || undefined, minComps: 3, dateFrom: cutoff,
  });
  const autopilotRuns = dbLib.getAutopilotRuns(db, LOOKBACK_DAYS);
  const { runs: researchRuns } = dbLib.getResearchRuns(db, { limit: 5, status: 'completed' });

  return {
    unitScope: unitScopeLabel(unit),
    dateScope: { from: cutoff, label: `last ${LOOKBACK_DAYS} days` },
    gaps: gaps.slice(0, 15).map(g => ({
      date: g.check_date, stayNights: g.stay_nights,
      unit: g.comp_unit, uniqueComps: g.unique_comps, obsCount: g.obs_count,
    })),
    recentAutopilotRuns: (autopilotRuns || []).slice(0, 5).map(r => ({
      id: r.id, status: r.status, startedAt: r.started_at,
      comps: r.comps_found, recs: r.recs_written,
    })),
    recentResearchRuns: researchRuns.slice(0, 5).map(r => ({
      id: r.id, unit: r.comp_unit, status: r.status,
      startedAt: r.started_at, saved: r.listings_saved,
    })),
  };
}

/**
 * Runs-for-month evidence: all runs covering a target month.
 *
 * Payload shape:
 * {
 *   unitScope, month,
 *   runs: [{ runId, type, startedAt, status, obsCount, units }]  (max 30)
 * }
 */
export function gatherRunsForMonthEvidence(db, unit, month) {
  const { db: dbLib } = getPricingLib();

  // Default: current month if none specified
  if (!month) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const runs = dbLib.getRunsForMonth(db, month, { unitId: unit || undefined });

  return {
    unitScope: unitScopeLabel(unit),
    month,
    runs: runs.slice(0, 30).map(r => ({
      runId: r.run_id, type: r.type, startedAt: r.started_at,
      status: r.status, obsCount: r.obs_count, units: r.units_processed,
    })),
  };
}

/**
 * Cheapest competitors by stay length — who offers the best deals?
 *
 * Payload shape:
 * {
 *   unitScope, dateScope: { from, lookbackDays },
 *   stayNights,
 *   units: [{
 *     unitId,
 *     cheapest: [{ name, active, bedrooms, rating, avgTcpn, minTcpn, obs, unavailPct }]  (max 10)
 *   }]
 * }
 */
export function gatherCheapestByStayLength(db, unit, nights = 2, dateRange = null) {
  const { db: dbLib } = getPricingLib();
  const units = resolveUnits(unit);
  const scope = resolveDateScope(dateRange);

  const unitResults = units.map(unitId => {
    const rows = dbLib.getCompPriceAndAvailComparison(db, unitId, {
      dateFrom: scope.dateFrom, dateTo: scope.dateTo, stayNights: nights, limit: 15,
    });
    return {
      unitId,
      cheapest: rows.map(r => ({
        name: (r.name || '').substring(0, 30),
        url: r.url || null,
        active: !!r.active,
        bedrooms: r.bedrooms,
        rating: r.rating,
        avgTcpn: r.avg_tcpn,
        minTcpn: r.min_tcpn,
        obs: r.obs_count,
        unavailPct: r.unavailable_pct,
      })),
    };
  });

  return {
    unitScope: unitScopeLabel(unit),
    dateScope: { from: scope.dateFrom, to: scope.dateTo, label: scope.label },
    stayNights: nights,
    units: unitResults,
  };
}

/**
 * Booked vs available competitor analysis — who's getting booked?
 *
 * Uses calendar_availability (primary) for real booking data,
 * with run_observations fallback for pricing context.
 *
 * Payload shape:
 * {
 *   unitScope, dateScope,
 *   dataSource: 'calendar' | 'observations',
 *   units: [{
 *     unitId,
 *     highOccupancy: [{ name, url, bookedPct, bookedDates, totalDates, datesTracked }]  (bookedPct > 30, max 10)
 *     lowOccupancy: [{ name, url, bookedPct, bookedDates, totalDates, datesTracked }]   (bookedPct < 15, max 10)
 *     avgBookedPct, compCount
 *   }]
 * }
 */
export function gatherBookedVsAvailableEvidence(db, unit, dateRange = null) {
  const { db: dbLib } = getPricingLib();
  const units = resolveUnits(unit);
  const scope = resolveDateScope(dateRange);

  let dataSource = 'calendar';
  const unitResults = units.map(unitId => {
    // Primary: calendar_availability (real booking data)
    const calComps = dbLib.getCalendarBookingSummary(db, unitId, {
      dateFrom: scope.dateFrom, dateTo: scope.dateTo, limit: 25,
    });

    if (calComps.length > 0) {
      const totalDates = calComps.reduce((s, r) => s + r.total_dates, 0);
      const totalBooked = calComps.reduce((s, r) => s + r.booked_dates, 0);

      const mapRow = r => ({
        name: (r.name || '').substring(0, 30),
        url: r.url || r.listing_url || null,
        bookedPct: r.booked_pct,
        bookedDates: r.booked_dates,
        totalDates: r.total_dates,
        datesTracked: r.dates_tracked,
      });

      return {
        unitId,
        compCount: calComps.length,
        highOccupancy: calComps.filter(r => r.booked_pct > 30).slice(0, 10).map(mapRow),
        lowOccupancy: calComps.filter(r => r.booked_pct < 15).slice(0, 10).map(mapRow),
        avgBookedPct: totalDates > 0 ? Math.round(1000 * totalBooked / totalDates) / 10 : 0,
      };
    }

    // Fallback: run_observations
    dataSource = 'observations';
    const comps = dbLib.getCompPriceAndAvailComparison(db, unitId, {
      dateFrom: scope.dateFrom, dateTo: scope.dateTo, stayNights: null, limit: 30,
    });
    const totalObs = comps.reduce((s, r) => s + r.obs_count, 0);
    const totalUnavail = comps.reduce((s, r) => s + r.unavailable_count, 0);

    const mapRow = r => ({
      name: (r.name || '').substring(0, 30),
      url: r.url || null,
      bookedPct: r.unavailable_pct,
      bookedDates: r.unavailable_count,
      totalDates: r.obs_count,
      datesTracked: 0,
    });

    return {
      unitId,
      compCount: comps.length,
      highOccupancy: comps.filter(r => r.unavailable_pct > 30).slice(0, 10).map(mapRow),
      lowOccupancy: comps.filter(r => r.unavailable_pct < 15).slice(0, 10).map(mapRow),
      avgBookedPct: totalObs > 0 ? Math.round(1000 * totalUnavail / totalObs) / 10 : 0,
    };
  });

  return {
    unitScope: unitScopeLabel(unit),
    dateScope: { from: scope.dateFrom, to: scope.dateTo, label: scope.label },
    dataSource,
    units: unitResults,
  };
}

/**
 * Cross-competitor comparison evidence. Per-unit when both are queried.
 *
 * Payload shape:
 * {
 *   unitScope, dateScope: { from, lookbackDays },
 *   units: [{
 *     unitId,
 *     competitors: [{ name, active, bedrooms, rating, avgTcpn, minTcpn, maxTcpn,
 *       unavailPct, latestRate, runs }]  (max 12),
 *     reliability: { repeatComps, totalComps, pctRepeat } | null
 *   }]
 * }
 */
export function gatherComparisonEvidence(db, unit, dateRange = null) {
  const { db: dbLib, compTimeline } = getPricingLib();
  const units = resolveUnits(unit);
  const scope = resolveDateScope(dateRange);

  const unitResults = units.map(unitId => {
    const rows = dbLib.getCompPriceAndAvailComparison(db, unitId, {
      dateFrom: scope.dateFrom, dateTo: scope.dateTo, limit: 20,
    });

    let reliability = null;
    try {
      reliability = compTimeline.getRepeatCompStats(db, unitId);
    } catch { /* ok */ }

    return {
      unitId,
      competitors: rows.map(r => ({
        name: (r.name || '').substring(0, 30),
        url: r.url || null,
        active: !!r.active,
        bedrooms: r.bedrooms,
        rating: r.rating,
        avgTcpn: r.avg_tcpn,
        minTcpn: r.min_tcpn,
        maxTcpn: r.max_tcpn,
        unavailPct: r.unavailable_pct,
        latestRate: r.latest_rate,
        runs: r.runs_observed,
      })),
      reliability: reliability ? {
        repeatComps: reliability.repeatComps,
        totalComps: reliability.totalComps,
        pctRepeat: reliability.pctRepeat,
      } : null,
    };
  });

  return {
    unitScope: unitScopeLabel(unit),
    dateScope: { from: scope.dateFrom, to: scope.dateTo, label: scope.label },
    units: unitResults,
  };
}
