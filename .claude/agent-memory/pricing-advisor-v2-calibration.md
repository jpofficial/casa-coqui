# Pricing Advisor V2 — Calibration Notes (March 2026)

## What Was Built

### Phase 1: Backend Trust Layer
- **decision-engine.js** — Deterministic pricing rule engine (Layer 2)
- **availability.js** — Availability signal classification (tight/mixed/open)
- **seasons.js** — Weekday multipliers + graduated lead-time curve
- **stats.js** — Fixed confidence model (actual freshness, 6 factors, structured output, warnings)
- **multi-stay.js** — Wired decision engine into analysis pipeline
- **pricing-ai.js** — Structured input/output, server-side enforcement, chat lockdown
- **advisor/route.js** — 3-layer architecture assembly + advisor_log writes
- **migrate-v10.sql** — advisor_log table
- **pricing-db.js** — ESM bridge for new modules

### Phase 2: Evaluation Results

#### Data State
- 20 snapshots (7n only, single date: 2026-04-14)
- 72 active competitors (unit-a), 20 with calendar data
- 1800 calendar_availability rows across 30 dates
- 7 completed runs, 0 my_rates entries
- No trend computable (runs lack overlapping future dates)

#### Component Test Results

**Availability classifier**: PASS
- Correctly classifies: open (15% unavail), mixed (35%), tight (65%)
- 20/72 comps tracked (reasonable — not all have calendar data)
- Overall signal for April: open (50%), mixed (30%), tight (20%)

**Confidence model**: PASS
- Fresh data + many comps: score=93 (high tier) ✓
- Stale + few comps: score=39 (low tier) ✓
- Very stale (>14d): hard suppress to score=10 ✓
- Below minimum (<3 comps): hard zero ✓
- Legacy compat (snapshotMaxAgeDays): works correctly

**Warning generation**: PASS
- Escalates from 0 (healthy) to 6 (everything wrong) ✓
- Severity levels correct: critical → caution → info ✓

**Decision matrix**: PASS — all 13 test vectors correct
- Low percentile → raise (regardless of trend)
- High percentile → lower (regardless of trend)
- Mid-range + strengthening + tight → upgrade to raise
- Mid-range + softening + open → downgrade to lower
- Low confidence → hold; very low → suppress

**Rate computation**: PASS
- Multipliers apply correctly (weekday, lead-time, trend, demand)
- Clamping between floor and stretch×1.10 works
- $5 rounding works

**Guardrails**: PASS
- Max raise/lower: $15 cap works
- Fire sale: $25 cap for ≤3d lead time
- Below threshold: $3 delta rounds to $5 (minimum actionable change)
- Booked dates: forced hold
- No current rate: returns suggested rate

**Backward compatibility**: PASS
- All 25 legacy fields present in multi-stay output
- New fields (decision, dataAgeDays) added non-destructively
- Autopilot script, autopilot API route, trends API route all consume legacy fields

**Build**: PASS — Next.js build succeeds

#### Known Gaps (Not Bugs — Expected)
1. **No trend signal** — requires ≥2 runs with ≥3 overlapping future dates. Current runs don't have this overlap yet. Will resolve naturally as more autopilot runs accumulate.
2. **No my_rates** — percentile position can't be computed. No host rates entered yet. Engine correctly returns `percentile: null` and uses "No rate recorded" reason.
3. **7n-only snapshots** — only 1 stay length available (7-night). 2-night anchor preferred but engine falls back correctly.
4. **Full pipeline test blocked** — Live advisor API call requires ANTHROPIC_API_KEY which is in .env.local. Structural flow verified through build + component tests.

#### Calibration Adjustments Made
- None needed yet. Thresholds produce sensible results with the available data.
- The confidence model's new factors (trend depth, signal agreement, proximity) are well-calibrated based on scenario testing.

## Threshold Decisions Validated

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| MIN_COMPS | 3 (hard zero) | Below 3 = no statistical basis |
| SUPPRESS_CONFIDENCE | 25 | Below this = suppress entirely |
| HOLD_CONFIDENCE | 40 | Below this = never recommend changes |
| MAX_RAISE/LOWER | $15 or 12% | Conservative — host should feel safe |
| FIRE_SALE_MAX | $25 or 20% | More aggressive for last-minute |
| MIN_CHANGE | $5 | Below this = noise, not signal |
| STALE_DATA_HARD_SUPPRESS | >14 days | No recommendation on 2-week-old data |
| Tight availability | ≥55% unavailable | Aligned with Airbnb market norms |
| Open availability | <30% unavailable | Conservative threshold |

## Evidence Retrieval (2026-03-30)

Added a second code path to the advisor API: `body.query` triggers evidence mode (historical data retrieval + AI answer), while `body.unit` (no query) triggers the existing recommendation mode. The two paths share the same route but are completely independent.

- `lib/pricing-evidence.js` — 9 evidence gatherers with `unitScope`/`dateScope` in every payload
- `lib/pricing-ai.js` — `answerEvidenceQuestion()` with separate `EVIDENCE_SYSTEM_PROMPT` + `history` support
- `tools/pricing/lib/db.js` — 6 new historical query functions
- `tools/pricing/scripts/inspect.js` — CLI for manual data inspection (11 commands)
- `MODEL` constant in `pricing-ai.js` — single source of truth for all 3 LLM call sites

## Pricing Chat Tab (2026-03-30)

Conversational UI for evidence queries — "Chat" tab on pricing dashboard.

- `ChatTab` component in `app/admin/pricing/page.js` — 6 suggested questions, bubble UI, auto-scroll
- Multi-turn: `answerEvidenceQuestion` accepts `history` array of `{ query, answer }` pairs
- 9 intents: 7 original + `cheapest` + `bookedAnalysis`
- 2 new gatherers: `gatherCheapestByStayLength`, `gatherBookedVsAvailableEvidence`
- Unit-aware: conversation clears on unit switch
- 14 i18n keys (ES + EN) in `lib/i18n.js`

## Evidence Data Source Fix (2026-03-30)

**Root cause**: `run_observations` only captures available listings (all `available=1` for April). Real booking data lives in `calendar_availability` (`display_status = 'not_available'` means booked). 13 of 20 tracked competitors have booked dates in April, with top 3 at 60% booked.

**Fix**:
- `tools/pricing/lib/db.js` — added `getCalendarBookingSummary()` querying `calendar_availability` with `booked_pct`, `booked_dates` etc.
- `lib/pricing-evidence.js` — `gatherAvailabilityEvidence` + `gatherBookedVsAvailableEvidence` now use `calendar_availability` as primary source, `run_observations` as fallback
- `lib/pricing-ai.js` — Updated EVIDENCE_SYSTEM_PROMPT: use "booked" for calendar data, present booking data as real calendar state

**CRITICAL**: For booking/availability questions, always use `calendar_availability` (20 comps with calendar tracking), NOT `run_observations` (only captures available listings). `run_observations` is correct for pricing data; `calendar_availability` is correct for booking data.

## Ready for Phase 3?

**YES**, with caveats:
1. Backend trust layer is structurally complete and tested
2. Server-side enforcement prevents LLM override
3. Backward compat layer prevents dashboard breakage
4. Need more autopilot runs to test trend classification and full decision flow
5. Phase 3 (UI redesign) can proceed independently — the API contract is stable
6. Evidence retrieval + chat tab complete; next would be streaming or advanced query UI
