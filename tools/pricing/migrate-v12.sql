-- v12: Add excluded column to research_runs and autopilot_runs
-- Allows host to mark bad/test runs so they are skipped by timeline analysis
ALTER TABLE research_runs ADD COLUMN excluded INTEGER DEFAULT 0;
ALTER TABLE autopilot_runs ADD COLUMN excluded INTEGER DEFAULT 0;
