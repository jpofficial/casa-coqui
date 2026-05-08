-- Migration V6: Historical market intelligence tables
-- Adds append-only tables for trend analysis and Airbnb data import

-- Market snapshot archive: one row per (unit, run, check_date)
-- Append-only. Never purged. Populated after each ANALYZE phase.
CREATE TABLE IF NOT EXISTS market_history (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id            TEXT NOT NULL,
  run_id             INTEGER NOT NULL,
  check_date         TEXT NOT NULL,
  scraped_at         TEXT NOT NULL,
  comp_count_total   INTEGER NOT NULL,
  comp_count_avail   INTEGER NOT NULL,
  median_tcpn_2n     REAL,
  p25_tcpn_2n        REAL,
  p75_tcpn_2n        REAL,
  mean_nightly       REAL,
  min_nightly        REAL,
  max_nightly        REAL,
  rec_nightly_rate   REAL,
  floor_price        REAL,
  target_price       REAL,
  stretch_price      REAL,
  your_rate          REAL,
  your_tcpn          REAL,
  percentile         REAL,
  verdict            TEXT,
  confidence         REAL,
  season             TEXT,
  day_type           TEXT,
  demand_signal      TEXT,
  UNIQUE(unit_id, run_id, check_date)
);

-- Per-comp availability log: tracks each comp's state over time
-- Append-only. Never purged.
CREATE TABLE IF NOT EXISTS availability_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id    INTEGER NOT NULL,
  check_date       TEXT NOT NULL,
  scraped_at       TEXT NOT NULL,
  run_id           INTEGER NOT NULL,
  available        INTEGER NOT NULL,
  nightly_rate     REAL,
  tcpn_2n          REAL,
  UNIQUE(competitor_id, check_date, run_id)
);

-- Host rate history: preserves every rate change
-- Append-only. Written alongside my_rates upserts.
CREATE TABLE IF NOT EXISTS my_rates_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id         TEXT NOT NULL,
  check_date      TEXT NOT NULL,
  nightly_rate    REAL NOT NULL,
  cleaning_fee    REAL DEFAULT 0,
  tcpn            REAL,
  is_booked       INTEGER DEFAULT 0,
  recorded_at     TEXT DEFAULT (datetime('now'))
);

-- Airbnb transaction imports (from CSV export)
CREATE TABLE IF NOT EXISTS airbnb_transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_code TEXT NOT NULL,
  unit_id           TEXT NOT NULL,
  transaction_type  TEXT NOT NULL,
  transaction_date  TEXT NOT NULL,
  amount            REAL NOT NULL,
  currency          TEXT DEFAULT 'USD',
  description       TEXT,
  listing_name      TEXT,
  import_batch_id   INTEGER,
  created_at        TEXT DEFAULT (datetime('now')),
  UNIQUE(confirmation_code, transaction_type, transaction_date)
);

-- Airbnb reservation details (enriched from transactions)
CREATE TABLE IF NOT EXISTS airbnb_reservations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_code TEXT UNIQUE NOT NULL,
  unit_id           TEXT NOT NULL,
  check_in          TEXT NOT NULL,
  check_out         TEXT NOT NULL,
  nights            INTEGER NOT NULL,
  guests            INTEGER,
  nightly_rate      REAL,
  cleaning_fee      REAL,
  service_fee       REAL,
  total_payout      REAL,
  booking_date      TEXT,
  source            TEXT DEFAULT 'csv_import',
  import_batch_id   INTEGER,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- Import audit trail
CREATE TABLE IF NOT EXISTS import_batches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type  TEXT NOT NULL,
  filename     TEXT,
  rows_parsed  INTEGER DEFAULT 0,
  rows_saved   INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  errors       TEXT,
  imported_at  TEXT DEFAULT (datetime('now'))
);

-- Indexes for trend queries
CREATE INDEX IF NOT EXISTS idx_market_history_unit_date
  ON market_history(unit_id, check_date, scraped_at);
CREATE INDEX IF NOT EXISTS idx_market_history_run
  ON market_history(run_id);
CREATE INDEX IF NOT EXISTS idx_avail_log_comp_date
  ON availability_log(competitor_id, check_date, scraped_at);
CREATE INDEX IF NOT EXISTS idx_avail_log_run
  ON availability_log(run_id);
CREATE INDEX IF NOT EXISTS idx_my_rates_history_unit_date
  ON my_rates_history(unit_id, check_date, recorded_at);
CREATE INDEX IF NOT EXISTS idx_airbnb_tx_unit_date
  ON airbnb_transactions(unit_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_airbnb_res_unit_dates
  ON airbnb_reservations(unit_id, check_in, check_out);
