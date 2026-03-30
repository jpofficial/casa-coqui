# Batch Market Capture CLI

> Change log for the batch market capture system.
> Date: 2026-03-26

## What Was Built

A CLI tool that captures competitor pricing data across an entire month in a single browser session, producing structured batch records that group related research runs.

## Files Changed

| File | Action | What |
|------|--------|------|
| `tools/pricing/migrate-v13.sql` | Created | Batch tables, day_type column, timeline indexes, analytical views |
| `tools/pricing/scripts/capture-market.js` | Created | Batch CLI (~310 lines) |
| `tools/pricing/lib/db.js` | Modified | 4 batch CRUD + 5 analytical helpers + day_type in saveRunObservations |
| `tools/pricing/scripts/market-research.js` | Modified | Migration list v10-v13 + day_type in observations |
| `tools/pricing/scripts/autopilot.js` | Modified | Migration list v10-v13 + day_type in observations |
| `lib/pricing-db.js` | Modified | Migration list + v13 |

## CLI Syntax

```bash
# Full capture
node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04

# With calendar availability
node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04 --capture-calendar

# Dry run — shows anchor schedule without scraping
node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04 --dry-run

# Headful mode for CAPTCHA solving
node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04 --headful
```

## Batch Model

- **Anchor dates**: Every 7 days from the 1st of the month (e.g., Apr 1, 8, 15, 22, 29)
- **Stay lengths**: 1, 2, 3, 7 nights per anchor
- **Browser reuse**: Single Playwright session shared across all anchors
- **Anti-detection**: 45-60s random delay between anchors
- **Snapshots**: Purged once at batch start (not per-anchor)
- **Listing search**: Done once, reused across all anchors

## Database Schema (v13)

### `capture_batches` table
Groups multiple research_runs into a logical batch. Tracks planned/completed/failed counts and overall status.

### `research_runs.batch_id` FK
Links individual anchor runs back to the batch.

### `run_observations.day_type` column
Captures day classification (weekday/friday/saturday/sunday/holiday) at write time. Existing rows have NULL.

### Timeline indexes
5 new indexes for cross-run analytical queries on run_observations, market_history, availability_log, and research_runs.

### Analytical views
5 SQL views: `v_comp_price_timeline`, `v_data_coverage`, `v_comp_capture_freq`, `v_comp_occupancy`, `v_weekend_premium`.

## New db.js Functions

### Batch CRUD
- `createCaptureBatch(db, opts)` — INSERT batch, return ID
- `updateCaptureBatch(db, batchId, updates)` — Update progress/status
- `getCaptureBatch(db, batchId)` — Single lookup with JSON parsing
- `getCaptureBatches(db, filters)` — Filtered list

### Historical Analysis
- `getCompPriceHistory(db, competitorId, opts)` — All historical prices for a competitor
- `getPriceMovementsByTimeWindow(db, unitId, days)` — Who raised/lowered prices
- `getCompOccupancyTrend(db, competitorId, days)` — Per-comp occupancy over time
- `getMarketDataGaps(db, opts)` — Dates with thin coverage
- `getWeekendPremium(db, unitId, days)` — Weekend vs weekday median TCPN

## Verification

```sql
-- Check batch status
SELECT * FROM capture_batches ORDER BY id DESC LIMIT 1;

-- Check runs per batch
SELECT COUNT(*), batch_id FROM research_runs WHERE batch_id IS NOT NULL GROUP BY batch_id;

-- Test price timeline view
SELECT * FROM v_comp_price_timeline WHERE competitor_id = 1 ORDER BY captured_at DESC LIMIT 20;

-- Find thin dates
SELECT * FROM v_data_coverage WHERE unique_comps < 3;
```
