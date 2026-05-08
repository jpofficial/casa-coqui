-- migrate-v5.sql — Smart Pricing Autopilot foundation tables

-- Multi-stay snapshots: adds stay_nights dimension
CREATE TABLE IF NOT EXISTS snapshots_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id),
  check_date TEXT NOT NULL,
  stay_nights INTEGER NOT NULL DEFAULT 2,
  day_type TEXT,
  nightly_rate REAL,
  cleaning_fee REAL DEFAULT 0,
  total_cost REAL,
  tcpn REAL,
  available INTEGER DEFAULT 1,
  captured_at TEXT DEFAULT (datetime('now')),
  UNIQUE(competitor_id, check_date, stay_nights)
);

-- Multi-stay recommendations with actionable output
CREATE TABLE IF NOT EXISTS recommendations_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  check_date TEXT NOT NULL,
  day_type TEXT,
  season TEXT,
  tcpn_1n REAL,
  tcpn_2n REAL,
  tcpn_3n REAL,
  tcpn_4n REAL,
  tcpn_7n REAL,
  rec_nightly_rate REAL,
  rec_weekly_pct REAL,
  rec_monthly_pct REAL,
  floor_price REAL,
  target_price REAL,
  stretch_price REAL,
  your_rate REAL,
  your_tcpn REAL,
  percentile REAL,
  verdict TEXT,
  reasoning TEXT,
  confidence REAL,
  comp_count INTEGER DEFAULT 0,
  demand_signal TEXT,
  holiday_adjusted INTEGER DEFAULT 0,
  generated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(unit_id, check_date)
);

-- Autopilot run log
CREATE TABLE IF NOT EXISTS autopilot_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT DEFAULT 'manual',
  units_processed TEXT,
  scrape_ok INTEGER DEFAULT 0,
  scrape_errors INTEGER DEFAULT 0,
  analysis_ok INTEGER DEFAULT 0,
  report_written INTEGER DEFAULT 0,
  duration_ms INTEGER,
  status TEXT DEFAULT 'running',
  error_log TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Seasonal config
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_month INTEGER NOT NULL,
  end_month INTEGER NOT NULL,
  name TEXT NOT NULL,
  target_pctl REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed Puerto Rico defaults (only if table is empty)
INSERT OR IGNORE INTO seasons (id, start_month, end_month, name, target_pctl) VALUES
  (1, 12, 4, 'high', 60),
  (2, 5, 6, 'shoulder', 50),
  (3, 7, 11, 'low', 40);
