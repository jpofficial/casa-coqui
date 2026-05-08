-- Migration V7: Run observability & lineage
-- Enriches autopilot_runs with trigger, config, phase timing, warnings.
-- Adds run_id FK to recommendations_v2, snapshots_v2, my_rates_history.
-- Creates run_summary convenience view.

-- Enrich autopilot_runs
ALTER TABLE autopilot_runs ADD COLUMN trigger TEXT DEFAULT 'terminal';
ALTER TABLE autopilot_runs ADD COLUMN config_snapshot TEXT;
ALTER TABLE autopilot_runs ADD COLUMN comps_found INTEGER DEFAULT 0;
ALTER TABLE autopilot_runs ADD COLUMN comps_active INTEGER DEFAULT 0;
ALTER TABLE autopilot_runs ADD COLUMN recs_written INTEGER DEFAULT 0;
ALTER TABLE autopilot_runs ADD COLUMN history_rows INTEGER DEFAULT 0;
ALTER TABLE autopilot_runs ADD COLUMN avail_rows INTEGER DEFAULT 0;
ALTER TABLE autopilot_runs ADD COLUMN warnings TEXT;
ALTER TABLE autopilot_runs ADD COLUMN scrape_start_ms INTEGER;
ALTER TABLE autopilot_runs ADD COLUMN scrape_end_ms INTEGER;
ALTER TABLE autopilot_runs ADD COLUMN analyze_start_ms INTEGER;
ALTER TABLE autopilot_runs ADD COLUMN analyze_end_ms INTEGER;
ALTER TABLE autopilot_runs ADD COLUMN archive_start_ms INTEGER;
ALTER TABLE autopilot_runs ADD COLUMN archive_end_ms INTEGER;

-- Add run_id FK to existing tables
ALTER TABLE recommendations_v2 ADD COLUMN run_id INTEGER;
ALTER TABLE snapshots_v2 ADD COLUMN run_id INTEGER;
ALTER TABLE my_rates_history ADD COLUMN run_id INTEGER;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_autopilot_runs_started ON autopilot_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_v2_run ON recommendations_v2(run_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_v2_run ON snapshots_v2(run_id);
CREATE INDEX IF NOT EXISTS idx_my_rates_history_run ON my_rates_history(run_id);

-- Convenience view
CREATE VIEW IF NOT EXISTS run_summary AS
SELECT ar.*,
  CASE WHEN ar.scrape_end_ms IS NOT NULL AND ar.scrape_start_ms IS NOT NULL
    THEN ar.scrape_end_ms - ar.scrape_start_ms ELSE NULL END AS scrape_duration_ms,
  CASE WHEN ar.analyze_end_ms IS NOT NULL AND ar.analyze_start_ms IS NOT NULL
    THEN ar.analyze_end_ms - ar.analyze_start_ms ELSE NULL END AS analyze_duration_ms,
  CASE WHEN ar.archive_end_ms IS NOT NULL AND ar.archive_start_ms IS NOT NULL
    THEN ar.archive_end_ms - ar.archive_start_ms ELSE NULL END AS archive_duration_ms
FROM autopilot_runs ar;
