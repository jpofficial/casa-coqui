const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use process.cwd() so both CLI scripts and Next.js API routes
// (where webpack rewrites __dirname to .next/server/...) hit the same file.
const DB_PATH = path.join(process.cwd(), 'tools', 'pricing', 'pricing.db');
const SCHEMA_PATH = path.join(process.cwd(), 'tools', 'pricing', 'schema.sql');

let _db = null;

/** Get or create the database connection */
function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

/** Initialize database from schema.sql */
function initDb() {
  const db = getDb();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  return db;
}

/** Close the database connection */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Log a collection action */
function logAction(action, details = {}) {
  const db = getDb();
  db.prepare('INSERT INTO collection_log (action, details) VALUES (?, ?)').run(
    action,
    JSON.stringify(details)
  );
}

/** Get a competitor by ID or name */
function getCompetitor(idOrName) {
  const db = getDb();
  if (typeof idOrName === 'number' || /^\d+$/.test(idOrName)) {
    return db.prepare('SELECT * FROM competitors WHERE id = ?').get(Number(idOrName));
  }
  return db.prepare('SELECT * FROM competitors WHERE name LIKE ?').get(`%${idOrName}%`);
}

/** Get all active competitors for a unit */
function getCompetitorsForUnit(unitId) {
  const db = getDb();
  return db.prepare('SELECT * FROM competitors WHERE comp_unit = ? AND active = 1').all(unitId);
}

/** Check if a holiday exists for a date */
function getHoliday(date) {
  const db = getDb();
  return db.prepare('SELECT * FROM holidays WHERE date = ?').get(date);
}

/** Get snapshots_v2 for a unit+date, optionally filtered by stay_nights */
function getCompSnapshotsV2(db, unitId, date, stayNights) {
  const comps = getCompetitorsForUnit(unitId);
  if (comps.length === 0) return [];
  const compIds = comps.map(c => c.id);
  const placeholders = compIds.map(() => '?').join(',');

  let query = `
    SELECT sv.*, c.name as comp_name, c.cleaning_fee as comp_cleaning_fee
    FROM snapshots_v2 sv
    JOIN competitors c ON sv.competitor_id = c.id
    WHERE sv.competitor_id IN (${placeholders})
      AND sv.check_date = ?
      AND sv.available = 1
  `;
  const params = [...compIds, date];

  if (stayNights != null) {
    query += ' AND sv.stay_nights = ?';
    params.push(stayNights);
  }

  return db.prepare(query).all(...params);
}

/** Save a recommendation_v2 record (upsert) */
function saveRecommendationV2(db, rec, runId = null) {
  db.prepare(`
    INSERT INTO recommendations_v2 (unit_id, check_date, day_type, season,
      tcpn_1n, tcpn_2n, tcpn_3n, tcpn_4n, tcpn_7n,
      rec_nightly_rate, rec_weekly_pct, rec_monthly_pct,
      floor_price, target_price, stretch_price,
      your_rate, your_tcpn, percentile, verdict, reasoning,
      confidence, comp_count, demand_signal, holiday_adjusted, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id, check_date) DO UPDATE SET
      day_type=excluded.day_type, season=excluded.season,
      tcpn_1n=excluded.tcpn_1n, tcpn_2n=excluded.tcpn_2n,
      tcpn_3n=excluded.tcpn_3n, tcpn_4n=excluded.tcpn_4n,
      tcpn_7n=excluded.tcpn_7n,
      rec_nightly_rate=excluded.rec_nightly_rate,
      rec_weekly_pct=excluded.rec_weekly_pct,
      rec_monthly_pct=excluded.rec_monthly_pct,
      floor_price=excluded.floor_price, target_price=excluded.target_price,
      stretch_price=excluded.stretch_price,
      your_rate=excluded.your_rate, your_tcpn=excluded.your_tcpn,
      percentile=excluded.percentile, verdict=excluded.verdict,
      reasoning=excluded.reasoning, confidence=excluded.confidence,
      comp_count=excluded.comp_count, demand_signal=excluded.demand_signal,
      holiday_adjusted=excluded.holiday_adjusted,
      run_id=excluded.run_id,
      generated_at=datetime('now')
  `).run(
    rec.unitId, rec.checkDate, rec.dayType, rec.season,
    rec.tcpn_1n, rec.tcpn_2n, rec.tcpn_3n, rec.tcpn_4n, rec.tcpn_7n,
    rec.recNightlyRate, rec.recWeeklyPct, rec.recMonthlyPct,
    rec.floor, rec.target, rec.stretch,
    rec.yourRate, rec.yourTcpn, rec.percentile, rec.verdict, rec.reasoning,
    rec.confidence, rec.compCount, rec.demandSignal, rec.holidayAdjusted ? 1 : 0,
    runId
  );
}

/** Get all seasons from DB, fallback to hardcoded PR defaults */
function getSeasons(db) {
  const rows = db.prepare('SELECT * FROM seasons ORDER BY start_month').all();
  return rows;
}

/** Get latest autopilot run */
function getLatestAutopilotRun(db) {
  return db.prepare('SELECT * FROM autopilot_runs ORDER BY started_at DESC LIMIT 1').get();
}

/** Get recommendations_v2 for a unit, next N days */
function getRecommendationsV2(db, unitId, days = 30) {
  const today = new Date().toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM recommendations_v2
    WHERE unit_id = ? AND check_date >= ?
    ORDER BY check_date ASC
    LIMIT ?
  `).all(unitId, today, days);
}

/**
 * Get all recommendations for a unit within a calendar month.
 * @param {Database} db
 * @param {string} unitId  e.g. 'unit-a'
 * @param {string} month   'YYYY-MM'
 * @returns {Array<Object>} recommendations_v2 rows sorted by check_date
 */
function getRecommendationsForMonth(db, unitId, month) {
  return db.prepare(`
    SELECT * FROM recommendations_v2
    WHERE unit_id = ? AND check_date LIKE ?
    ORDER BY check_date ASC
  `).all(unitId, `${month}-%`);
}

/**
 * Get a single recommendation row for (unit, date).
 * @returns {Object|null}
 */
function getRecommendationForDate(db, unitId, checkDate) {
  return db.prepare(`
    SELECT * FROM recommendations_v2
    WHERE unit_id = ? AND check_date = ?
    LIMIT 1
  `).get(unitId, checkDate) || null;
}

/**
 * For a unit + date, return how many active comps are tracked and how many are booked.
 * Uses the latest available calendar_availability per (competitor, date).
 * @returns {{ total: number, booked: number, pct: number }}
 */
function getCompBookedSummaryForDate(db, unitId, date) {
  const rows = db.prepare(`
    SELECT ca.display_status
    FROM calendar_availability ca
    JOIN competitors c ON c.id = ca.competitor_id
    WHERE c.comp_unit = ? AND c.active = 1 AND ca.date = ?
    AND ca.id IN (
      SELECT MAX(id) FROM calendar_availability
      WHERE date = ?
      GROUP BY competitor_id
    )
  `).all(unitId, date, date);
  const total = rows.length;
  const booked = rows.filter(r => r.display_status === 'not_available').length;
  const pct = total === 0 ? 0 : Math.round((booked / total) * 100);
  return { total, booked, pct };
}

/**
 * Top N competitors for a unit on a given date, by nightly rate desc.
 * Joins snapshots_v2 (for price) with calendar_availability (for booked flag).
 * @param {Object} opts { stayNights=2, limit=5 }
 * @returns {Array<{ airbnb_id, name, bedrooms, nightly_rate, booked, listing_url }>}
 */
function getTopCompsForDate(db, unitId, date, { stayNights = 2, limit = 5 } = {}) {
  return db.prepare(`
    SELECT
      c.airbnb_id,
      c.name,
      c.bedrooms,
      c.url AS listing_url,
      s.nightly_rate,
      COALESCE(ca.display_status, 'unknown') AS status
    FROM competitors c
    LEFT JOIN snapshots_v2 s ON s.competitor_id = c.id AND s.check_date = ? AND s.stay_nights = ?
    LEFT JOIN calendar_availability ca ON ca.competitor_id = c.id AND ca.date = ?
      AND ca.id = (SELECT MAX(id) FROM calendar_availability WHERE competitor_id = c.id AND date = ?)
    WHERE c.comp_unit = ? AND c.active = 1
    ORDER BY s.nightly_rate DESC NULLS LAST
    LIMIT ?
  `).all(date, stayNights, date, date, unitId, limit).map(r => ({
    airbnb_id: r.airbnb_id,
    name: r.name,
    bedrooms: r.bedrooms,
    listing_url: r.listing_url,
    nightly_rate: r.nightly_rate,
    booked: r.status === 'not_available',
  })).filter(r => r.nightly_rate != null);
}

/**
 * Most recent autopilot run summary (for UI meta lines).
 * @returns {Object|null}
 */
function getLatestRunMeta(db) {
  return db.prepare(`
    SELECT id, started_at, status, trigger, comps_active, recs_written
    FROM autopilot_runs
    ORDER BY started_at DESC
    LIMIT 1
  `).get() || null;
}

/**
 * Summarize the active comp set for a unit.
 * Used for page-header meta lines and the side-panel "Comp set" row.
 * @returns {{ count:number, minBedrooms:number|null, maxBedrooms:number|null, avgBedrooms:number|null }}
 */
function getCompSetSummaryForUnit(db, unitId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count, MIN(bedrooms) AS minBedrooms, MAX(bedrooms) AS maxBedrooms, AVG(bedrooms) AS avgBedrooms
    FROM competitors
    WHERE comp_unit = ? AND active = 1
  `).get(unitId);
  if (!row || row.count === 0) return { count: 0, minBedrooms: null, maxBedrooms: null, avgBedrooms: null };
  return {
    count: row.count,
    minBedrooms: row.minBedrooms,
    maxBedrooms: row.maxBedrooms,
    avgBedrooms: row.avgBedrooms == null ? null : Math.round(row.avgBedrooms * 10) / 10,
  };
}

/**
 * Purge only snapshots_v2 for a unit's competitors.
 */
function purgeUnitSnapshots(db, unitId) {
  const comps = db.prepare('SELECT id FROM competitors WHERE comp_unit = ?').all(unitId);
  const compIds = comps.map(c => c.id);
  if (compIds.length === 0) return 0;
  const placeholders = compIds.map(() => '?').join(',');
  return db.prepare(`DELETE FROM snapshots_v2 WHERE competitor_id IN (${placeholders})`).run(...compIds).changes;
}

/**
 * Purge only recommendations_v2 for a unit.
 */
function purgeUnitRecommendations(db, unitId) {
  return db.prepare('DELETE FROM recommendations_v2 WHERE unit_id = ?').run(unitId).changes;
}

/**
 * Record a rate change in my_rates_history (append-only).
 * Call this whenever my_rates is upserted.
 */
function recordRateHistory(db, unitId, checkDate, nightlyRate, cleaningFee, tcpn, isBooked, runId = null) {
  db.prepare(`
    INSERT INTO my_rates_history (unit_id, check_date, nightly_rate, cleaning_fee, tcpn, is_booked, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(unitId, checkDate, nightlyRate, cleaningFee || 0, tcpn, isBooked ? 1 : 0, runId);
}

/**
 * Archive market data to history tables (append-only).
 * Called after ANALYZE phase — captures current snapshots + recommendations
 * before the next scrape purges them.
 */
function archiveMarketData(db, unitId, runId, scrapedAt) {
  const comps = db.prepare('SELECT id FROM competitors WHERE comp_unit = ? AND active = 1').all(unitId);
  const compIds = comps.map(c => c.id);
  if (compIds.length === 0) return { historyRows: 0, availRows: 0 };

  const placeholders = compIds.map(() => '?').join(',');

  // 1. Archive availability_log from current snapshots_v2
  // Use best available stay_nights (prefer 2n, fall back to shortest available)
  const bestStay = db.prepare(`
    SELECT MIN(stay_nights) as sn FROM snapshots_v2
    WHERE competitor_id IN (${placeholders}) AND stay_nights IN (2, 4, 5, 7)
  `).get(...compIds);
  const archiveStayNights = bestStay?.sn || 2;

  const snapshots = db.prepare(`
    SELECT competitor_id, check_date, available, nightly_rate, tcpn
    FROM snapshots_v2
    WHERE competitor_id IN (${placeholders}) AND stay_nights = ?
  `).all(...compIds, archiveStayNights);

  const insertAvail = db.prepare(`
    INSERT INTO availability_log (competitor_id, check_date, scraped_at, run_id, available, nightly_rate, tcpn_2n)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(competitor_id, check_date, run_id) DO UPDATE SET
      available=excluded.available, nightly_rate=excluded.nightly_rate, tcpn_2n=excluded.tcpn_2n
  `);

  const insertAvailMany = db.transaction((rows) => {
    for (const r of rows) {
      insertAvail.run(r.competitor_id, r.check_date, scrapedAt, runId, r.available, r.nightly_rate, r.tcpn);
    }
  });
  insertAvailMany(snapshots);

  // 2. Archive market_history from current recommendations_v2 + snapshot aggregates
  const recs = db.prepare(`
    SELECT * FROM recommendations_v2 WHERE unit_id = ?
  `).all(unitId);

  const insertHistory = db.prepare(`
    INSERT INTO market_history (
      unit_id, run_id, check_date, scraped_at,
      comp_count_total, comp_count_avail,
      median_tcpn_2n, p25_tcpn_2n, p75_tcpn_2n,
      mean_nightly, min_nightly, max_nightly,
      rec_nightly_rate, floor_price, target_price, stretch_price,
      your_rate, your_tcpn, percentile,
      verdict, confidence, season, day_type, demand_signal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id, run_id, check_date) DO UPDATE SET
      comp_count_total=excluded.comp_count_total, comp_count_avail=excluded.comp_count_avail,
      median_tcpn_2n=excluded.median_tcpn_2n, p25_tcpn_2n=excluded.p25_tcpn_2n,
      p75_tcpn_2n=excluded.p75_tcpn_2n,
      mean_nightly=excluded.mean_nightly, min_nightly=excluded.min_nightly,
      max_nightly=excluded.max_nightly,
      rec_nightly_rate=excluded.rec_nightly_rate, floor_price=excluded.floor_price,
      target_price=excluded.target_price, stretch_price=excluded.stretch_price,
      your_rate=excluded.your_rate, your_tcpn=excluded.your_tcpn,
      percentile=excluded.percentile, verdict=excluded.verdict,
      confidence=excluded.confidence, season=excluded.season,
      day_type=excluded.day_type, demand_signal=excluded.demand_signal
  `);

  const insertHistoryMany = db.transaction((rows) => {
    for (const r of rows) {
      // Get snapshot aggregates for this date
      const dateSnapshots = db.prepare(`
        SELECT nightly_rate, tcpn, available
        FROM snapshots_v2
        WHERE competitor_id IN (${placeholders}) AND check_date = ? AND stay_nights = 2
      `).all(...compIds, r.check_date);

      const availSnapshots = dateSnapshots.filter(s => s.available);
      const rates = availSnapshots.map(s => s.nightly_rate).filter(Boolean).sort((a, b) => a - b);
      const tcpns = availSnapshots.map(s => s.tcpn).filter(Boolean).sort((a, b) => a - b);

      const median = tcpns.length > 0 ? tcpns[Math.floor(tcpns.length / 2)] : null;
      const p25 = tcpns.length >= 4 ? tcpns[Math.floor(tcpns.length * 0.25)] : (tcpns[0] || null);
      const p75 = tcpns.length >= 4 ? tcpns[Math.floor(tcpns.length * 0.75)] : (tcpns[tcpns.length - 1] || null);
      const mean = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
      const min = rates.length > 0 ? rates[0] : null;
      const max = rates.length > 0 ? rates[rates.length - 1] : null;

      insertHistory.run(
        unitId, runId, r.check_date, scrapedAt,
        dateSnapshots.length, availSnapshots.length,
        median, p25, p75, mean, min, max,
        r.rec_nightly_rate, r.floor_price, r.target_price, r.stretch_price,
        r.your_rate, r.your_tcpn, r.percentile,
        r.verdict, r.confidence, r.season, r.day_type, r.demand_signal
      );
    }
  });
  insertHistoryMany(recs);

  return { historyRows: recs.length, availRows: snapshots.length };
}

/**
 * Get market history for trend analysis.
 * Returns data points grouped by check_date across multiple runs.
 */
function getMarketHistory(db, unitId, days = 30) {
  const today = new Date().toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM market_history
    WHERE unit_id = ? AND check_date >= ?
    ORDER BY check_date ASC, scraped_at ASC
  `).all(unitId, today);
}

/**
 * Get availability history for a unit's competitors.
 */
function getAvailabilityHistory(db, unitId, days = 30) {
  const today = new Date().toISOString().split('T')[0];
  const comps = db.prepare('SELECT id FROM competitors WHERE comp_unit = ? AND active = 1').all(unitId);
  const compIds = comps.map(c => c.id);
  if (compIds.length === 0) return [];
  const placeholders = compIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT al.*, c.name as comp_name
    FROM availability_log al
    JOIN competitors c ON al.competitor_id = c.id
    WHERE al.competitor_id IN (${placeholders}) AND al.check_date >= ?
    ORDER BY al.check_date ASC, al.scraped_at ASC
  `).all(...compIds, today);
}

/**
 * Get all autopilot runs within a date range.
 */
function getAutopilotRuns(db, days = 90) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT * FROM autopilot_runs
    WHERE started_at >= ? AND status = 'completed'
    ORDER BY started_at ASC
  `).all(cutoff);
}

/** Get paginated run list from run_summary view */
function getRunList(db, { limit = 20, offset = 0, status = null } = {}) {
  let query = 'SELECT * FROM run_summary';
  const params = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const runs = db.prepare(query).all(...params);

  let countQuery = 'SELECT COUNT(*) as total FROM autopilot_runs';
  const countParams = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const { total } = db.prepare(countQuery).get(...countParams);

  return { runs, total };
}

/** Get a single run by ID from run_summary view */
function getRunById(db, id) {
  return db.prepare('SELECT * FROM run_summary WHERE id = ?').get(id) || null;
}

/** Get verdict breakdown for a run + unit */
function getRunRecSummary(db, runId, unitId) {
  return db.prepare(`
    SELECT verdict, COUNT(*) as count,
      ROUND(AVG(rec_nightly_rate), 2) as avg_rate,
      ROUND(AVG(confidence), 1) as avg_confidence
    FROM recommendations_v2
    WHERE run_id = ? AND unit_id = ?
    GROUP BY verdict
    ORDER BY count DESC
  `).all(runId, unitId);
}

/** Get market summary aggregates for a run */
function getRunMarketSummary(db, runId) {
  return db.prepare(`
    SELECT unit_id,
      COUNT(*) as dates_covered,
      ROUND(AVG(median_tcpn_2n), 2) as avg_median_tcpn,
      ROUND(AVG(comp_count_avail), 1) as avg_comps_available,
      ROUND(AVG(percentile), 1) as avg_percentile
    FROM market_history
    WHERE run_id = ?
    GROUP BY unit_id
  `).all(runId);
}

/**
 * Batch INSERT observations into run_observations (transaction).
 * Each observation: { runId, runSource, compUnit, competitorId, airbnbId,
 *   listingName, listingUrl, bedrooms, bathrooms, rating, reviewCount,
 *   superhost, checkDate, stayNights, nightlyRate, cleaningFee, totalCost, tcpn, available }
 */
function saveRunObservations(db, observations) {
  if (!observations || observations.length === 0) return 0;

  const insert = db.prepare(`
    INSERT INTO run_observations (
      run_id, run_source, comp_unit, competitor_id, airbnb_id,
      listing_name, listing_url, bedrooms, bathrooms, rating, review_count, superhost,
      check_date, stay_nights, nightly_rate, cleaning_fee, total_cost, tcpn, available, day_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, run_source, competitor_id, check_date, stay_nights) DO UPDATE SET
      nightly_rate=excluded.nightly_rate, cleaning_fee=excluded.cleaning_fee,
      total_cost=excluded.total_cost, tcpn=excluded.tcpn, available=excluded.available,
      day_type=excluded.day_type
  `);

  const insertMany = db.transaction((rows) => {
    for (const o of rows) {
      insert.run(
        o.runId, o.runSource || 'autopilot', o.compUnit, o.competitorId, o.airbnbId,
        o.listingName || null, o.listingUrl || null,
        o.bedrooms || null, o.bathrooms || null, o.rating || null,
        o.reviewCount || null, o.superhost ? 1 : 0,
        o.checkDate, o.stayNights, o.nightlyRate || null,
        o.cleaningFee || 0, o.totalCost || null, o.tcpn || null, o.available != null ? o.available : 1,
        o.dayType || null
      );
    }
  });

  insertMany(observations);
  return observations.length;
}

/** Get all raw observations for a run */
function getRunObservations(db, runId, runSource = 'autopilot', limit = 200) {
  return db.prepare(`
    SELECT * FROM run_observations
    WHERE run_id = ? AND run_source = ?
    ORDER BY comp_unit, listing_name, check_date, stay_nights
    LIMIT ?
  `).all(runId, runSource, limit);
}

/** Per-listing aggregates for a run: avg/min/max rate, obs count, stay lengths */
function getRunListingsSummary(db, runId, runSource = 'autopilot') {
  return db.prepare(`
    SELECT
      competitor_id, airbnb_id, listing_name, listing_url, comp_unit,
      bedrooms, bathrooms, rating, review_count, superhost,
      COUNT(*) as obs_count,
      GROUP_CONCAT(DISTINCT stay_nights) as stay_lengths,
      ROUND(AVG(nightly_rate), 2) as avg_rate,
      ROUND(MIN(nightly_rate), 2) as min_rate,
      ROUND(MAX(nightly_rate), 2) as max_rate,
      ROUND(AVG(tcpn), 2) as avg_tcpn
    FROM run_observations
    WHERE run_id = ? AND run_source = ?
    GROUP BY competitor_id
    ORDER BY comp_unit, listing_name
  `).all(runId, runSource);
}

/**
 * Compare a run vs the previous completed run.
 * Returns { current, previous, deltas } with key metric deltas.
 */
function getRunComparison(db, runId) {
  // Get current run
  const current = db.prepare('SELECT * FROM autopilot_runs WHERE id = ?').get(runId);
  if (!current) return null;

  // Get previous completed run
  const previous = db.prepare(`
    SELECT * FROM autopilot_runs
    WHERE id < ? AND status = 'completed'
    ORDER BY id DESC LIMIT 1
  `).get(runId);

  if (!previous) return { current: summarizeRun(db, current), previous: null, deltas: null };

  const currentSummary = summarizeRun(db, current);
  const previousSummary = summarizeRun(db, previous);

  const deltas = {};
  for (const key of ['medianTcpn', 'avgPercentile', 'compsActive', 'avgRate', 'listingCount']) {
    if (currentSummary[key] != null && previousSummary[key] != null) {
      deltas[key] = Math.round((currentSummary[key] - previousSummary[key]) * 100) / 100;
    }
  }

  return { current: currentSummary, previous: previousSummary, deltas };
}

/** Helper: summarize a run using market_history + run_observations */
function summarizeRun(db, run) {
  const mh = db.prepare(`
    SELECT
      ROUND(AVG(median_tcpn_2n), 2) as median_tcpn,
      ROUND(AVG(percentile), 1) as avg_percentile,
      ROUND(AVG(mean_nightly), 2) as avg_rate,
      ROUND(AVG(comp_count_avail), 1) as comps_active
    FROM market_history WHERE run_id = ?
  `).get(run.id);

  // Count unique listings from observations (if available)
  let listingCount = 0;
  try {
    const obs = db.prepare(
      'SELECT COUNT(DISTINCT competitor_id) as n FROM run_observations WHERE run_id = ? AND run_source = ?'
    ).get(run.id, 'autopilot');
    listingCount = obs ? obs.n : 0;
  } catch { /* table may not exist for older runs */ }

  return {
    runId: run.id,
    startedAt: run.started_at,
    medianTcpn: mh ? mh.median_tcpn : null,
    avgPercentile: mh ? mh.avg_percentile : null,
    avgRate: mh ? mh.avg_rate : null,
    compsActive: mh ? mh.comps_active : null,
    listingCount,
  };
}

/**
 * Batch INSERT calendar availability rows (transaction).
 * Each row: { runId, runSource, competitorId, airbnbId, listingName, listingUrl,
 *   date, rawStatus, displayStatus, minNights, maxNights,
 *   availableForCheckin, availableForCheckout }
 */
function saveCalendarAvailability(db, rows) {
  if (!rows || rows.length === 0) return 0;

  const insert = db.prepare(`
    INSERT INTO calendar_availability (
      run_id, run_source, competitor_id, airbnb_id, listing_name, listing_url,
      date, raw_status, display_status, min_nights, max_nights,
      available_for_checkin, available_for_checkout
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, run_source, competitor_id, date) DO UPDATE SET
      raw_status=excluded.raw_status, display_status=excluded.display_status,
      min_nights=excluded.min_nights, max_nights=excluded.max_nights,
      available_for_checkin=excluded.available_for_checkin,
      available_for_checkout=excluded.available_for_checkout,
      captured_at=datetime('now')
  `);

  const insertMany = db.transaction((items) => {
    for (const r of items) {
      insert.run(
        r.runId, r.runSource || 'research', r.competitorId, r.airbnbId,
        r.listingName || null, r.listingUrl || null,
        r.date, r.rawStatus || 'unknown', r.displayStatus || 'not_available',
        r.minNights || null, r.maxNights || null,
        r.availableForCheckin ? 1 : 0, r.availableForCheckout ? 1 : 0
      );
    }
  });

  insertMany(rows);
  return rows.length;
}

/**
 * Get calendar availability summary: per-listing/month aggregates.
 */
function getCalendarSummary(db, runId, runSource) {
  return db.prepare(`
    SELECT competitor_id, airbnb_id, listing_name,
      strftime('%Y-%m', date) AS month,
      SUM(CASE WHEN display_status = 'available' THEN 1 ELSE 0 END) AS available_nights,
      SUM(CASE WHEN display_status = 'not_available' THEN 1 ELSE 0 END) AS not_available_nights,
      SUM(CASE WHEN display_status = 'not_available'
           AND CAST(strftime('%w', date) AS INTEGER) IN (5, 6)
           THEN 1 ELSE 0 END) AS weekend_not_available_nights
    FROM calendar_availability
    WHERE run_id = ? AND run_source = ?
    GROUP BY competitor_id, airbnb_id, month
    ORDER BY listing_name, month
  `).all(runId, runSource);
}

/**
 * Get coverage stats per (run_id, run_source) for a date range.
 * Returns a Map keyed by "run_id:run_source" → { obsInRange, uniqueComps, datesCovered }.
 */
function getRunCoverageStats(db, dateFrom, dateTo) {
  const map = new Map();

  // run_observations: check_date BETWEEN dateFrom AND dateTo
  const obsRows = db.prepare(`
    SELECT run_id, run_source,
      COUNT(*) as obs_in_range,
      COUNT(DISTINCT competitor_id) as unique_comps,
      COUNT(DISTINCT check_date) as dates_covered
    FROM run_observations
    WHERE check_date BETWEEN ? AND ?
    GROUP BY run_id, run_source
  `).all(dateFrom, dateTo);

  for (const r of obsRows) {
    map.set(`${r.run_id}:${r.run_source}`, {
      obsInRange: r.obs_in_range,
      uniqueComps: r.unique_comps,
      datesCovered: r.dates_covered,
    });
  }

  // calendar_availability: date BETWEEN dateFrom AND dateTo (research runs)
  const calRows = db.prepare(`
    SELECT run_id, run_source,
      COUNT(*) as obs_in_range,
      COUNT(DISTINCT competitor_id) as unique_comps,
      COUNT(DISTINCT date) as dates_covered
    FROM calendar_availability
    WHERE date BETWEEN ? AND ?
    GROUP BY run_id, run_source
  `).all(dateFrom, dateTo);

  for (const r of calRows) {
    const key = `${r.run_id}:${r.run_source}`;
    if (map.has(key)) {
      // Merge — take the max of each stat
      const existing = map.get(key);
      existing.obsInRange += r.obs_in_range;
      existing.uniqueComps = Math.max(existing.uniqueComps, r.unique_comps);
      existing.datesCovered = Math.max(existing.datesCovered, r.dates_covered);
    } else {
      map.set(key, {
        obsInRange: r.obs_in_range,
        uniqueComps: r.unique_comps,
        datesCovered: r.dates_covered,
      });
    }
  }

  return map;
}

/** Get paginated research runs */
function getResearchRuns(db, { limit = 20, offset = 0, status = null } = {}) {
  let query = 'SELECT * FROM research_runs';
  const params = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const runs = db.prepare(query).all(...params);

  let countQuery = 'SELECT COUNT(*) as total FROM research_runs';
  const countParams = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const { total } = db.prepare(countQuery).get(...countParams);

  return { runs, total };
}

// ---------------------------------------------------------------------------
// Batch capture CRUD
// ---------------------------------------------------------------------------

/** Create a capture batch record. Returns the new batch ID. */
function createCaptureBatch(db, opts) {
  const result = db.prepare(`
    INSERT INTO capture_batches (label, unit_id, month, anchor_dates, stay_lengths, runs_planned, config_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.label, opts.unitId, opts.month,
    JSON.stringify(opts.anchorDates || []),
    JSON.stringify(opts.stayLengths || []),
    opts.runsPlanned,
    opts.configSnapshot ? JSON.stringify(opts.configSnapshot) : null
  );
  return Number(result.lastInsertRowid);
}

/** Update a capture batch (progress, status, timing). */
function updateCaptureBatch(db, batchId, updates) {
  const allowed = ['runs_completed', 'runs_failed', 'status', 'completed_at', 'duration_ms'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(updates[key]);
    }
  }
  if (sets.length === 0) return;
  params.push(batchId);
  db.prepare(`UPDATE capture_batches SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

/** Get a single capture batch by ID. */
function getCaptureBatch(db, batchId) {
  const row = db.prepare('SELECT * FROM capture_batches WHERE id = ?').get(batchId);
  if (row) {
    try { row.anchor_dates = JSON.parse(row.anchor_dates); } catch { row.anchor_dates = []; }
    try { row.stay_lengths = JSON.parse(row.stay_lengths); } catch { row.stay_lengths = []; }
    try { row.config_snapshot = JSON.parse(row.config_snapshot); } catch { row.config_snapshot = null; }
  }
  return row || null;
}

/** List capture batches with optional filters. */
function getCaptureBatches(db, { unitId, month, status, limit = 20, offset = 0 } = {}) {
  let query = 'SELECT * FROM capture_batches WHERE 1=1';
  const params = [];
  if (unitId) { query += ' AND unit_id = ?'; params.push(unitId); }
  if (month) { query += ' AND month = ?'; params.push(month); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(query).all(...params);
}

// ---------------------------------------------------------------------------
// Historical analysis helpers
// ---------------------------------------------------------------------------

/**
 * Get all historical prices for a competitor across runs.
 * Options: { dateFrom, dateTo, stayNights }
 */
function getCompPriceHistory(db, competitorId, opts = {}) {
  let query = `
    SELECT ro.*, c.name, c.comp_unit
    FROM run_observations ro
    JOIN competitors c ON ro.competitor_id = c.id
    WHERE ro.competitor_id = ?
  `;
  const params = [competitorId];
  if (opts.dateFrom) { query += ' AND ro.check_date >= ?'; params.push(opts.dateFrom); }
  if (opts.dateTo) { query += ' AND ro.check_date <= ?'; params.push(opts.dateTo); }
  if (opts.stayNights) { query += ' AND ro.stay_nights = ?'; params.push(opts.stayNights); }
  query += ' ORDER BY ro.check_date ASC, ro.captured_at ASC';
  if (opts.limit) { query += ' LIMIT ?'; params.push(opts.limit); }
  return db.prepare(query).all(...params);
}

/**
 * Which competitors raised/lowered prices in a time window?
 * Compares earliest vs latest observation per competitor within the window.
 */
function getPriceMovementsByTimeWindow(db, unitId, days = 14) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    WITH ranked AS (
      SELECT competitor_id, check_date, stay_nights, tcpn, captured_at,
        ROW_NUMBER() OVER (PARTITION BY competitor_id, check_date, stay_nights ORDER BY captured_at ASC) as rn_first,
        ROW_NUMBER() OVER (PARTITION BY competitor_id, check_date, stay_nights ORDER BY captured_at DESC) as rn_last
      FROM run_observations
      WHERE comp_unit = ? AND captured_at >= ? AND stay_nights = 2
    ),
    movements AS (
      SELECT
        f.competitor_id, f.check_date,
        f.tcpn as first_tcpn, l.tcpn as last_tcpn,
        ROUND(l.tcpn - f.tcpn, 2) as delta
      FROM ranked f
      JOIN ranked l ON f.competitor_id = l.competitor_id
        AND f.check_date = l.check_date AND f.stay_nights = l.stay_nights
      WHERE f.rn_first = 1 AND l.rn_last = 1 AND f.captured_at != l.captured_at
    )
    SELECT m.competitor_id, c.name, m.check_date,
      m.first_tcpn, m.last_tcpn, m.delta,
      CASE WHEN m.delta > 0 THEN 'raised' WHEN m.delta < 0 THEN 'lowered' ELSE 'unchanged' END as direction
    FROM movements m
    JOIN competitors c ON m.competitor_id = c.id
    WHERE m.delta != 0
    ORDER BY ABS(m.delta) DESC
  `).all(unitId, cutoff);
}

/**
 * Per-competitor occupancy % over a time window.
 */
function getCompOccupancyTrend(db, competitorId, days = 30) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT check_date, available, nightly_rate, tcpn_2n, scraped_at
    FROM availability_log
    WHERE competitor_id = ? AND check_date >= ?
    ORDER BY check_date ASC, scraped_at ASC
  `).all(competitorId, cutoff);
}

/**
 * Find dates with thin data coverage (few competitors captured).
 * Options: { unitId, dateFrom, dateTo, minComps = 3 }
 */
function getMarketDataGaps(db, opts = {}) {
  let query = `
    SELECT check_date, stay_nights, comp_unit,
      COUNT(DISTINCT competitor_id) AS unique_comps,
      COUNT(*) AS obs_count,
      MAX(captured_at) AS freshest
    FROM run_observations
    WHERE 1=1
  `;
  const params = [];
  if (opts.unitId) { query += ' AND comp_unit = ?'; params.push(opts.unitId); }
  if (opts.dateFrom) { query += ' AND check_date >= ?'; params.push(opts.dateFrom); }
  if (opts.dateTo) { query += ' AND check_date <= ?'; params.push(opts.dateTo); }
  query += ' GROUP BY check_date, stay_nights, comp_unit';
  query += ' HAVING unique_comps < ?';
  params.push(opts.minComps || 3);
  query += ' ORDER BY check_date ASC';
  return db.prepare(query).all(...params);
}

/**
 * Weekend vs weekday median TCPN comparison from market_history.
 */
function getWeekendPremium(db, unitId, days = 60) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT
      ROUND(AVG(CASE WHEN CAST(strftime('%w', check_date) AS INT) IN (5,6) THEN median_tcpn_2n END), 2) AS weekend_median,
      ROUND(AVG(CASE WHEN CAST(strftime('%w', check_date) AS INT) BETWEEN 1 AND 4 THEN median_tcpn_2n END), 2) AS weekday_median,
      COUNT(CASE WHEN CAST(strftime('%w', check_date) AS INT) IN (5,6) THEN 1 END) AS weekend_count,
      COUNT(CASE WHEN CAST(strftime('%w', check_date) AS INT) BETWEEN 1 AND 4 THEN 1 END) AS weekday_count
    FROM market_history
    WHERE unit_id = ? AND check_date >= ?
  `).get(unitId, cutoff);
}

// ---------------------------------------------------------------------------
// Cross-run evidence queries (for manual inspection + AI evidence retrieval)
// ---------------------------------------------------------------------------

/** Compute first day of the month AFTER the given YYYY-MM. */
function _nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return next + '-01';
}

/**
 * Per-competitor availability summary across all runs for a unit.
 * Historical by default: includes inactive competitors (they have valid past data).
 * Options: { dateFrom, dateTo, activeOnly = false }
 * Returns: [{ competitor_id, name, active, total_observations, unavailable_count,
 *   unavailable_pct, runs_observed, avg_rate_when_available }]
 */
function getCompAvailabilitySummary(db, unitId, opts = {}) {
  let query = `
    SELECT al.competitor_id, c.name, c.url, c.comp_unit, c.active,
      COUNT(*) AS total_observations,
      SUM(CASE WHEN al.available = 0 THEN 1 ELSE 0 END) AS unavailable_count,
      ROUND(100.0 * SUM(CASE WHEN al.available = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS unavailable_pct,
      COUNT(DISTINCT al.run_id) AS runs_observed,
      ROUND(AVG(CASE WHEN al.available = 1 THEN al.nightly_rate END), 2) AS avg_rate_when_available
    FROM availability_log al
    JOIN competitors c ON al.competitor_id = c.id
    WHERE c.comp_unit = ?
  `;
  const params = [unitId];
  if (opts.activeOnly) { query += ' AND c.active = 1'; }
  if (opts.dateFrom) { query += ' AND al.check_date >= ?'; params.push(opts.dateFrom); }
  if (opts.dateTo) { query += ' AND al.check_date <= ?'; params.push(opts.dateTo); }
  query += ' GROUP BY al.competitor_id ORDER BY unavailable_pct DESC';
  return db.prepare(query).all(...params);
}

/**
 * Per-run availability for a single competitor across all captured runs.
 * Returns: [{ run_id, check_date, available, nightly_rate, tcpn_2n, scraped_at }]
 * Options: { dateFrom, dateTo, limit }
 */
function getCompAvailabilityAcrossRuns(db, competitorId, opts = {}) {
  let query = `
    SELECT run_id, check_date, available, nightly_rate, tcpn_2n, scraped_at
    FROM availability_log
    WHERE competitor_id = ?
  `;
  const params = [competitorId];
  if (opts.dateFrom) { query += ' AND check_date >= ?'; params.push(opts.dateFrom); }
  if (opts.dateTo) { query += ' AND check_date <= ?'; params.push(opts.dateTo); }
  query += ' ORDER BY check_date ASC, run_id ASC';
  if (opts.limit) { query += ' LIMIT ?'; params.push(opts.limit); }
  return db.prepare(query).all(...params);
}

/**
 * All runs (autopilot + research) that cover a target month (YYYY-MM).
 * A run "covers" a month if its observations include dates in that month.
 * Options: { type: 'autopilot' | 'research' | null (both), unitId }
 * Returns: [{ run_id, type, started_at, completed_at, status, obs_count, units_processed }]
 */
function getRunsForMonth(db, month, opts = {}) {
  const monthStart = month + '-01';
  const nextMonth = _nextMonthStart(month);
  const parts = [];
  const params = [];

  if (!opts.type || opts.type === 'autopilot') {
    let subWhere = 'ro.run_source = ? AND ro.check_date >= ? AND ro.check_date < ?';
    const subParams = ['autopilot', monthStart, nextMonth];
    if (opts.unitId) { subWhere += ' AND ro.comp_unit = ?'; subParams.push(opts.unitId); }
    parts.push(`
      SELECT ar.id AS run_id, 'autopilot' AS type, ar.started_at, ar.completed_at,
        ar.status, ar.comps_found AS obs_count, ar.units_processed
      FROM autopilot_runs ar
      WHERE ar.status != 'error' AND EXISTS (
        SELECT 1 FROM run_observations ro WHERE ro.run_id = ar.id AND ${subWhere}
      )
    `);
    params.push(...subParams);
  }

  if (!opts.type || opts.type === 'research') {
    let subWhere = 'ro.run_source = ? AND ro.check_date >= ? AND ro.check_date < ?';
    const subParams = ['research', monthStart, nextMonth];
    if (opts.unitId) { subWhere += ' AND ro.comp_unit = ?'; subParams.push(opts.unitId); }
    parts.push(`
      SELECT rr.id AS run_id, 'research' AS type, rr.started_at, rr.completed_at,
        rr.status, rr.listings_saved AS obs_count, rr.comp_unit AS units_processed
      FROM research_runs rr
      WHERE rr.status != 'error' AND EXISTS (
        SELECT 1 FROM run_observations ro WHERE ro.run_id = rr.id AND ${subWhere}
      )
    `);
    params.push(...subParams);
  }

  if (parts.length === 0) return [];
  const query = parts.join(' UNION ALL ') + ' ORDER BY started_at DESC';
  return db.prepare(query).all(...params);
}

/**
 * Cross-competitor pricing + availability snapshot for a unit.
 * Historical by default: includes inactive competitors (they have valid past data).
 * Options: { dateFrom, dateTo, stayNights = 2 (null = all), limit = 20, activeOnly = false }
 * Returns: [{ competitor_id, name, url, active, bedrooms, rating, review_count, superhost,
 *   obs_count, runs_observed, avg_tcpn, min_tcpn, max_tcpn,
 *   unavailable_count, unavailable_pct, latest_rate, latest_captured }]
 */
function getCompPriceAndAvailComparison(db, unitId, opts = {}) {
  const stayNights = opts.stayNights === null ? null : (opts.stayNights || 2);
  const limit = opts.limit || 20;

  // Build optional WHERE clauses and their params separately
  let filters = '';
  const filterParams = [];
  if (opts.activeOnly) { filters += ' AND c.active = 1'; }
  if (opts.dateFrom) { filters += ' AND ro.check_date >= ?'; filterParams.push(opts.dateFrom); }
  if (opts.dateTo) { filters += ' AND ro.check_date <= ?'; filterParams.push(opts.dateTo); }

  // When stayNights is null, aggregate across all stay lengths
  const stayFilter = stayNights != null ? ' AND ro.stay_nights = ?' : '';
  const subStayFilter = stayNights != null ? ' AND ro2.stay_nights = ?' : '';

  const params = [];
  if (stayNights != null) params.push(stayNights); // subquery
  params.push(unitId);                              // main WHERE
  if (stayNights != null) params.push(stayNights); // main WHERE
  params.push(...filterParams);
  params.push(limit);

  return db.prepare(`
    SELECT c.id AS competitor_id, c.name, c.url, c.active, c.bedrooms, c.rating, c.review_count,
      c.superhost,
      COUNT(*) AS obs_count,
      COUNT(DISTINCT ro.run_id) AS runs_observed,
      ROUND(AVG(ro.tcpn), 2) AS avg_tcpn,
      ROUND(MIN(ro.tcpn), 2) AS min_tcpn,
      ROUND(MAX(ro.tcpn), 2) AS max_tcpn,
      SUM(CASE WHEN ro.available = 0 THEN 1 ELSE 0 END) AS unavailable_count,
      ROUND(100.0 * SUM(CASE WHEN ro.available = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS unavailable_pct,
      (SELECT ro2.nightly_rate FROM run_observations ro2
       WHERE ro2.competitor_id = c.id${subStayFilter} AND ro2.available = 1
       ORDER BY ro2.captured_at DESC LIMIT 1) AS latest_rate,
      MAX(ro.captured_at) AS latest_captured
    FROM run_observations ro
    JOIN competitors c ON ro.competitor_id = c.id
    WHERE c.comp_unit = ?${stayFilter}
      ${filters}
    GROUP BY c.id
    ORDER BY avg_tcpn ASC
    LIMIT ?
  `).all(...params);
}

/**
 * Get a research run by ID.
 */
function getResearchRunById(db, id) {
  return db.prepare('SELECT * FROM research_runs WHERE id = ?').get(id) || null;
}

/**
 * Compact summary of observations in a run.
 * Returns: { total_obs, unique_comps, unique_dates, stay_lengths, date_from, date_to, avg_rate, avg_tcpn }
 */
function getRunObservationsSummary(db, runId, runSource = 'autopilot') {
  return db.prepare(`
    SELECT COUNT(*) AS total_obs,
      COUNT(DISTINCT competitor_id) AS unique_comps,
      COUNT(DISTINCT check_date) AS unique_dates,
      GROUP_CONCAT(DISTINCT stay_nights) AS stay_lengths,
      MIN(check_date) AS date_from,
      MAX(check_date) AS date_to,
      ROUND(AVG(nightly_rate), 2) AS avg_rate,
      ROUND(AVG(tcpn), 2) AS avg_tcpn
    FROM run_observations
    WHERE run_id = ? AND run_source = ?
  `).get(runId, runSource);
}

/**
 * Per-competitor booking summary from calendar_availability.
 * Unlike run_observations (which only captures available listings with pricing),
 * calendar_availability tracks the full calendar state including booked/blocked dates.
 * This is the correct source for "who's getting booked?" questions.
 *
 * Returns: [{ competitor_id, name, url, comp_unit, active, total_dates, booked_dates,
 *   booked_pct, available_dates, dates_tracked, listing_url }]
 * Options: { dateFrom, dateTo, activeOnly, limit }
 */
function getCalendarBookingSummary(db, unitId, opts = {}) {
  let filters = '';
  const params = [unitId];
  if (opts.activeOnly) { filters += ' AND c.active = 1'; }
  if (opts.dateFrom) { filters += ' AND ca.date >= ?'; params.push(opts.dateFrom); }
  if (opts.dateTo) { filters += ' AND ca.date <= ?'; params.push(opts.dateTo); }
  const limit = opts.limit || 30;
  params.push(limit);
  return db.prepare(`
    SELECT c.id AS competitor_id, c.name, c.url, c.comp_unit, c.active,
      COUNT(*) AS total_dates,
      SUM(CASE WHEN ca.display_status = 'not_available' THEN 1 ELSE 0 END) AS booked_dates,
      ROUND(100.0 * SUM(CASE WHEN ca.display_status = 'not_available' THEN 1 ELSE 0 END) / COUNT(*), 1) AS booked_pct,
      SUM(CASE WHEN ca.display_status = 'available' THEN 1 ELSE 0 END) AS available_dates,
      COUNT(DISTINCT ca.date) AS dates_tracked,
      MAX(ca.listing_url) AS listing_url
    FROM calendar_availability ca
    JOIN competitors c ON ca.competitor_id = c.id
    WHERE c.comp_unit = ?${filters}
    GROUP BY c.id
    ORDER BY booked_pct DESC
    LIMIT ?
  `).all(...params);
}

module.exports = {
  getDb, initDb, closeDb, logAction, getCompetitor, getCompetitorsForUnit, getHoliday, DB_PATH,
  getCompSnapshotsV2, saveRecommendationV2, getSeasons, getLatestAutopilotRun, getRecommendationsV2,
  getRecommendationsForMonth,
  getRecommendationForDate,
  getCompBookedSummaryForDate,
  getTopCompsForDate,
  getLatestRunMeta,
  getCompSetSummaryForUnit,
  purgeUnitSnapshots, purgeUnitRecommendations,
  archiveMarketData, getMarketHistory, getAvailabilityHistory, getAutopilotRuns, recordRateHistory,
  getRunList, getRunById, getRunRecSummary, getRunMarketSummary,
  saveRunObservations, getRunObservations, getRunListingsSummary, getRunComparison, getResearchRuns,
  saveCalendarAvailability, getCalendarSummary, getRunCoverageStats,
  // Batch capture
  createCaptureBatch, updateCaptureBatch, getCaptureBatch, getCaptureBatches,
  // Historical analysis
  getCompPriceHistory, getPriceMovementsByTimeWindow, getCompOccupancyTrend, getMarketDataGaps, getWeekendPremium,
  // Cross-run evidence queries
  getCompAvailabilitySummary, getCompAvailabilityAcrossRuns, getRunsForMonth,
  getCompPriceAndAvailComparison, getResearchRunById, getRunObservationsSummary,
  getCalendarBookingSummary,
};
