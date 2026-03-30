-- v14: Fix unit-b missing max_bedrooms ceiling
-- Without this, 5-8+ BR homes pass through the bedroom filter
UPDATE research_config SET max_bedrooms = 4 WHERE comp_unit = 'unit-b' AND max_bedrooms IS NULL;
