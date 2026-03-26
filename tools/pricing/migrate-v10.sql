-- migrate-v10.sql — Advisor log for recommendation tracking
-- Tracks what the advisor recommended and whether the host applied it.

CREATE TABLE IF NOT EXISTS advisor_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  action TEXT NOT NULL,           -- 'raise' | 'hold' | 'lower'
  suggested_rate REAL NOT NULL,
  current_rate REAL,
  confidence TEXT NOT NULL,       -- 'high' | 'medium' | 'low'
  confidence_score INTEGER,       -- 0-100
  market_trend TEXT,              -- 'strengthening' | 'stable' | 'softening'
  availability_signal TEXT,       -- 'tight' | 'mixed' | 'open'
  percentile REAL,
  comp_count INTEGER,
  applied INTEGER DEFAULT 0,
  applied_at TEXT,
  market_rate_after REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_log_unit ON advisor_log(unit_id, created_at);
