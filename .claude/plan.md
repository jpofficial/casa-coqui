# Competitor Timeline Layer — Dedup-Safe Derived Views & Evidence System

## 1. Executive Verdict

**The raw data layer is already correct.** Five sub-agents independently confirmed:

- `run_observations` — 165 rows, 45 comps, 11 research runs, **zero within-run duplicates**, UNIQUE constraint on `(run_id, run_source, competitor_id, check_date, stay_nights)` working perfectly via ON CONFLICT upsert
- `calendar_availability` — 1,800 rows, 20 comps, 3 calendar runs, **zero within-run duplicates**, UNIQUE constraint on `(run_id, run_source, competitor_id, date)` working perfectly
- `competitors.airbnb_id` — UNIQUE, NOT NULL, 100% coverage, 0 mismatches between tables
- Cross-run data is correctly preserved (same Airbnb ID in 10+ runs with different prices)

**What's missing is the derived layer.** The current `comp-timeline.js` provides market-level summaries but lacks:
- Per-competitor lifecycle (first seen, last seen, persistence)
- Per-competitor latest-vs-previous state
- Market-wide snapshot (all comps in one queryable view)
- A clean per-competitor evidence payload for the admin UI

**Build:** 3 SQL views + 2 new query functions + API evidence enrichment + UI table. No schema changes to raw tables.

---

## 2. Source-of-Truth Model

```
RAW LAYER (append-only, never modified)
├── run_observations     — one row per (run, competitor, date, stay_nights)
├── calendar_availability — one row per (run, competitor, date)
├── competitors          — stable identity via airbnb_id (UNIQUE)
└── research_runs        — run metadata (started_at, status)

DERIVED LAYER (read-only views + query functions, rebuilt on read)
├── v_comp_latest_state  — SQL VIEW: latest observation per competitor
├── v_comp_persistence   — SQL VIEW: first_seen, last_seen, runs_seen per competitor
├── v_comp_movement      — SQL VIEW: latest vs previous price + availability
├── getMarketSnapshot()      — query function: all comps latest+prev state for UI
└── getMarketMovementSummary()  — (existing, works alongside new views)
```

**Principle:** Raw tables own the truth. Views/queries provide sanitized, deduplicated, current-state reads. Views can be dropped and recreated at any time with zero data loss.

---

## 3. Uniqueness Rules for Raw Tables

### run_observations — KEEP AS-IS (verified correct)

```sql
UNIQUE(run_id, run_source, competitor_id, check_date, stay_nights)
```

- **Within-run:** ON CONFLICT DO UPDATE prevents duplicates. Same competitor+date+stay re-scraped in one run → updates price fields only.
- **Cross-run:** Different run_id = different row. Same competitor appearing in run 21 and run 28 = two separate valid observations.
- **No changes needed.** 0 violations across 165 rows.

### calendar_availability — KEEP AS-IS (verified correct)

```sql
UNIQUE(run_id, run_source, competitor_id, date)
```

- **Within-run:** ON CONFLICT DO UPDATE prevents duplicates. Same competitor+date re-checked → updates status fields.
- **Cross-run:** Different run_id = different row. Availability can change between runs — that's the signal we want.
- **No changes needed.** 0 violations across 1,800 rows.

### competitors — KEEP AS-IS (verified correct)

```sql
airbnb_id TEXT UNIQUE
```

- 72 active competitors, 100% have airbnb_id, 0 mismatches with observation tables.
- airbnb_id is the stable cross-run identity key.

---

## 4. Stable Identity Model

**Already solid — no changes needed.**

| Layer | Identity Key | Purpose |
|-------|-------------|---------|
| `competitors` table | `airbnb_id` (TEXT UNIQUE) | Canonical identity |
| `run_observations` | `competitor_id` FK + denormalized `airbnb_id` | Per-row reconstruction |
| `calendar_availability` | `competitor_id` FK + denormalized `airbnb_id` | Per-row reconstruction |
| Derived views | JOIN on `competitor_id` → `competitors.airbnb_id` | Cross-table identity |

**Rule:** All derived views/queries JOIN through `competitor_id` to `competitors` for name/url/airbnb_id. Never rely on listing_name for identity.

---

## 5. Derived Layers / Views

### Migration: `tools/pricing/migrate-v12.sql` (3 SQL VIEWs)

#### View 1: `v_comp_latest_state` — Latest observation per competitor

For each competitor, the most recent TCPN observation and most recent calendar status.

```sql
CREATE VIEW IF NOT EXISTS v_comp_latest_state AS
SELECT
  c.id AS competitor_id,
  c.airbnb_id,
  c.name,
  c.url,
  c.comp_unit,
  latest_price.run_id AS price_run_id,
  latest_price.check_date AS price_check_date,
  latest_price.stay_nights,
  latest_price.nightly_rate,
  latest_price.tcpn,
  latest_price.available AS price_available,
  latest_price.captured_at AS price_captured_at,
  latest_cal.run_id AS cal_run_id,
  latest_cal.date AS cal_date,
  latest_cal.display_status,
  latest_cal.captured_at AS cal_captured_at
FROM competitors c
LEFT JOIN (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY competitor_id ORDER BY run_id DESC, check_date DESC
  ) AS rn
  FROM run_observations WHERE run_source = 'research'
) latest_price ON latest_price.competitor_id = c.id AND latest_price.rn = 1
LEFT JOIN (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY competitor_id ORDER BY run_id DESC, date DESC
  ) AS rn
  FROM calendar_availability WHERE run_source = 'research'
) latest_cal ON latest_cal.competitor_id = c.id AND latest_cal.rn = 1
WHERE c.active = 1;
```

#### View 2: `v_comp_persistence` — Lifecycle metrics per competitor

```sql
CREATE VIEW IF NOT EXISTS v_comp_persistence AS
SELECT
  c.id AS competitor_id,
  c.airbnb_id,
  c.name,
  c.url,
  c.comp_unit,
  COALESCE(ro.runs_seen, 0) AS price_runs_seen,
  COALESCE(ca.cal_runs_seen, 0) AS cal_runs_seen,
  ro.first_seen_run_id,
  ro.first_seen_at,
  ro.last_seen_run_id,
  ro.last_seen_at,
  COALESCE(ro.runs_seen, 0) + COALESCE(ca.cal_runs_seen, 0) AS total_observations
FROM competitors c
LEFT JOIN (
  SELECT
    competitor_id,
    COUNT(DISTINCT run_id) AS runs_seen,
    MIN(run_id) AS first_seen_run_id,
    MIN(captured_at) AS first_seen_at,
    MAX(run_id) AS last_seen_run_id,
    MAX(captured_at) AS last_seen_at
  FROM run_observations WHERE run_source = 'research'
  GROUP BY competitor_id
) ro ON ro.competitor_id = c.id
LEFT JOIN (
  SELECT
    competitor_id,
    COUNT(DISTINCT run_id) AS cal_runs_seen
  FROM calendar_availability WHERE run_source = 'research'
  GROUP BY competitor_id
) ca ON ca.competitor_id = c.id
WHERE c.active = 1;
```

#### View 3: `v_comp_movement` — Latest vs previous price + availability

```sql
CREATE VIEW IF NOT EXISTS v_comp_movement AS
SELECT
  c.id AS competitor_id,
  c.airbnb_id,
  c.name,
  c.url,
  c.comp_unit,
  curr.run_id AS latest_run_id,
  curr.tcpn AS latest_tcpn,
  curr.nightly_rate AS latest_nightly,
  curr.available AS latest_available,
  curr.captured_at AS latest_captured_at,
  prev.run_id AS prev_run_id,
  prev.tcpn AS prev_tcpn,
  prev.nightly_rate AS prev_nightly,
  prev.available AS prev_available,
  prev.captured_at AS prev_captured_at,
  CASE
    WHEN prev.tcpn IS NULL THEN 'new'
    WHEN curr.tcpn IS NULL THEN 'disappeared'
    WHEN prev.tcpn > 0 AND ABS(curr.tcpn - prev.tcpn) / prev.tcpn < 0.02 THEN 'unchanged'
    WHEN curr.tcpn > prev.tcpn THEN 'raised'
    ELSE 'lowered'
  END AS price_direction,
  CASE
    WHEN curr.tcpn IS NOT NULL AND prev.tcpn IS NOT NULL
    THEN ROUND(curr.tcpn - prev.tcpn, 0)
    ELSE NULL
  END AS price_delta,
  CASE
    WHEN curr.tcpn IS NOT NULL AND prev.tcpn IS NOT NULL AND prev.tcpn > 0
    THEN ROUND((curr.tcpn - prev.tcpn) / prev.tcpn * 100, 1)
    ELSE NULL
  END AS price_delta_pct
FROM competitors c
LEFT JOIN (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY competitor_id ORDER BY run_id DESC
  ) AS rn
  FROM run_observations WHERE run_source = 'research'
) curr ON curr.competitor_id = c.id AND curr.rn = 1
LEFT JOIN (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY competitor_id ORDER BY run_id DESC
  ) AS rn
  FROM run_observations WHERE run_source = 'research'
) prev ON prev.competitor_id = c.id AND prev.rn = 2
WHERE c.active = 1;
```

---

## 6. Advisor-Facing Evidence Model

The advisor reads **derived summaries only**, never raw repeated rows.

### Current flow (keep):
```
getMarketMovementSummary() → { priceMovement, availabilityEvidence, compReliability, runContext }
  → buildAdvisorInput() competitorEvidence section (~250 tokens)
  → System prompt rules 11-15
```

The existing `getMarketMovementSummary()` already provides exactly the right summary for AI token budget. No changes needed to the AI evidence pipeline. The new views power the UI, not the LLM prompt.

---

## 7. Admin Evidence Model (CompetitorEvidenceTable)

### New query function: `getMarketSnapshot(db, unitId)`

Reads from `v_comp_movement` + `v_comp_persistence` in a single query. Returns per-competitor evidence for the admin UI.

### API enrichment

In `advisor/route.js`, after building existing evidence:

```javascript
let compSnapshot = [];
try {
  compSnapshot = compTimeline.getMarketSnapshot(db, unit);
} catch { /* views may not exist yet */ }

return NextResponse.json({
  success: true,
  data: { ...result, evidence, compSnapshot }
});
```

### UI: CompetitorEvidenceTable component

**Location:** Zone 4 expandable details, after MarketMovementPanel.

**Shows per competitor:**

| Column | Source | Notes |
|--------|--------|-------|
| Listing name | `name` (truncated 40 chars) | Clickable → Airbnb link |
| Latest TCPN | `latest_tcpn` | From most recent research run |
| Previous TCPN | `prev_tcpn` | From second-most-recent run |
| Delta | `price_delta` + `price_delta_pct` | Colored: amber (↑), blue (↓), gray (—) |
| Direction | `price_direction` | raised / lowered / unchanged / new |
| Runs seen | `price_runs_seen` | How many analyses include this comp |

**Mobile layout:** Stacked cards (one per competitor) with compact metric grid.
**Desktop layout:** Responsive grid (5 columns).
**Empty state:** "Need 2+ research runs to see competitor evidence."

### I18n keys (~7 new, EN + ES):

```
admin_pricing_advisor_comp_evidence_title
admin_pricing_advisor_comp_latest
admin_pricing_advisor_comp_previous
admin_pricing_advisor_comp_direction_raised
admin_pricing_advisor_comp_direction_lowered
admin_pricing_advisor_comp_direction_new
admin_pricing_advisor_comp_evidence_empty
```

---

## 8. Risks / Edge Cases

| Risk | Mitigation |
|------|-----------|
| **ROW_NUMBER() requires SQLite 3.25+** | better-sqlite3 ships 3.40+. Safe. |
| **Views slow on large datasets** | 165 obs + 1,800 cal rows = instant. Even at 10x growth, no materialization needed. |
| **Calendar data only in 3 of 11 runs** | LEFT JOIN in views — comps without calendar data show NULL display_status, not misleading. |
| **4 calendar-only comps** (IDs 125, 126, 154, 242) | These have calendar but no price data. `v_comp_movement` shows NULL latest_tcpn — correctly handled. |
| **Different stay_nights across runs** | Views pick latest run per comp via `ROW_NUMBER()`. TCPN normalizes across stay lengths. |
| **Token budget for AI** | Market snapshot feeds UI directly; AI keeps its capped ~250 token `competitorEvidence`. No inflation. |
| **View rebuild on schema change** | `CREATE VIEW IF NOT EXISTS` + `DROP VIEW` in migration is safe. No data loss possible. |
| **Duplicate view creation across app restarts** | `IF NOT EXISTS` makes it idempotent, same as existing migration pattern. |

---

## 9. Implementation Plan

```
Phase 1: SQL Views                        [no dependencies]
  → tools/pricing/migrate-v12.sql (3 views)
  → lib/pricing-db.js (register v12 migration)
  → Verify: SELECT * FROM v_comp_movement LIMIT 5

Phase 2: Query Functions                  [depends on Phase 1]
  → tools/pricing/lib/comp-timeline.js
    - getMarketSnapshot(db, unitId)
  → Verify: test against real data

Phase 3: API Evidence Enrichment          [depends on Phase 2]
  → app/api/pricing/advisor/route.js
    - Call getMarketSnapshot(), return compSnapshot in response
  → Verify: curl advisor API, check compSnapshot in JSON

Phase 4: UI CompetitorEvidenceTable       [depends on Phase 3]
  → app/admin/pricing/page.js
    - compSnapshot state in AdvisorCard
    - CompetitorEvidenceTable component in Zone 4
  → lib/i18n.js (~7 new bilingual keys)
  → Verify: visual QA, clickable Airbnb links, empty state
```

---

## 10. Files to Modify

| File | Change | Phase |
|---|---|---|
| `tools/pricing/migrate-v12.sql` | **NEW** — 3 SQL views | 1 |
| `lib/pricing-db.js` | Add `'migrate-v12.sql'` to migration loop | 1 |
| `tools/pricing/lib/comp-timeline.js` | Add `getMarketSnapshot()` | 2 |
| `app/api/pricing/advisor/route.js` | Call `getMarketSnapshot()`, return `compSnapshot` | 3 |
| `app/admin/pricing/page.js` | `compSnapshot` state + `CompetitorEvidenceTable` component | 4 |
| `lib/i18n.js` | ~7 new bilingual keys | 4 |

---

## 11. Final Opinionated Recommendation

**Do not touch the raw tables.** They are correct. The UNIQUE constraints + ON CONFLICT upsert pattern is the right design for append-only observation history with within-run dedup.

**Build SQL views, not materialized tables.** The dataset is small (hundreds of rows) — views execute instantly. If this ever needs to scale, materialize with triggers, but not now.

**Keep the AI token budget tight.** The market snapshot powers the admin UI directly. The AI still gets the same ~250-token `competitorEvidence` summary. Don't dump raw competitor lists into the LLM prompt.

**The derived layer is the product.** Raw observations are infrastructure. Views + query functions + the evidence API = the product the admin interacts with. Design the views to answer the exact questions:
- When was this comp first/last seen? → `v_comp_persistence`
- What's the latest price vs previous? → `v_comp_movement`
- What's the current state? → `v_comp_latest_state`
- Did it raise/hold/lower? → `v_comp_movement.price_direction`
- How reliable is this comp? → `price_runs_seen`
