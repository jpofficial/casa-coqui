-- migrate-v13.sql — Batch capture system + timeline indexes + analytical views
-- Architecture hardening: batch grouping, day_type gap fix, cross-run queries

-- ==========================================================================
-- 1. Batch capture system
-- ==========================================================================

CREATE TABLE IF NOT EXISTS capture_batches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  label           TEXT NOT NULL,
  unit_id         TEXT NOT NULL,
  month           TEXT NOT NULL,
  anchor_dates    TEXT,
  stay_lengths    TEXT,
  runs_planned    INTEGER NOT NULL,
  runs_completed  INTEGER DEFAULT 0,
  runs_failed     INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running',
  started_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT,
  duration_ms     INTEGER,
  config_snapshot TEXT
);

CREATE INDEX IF NOT EXISTS idx_capture_batches_unit_month
  ON capture_batches(unit_id, month);

ALTER TABLE research_runs ADD COLUMN batch_id INTEGER REFERENCES capture_batches(id);

-- ==========================================================================
-- 2. Schema gap fix — day_type missing from run_observations
-- ==========================================================================

ALTER TABLE run_observations ADD COLUMN day_type TEXT;

-- ==========================================================================
-- 3. Timeline indexes for cross-run analytical queries
-- ==========================================================================

CREATE INDEX IF NOT EXISTS idx_run_obs_check_date_stay
  ON run_observations(check_date, stay_nights, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_obs_comp_run_date
  ON run_observations(competitor_id, run_id, check_date);

CREATE INDEX IF NOT EXISTS idx_market_history_day_type_date
  ON market_history(unit_id, day_type, check_date DESC);

CREATE INDEX IF NOT EXISTS idx_avail_log_comp_date_range
  ON availability_log(competitor_id, check_date DESC, available);

CREATE INDEX IF NOT EXISTS idx_research_runs_status_date
  ON research_runs(status, excluded, started_at DESC);

-- ==========================================================================
-- 4. Analytical views
-- ==========================================================================

-- Competitor price history across runs
CREATE VIEW IF NOT EXISTS v_comp_price_timeline AS
SELECT ro.competitor_id, c.name, c.comp_unit, ro.check_date, ro.stay_nights,
  ro.nightly_rate, ro.tcpn, ro.available, ro.day_type,
  ro.run_id, ro.run_source, ro.captured_at
FROM run_observations ro
JOIN competitors c ON ro.competitor_id = c.id;

-- Data coverage gaps
CREATE VIEW IF NOT EXISTS v_data_coverage AS
SELECT check_date, stay_nights, comp_unit,
  COUNT(DISTINCT competitor_id) AS unique_comps,
  COUNT(*) AS obs_count,
  MAX(captured_at) AS freshest
FROM run_observations
GROUP BY check_date, stay_nights, comp_unit;

-- Competitor capture frequency
CREATE VIEW IF NOT EXISTS v_comp_capture_freq AS
SELECT ro.competitor_id, c.name, c.comp_unit,
  COUNT(DISTINCT ro.run_id) AS total_runs,
  COUNT(DISTINCT ro.check_date) AS dates_covered,
  MIN(ro.captured_at) AS first_captured,
  MAX(ro.captured_at) AS last_captured
FROM run_observations ro
JOIN competitors c ON ro.competitor_id = c.id
GROUP BY ro.competitor_id;

-- Competitor availability occupancy
CREATE VIEW IF NOT EXISTS v_comp_occupancy AS
SELECT al.competitor_id, c.name, c.comp_unit,
  COUNT(DISTINCT al.check_date) AS days_tracked,
  SUM(CASE WHEN al.available = 0 THEN 1 ELSE 0 END) AS booked_days,
  ROUND(100.0 * SUM(CASE WHEN al.available = 0 THEN 1 ELSE 0 END)
    / NULLIF(COUNT(DISTINCT al.check_date), 0), 1) AS occupancy_pct
FROM availability_log al
JOIN competitors c ON al.competitor_id = c.id
GROUP BY al.competitor_id;

-- Weekend premium analysis
CREATE VIEW IF NOT EXISTS v_weekend_premium AS
SELECT unit_id,
  ROUND(AVG(CASE WHEN CAST(strftime('%w', check_date) AS INT) IN (5,6) THEN median_tcpn_2n END), 2) AS weekend_median,
  ROUND(AVG(CASE WHEN CAST(strftime('%w', check_date) AS INT) BETWEEN 1 AND 4 THEN median_tcpn_2n END), 2) AS weekday_median
FROM market_history
GROUP BY unit_id;
