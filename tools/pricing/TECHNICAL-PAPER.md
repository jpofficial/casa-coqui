# Smart Pricing Autopilot — Technical Paper

**System**: Casa Coqui Competitive Pricing Intelligence
**Version**: v2 (Multi-Stay Analysis Engine)
**Date**: March 2026
**Authors**: Julio Perez, Claude

---

## 1. Introduction

### 1.1 Problem Statement

Short-term rental hosts face a persistent pricing dilemma. Set rates too high and occupancy drops; set them too low and you leave revenue on the table. The problem intensifies when you manage a multi-unit property in a seasonal market (Puerto Rico), where prices swing dramatically between high season (December-April) and low season (July-November), and where holidays like Three Kings Day, Christmas Eve, and Independence Day command premiums that mainland US hosts rarely encounter.

Manual competitive analysis is tedious and error-prone: open Airbnb, search for comparable listings, check prices for different dates and stay lengths, try to account for cleaning fees that distort per-night comparisons, then somehow synthesize all of that into a pricing decision. This system automates the entire pipeline.

### 1.2 Solution Overview

The Smart Pricing Autopilot is a three-phase data pipeline:

1. **Scrape** — A Playwright-based browser automation engine searches Airbnb for competitor listings, visits each one across multiple date ranges, and extracts structured pricing data.
2. **Analyze** — A statistical analysis engine normalizes prices using True Cost Per Night (TCPN), computes market percentiles across five stay lengths, applies seasonal/holiday/demand overlays, and generates actionable recommendations.
3. **Report** — Results are persisted to a local SQLite database and exported to a JSON report consumed by the admin dashboard.

The entire system runs as a Node.js CLI tool (no cloud dependencies) with an optional API route for dashboard-triggered analysis.

---

## 2. Architecture

### 2.1 Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Database | SQLite via `better-sqlite3` | Zero-ops, file-based, co-located with the app. No network latency for the tight read-write loops in analysis. Synchronous API simplifies transactional logic. |
| Browser Automation | Playwright (Chromium) | Modern, reliable, built-in anti-detection capabilities. Supports both headless and headful modes for CAPTCHA solving. |
| Runtime | Node.js (CJS) | Matches the Next.js host application. CJS modules allow `require()` from both CLI scripts and Next.js API routes via `createRequire`. |
| Data Format | ISO 8601 dates (`YYYY-MM-DD`), USD amounts as REAL | Consistent, sortable, timezone-independent. |

### 2.2 File Organization

```
tools/pricing/
├── pricing.db              ← SQLite database (gitignored)
├── schema.sql              ← Base schema (competitors, snapshots, my_rates, holidays, etc.)
├── migrate-v3.sql          ← Adds base_rate to competitors
├── migrate-v4.sql          ← Research engine tables (research_config, research_runs)
├── migrate-v5.sql          ← Multi-stay tables (snapshots_v2, recommendations_v2, autopilot_runs, seasons)
├── scripts/
│   ├── market-research.js  ← CLI: Airbnb scraping pipeline
│   ├── autopilot.js        ← CLI: Full scrape→analyze→report orchestrator
│   ├── analyze.js          ← CLI: Standalone analysis (legacy v1)
│   ├── init-db.js          ← Database initialization
│   ├── add-comp.js         ← Manual competitor entry
│   ├── add-snapshot.js     ← Manual snapshot entry
│   └── add-my-rates.js     ← Manual rate entry
└── lib/
    ├── db.js               ← Database connection, queries, purge helpers
    ├── market-research.js  ← Playwright scraping logic
    ├── extract-listing.js  ← Airbnb JSON/DOM data extraction
    ├── multi-stay.js       ← V2 analysis engine (primary)
    ├── analysis.js         ← V1 analysis engine + shared statistical functions
    ├── normalize.js        ← TCPN computation and reversal
    ├── seasons.js          ← Seasonal classification and lead-time adjustment
    ├── dates.js            ← Date classification and range generation
    └── holidays.js         ← Puerto Rico + US holiday calendar with peak multipliers
```

### 2.3 Database Schema

The schema evolves through idempotent migrations. Each script runs `schema.sql` followed by `migrate-v3` through `migrate-v5` at startup, with individual statements wrapped in try/catch to handle "already exists" errors gracefully.

#### Core Tables

**`competitors`** — The competitive set. Each row is an Airbnb listing tracked for pricing comparison.

```sql
CREATE TABLE competitors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  airbnb_id     TEXT UNIQUE,          -- Airbnb listing ID (deduplication key)
  name          TEXT NOT NULL,
  url           TEXT,
  host_name     TEXT,
  neighborhood  TEXT,
  bedrooms      INTEGER NOT NULL,
  bathrooms     REAL NOT NULL,
  max_guests    INTEGER,
  amenities     TEXT,                 -- Comma-separated list
  rating        REAL,
  review_count  INTEGER,
  superhost     INTEGER DEFAULT 0,
  min_nights    INTEGER DEFAULT 1,
  cleaning_fee  REAL DEFAULT 0,
  base_rate     REAL,                 -- Last observed nightly rate
  source        TEXT DEFAULT 'manual', -- 'manual' | 'research'
  comp_unit     TEXT NOT NULL,        -- 'unit-a' | 'unit-b'
  active        INTEGER DEFAULT 1,    -- Soft-delete flag
  notes         TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
```

The `airbnb_id` UNIQUE constraint enables upsert semantics — re-scraping the same listing updates its metadata without creating duplicates. The `comp_unit` field partitions competitors by property unit, since each unit competes in a different market segment (different bedroom count, amenities, etc.).

**`snapshots_v2`** — Price observations across stay lengths. This is the primary data source for the v2 analysis engine.

```sql
CREATE TABLE snapshots_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id),
  check_date    TEXT NOT NULL,
  stay_nights   INTEGER NOT NULL DEFAULT 2,  -- 1, 2, 3, 4, or 7
  day_type      TEXT,
  nightly_rate  REAL,
  cleaning_fee  REAL DEFAULT 0,
  total_cost    REAL,
  tcpn          REAL,                         -- Pre-computed True Cost Per Night
  available     INTEGER DEFAULT 1,            -- 1=bookable, 0=booked
  captured_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(competitor_id, check_date, stay_nights)
);
```

The three-column unique constraint `(competitor_id, check_date, stay_nights)` ensures one observation per competitor per date per stay length. The `stay_nights` dimension is the key architectural difference from v1 — it enables the multi-stay analysis that produces weekly and monthly discount recommendations.

**`recommendations_v2`** — Analysis output. One recommendation per unit per date.

```sql
CREATE TABLE recommendations_v2 (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id            TEXT NOT NULL,
  check_date         TEXT NOT NULL,
  day_type           TEXT,
  season             TEXT,               -- 'high' | 'shoulder' | 'low'
  tcpn_1n            REAL,               -- Market TCPN for 1-night stays
  tcpn_2n            REAL,               -- Market TCPN for 2-night stays
  tcpn_3n            REAL,               -- Market TCPN for 3-night stays
  tcpn_4n            REAL,               -- Market TCPN for 4-night stays
  tcpn_7n            REAL,               -- Market TCPN for 7-night stays
  rec_nightly_rate   REAL,               -- Recommended base nightly rate
  rec_weekly_pct     REAL,               -- Recommended 7-night discount %
  rec_monthly_pct    REAL,               -- Recommended 28-night discount %
  floor_price        REAL,               -- P25 TCPN (competitive floor)
  target_price       REAL,               -- Seasonal percentile TCPN
  stretch_price      REAL,               -- P75 TCPN (premium ceiling)
  your_rate          REAL,               -- Your current nightly rate
  your_tcpn          REAL,               -- Your TCPN for comparison
  percentile         REAL,               -- Where you sit in the market (0-100)
  verdict            TEXT,               -- Actionable verdict code
  reasoning          TEXT,               -- Human-readable explanation
  confidence         REAL,               -- 0-100 composite score
  comp_count         INTEGER DEFAULT 0,
  demand_signal      TEXT,               -- 'high_demand' | 'low_demand' | null
  holiday_adjusted   INTEGER DEFAULT 0,
  generated_at       TEXT DEFAULT (datetime('now')),
  UNIQUE(unit_id, check_date)
);
```

#### Supporting Tables

| Table | Purpose |
|-------|---------|
| `snapshots` | Legacy v1 price snapshots (single stay length). Still written by the market-research scraper for backward compatibility. |
| `recommendations` | Legacy v1 recommendations. Still produced by `analysis.js` standalone analysis. |
| `my_rates` | Your own listing's nightly rates, cleaning fees, and booking status per date. Used for verdict computation (comparing your rate to market). |
| `holidays` | Holiday calendar with `peak_multiplier` values (1.1x–1.5x). 19 entries for 2026 covering US federal holidays and Puerto Rico-specific holidays (Three Kings Day, Emancipation Day, PR Constitution Day, Discovery Day). |
| `seasons` | Seasonal tiers defining target percentiles. Three rows: high (Dec–Apr, 60th), shoulder (May–Jun, 50th), low (Jul–Nov, 40th). |
| `research_config` | Search parameters per unit: location, bedroom/bathroom minimums, price range, date range, max results, nearby area names for geo-filtering. |
| `research_runs` | Audit trail for scraping operations (status, listings found/saved, snapshots saved, errors, duration). |
| `autopilot_runs` | Audit trail for full pipeline runs (scrape stats, analysis count, report status, duration). |
| `collection_log` | Generic action log for manual data entry operations. |

---

## 3. Data Collection (Scrape Phase)

### 3.1 Search Strategy

The scraper uses Airbnb's web interface rather than any API. A Playwright-controlled Chromium instance navigates to Airbnb's search page with query parameters that mirror the research configuration:

```
https://www.airbnb.com/s/{location}/homes?
  min_bedrooms={n}&min_bathrooms={n}
  &checkin={date}&checkout={date}
  &adults=2
  &l2_property_type_ids[]=1          ← Entire place only
  &price_min={n}&price_max={n}
  &ne_lat={n}&ne_lng={n}&sw_lat={n}&sw_lng={n}  ← Geo bounding box
  &search_by_map=true
```

The geo bounding box (`METRO_BOUNDS`) constrains results to the San Juan metro area (SW: 18.30°N, 66.20°W → NE: 18.50°N, 65.88°W), preventing results from nearby but non-comparable markets.

### 3.2 Anti-Detection Measures

Airbnb aggressively blocks automated access. The scraper employs several countermeasures:

1. **User agent spoofing** — Chrome 123 on macOS, matching a real browser fingerprint.
2. **WebDriver property override** — `navigator.webdriver` is patched to return `false` via `addInitScript`.
3. **Launch flags** — `--disable-blink-features=AutomationControlled` removes Chrome's automation indicators.
4. **Jittered delays** — 3–5 second random waits between page loads to simulate human browsing.
5. **Modal dismissal** — Automatically closes cookie consent, translation popups, and overlay modals using a cascade of selectors + Escape key presses.
6. **CAPTCHA handling** — Detects PerimeterX/reCAPTCHA challenge pages, saves a debug screenshot, and waits up to 60 seconds for manual solving in headful mode.

### 3.3 Listing Discovery

Listings are extracted from search results using a two-strategy approach:

**Strategy 1 (Primary): JSON extraction** — Airbnb embeds structured data in `<script data-deferred-state>` tags. The scraper parses these JSON blobs and extracts listing IDs and names via regex matching on the stringified JSON.

**Strategy 2 (Fallback): DOM extraction** — If JSON extraction yields no results, the scraper walks the DOM looking for `<a href="/rooms/{id}">` links, then extracts names from `[data-testid="listing-card-title"]` elements and prices from surrounding text.

After extraction:
- Results are deduplicated by `airbnb_id`.
- A soft geo-filter removes listings whose names mention cities outside the allowed area (e.g., "Home in Bayamón" when searching San Juan). The filter only applies if it retains >50% of results — otherwise, Airbnb's built-in location constraint is trusted.
- Results are capped at `max_results` (default: 20).
- If the first page has 18+ results and more are needed, a second page is loaded with `items_offset`.

### 3.4 Per-Listing Price Extraction

For each discovered listing, the scraper visits the listing page with each configured date range. The `market-research.js` CLI uses a single date range from the research config. The `autopilot.js` orchestrator uses five standard stay lengths (1, 2, 3, 4, 7 nights) via `computeDateRangesV2()`.

On the first visit to a listing, full metadata is extracted from the deferred-state JSON:

| Field | Extraction Method |
|-------|-------------------|
| Name | `listingTitle` or `title` JSON key, or section data title |
| Bedrooms/Bathrooms | `overviewItems` section data, or `bedrooms`/`bathrooms` JSON keys |
| Max guests | `personCapacity` or `maxGuestCapacity` |
| Rating/Reviews | `overallRating`, `reviewCount` or `visibleReviewCount` |
| Host name | `hostName` or name adjacent to `isSuperhost` |
| Superhost | `isSuperhost` boolean |
| Neighborhood | `neighborhood.name` or `localizedCity` |
| Min nights | `minNights` |
| Cleaning fee | `cleaningFee` or `cleaning_fee.amount` |
| Base rate | `priceString`, `basePrice`, `discountedPrice`, or `structuredDisplayPrice.amount` |
| Amenities | `amenityGroups[].amenities[].title` (deduplicated) |

Price extraction for each date range uses `extractPriceFromJson()`:

| Field | Sources (priority order) |
|-------|-------------------------|
| Total cost | `total.amount`, `totalPrice` |
| Nightly rate | `priceItems[].amount` (near "nights"), `priceString`, `basePrice` |
| Cleaning fee | `cleaningFee` |

If JSON extraction fails, a DOM fallback walks all text nodes looking for `$NNN/night` patterns or large dollar amounts.

### 3.5 Stay-Length Derivation

The `market-research.js` CLI scrapes a single date range (as configured) but derives `snapshots_v2` entries for all five standard stay lengths (1, 2, 3, 4, 7 nights). The derivation assumes the scraped nightly rate is constant across short stays (a simplification — Airbnb may vary slightly):

```javascript
function deriveStayLengths(searchedNights, nightlyRate, cleaningFee) {
  return [1, 2, 3, 4, 7].map(nights => {
    const total = nightlyRate * nights + cleaningFee;
    const tcpn = Math.round((total / nights) * 100) / 100;
    return { nights, nightly_rate: nightlyRate, total, tcpn };
  });
}
```

The `autopilot.js` scraper takes a more accurate approach: it visits each listing five times with different stay lengths, capturing the actual nightly rate Airbnb quotes for each duration.

### 3.6 Database Writes

Competitor data uses upsert semantics (`INSERT ... ON CONFLICT(airbnb_id) DO UPDATE`). The UPDATE branch uses `COALESCE(excluded.X, competitors.X)` to preserve existing metadata when the new scrape returns null for a field — this prevents data loss from partial scrapes.

Snapshots use `INSERT OR REPLACE` (v1) or `INSERT ... ON CONFLICT ... DO UPDATE` (v2), keyed by `(competitor_id, check_date)` for v1 and `(competitor_id, check_date, stay_nights)` for v2.

---

## 4. Normalization: True Cost Per Night (TCPN)

### 4.1 The Problem with Nightly Rates

Airbnb listings quote a nightly rate, but the actual cost to a guest includes a one-time cleaning fee amortized across the stay. Two listings might both show "$150/night" but have wildly different total costs:

| Listing | Nightly Rate | Cleaning Fee | 2-Night Total | 2-Night TCPN |
|---------|-------------|-------------|---------------|--------------|
| A | $150 | $50 | $350 | $175 |
| B | $150 | $150 | $450 | $225 |

Listing B is 29% more expensive for the guest, despite having the same advertised rate. TCPN exposes this.

### 4.2 TCPN Formula

```
TCPN = (nightly_rate × nights + cleaning_fee) / nights
```

Or equivalently:

```
TCPN = nightly_rate + (cleaning_fee / nights)
```

The default assumed stay is 2 nights, the most common booking length for urban Airbnb properties. For the multi-stay engine, TCPN is computed at each of the five standard stay lengths (1, 2, 3, 4, 7).

### 4.3 Reverse TCPN

To convert a market TCPN back to a recommended nightly rate (given a known cleaning fee):

```
nightly_rate = TCPN - (cleaning_fee / nights)
```

This is the core formula used to produce the `rec_nightly_rate` output.

### 4.4 Reference Nights

For the v1 engine, the reference stay length is determined by computing the statistical mode of `min_nights` across competitors. This adapts to the market — if most competitors require 3-night minimums, analysis uses 3-night TCPN. The v2 engine sidesteps this by analyzing all five stay lengths independently.

---

## 5. Analysis Engine (Multi-Stay v2)

### 5.1 Overview

The `analyzeDateMultiStay()` function produces a single recommendation for a `(unit, date)` pair. It is the sole analysis path used by the autopilot pipeline and the API route.

### 5.2 Step 1: Gather Market Data

For each of the five stay lengths (1, 2, 3, 4, 7 nights):

1. Query `snapshots_v2` for all active competitors in the unit, filtered to the target date and stay length, where `available = 1`.
2. Extract TCPN values. If a snapshot lacks a pre-computed TCPN, recompute it from `nightly_rate` and `cleaning_fee`.
3. Sort TCPN values ascending.
4. Trim statistical outliers using IQR-based filtering (see Section 5.7).
5. Compute the market TCPN at the seasonal target percentile (see Section 5.3).

```javascript
const stayData = {};
for (const nights of [1, 2, 3, 4, 7]) {
  const snapshots = getCompSnapshotsV2(db, unitId, date, nights);
  const tcpns = snapshots.map(s => s.tcpn).filter(v => v > 0).sort((a, b) => a - b);
  const trimmed = trimOutliers(tcpns);
  const marketTcpn = percentile(trimmed, season.target_pctl);
  stayData[nights] = { tcpns, trimmed, marketTcpn };
}
```

### 5.3 Seasonal Percentile Anchoring

The recommended rate is anchored to a percentile of the market distribution. The target percentile varies by season:

| Season | Months | Target Percentile | Strategy |
|--------|--------|-------------------|----------|
| High | Dec – Apr | 60th | Premium positioning. Demand supports higher rates. |
| Shoulder | May – Jun | 50th | Market median. Balanced pricing. |
| Low | Jul – Nov | 40th | Below-median to maximize fill rate. |

Season detection handles cross-year ranges (Dec–Apr spans months 12 → 4) by checking `month >= start OR month <= end`.

### 5.4 Step 2: Derive Recommended Nightly Rate

The engine selects an "anchor" stay length — the one with the most reliable market data. Preference order: 2n → 3n → 1n → 4n → 7n. Two-night data is preferred because it's the most common Airbnb booking length and the best predictor of guest behavior.

```javascript
const anchorTcpn = stayData[anchorStay].marketTcpn;
const cleaningFee = myRate?.cleaning_fee || 75;  // Default $75 for PR market
let recNightly = anchorTcpn - (cleaningFee / anchorStay);
recNightly = Math.round(recNightly / 5) * 5;  // Round to nearest $5
```

The $5 rounding matches Airbnb's UI convention and avoids false precision.

### 5.5 Step 3: Derive Discount Percentages

**Weekly discount** — Compares 7-night TCPN to 2-night TCPN:

```javascript
weeklyPct = (1 - tcpn_7n / tcpn_2n) × 100
// Clamped to [5%, 30%]
// Fallback: 10% if insufficient data
```

This formula captures the natural market discount for longer stays. If competitors offer significant discounts for weekly bookings, the recommendation reflects that.

**Monthly discount** — Extrapolated from weekly:

```javascript
monthlyPct = weeklyPct × 2.5
// Clamped to [15%, 40%]
```

The 2.5x multiplier is a heuristic based on observed Airbnb market patterns where monthly discounts are roughly 2-3x the weekly discount.

### 5.6 Step 4: Apply Overlays

Three adjustment layers are applied sequentially to the recommended nightly rate:

#### Lead-Time Adjustment

| Condition | Multiplier | Rationale |
|-----------|-----------|-----------|
| ≤ 3 days to check-in | 0.85 (-15%) | Last-minute pricing to maximize fill |
| Low season + ≤ 14 days | 0.90 (-10%) | Additional discounting in weak demand |
| High season + > 30 days | 1.10 (+10%) | Advance booking premium |
| Otherwise | 1.00 | No adjustment |

#### Holiday Multiplier

If the target date is a holiday, the `peak_multiplier` from the holidays table is applied. Multipliers range from 1.1x (Columbus Day, Veterans Day) to 1.5x (Christmas Eve, Christmas Day, New Year's Eve).

**Important**: The holiday multiplier is applied to the TCPN-derived recommendation, not to raw market data. If the market snapshots already reflect holiday pricing (i.e., they were scraped on the holiday itself), no double-multiplier is applied — the v1 engine's fallback logic specifically tracks `fallbackFromHoliday` to prevent this.

#### Demand Signal

Demand is inferred from competitor availability:

```javascript
const demandSignal =
  availableSnaps < totalComps * 0.4 ? 'high_demand'   // >60% booked
  : availableSnaps >= totalComps * 0.8 ? 'low_demand'  // <20% booked
  : null;
```

| Signal | Adjustment |
|--------|-----------|
| High demand | +5% |
| Low demand | -5% |

All adjustments preserve the $5 rounding: `Math.round((rate * multiplier) / 5) * 5`.

### 5.7 Statistical Methods

#### Outlier Trimming

Uses IQR (Interquartile Range) filtering:

```
Lower bound = Q1 - 1.5 × IQR
Upper bound = Q3 + 1.5 × IQR
```

Safety rails:
- Skipped if ≤ 3 values (insufficient data to identify outliers)
- Skipped if IQR = 0 (all values identical)
- If trimming would reduce below 3 values, the original dataset is preserved

#### Percentile Computation

Uses linear interpolation between adjacent values in the sorted array:

```javascript
function percentile(sortedValues, p) {
  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] +
    (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}
```

#### Percentile Rank

For positioning your rate within the market, uses the midpoint method:

```
rank = (countBelow + countEqual × 0.5) / totalValues × 100
```

#### Coefficient of Variation

Used for confidence scoring:

```
CV = σ / μ
```

where σ is the standard deviation and μ is the mean of the TCPN distribution. A low CV (<0.15) indicates tight market consensus; a high CV (>0.30) indicates a fragmented market where recommendations carry less certainty.

### 5.8 Confidence Scoring

Confidence is a 0-100 composite score from four weighted factors:

| Factor | Weight | Scoring |
|--------|--------|---------|
| Competitor count | 40% | <3→0 (hard zero), 3→30, 4→50, 5→70, 6→85, 7+→100 |
| Data freshness | 25% | ≤3d→100, 3-7d→80, 7-14d→50, >14d→20 |
| Data source | 20% | Exact date→100, Fallback (nearby weekday)→40 |
| Market spread (CV) | 15% | <0.15→100, 0.15-0.30→70, >0.30→40 |

**Hard zero**: If fewer than 3 competitors have data, confidence is forced to 0 regardless of other factors. This prevents the engine from making recommendations on unreliable thin data.

**Confidence gate**: When confidence < 40, the verdict is overridden to `insufficient_data` and the recommendation is suppressed from the analysis output.

### 5.9 Verdict System

The verdict compares your TCPN to the market distribution:

| Verdict | Condition | Meaning |
|---------|-----------|---------|
| `underpriced` | Percentile rank < 20 | Significantly below market. Raise immediately. |
| `below_market` | 20 ≤ rank < 40 | Room to increase toward target. |
| `market_rate` | 40 ≤ rank ≤ 65 | Well-positioned. No change needed. |
| `above_market` | 65 < rank ≤ 85 | Premium positioning. Sustainable with strong reviews. |
| `premium` | rank > 85 | Highest tier. Monitor booking velocity. |
| `last_minute` | ≤ 3 days to check-in + unbooked | Price at floor to maximize fill. |
| `booked_low` | Booked + rank < 30 | Consider raising for similar future dates. |
| `booked_fair` | Booked + 30 ≤ rank ≤ 70 | Rate was competitive when booked. |
| `booked_high` | Booked + rank > 70 | Strong rate captured. |
| `no_rate` | No rate recorded | Cannot evaluate positioning. |
| `insufficient_data` | Confidence < 40 or no data | Collect more comp data. |

### 5.10 Price Points

Three TCPN reference points are computed from the anchor stay data:

| Point | Definition | Purpose |
|-------|-----------|---------|
| Floor | P25 of trimmed TCPNs | Minimum competitive rate. Below this, you're leaving money on the table. |
| Target | Seasonal percentile (P40/P50/P60) | Recommended positioning for the current season. |
| Stretch | P75 of trimmed TCPNs | Premium ceiling. Sustainable with strong reviews and amenities. |

For small samples (<6 comps), the engine honestly reports min/median/max instead of percentiles.

---

## 6. Data Freshness: The Purge-Before-Write Pattern

### 6.1 Problem

When the scraping pipeline runs multiple times — different dates, updated search parameters, or simply a periodic refresh — old snapshot data from previous runs persists in the database. The analysis engine queries all snapshots for a competitor and date, regardless of when they were captured. This means:

- **Stale prices** from last week's scrape mix with today's fresh data.
- **Deactivated competitors** still have orphaned snapshots that influence analysis.
- **Changed search parameters** (different date range, different filters) leave behind data that no longer matches the current research configuration.

The result: recommendations based on a polluted mix of old and new data.

### 6.2 Solution

Three purge helper functions in `lib/db.js` implement cleanup at strategic points in the pipeline:

#### `purgeUnitData(db, unitId)`

The full purge. Deletes all snapshots (v1 + v2) and all recommendations for a unit. Targets **all** competitors for the unit, including inactive ones, ensuring orphaned data from deactivated competitors is cleaned up.

```javascript
function purgeUnitData(db, unitId) {
  // Get ALL competitors, active and inactive
  const comps = db.prepare('SELECT id FROM competitors WHERE comp_unit = ?').all(unitId);
  const compIds = comps.map(c => c.id);

  let snapshots = 0, snapshots_v2 = 0;
  if (compIds.length > 0) {
    const placeholders = compIds.map(() => '?').join(',');
    snapshots = db.prepare(
      `DELETE FROM snapshots WHERE competitor_id IN (${placeholders})`
    ).run(...compIds).changes;
    snapshots_v2 = db.prepare(
      `DELETE FROM snapshots_v2 WHERE competitor_id IN (${placeholders})`
    ).run(...compIds).changes;
  }

  const recommendations = db.prepare(
    'DELETE FROM recommendations_v2 WHERE unit_id = ?'
  ).run(unitId).changes;

  return { snapshots, snapshots_v2, recommendations };
}
```

**Called by**: `market-research.js` — before launching the browser, after creating the research run record.

#### `purgeUnitSnapshots(db, unitId)`

Targeted snapshot purge. Deletes only `snapshots_v2` for a unit's competitors. Used when you want to refresh snapshot data without destroying existing recommendations (which may still be valid during an in-progress pipeline).

**Called by**: `autopilot.js` — before the scrape phase, per unit.

#### `purgeUnitRecommendations(db, unitId)`

Targeted recommendation purge. Deletes only `recommendations_v2` for a unit. Used before the analysis phase to ensure recommendations are computed from only the freshest snapshots.

**Called by**: `autopilot.js` — before the analyze phase, per unit. Also called by the `POST /api/pricing/autopilot` API route before dashboard-triggered analysis.

### 6.3 Purge Points in the Pipeline

```
market-research.js:
  1. Create research_runs record
  2. ➜ purgeUnitData()        ← Full purge (snapshots v1+v2 + recommendations)
  3. Launch browser, scrape, write fresh data

autopilot.js:
  SCRAPE PHASE (per unit):
    1. ➜ purgeUnitSnapshots()  ← Clear stale v2 snapshots
    2. Scrape Airbnb, write fresh snapshots

  ANALYZE PHASE (per unit):
    1. ➜ purgeUnitRecommendations()  ← Clear stale recommendations
    2. Run analyzeDateMultiStay() for each date
    3. Save fresh recommendations

POST /api/pricing/autopilot:
  1. ➜ purgeUnitRecommendations()  ← Clear before dashboard-triggered analysis
  2. Run analysis, save recommendations
```

### 6.4 Dry-Run Safety

All purge operations are skipped in `--dry-run` mode. The dry-run flag gates both database writes and purges, ensuring preview runs never destroy existing data.

### 6.5 Design Decisions

- **Active + inactive competitors**: Purge targets all competitors for a unit, not just active ones. This prevents orphaned snapshot data from deactivated competitors leaking into analysis.
- **No schema changes**: The purge system uses plain DELETE statements. No new tables, columns, or indexes required.
- **Logged counts**: Each purge logs the number of deleted rows to console (e.g., "Purged: 42 v1 snapshots, 210 v2 snapshots, 30 recommendations"), providing visibility into the cleanup operation.
- **Idempotent**: Running purge on an already-empty dataset safely returns zero counts.

---

## 7. Pipeline Orchestration

### 7.1 CLI Entry Points

#### `market-research.js`

Single-unit scraping pipeline. Reads `research_config` for the specified unit, launches a browser, searches Airbnb, scrapes each listing, and writes to the database.

```bash
node tools/pricing/scripts/market-research.js --unit unit-a [--dry-run] [--headful]
```

Flags:
- `--unit <id>` (required): The unit to research.
- `--dry-run`: Search only, no database writes or purges.
- `--headful`: Show the browser window for manual CAPTCHA solving.

#### `autopilot.js`

Full pipeline orchestrator. Runs scrape → analyze → report for one or all units.

```bash
node tools/pricing/scripts/autopilot.js [--unit unit-a] [--skip-scrape] [--dry-run] [--headful] [--days 60]
```

Flags:
- `--unit <id>`: Single unit (default: both `unit-a` and `unit-b`).
- `--skip-scrape`: Skip the scrape phase; analyze existing data only.
- `--dry-run`: Preview mode, no writes.
- `--headful`: Visible browser.
- `--days <n>`: Analysis horizon in days (default: 30).

The report phase writes to `public/data/pricing-report.json`, which is served statically by Next.js for the admin dashboard.

### 7.2 API Entry Point

`POST /api/pricing/autopilot` triggers analysis (no scraping) from the admin dashboard:

```json
{ "unit": "unit-a", "days": 30 }
```

This route uses `createRequire(import.meta.url)` to load the CJS analysis modules from the Next.js ESM API route — a pragmatic bridge between the two module systems. It purges stale recommendations, runs `analyzeDateMultiStay()` for each date, and returns a 14-day preview in the response.

`GET /api/pricing/autopilot` returns the latest recommendations and last run metadata for the dashboard.

### 7.3 Run Logging

Every pipeline execution is logged to either `research_runs` (for scraping) or `autopilot_runs` (for full pipeline / analysis). The log captures:

- Start time, completion time, duration in milliseconds
- Status (`running` → `completed` | `failed`)
- Counts: listings found, listings saved, snapshots saved, analysis OK, errors
- Error log (on failure)
- Config snapshot (for research runs)

This enables post-hoc debugging and performance tracking.

---

## 8. V1 Analysis Engine (Legacy)

The original analysis engine (`lib/analysis.js`) operates on the `snapshots` table (single stay length) and produces `recommendations` (v1 format). It remains functional for standalone analysis via `scripts/analyze.js` but is not used by the autopilot pipeline.

Key differences from v2:

| Aspect | V1 | V2 |
|--------|----|----|
| Stay lengths | Single (mode of competitors' min_nights) | Five (1, 2, 3, 4, 7) |
| Fallback data | Same day-of-week within ±7 days | Exact date only (no fallback) |
| Holiday handling | Multiplier on fallback data only (prevents double-counting) | Multiplier on recommended rate |
| Output | Floor/target/stretch TCPNs | Nightly rate + weekly % + monthly % |
| Demand signal | From available vs unavailable snapshot counts | From available snapshot count vs total comp count |

The v1 engine's fallback logic is notably more sophisticated: when exact-date data is unavailable, it searches for snapshots from the same day-of-week within a ±7-day window, deduplicates by competitor (most recent first), and tracks whether the fallback data came from a holiday-priced date to avoid applying the holiday multiplier twice. The v2 engine sacrifices this flexibility for the simplicity of requiring exact-date data — acceptable because the autopilot runs fresh scrapes before analysis.

---

## 9. Listing Data Extraction

### 9.1 Airbnb's Data Architecture

Airbnb renders its pages as React SPAs with server-side data embedded in `<script data-deferred-state>` tags. These JSON blobs contain the full listing data, pricing breakdown, and search results. The scraper's extraction strategy targets these structured data sources first, falling back to DOM walking only when JSON extraction fails.

### 9.2 Extraction Pipeline

The `extract-listing.js` module provides four extraction functions:

1. **`extractFromDeferredState(json, data)`** — Primary extractor. Walks the `niobeMinimalClientData.StayListing...` path to find structured section data (name, bedrooms, bathrooms, guests from overview items). Falls back to regex matching on the stringified JSON for 20+ fields.

2. **`extractPriceFromJson(json)`** — Price-specific extractor for date-parameterized listing pages. Targets `total.amount`, `priceItems[].amount`, `priceString`, and `cleaningFee` fields.

3. **`extractFromLdJson(json, data)`** — Parses JSON-LD structured data (`@type: BedAndBreakfast | LodgingBusiness | House | Apartment`) for name, rating, review count, and neighborhood.

4. **`extractFromDescription(text, data)`** — Last-resort regex extraction from freeform description text for bedroom/bathroom/guest counts.

### 9.3 Robustness

The extraction code is designed for resilience:
- Every field extraction is wrapped in a null check (`if (data.X == null)`) to prevent overwriting earlier, potentially more accurate data.
- Multiple regex patterns are tried per field (e.g., `priceString`, `basePrice`, `discountedPrice`, `originalPrice`, `structuredDisplayPrice` for the base rate).
- The `walkSections()` function handles Airbnb's nested section data structure, which varies between listing types and page versions.

---

## 10. Operational Considerations

### 10.1 Holiday Calendar Maintenance

The `holidays.js` file contains a hardcoded calendar for 2026. Many holidays fall on different dates each year (MLK Day, Easter, Thanksgiving, etc.). The `checkHolidayCoverage()` function logs a console warning if the current year has no holidays seeded. **Action required**: Update the holiday array and re-run `seedHolidays(db)` before each new year.

### 10.2 Season Configuration

Seasons are seeded into the database via `migrate-v5.sql` with Puerto Rico defaults. The admin dashboard can customize these, but the hardcoded `PR_DEFAULTS` in `seasons.js` serve as a fallback if the seasons table is empty or the query fails.

### 10.3 CAPTCHA Resilience

Airbnb's anti-bot measures (PerimeterX) may trigger CAPTCHAs during scraping. The system handles this gracefully:
- In headful mode: pauses and polls every 5 seconds for up to 60 seconds, allowing manual solving.
- In headless mode: detects the CAPTCHA and reports failure without hanging indefinitely.
- CAPTCHA screenshots are saved to `tools/pricing/debug-captcha.png` for debugging.

### 10.4 Rate Limiting

The scraper uses 3-5 second jittered delays between page loads. For a typical run (20 listings × 5 date ranges = 100 page loads), this means ~6-8 minutes of scraping per unit. The autopilot pipeline logs total duration for monitoring.

### 10.5 Data Integrity

- **Foreign keys** are enforced (`PRAGMA foreign_keys = ON`), preventing orphaned snapshots if a competitor is deleted.
- **WAL mode** (`PRAGMA journal_mode = WAL`) enables concurrent reads during writes, important when the API route reads while a CLI script is writing.
- **Singleton connection** via `getDb()` prevents multiple database handles from causing lock contention.

---

## 11. Admin Dashboard Integration

The admin pricing dashboard (`app/admin/pricing/page.js`) consumes data through two channels:

1. **API routes** — `GET /api/pricing/autopilot` returns live recommendations, last run metadata, and season configuration. `GET /api/pricing/competitors` returns the competitor list. `GET /api/pricing/research-config` returns search configuration.

2. **Static JSON** — `public/data/pricing-report.json` is generated by the report phase of `autopilot.js` and served statically for fast initial page loads.

The dashboard displays:
- A 14-day chart with floor/target/stretch price bands and your current rate overlay.
- Verdict badges (color-coded by severity) and confidence indicators (1-4 bar icons).
- Demand signal chips ("High Demand" / "Low Demand").
- A summary card with the next-weekend verdict and market trend (rising/stable/falling).
- Manual "Run Analysis" button that triggers `POST /api/pricing/autopilot`.

---

## 12. Summary

The Smart Pricing Autopilot transforms competitive pricing from a manual, error-prone task into an automated, data-driven pipeline. Its key innovations are:

1. **TCPN normalization** — Eliminates the cleaning-fee distortion that makes raw nightly rate comparisons misleading.
2. **Multi-stay analysis** — Produces recommendations across five stay lengths, enabling dynamic weekly and monthly discount strategies.
3. **Seasonal anchoring** — Target percentiles shift with the season, automatically adjusting between premium positioning (high season) and fill-rate optimization (low season).
4. **Layered overlays** — Lead-time, holiday, and demand adjustments are applied independently and cumulatively, capturing the full complexity of short-term rental pricing.
5. **Confidence gating** — Recommendations are suppressed when data quality is insufficient, preventing the system from making bad calls with thin evidence.
6. **Purge-before-write** — Each pipeline run starts with a clean slate, ensuring recommendations always reflect the current market rather than a polluted mix of old and new data.

The system is designed for a single-host, multi-unit property, but the architecture (per-unit competitive sets, configurable search parameters, pluggable seasonal tiers) could scale to additional units or markets with minimal changes.
