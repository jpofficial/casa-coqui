-- Pricing V4 migration — Market Research Engine
-- Adds research_config, research_runs tables + source column on competitors.
-- Safe to re-run.

-- Research search configuration (one per comp_unit)
CREATE TABLE IF NOT EXISTS research_config (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_unit      TEXT NOT NULL UNIQUE,
  location       TEXT NOT NULL,
  min_bedrooms   INTEGER NOT NULL DEFAULT 4,
  min_bathrooms  INTEGER NOT NULL DEFAULT 1,
  max_results    INTEGER NOT NULL DEFAULT 20,
  start_date     TEXT,
  notes          TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

-- Research run history
CREATE TABLE IF NOT EXISTS research_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_unit       TEXT NOT NULL,
  config_snapshot TEXT,
  listings_found  INTEGER DEFAULT 0,
  listings_saved  INTEGER DEFAULT 0,
  snapshots_saved INTEGER DEFAULT 0,
  errors          INTEGER DEFAULT 0,
  duration_ms     INTEGER,
  status          TEXT NOT NULL DEFAULT 'running',
  error_log       TEXT,
  started_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT
);

-- Add source column to competitors (manual vs research)
ALTER TABLE competitors ADD COLUMN source TEXT DEFAULT 'manual';

-- Add nearby_areas to research_config
ALTER TABLE research_config ADD COLUMN nearby_areas TEXT;

-- Add price range + checkout date filters
ALTER TABLE research_config ADD COLUMN min_price INTEGER;
ALTER TABLE research_config ADD COLUMN max_price INTEGER;
ALTER TABLE research_config ADD COLUMN checkout_date TEXT;

-- Add max_bedrooms ceiling filter (Airbnb only supports min_bedrooms in search)
ALTER TABLE research_config ADD COLUMN max_bedrooms INTEGER;
