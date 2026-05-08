# Market Research Filter Fix (2026-03-26)

## Problem

Two bugs allowed noisy listings into the competitor database:

1. **unit-b had no `max_bedrooms` ceiling** — `max_bedrooms` was NULL, so 5-8+ BR homes passed through the filter.
2. **Null bedroom count bypassed the filter** — When scraping failed to parse bedrooms, `details.bedrooms` was null. The condition `null && ...` short-circuited to false, so the listing was saved with `bedrooms: config.min_bedrooms` (faked as 4BR).

## Fix

### migrate-v14.sql
Sets `max_bedrooms = 4` for unit-b (only if currently NULL — idempotent).

### Bedroom filter (3 scripts)
Replaced single-line filter with null-safe version:
```js
if (config.max_bedrooms) {
  if (details.bedrooms == null) {
    // Skip — can't verify bedroom count
    continue;
  }
  if (details.bedrooms > config.max_bedrooms) {
    // Skip — exceeds ceiling
    continue;
  }
}
```

### Post-scrape summary table
Added to `market-research.js` and `capture-market.js` — prints a table of all scraped listings with bedrooms, nightly rate, rating, and save/skip status.

## Files Changed

| File | Change |
|------|--------|
| `tools/pricing/migrate-v14.sql` | New — unit-b max_bedrooms fix |
| `tools/pricing/scripts/market-research.js` | Bedroom filter + summary table + v14 migration |
| `tools/pricing/scripts/capture-market.js` | Bedroom filter + summary table + v14 migration |
| `tools/pricing/scripts/autopilot.js` | Bedroom filter + v14 migration |
| `lib/pricing-db.js` | v14 migration reference |

## Config After Fix

```
unit-a: min_bedrooms=4, max_bedrooms=4, min_price=100, max_price=300
unit-b: min_bedrooms=4, max_bedrooms=4, min_price=NULL, max_price=450
```
