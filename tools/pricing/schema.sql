-- Competitive Pricing Monitor — Schema
-- Run via: node tools/pricing/scripts/init-db.js

-- Competitor listings (your comp set)
CREATE TABLE IF NOT EXISTS competitors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  airbnb_id     TEXT UNIQUE,
  name          TEXT NOT NULL,
  url           TEXT,
  host_name     TEXT,
  neighborhood  TEXT,
  bedrooms      INTEGER NOT NULL,
  bathrooms     REAL NOT NULL,
  max_guests    INTEGER,
  sqft          INTEGER,
  amenities     TEXT,
  rating        REAL,
  review_count  INTEGER,
  superhost     INTEGER DEFAULT 0,
  min_nights    INTEGER DEFAULT 1,
  cleaning_fee  REAL DEFAULT 0,
  base_rate     REAL,
  source        TEXT DEFAULT 'manual',
  comp_unit     TEXT NOT NULL,
  active        INTEGER DEFAULT 1,
  notes         TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- DEPRECATED: V1 price snapshots — superseded by snapshots_v2.
-- Kept for backward compatibility with legacy scripts (analyze.js, generate-report.js).
CREATE TABLE IF NOT EXISTS snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id),
  check_date    TEXT NOT NULL,
  day_type      TEXT NOT NULL,
  nightly_rate  REAL NOT NULL,
  cleaning_fee  REAL,
  total_cost    REAL,
  tcpn          REAL,
  assumed_nights INTEGER DEFAULT 2,
  available     INTEGER DEFAULT 1,
  captured_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(competitor_id, check_date)
);

-- Your own rates
CREATE TABLE IF NOT EXISTS my_rates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id       TEXT NOT NULL,
  check_date    TEXT NOT NULL,
  day_type      TEXT NOT NULL,
  nightly_rate  REAL NOT NULL,
  cleaning_fee  REAL DEFAULT 0,
  tcpn          REAL,
  min_nights    INTEGER DEFAULT 2,
  is_booked     INTEGER DEFAULT 0,
  captured_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(unit_id, check_date)
);

-- Holiday calendar
CREATE TABLE IF NOT EXISTS holidays (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT DEFAULT 'us',
  peak_multiplier REAL DEFAULT 1.3
);

-- DEPRECATED: V1 analysis results — superseded by recommendations_v2.
-- Kept for backward compatibility with legacy scripts (analyze.js, generate-report.js).
CREATE TABLE IF NOT EXISTS recommendations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id           TEXT NOT NULL,
  check_date        TEXT NOT NULL,
  day_type          TEXT NOT NULL,
  floor_price       REAL NOT NULL,
  target_price      REAL NOT NULL,
  stretch_price     REAL NOT NULL,
  your_rate         REAL,
  your_tcpn         REAL,
  percentile        REAL,
  verdict           TEXT,
  reasoning         TEXT,
  comp_count        INTEGER,
  confidence        INTEGER,
  is_booked         INTEGER DEFAULT 0,
  lead_time_days    INTEGER,
  demand_signal     TEXT,
  holiday_adjusted  INTEGER DEFAULT 0,
  reference_nights  INTEGER DEFAULT 2,
  comps_available   INTEGER,
  comps_total       INTEGER,
  generated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(unit_id, check_date)
);

-- DEPRECATED: Collection metadata — unused by active code paths.
CREATE TABLE IF NOT EXISTS collection_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action        TEXT NOT NULL,
  details       TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
