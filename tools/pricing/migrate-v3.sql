-- Pricing V3 migration — adds base_rate column to competitors table.
-- Safe to re-run: ALTER TABLE ADD COLUMN fails silently on duplicates in SQLite.

ALTER TABLE competitors ADD COLUMN base_rate REAL;
