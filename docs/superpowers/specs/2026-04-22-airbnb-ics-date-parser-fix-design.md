# Airbnb ICS Date Parser Fix — Design

**Date:** 2026-04-22
**Status:** Approved — ready for implementation plan
**Owner:** @jpofficial

## Problem

The admin calendar at `/admin/calendar` displays Airbnb reservations one calendar day earlier than they actually are on Airbnb.com. Reported by the host; confirmed symptom: Airbnb says check-in Apr 15, the app shows Apr 14.

The host proposed physically separating Airbnb reservations into a new `external_bookings` collection. An independent two-reviewer staff-engineer evaluation rejected that approach: collection separation does not fix the underlying bug, breaks five working systems (auto-cleaning-job creation, manual-vs-Airbnb overlap detection, cleaning-date cascade, welcome-message drafting, conflict warnings), violates the documented invariant that "the internal booking model is the canonical app-facing object," and is a one-way storage migration.

This spec takes the staff-engineer-recommended path: **fix the parser at the source, backfill affected data, and audit the second ingestion path.**

## Root cause

`veventDateToYMD()` in [functions/icsSync.js:72-78](../../functions/icsSync.js):

```js
function veventDateToYMD(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}
```

Airbnb emits all-day `VEVENT`s (`DTSTART;VALUE=DATE:20260415` / `DTEND;VALUE=DATE:20260420`). `node-ical` returns these as JS `Date` objects. Calling `.toISOString()` normalizes to UTC; when any consumer (or even `node-ical`'s own VTIMEZONE resolution for DATE values) produces a JS `Date` whose UTC date falls before the iCal DATE value, the YMD extracted after UTC conversion slips one calendar day earlier.

The same function is the only write path for Airbnb reservation dates. Every downstream consumer (`bookings.checkInDate`, `bookings.checkOutDate`, the auto-created `cleaning_jobs.scheduledDate`, the welcome-message drafter, the overlap detector, the warning engine) inherits the shift.

## Non-goals

- Splitting Airbnb data into its own collection. Explicitly rejected by staff review.
- Per-unit or per-VEVENT timezone configuration. Property is single-location in Puerto Rico; the `America/Puerto_Rico` timezone is a hardcoded constant.
- Guest-portal display changes. Guest-facing dates read the same `checkInDate`/`checkOutDate` strings; fixing the source corrects every consumer.
- Changes to the cleaning-job cascade, notification, or welcome-message logic. Those systems are correct; they just receive wrong inputs today.

## Design

### Parser rewrite

Replace `veventDateToYMD` with a two-branch implementation keyed off `node-ical`'s `dateOnly`/`datetype` metadata:

```js
function veventDateToYMD(dt, opts = {}) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;

  // DATE-only VEVENTs (Airbnb's format). node-ical stores these at UTC
  // midnight; UTC getters yield the exact calendar day from the ICS file,
  // independent of server TZ or VTIMEZONE resolution.
  if (opts.dateOnly || dt.dateOnly === true) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // DATE-TIME VEVENTs: resolve to property timezone before taking YMD.
  // Intl is the most reliable cross-runtime zoned formatter.
  // 'en-CA' locale yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Puerto_Rico',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
```

Call sites in `processFeed` pass the `dateOnly` flag explicitly:

```js
const dtstart = veventDateToYMD(event.start, { dateOnly: event.datetype === 'date' });
const dtend   = veventDateToYMD(event.end,   { dateOnly: event.datetype === 'date' });
```

The fallback `dt.dateOnly === true` check covers node-ical versions that expose the flag directly on the Date object.

### Timezone

The property's canonical timezone is `America/Puerto_Rico` (UTC−4, no DST). Hardcoded as a top-level constant in `functions/icsSync.js` and referenced by the DATE-TIME branch. If the property ever moves, this is a single-line change.

### Lambda / email ingestion path audit

[functions/icsSync.js:501-527](../../functions/icsSync.js) contains migration logic that detects bookings originally created by a legacy Lambda path (`migratedFromEmailAt`, `extractConfirmationCodeFromVevent`). The Lambda source lives at `infra/lambda/parse-airbnb-email/`. That parser must be audited:

1. Does it derive `checkInDate`/`checkOutDate` via the same `toISOString()`-after-local-parse pattern?
2. Is it still live (being invoked), or dormant?

If live and broken: apply the equivalent fix. If dormant but producing historical bad data: covered by the backfill.

**Audit result (2026-04-22):** Lambda *does* write `checkInDate` / `checkOutDate` (contrary to preliminary grep in the plan doc). However it derives them via `parseShortDate` — a text-regex parser over the human-readable email body (e.g. "Check-in Sat, May 23"). `parseShortDate` constructs YYYY-MM-DD directly from parsed month/day/year integers without `toISOString()`, and the Lambda does not import `node-ical` or parse VEVENT text. It is immune to the bug fixed here. No Lambda patch needed. Historical bookings created by Lambda are unaffected by the VEVENT-parser bug, so the backfill script will find their dates already correct and skip them.

### Backfill script — `scripts/fix-airbnb-dates.js`

Re-derive correct dates from the live ICS feed rather than applying a blind `+1 day` shift. Safer because some bookings may have been hand-edited, imported via a different path, or carry dates that are correct by coincidence.

Behavior:

1. Load enabled ICS feeds from `settings/property.icsFeeds`.
2. For each feed, fetch and parse with `node-ical` using the fixed parser.
3. For each VEVENT, look up `bookings` by `externalId` + `unit`.
4. Compare re-derived `checkInDate`/`checkOutDate` to stored values.
5. Where different:
   - Update the booking: `checkInDate`, `checkOutDate`, `syncHash`, `lastSyncedAt`, `updatedAt`.
   - Cascade to linked `cleaning_jobs` via the existing `cascadeCleaningJobs` helper — this already respects `manualOverride`, in-progress statuses, and historical (terminal) statuses.
6. Emit a summary: matched, corrected, skipped (no change), skipped (terminal cleaning), unmatched (VEVENT with no booking), orphaned (booking with externalId not seen in feed — logged, not modified; cancellation logic handles these separately).
7. Flags:
   - `--dry-run` (default): report only, no writes.
   - `--apply`: perform writes.
   - `--feed <unitId>`: restrict to one feed.

The script is idempotent: a second run after `--apply` produces zero corrections.

### Unit tests — `functions/__tests__/vevent-date.test.js`

Fixture-based. Input raw VEVENT text; parse with `node-ical`; assert `veventDateToYMD` output.

Cases:

- DATE-only, mid-month (primary Airbnb case) — expect exact day match.
- DATE-only, month boundary (e.g. `DTEND;VALUE=DATE:20260501` for an April booking).
- DATE-only, year boundary (checkout `20270101`).
- DATE-TIME with explicit `TZID=America/Puerto_Rico` — resolve correctly.
- DATE-TIME in UTC (`Z` suffix) — expected to return the Puerto Rico calendar day.
- `null` and invalid inputs return `null` without throwing.

Test runner: whichever test framework already ships in the `functions/` workspace (inspect `functions/package.json` at implementation time; add Jest if absent — low-surface-area dependency for a Cloud Function workspace).

### Optional: source filter on calendar

Cosmetic add — not required by this spec but cheap and naturally paired. [app/admin/calendar/page.js:515-527](../../app/admin/calendar/page.js) renders a unit-filter pill row; add a second pill row bound to `sourceFilter` state with options `All / Manual / Airbnb`. `filteredBookings` gains one additional `.filter((b) => sourceFilter === 'All' || (b.source || 'manual') === sourceFilter.toLowerCase())`. Default `All`. Scope: ~15 lines; zero backend coupling.

Carved out of the critical path. Ship with the parser fix if implementation time permits; otherwise a follow-up PR.

## Rollout

1. Land parser fix + unit tests on a branch.
2. Deploy Cloud Functions.
3. Run backfill with `--dry-run`; eyeball the diff for sanity (all corrections should be `+1 day`; any other pattern is a red flag).
4. Run backfill with `--apply`.
5. Spot-check 2–3 Airbnb bookings on the admin calendar against Airbnb.com.
6. Audit `infra/lambda/parse-airbnb-email/`; patch or document-as-dormant.
7. (Optional) ship source toggle.

## Risks

- **Cleaning jobs inherit the bug.** Any `cleaning_jobs.scheduledDate` derived from the broken parser is also off by one day. The backfill must cascade — it does, via the existing cascade helper.
- **DTEND semantics.** DATE-only DTEND is *exclusive* per iCal spec (the day after the last occupied night). The parser must preserve exclusivity — it does, because it returns the literal iCal DATE value without shift. The unit test explicitly covers DTEND to guard against a regression that would flip the direction of the bug on checkout dates.
- **node-ical version drift.** The `dateOnly` flag and `datetype === 'date'` metadata depend on node-ical's behavior. The parser uses both (explicit opt flag + Date-object fallback) to remain robust across versions. Pin or note the version in the unit test file.
- **Backfill safety.** Re-deriving from live ICS requires the feed to still contain the VEVENT. For bookings whose `externalId` is absent from the current feed, the script logs and skips — it does not shift blindly. This is the correct conservative default.
- **Second ingestion path.** If the Lambda email parser is live and broken, the bug re-enters through the side door. Rollout step 6 is non-optional for long-term correctness.

## Files touched

- `functions/icsSync.js` — parser rewrite + call-site updates.
- `functions/__tests__/vevent-date.test.js` — new unit test file.
- `scripts/fix-airbnb-dates.js` — new backfill script.
- `infra/lambda/parse-airbnb-email/` — audit; patch if needed.
- `app/admin/calendar/page.js` — optional source toggle (follow-up).

## References

- Original brainstorm session, 2026-04-22.
- Staff-engineer review (two independent reviews, unanimous verdict for this approach).
- Prior ICS architecture memo: `.claude/agent-memory/ics-sync-architecture.md`.
- Related: [docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md](./2026-04-18-parse-airbnb-email-correctness-design.md).
