# Admin Calendar Cleanup — Design

**Date:** 2026-04-15
**Status:** Brainstormed, pending implementation plan
**Scope:** `app/admin/calendar/page.js` only. Cleaner calendar (`components/cleaner/CleanerHome.js`) is **not** changed.

## Problem

The admin calendar at `/admin/calendar` has grown too visually dense. Each 72px day cell currently renders: day number, two unit-occupancy bars (with CI/CO rounding), "CI"/"CO" text markers, cleaning-status color dots (4 states), an "A" Airbnb tag, a ⚠ conflict icon, and optional red-tinted background — all at once. The legend beneath lists ~9 items. After ICS sync was added per-unit, every Airbnb booking on both units produces bars + markers every day, which pushed the view into "noisy" territory.

The cleaner's view at `/cleaning` reads cleanly because it only shows the single question a cleaner cares about: *is there a job today, and for which unit?* Admin needs more information than that, but the admin calendar should be the same kind of glance-friendly tool — with detail behind a tap, not crammed into the cell.

## Goals

1. Reduce day-cell information density so the month can be scanned at a glance.
2. Keep operational warnings (missing cleaning, date-mismatch cleaning) visible and — importantly — make them **actionable** rather than just decorative.
3. Match the cleaner page's Agenda/Calendar toggle pattern so admin mental model is consistent across roles.
4. Do not touch the cleaner view.

## Non-goals

- No changes to cleaning job model, booking model, or ICS sync behavior.
- No changes to Firestore rules or backend APIs.
- No changes to the cleaner page.
- No changes to the per-unit settings system.

## Design

### Page structure: Agenda + Calendar toggle

The admin calendar page gains a segmented toggle at the top, matching the cleaner pattern:

- **Agenda** (default landing) — "what's happening today, tomorrow, and soon"
- **Calendar** — month overview for scanning

Unit filter tabs (`All` / `Coqui Tierra` / `Coqui Cielo`) stay on both views.

### Agenda view

Landing page for the admin calendar. Vertical list, top to bottom:

1. **Warnings section** (only if any exist for the current / next ~30 days)
   - Each warning is a red-bordered card with:
     - Title: `⚠ No cleaning scheduled` or `⚠ Cleaning date mismatch`
     - Affected date and unit
     - A `Fix →` link that deep-links to the right place (cleaning job form pre-filled for the checkout date, or the mismatched cleaning job's edit page)
   - Warnings are pinned above the day-grouped events so they can't be missed.

2. **Day-grouped event cards**
   - Grouped as `Today · Wed Apr 15`, `Tomorrow · Thu Apr 16`, then `Fri Apr 17`, `Sat Apr 18`, ... (short weekday + date).
   - Show the next ~14 days of events; older cards not shown in Agenda (the Calendar view remains the way to look at past months).
   - Each event card has:
     - Unit-colored left border (orange for Tierra, blue for Cielo).
     - Primary label: guest name for reservations, or "Tierra cleaning" / "Cielo cleaning" for cleanings.
     - Badges on the right: `Check-in`, `Check-out`, `Airbnb`, or a cleaning-status badge (`Scheduled` / `Confirmed` / `In progress` / `Done`).
     - Meta row: unit · time · nights or cleaner name + time.
   - Cards for cleaning jobs deep-link to the cleaning job detail page; reservation cards deep-link to the booking detail.

Event types that appear in Agenda:

- Check-ins (reservation starts that day)
- Check-outs (reservation ends that day)
- Cleanings (scheduled or in-progress)

"Active stay, mid-stay" cards are **not** shown in Agenda (too noisy; they're visible in Calendar bars and tap-sheet).

### Calendar view

Month grid. Each day cell is compact:

- **Day number** at the top (with today highlighted green).
- **Two stacked color pills** below:
  - Top pill = Coqui Tierra. Filled orange if the unit is occupied that day (any booking status other than cancelled). Faint grey otherwise.
  - Bottom pill = Coqui Cielo. Filled blue / faint grey by same rule.
- Drop from current cell: CI/CO text, Airbnb "A", cleaning-status dots, red background tint.
- **Warning days** get a thin red outline around the cell plus a small red dot in the top-right corner. No background tint.
- Month-level warning banner stays at the top: `⚠ 2 warnings this month →`. Tapping the banner switches the view back to Agenda (where the actionable cards live).

Tapping a day cell opens the **day detail sheet**.

### Day detail sheet

Bottom sheet (existing pattern, simplified content). Sections, in order:

1. **Warnings** — inline red banners, one per warning for that day (if any).
2. **Reservations** — one card per booking active that day:
   - Unit-colored left border.
   - Guest name + status badge (`Check-in` / `Check-out` / `Active` / `Upcoming` / `Past`).
   - Unit · check-in date → check-out date · nights.
   - Airbnb badge if `source === 'airbnb'`.
3. **Cleaning** — one card per cleaning job scheduled on that day:
   - Status badge (same vocabulary as Agenda).
   - Unit · checkout time · assignee name (or "Unassigned").
   - Deep-link to cleaning job detail (replaces current "View Forum →").

Drops from current sheet: the `A`-style Airbnb duplication, the duplicated "Airbnb" badge rendering.

### Visual conventions

- Unit colors stay: **Tierra = orange** (`#fb923c` family), **Cielo = blue** (`#60a5fa` family). Already established in cleaner view.
- Cleaning status colors stay: scheduled = grey, confirmed = blue, in-progress = amber, done = green.
- Today highlight stays green (matches existing admin theme).

### What is removed (vs. today)

| Removed element | Where it used to appear |
|---|---|
| `CI` / `CO` text markers | Day cell |
| `A` Airbnb text marker | Day cell |
| Cleaning status dots (4 colors) | Day cell |
| Red background tint on conflict days | Day cell |
| Legend row listing 9 items | Below calendar |
| `View Forum →` link inside cleaning card | Day detail sheet |

The legend shrinks to a minimal row showing just the two unit colors (Tierra / Cielo) inside each mockup. Warning semantics move into the actual warning cards where they're self-explanatory.

## Data & behavior notes

- **No data-model changes.** All rendering is derived from the same `bookings`, `cleaning_jobs`, and `settings` collections already consumed by this page.
- Conflict detection logic stays in `detectConflicts()` as-is; only its rendering changes.
- Agenda view uses a 14-day forward window starting from `today` (property local timezone) to keep the list useful without unbounded scroll.
- `Fix →` link destinations:
  - Missing-cleaning → `/admin/cleaning/new?unit={unit}&date={checkoutDate}&bookingId={bookingId}` (or equivalent based on current cleaning-job create flow).
  - Date-mismatch → cleaning job edit surface for the mismatched job.
  - (If a deep-link surface doesn't exist yet, fall back to scrolling the relevant page section. Implementation plan will pick the approach.)

## Code organization

File structure stays the same: one page file at `app/admin/calendar/page.js`. To keep the file readable it will be split into three in-file components:

- `AgendaView` — renders warnings + day-grouped event cards.
- `CalendarView` — renders the month grid + tap sheet.
- `DayDetailSheet` — existing, simplified.

Shared helpers (`getUnitPalette`, status labels, etc.) stay in `lib/calendar-helpers.js`. New helpers added there as needed:

- `buildAgendaForWindow(bookings, cleaningJobs, todayStr, days)` — returns `[{ dateStr, label, events: [...] }]`.
- `buildWarningList(bookings, cleaningJobs, unitNames, window)` — returns a flat list of warnings with `{ kind, dateStr, unit, fixHref, message }`.

## Testing / verification

- Manual smoke: admin calendar renders under both toggles for the current month. Agenda lists today/tomorrow/next-14 events across both units.
- Manual smoke: warning card appears when a booking has no cleaning on checkout day; `Fix →` link opens the right create form.
- Manual smoke: warning day on Calendar has red outline + dot; no red background tint.
- Visual: confirm cleaner page (`/cleaning`) is unchanged.
- No unit-test infrastructure exists for this page today; plan does not add one.

## Rollout

Single PR. No feature flag — change is UI-only and reversible by revert. No schema or rule changes.

## Open questions (to revisit during implementation plan)

1. Does a deep-link surface for "create cleaning job pre-filled" already exist, or does the `Fix →` link route to the generic create page? Determines whether implementation needs new query-param handling in the cleaning create flow.
2. Agenda window size: 14 days is the current proposal. If admin uses the page to plan further out, increase to 30. Revisit after first week of use.
