# Competitor Pricing Data Model

> Architecture reference for the Casa Coqui pricing intelligence system.
> Created: 2026-03-26

## 3-Layer Architecture

The pricing database uses a deliberate 3-layer design:

| Layer | Tables | Lifecycle | Purpose |
|-------|--------|-----------|---------|
| **1 - Staging** | `snapshots_v2`, `recommendations_v2` | Purge-and-replace each run | Working tables for ANALYZE phase |
| **2 - Raw Observations** | `run_observations`, `calendar_availability` | Append-only, never purged | Durable per-listing per-run pricing record |
| **3 - Analyzed Archive** | `market_history`, `availability_log`, `my_rates_history` | Append-only, never purged | Derived aggregates + trend data |

## Source of Truth by Data Type

| Data Type | Source Table | Notes |
|-----------|-------------|-------|
| Per-listing per-run pricing | `run_observations` | Layer 2. Includes property metadata snapshot per run. |
| Market aggregates (medians, percentiles) | `market_history` | Layer 3. Derived from snapshots_v2 during ARCHIVE phase. |
| Calendar availability (raw) | `calendar_availability` | Layer 2. Append-only per-run per-listing per-date. |
| Availability trend | `availability_log` | Layer 3. Derived from snapshots_v2 during ARCHIVE. |
| Competitor metadata (current) | `competitors` | Upserted on each scrape. History lost on update. |
| Competitor metadata (per-run) | `run_observations` | Bedrooms, bathrooms, rating, reviews, superhost captured per observation. |
| My rates history | `my_rates_history` | Layer 3. Append-only record of your rate changes. |

## Pipeline: SCRAPE -> ANALYZE -> ARCHIVE

```
SCRAPE
  1. Search Airbnb for competitors
  2. Scrape pricing for each listing
  3. Write to snapshots_v2 (staging) + run_observations (durable)
  |
ANALYZE
  4. Read snapshots_v2 for all dates in range
  5. Run multi-stay analysis per date
  6. Write to recommendations_v2 (staging)
  |
ARCHIVE
  7. Read snapshots_v2 + recommendations_v2
  8. Aggregate into market_history + availability_log (append-only)
  9. Next run can safely purge snapshots_v2
```

## Batch Capture System (v13)

The `capture_batches` table groups multiple research runs:

- One batch = one unit + one month
- Anchor dates every 7 days within the month
- Each anchor creates its own `research_runs` record linked by `batch_id`
- Single browser session shared across all anchors
- Stay lengths: 1, 2, 3, 7 nights

CLI: `node tools/pricing/scripts/capture-market.js --unit unit-a --month 2026-04`

## Pipeline Failure Analysis

| Scenario | Data Lost | Recovery |
|----------|-----------|----------|
| Browser crash mid-scrape | In-memory buffer | Re-run; run_observations regenerated |
| ANALYZE fails after SCRAPE | Nothing | Re-run with `--skip-scrape` |
| **ARCHIVE fails after ANALYZE** | **market_history aggregates** | Raw prices in run_observations; aggregates must be recomputed |
| Two concurrent runs | Snapshot race | No mutex exists (open risk) |

## Analytical Views (v13)

| View | Purpose |
|------|---------|
| `v_comp_price_timeline` | Competitor price history across all runs |
| `v_data_coverage` | Data completeness per date/stay/unit |
| `v_comp_capture_freq` | How often each competitor is captured |
| `v_comp_occupancy` | Competitor booking rate from availability_log |
| `v_weekend_premium` | Weekend vs weekday median TCPN comparison |

## Key Design Decisions

1. **Why not full redesign?** `run_observations` IS the durable pricing table. `market_history` IS the aggregates table. Renaming gains nothing.
2. **day_type on run_observations**: Added in v13. Old rows have NULL (acceptable — recomputable from check_date).
3. **Competitor metadata versioning**: Not implemented. Per-run metadata in run_observations is sufficient.
4. **No mutex**: Concurrent runs can cause snapshot race conditions. Acceptable risk for single-operator use.

## File Map

| File | Role |
|------|------|
| `tools/pricing/lib/db.js` | All database CRUD + batch + analytical helpers |
| `tools/pricing/lib/market-research.js` | Playwright scraper (search + listing details) |
| `tools/pricing/lib/normalize.js` | TCPN computation |
| `tools/pricing/lib/dates.js` | Day classification (weekday/friday/saturday/sunday/holiday) |
| `tools/pricing/lib/multi-stay.js` | Multi-stay analysis engine |
| `tools/pricing/lib/decision-engine.js` | Layer 2 rules engine (raise/hold/lower) |
| `tools/pricing/lib/stats.js` | Statistical helpers (median, percentile) |
| `tools/pricing/lib/seasons.js` | Season detection |
| `tools/pricing/scripts/autopilot.js` | Full pipeline CLI (scrape+analyze+archive) |
| `tools/pricing/scripts/market-research.js` | Research-mode scraper CLI |
| `tools/pricing/scripts/capture-market.js` | Batch capture CLI (monthly) |
| `lib/pricing-db.js` | ESM bridge for Next.js API routes |
| `lib/pricing-ai.js` | Layer 3 AI advisor (Claude Haiku) |
| `app/admin/pricing/page.js` | Dashboard UI |

## Schema Migrations

| Version | File | What |
|---------|------|------|
| v3 | migrate-v3.sql | Snapshots V2, recommendations V2 |
| v4 | migrate-v4.sql | Research config + runs tables |
| v5-v7 | migrate-v5/6/7.sql | Market history, availability log, my rates history |
| v8 | migrate-v8.sql | run_observations (Layer 2) |
| v9 | migrate-v9.sql | Calendar availability |
| v10 | migrate-v10.sql | Autopilot run enrichment |
| v11 | migrate-v11.sql | Competitor timeline indexes |
| v12 | migrate-v12.sql | Run exclusion column |
| v13 | migrate-v13.sql | Batch capture + day_type + timeline indexes + views |
