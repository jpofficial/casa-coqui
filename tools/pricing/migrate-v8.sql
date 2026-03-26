-- Migration V8: Per-run raw observations (append-only Layer 2)
-- Preserves per-listing pricing data for full run reconstruction.
-- ~150 rows/run × ~300 bytes = ~45 KB/run. Negligible storage.

CREATE TABLE IF NOT EXISTS run_observations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           INTEGER NOT NULL,
  run_source       TEXT NOT NULL DEFAULT 'autopilot',
  comp_unit        TEXT NOT NULL,
  competitor_id    INTEGER NOT NULL,
  airbnb_id        TEXT NOT NULL,
  listing_name     TEXT,
  listing_url      TEXT,
  bedrooms         INTEGER,
  bathrooms        REAL,
  rating           REAL,
  review_count     INTEGER,
  superhost        INTEGER DEFAULT 0,
  check_date       TEXT NOT NULL,
  stay_nights      INTEGER NOT NULL,
  nightly_rate     REAL,
  cleaning_fee     REAL DEFAULT 0,
  total_cost       REAL,
  tcpn             REAL,
  available        INTEGER DEFAULT 1,
  captured_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(run_id, run_source, competitor_id, check_date, stay_nights)
);

CREATE INDEX IF NOT EXISTS idx_run_obs_run ON run_observations(run_id, run_source);
CREATE INDEX IF NOT EXISTS idx_run_obs_comp_unit ON run_observations(comp_unit, run_id);
CREATE INDEX IF NOT EXISTS idx_run_obs_competitor ON run_observations(competitor_id, check_date);
