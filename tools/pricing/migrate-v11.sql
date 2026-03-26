-- migrate-v11.sql — Competitor timeline indexes for cross-run queries

-- Cross-run price comparison on run_observations
CREATE INDEX IF NOT EXISTS idx_run_obs_comp_date
  ON run_observations(competitor_id, check_date);

CREATE INDEX IF NOT EXISTS idx_run_obs_airbnb_date
  ON run_observations(airbnb_id, check_date);

-- Cross-run calendar availability queries
CREATE INDEX IF NOT EXISTS idx_cal_avail_comp_date_run
  ON calendar_availability(competitor_id, date, run_id);
