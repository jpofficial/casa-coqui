-- migrate-v15: Rate Calendar lede cache
-- Adds plain-English explanation text + generation timestamp to recommendations_v2.
-- At read time, if lede_generated_at < generated_at (or is NULL), the lede is regenerated.

ALTER TABLE recommendations_v2 ADD COLUMN lede_text TEXT;
ALTER TABLE recommendations_v2 ADD COLUMN lede_generated_at TEXT;
