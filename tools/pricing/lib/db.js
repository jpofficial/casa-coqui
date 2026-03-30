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

module.exports = {
  getDb, initDb, closeDb, logAction, getCompetitor, getCompetitorsForUnit, getHoliday, DB_PATH,
  getCompSnapshotsV2, saveRecommendationV2, getSeasons, getLatestAutopilotRun, getRecommendationsV2,
  purgeUnitSnapshots, purgeUnitRecommendations,
  archiveMarketData, getMarketHistory, getAvailabilityHistory, getAutopilotRuns, recordRateHistory,
  getRunList, getRunById, getRunRecSummary, getRunMarketSummary,
  saveRunObservations, getRunObservations, getRunListingsSummary, getRunComparison, getResearchRuns,
  saveCalendarAvailability, getCalendarSummary, getRunCoverageStats,
  // Batch capture
  createCaptureBatch, updateCaptureBatch, getCaptureBatch, getCaptureBatches,
  // Historical analysis
  getCompPriceHistory, getPriceMovementsByTimeWindow, getCompOccupancyTrend, getMarketDataGaps, getWeekendPremium,
};
