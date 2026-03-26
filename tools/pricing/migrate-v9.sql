-- migrate-v9: Calendar availability capture (month-filtered)
-- Stores per-day availability for competitor listings, filtered to
-- the month(s) relevant to the research run's search window.

CREATE TABLE IF NOT EXISTS calendar_availability (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                  INTEGER NOT NULL,
  run_source              TEXT NOT NULL DEFAULT 'research',
  competitor_id           INTEGER NOT NULL,
  airbnb_id               TEXT NOT NULL,
  listing_name            TEXT,
  listing_url             TEXT,
  date                    TEXT NOT NULL,
  raw_status              TEXT NOT NULL DEFAULT 'unknown',
  display_status          TEXT NOT NULL DEFAULT 'not_available',
  min_nights              INTEGER,
  max_nights              INTEGER,
  available_for_checkin   INTEGER DEFAULT 0,
  available_for_checkout  INTEGER DEFAULT 0,
  captured_at             TEXT DEFAULT (datetime('now')),
  UNIQUE(run_id, run_source, competitor_id, date)
);

CREATE INDEX IF NOT EXISTS idx_cal_avail_run ON calendar_availability(run_id, run_source);
CREATE INDEX IF NOT EXISTS idx_cal_avail_comp_date ON calendar_availability(competitor_id, date);
CREATE INDEX IF NOT EXISTS idx_cal_avail_date_status ON calendar_availability(date, display_status);

-- Capture window metadata on research_runs
ALTER TABLE research_runs ADD COLUMN calendar_start_date TEXT;
ALTER TABLE research_runs ADD COLUMN calendar_end_date TEXT;
