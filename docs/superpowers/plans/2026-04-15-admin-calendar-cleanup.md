# Admin Calendar Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce information density on the admin calendar, split it into an Agenda + Calendar toggle (matching the cleaner-side pattern), and make operational warnings (missing cleaning, date mismatch) actionable via a `Fix →` deep-link that pre-fills the cleaning-create form.

**Architecture:** Single-page refactor of `app/admin/calendar/page.js`. No data-model, API, or Firestore-rule changes. New pure helpers added to `lib/calendar-helpers.js` (with unit tests under `lib/__tests__/`). `CleaningJobForm` gains two optional prefill props so the `Fix →` link can open it ready-to-save. Cleaner page (`components/cleaner/CleanerHome.js`) is untouched.

**Tech Stack:** Next.js 14 (App Router), JavaScript, React hooks, Tailwind CSS, Firebase Firestore real-time, `node --test` for helper unit tests.

**Spec:** [docs/superpowers/specs/2026-04-15-admin-calendar-cleanup-design.md](../specs/2026-04-15-admin-calendar-cleanup-design.md)

---

## File Structure

**New / modified files and responsibilities:**

| Path | Responsibility |
|---|---|
| `lib/calendar-helpers.js` | **modify** — add pure helpers `buildWarningList(bookings, cleaningJobs, unitNames, windowStart, windowEnd)` and `buildAgendaForWindow(bookings, cleaningJobs, todayStr, days)`. |
| `lib/__tests__/calendar-helpers.test.js` | **create** — node:test unit tests for the two new helpers. |
| `components/admin/CleaningJobForm.js` | **modify** — accept optional `initialUnit` and `initialDate` props; seed form state when `open` transitions `false → true`. |
| `app/admin/cleaning/page.js` | **modify** — read `?new=1&unit=<name>&date=<YYYY-MM-DD>` query params; when `new=1`, auto-open `CleaningJobForm` with prefill; clear query params after opening. |
| `app/admin/calendar/page.js` | **modify** — full refactor: extract `AgendaView` / `CalendarView` in-file components, new color-pills day cell, Agenda/Calendar segmented toggle, warning-count banner, simplified `DayDetailSheet`. |
| `components/cleaner/CleanerHome.js` | **untouched**. |

**Unit color convention** (reused by both existing cells and new pills):
- Unit 0 (`UNIT_PALETTES[0]`) → Teal — existing: `bg-teal-500 / bg-teal-200`.
- Unit 1 (`UNIT_PALETTES[1]`) → Amber — existing: `bg-amber-500 / bg-amber-200`.
- The spec mockups called them "orange" (Tierra) / "blue" (Cielo). **Use the existing palettes** (teal / amber) to match the rest of the app. Don't introduce new colors.

**Faint / empty pill** on days when a unit has no booking: `bg-gray-100`.

**Today highlight:** day number in a green pill (`bg-coqui-600 text-white rounded-full`) — matches existing treatment.

---

## Task 1: Add `buildWarningList` helper + tests

**Files:**
- Modify: `lib/calendar-helpers.js`
- Test: `lib/__tests__/calendar-helpers.test.js` (create)

Purpose: pure function that takes all bookings + cleaning jobs and returns a flat array of actionable warning objects for a given window. Same logic as the existing `detectConflicts` in `app/admin/calendar/page.js:42-87`, but windowed and returning richer metadata (including a `fixHref`).

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/calendar-helpers.test.js` with:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWarningList } from '../calendar-helpers.js';

test('buildWarningList flags checkout day with no cleaning job', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra', 'Coqui Cielo'], '2026-04-01', '2026-04-30');

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'missing_cleaning');
  assert.equal(warnings[0].dateStr, '2026-04-15');
  assert.equal(warnings[0].unit, 'Coqui Tierra');
  assert.equal(warnings[0].bookingId, 'b1');
  assert.match(warnings[0].fixHref, /\/admin\/cleaning\?new=1/);
  assert.match(warnings[0].fixHref, /unit=Coqui%20Tierra/);
  assert.match(warnings[0].fixHref, /date=2026-04-15/);
});

test('buildWarningList ignores cancelled bookings', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'cancelled' },
  ];
  const warnings = buildWarningList(bookings, [], ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 0);
});

test('buildWarningList ignores checkouts outside window', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-01-10', checkOutDate: '2026-01-15', status: 'active' },
  ];
  const warnings = buildWarningList(bookings, [], ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 0);
});

test('buildWarningList does not flag when cleaning exists on that unit+date', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', bookingId: 'b1', unit: 'Coqui Tierra', scheduledDate: '2026-04-15', status: 'scheduled' },
  ];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 0);
});

test('buildWarningList ignores cleaning jobs with terminal status', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', bookingId: 'b1', unit: 'Coqui Tierra', scheduledDate: '2026-04-15', status: 'cancelled' },
  ];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'missing_cleaning');
});

test('buildWarningList flags date mismatch between booking checkout and cleaning scheduledDate', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', bookingId: 'b1', unit: 'Coqui Tierra', scheduledDate: '2026-04-16', status: 'scheduled' },
  ];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'date_mismatch');
  assert.equal(warnings[0].dateStr, '2026-04-16');
  assert.equal(warnings[0].unit, 'Coqui Tierra');
  assert.equal(warnings[0].bookingId, 'b1');
  assert.equal(warnings[0].cleaningJobId, 'j1');
});

test('buildWarningList does not flag date mismatch when cleaning has manualOverride', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', bookingId: 'b1', unit: 'Coqui Tierra', scheduledDate: '2026-04-16', status: 'scheduled', manualOverride: true },
  ];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  // manualOverride suppresses date-mismatch; BUT the booking checkout (Apr 15) still has no cleaning → missing_cleaning
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'missing_cleaning');
  assert.equal(warnings[0].dateStr, '2026-04-15');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern=buildWarningList`
Expected: FAIL with `buildWarningList is not a function` (or equivalent — the export doesn't exist yet).

- [ ] **Step 3: Implement `buildWarningList`**

Append to `lib/calendar-helpers.js`:

```javascript
const TERMINAL_CLEANING_STATUSES = new Set(['cancelled', 'deleted', 'archived']);

/**
 * Build a flat list of operational warnings for a given date window.
 *
 * Emits two kinds:
 *   - missing_cleaning: booking ends on a day in-window with no active cleaning job on that unit+date.
 *   - date_mismatch:    cleaning job in-window whose scheduledDate differs from its linked booking's checkOutDate
 *                       (suppressed if manualOverride is set).
 *
 * Returns: [{ kind, dateStr, unit, bookingId?, cleaningJobId?, message, fixHref }]
 */
export function buildWarningList(bookings, cleaningJobs, unitNames, windowStart, windowEnd) {
  const out = [];
  const activeBookings = bookings.filter((b) => b.status !== 'cancelled');

  // Missing cleaning: booking checkout in-window with no active job on unit+date.
  for (const booking of activeBookings) {
    const checkOut = ymd(booking.checkOutDate);
    if (checkOut < windowStart || checkOut > windowEnd) continue;

    const hasActiveJob = cleaningJobs.some((j) =>
      !TERMINAL_CLEANING_STATUSES.has(j.status) &&
      (j.bookingId === booking.id ||
       (j.unit === booking.unit && j.scheduledDate === checkOut))
    );
    if (hasActiveJob) continue;

    out.push({
      kind: 'missing_cleaning',
      dateStr: checkOut,
      unit: booking.unit,
      bookingId: booking.id,
      message: `No cleaning scheduled for ${booking.unit} checkout`,
      fixHref: `/admin/cleaning?new=1&unit=${encodeURIComponent(booking.unit)}&date=${checkOut}&bookingId=${booking.id}`,
    });
  }

  // Date mismatch: active cleaning in-window, linked to a booking whose checkout is a different day.
  for (const job of cleaningJobs) {
    if (TERMINAL_CLEANING_STATUSES.has(job.status)) continue;
    if (!job.bookingId) continue;
    if (job.manualOverride) continue;
    if (job.scheduledDate < windowStart || job.scheduledDate > windowEnd) continue;

    const booking = bookings.find((b) => b.id === job.bookingId);
    if (!booking) continue;
    const bookingCheckout = ymd(booking.checkOutDate);
    if (bookingCheckout === job.scheduledDate) continue;

    out.push({
      kind: 'date_mismatch',
      dateStr: job.scheduledDate,
      unit: job.unit,
      bookingId: booking.id,
      cleaningJobId: job.id,
      message: `Cleaning on ${formatDateShort(job.scheduledDate)} but checkout is ${formatDateShort(bookingCheckout)}`,
      fixHref: `/admin/cleaning#job-${job.id}`,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern=buildWarningList`
Expected: 7 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/calendar-helpers.js lib/__tests__/calendar-helpers.test.js
git commit -m "feat(calendar-helpers): add buildWarningList with windowed checks"
```

---

## Task 2: Add `buildAgendaForWindow` helper + tests

**Files:**
- Modify: `lib/calendar-helpers.js`
- Test: `lib/__tests__/calendar-helpers.test.js`

Purpose: pure function that turns bookings + cleaning jobs into day-grouped agenda cards for a forward-looking window. Each emitted event is one of three kinds: `check_in`, `check_out`, or `cleaning`. Events mid-stay (nights without CI/CO) are intentionally excluded — they're visible in Calendar only.

- [ ] **Step 1: Append failing tests**

Append to `lib/__tests__/calendar-helpers.test.js`:

```javascript
import { buildAgendaForWindow } from '../calendar-helpers.js';

test('buildAgendaForWindow emits check-in + check-out events per booking', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-15', checkOutDate: '2026-04-18', guestName: 'Ana', source: 'airbnb', status: 'active' },
  ];
  const days = buildAgendaForWindow(bookings, [], '2026-04-15', 14);
  // Days with events: Apr 15 (check-in) and Apr 18 (check-out)
  const dates = days.map((d) => d.dateStr);
  assert.ok(dates.includes('2026-04-15'));
  assert.ok(dates.includes('2026-04-18'));

  const apr15 = days.find((d) => d.dateStr === '2026-04-15');
  assert.equal(apr15.events.length, 1);
  assert.equal(apr15.events[0].kind, 'check_in');
  assert.equal(apr15.events[0].bookingId, 'b1');
  assert.equal(apr15.events[0].guestName, 'Ana');
  assert.equal(apr15.events[0].unit, 'Coqui Tierra');
  assert.equal(apr15.events[0].source, 'airbnb');

  const apr18 = days.find((d) => d.dateStr === '2026-04-18');
  assert.equal(apr18.events[0].kind, 'check_out');
});

test('buildAgendaForWindow emits cleaning events with status label', () => {
  const cleaningJobs = [
    { id: 'j1', unit: 'Coqui Cielo', scheduledDate: '2026-04-16', status: 'scheduled', assigneeName: 'Luisa' },
  ];
  const days = buildAgendaForWindow([], cleaningJobs, '2026-04-15', 14);
  const apr16 = days.find((d) => d.dateStr === '2026-04-16');
  assert.equal(apr16.events.length, 1);
  assert.equal(apr16.events[0].kind, 'cleaning');
  assert.equal(apr16.events[0].cleaningJobId, 'j1');
  assert.equal(apr16.events[0].unit, 'Coqui Cielo');
  assert.equal(apr16.events[0].assigneeName, 'Luisa');
});

test('buildAgendaForWindow excludes mid-stay nights', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-15', checkOutDate: '2026-04-20', guestName: 'Ana', status: 'active' },
  ];
  const days = buildAgendaForWindow(bookings, [], '2026-04-15', 14);
  const dates = days.map((d) => d.dateStr);
  // Only CI (Apr 15) and CO (Apr 20) should appear; Apr 16/17/18/19 should not
  assert.deepEqual(dates.sort(), ['2026-04-15', '2026-04-20']);
});

test('buildAgendaForWindow excludes events outside window', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-05-10', checkOutDate: '2026-05-12', guestName: 'Ana', status: 'active' },
  ];
  const days = buildAgendaForWindow(bookings, [], '2026-04-15', 14);
  assert.equal(days.length, 0);
});

test('buildAgendaForWindow excludes cancelled bookings and terminal cleanings', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-15', checkOutDate: '2026-04-18', guestName: 'Ana', status: 'cancelled' },
  ];
  const cleaningJobs = [
    { id: 'j1', unit: 'Coqui Cielo', scheduledDate: '2026-04-16', status: 'cancelled' },
  ];
  const days = buildAgendaForWindow(bookings, cleaningJobs, '2026-04-15', 14);
  assert.equal(days.length, 0);
});

test('buildAgendaForWindow sorts events within a day: check-in, check-out, cleaning', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-15', checkOutDate: '2026-04-15', guestName: 'CIguest', status: 'active' },
    { id: 'b2', unit: 'Coqui Cielo', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', guestName: 'COguest', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', unit: 'Coqui Cielo', scheduledDate: '2026-04-15', status: 'scheduled' },
  ];
  const days = buildAgendaForWindow(bookings, cleaningJobs, '2026-04-15', 14);
  const apr15 = days.find((d) => d.dateStr === '2026-04-15');
  assert.equal(apr15.events.length, 3);
  assert.equal(apr15.events[0].kind, 'check_in');
  assert.equal(apr15.events[1].kind, 'check_out');
  assert.equal(apr15.events[2].kind, 'cleaning');
});

test('buildAgendaForWindow returns days in ascending date order', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-20', checkOutDate: '2026-04-22', guestName: 'B', status: 'active' },
    { id: 'b2', unit: 'Coqui Cielo', checkInDate: '2026-04-16', checkOutDate: '2026-04-18', guestName: 'A', status: 'active' },
  ];
  const days = buildAgendaForWindow(bookings, [], '2026-04-15', 14);
  const dates = days.map((d) => d.dateStr);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern=buildAgendaForWindow`
Expected: FAIL with `buildAgendaForWindow is not a function`.

- [ ] **Step 3: Implement `buildAgendaForWindow`**

Append to `lib/calendar-helpers.js`:

```javascript
/**
 * Compute the last date in an inclusive forward window starting at todayStr.
 * Returns YYYY-MM-DD.
 */
function addDaysYmd(startStr, days) {
  const [y, m, d] = startStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dateToYMD(date);
}

/**
 * Build a day-grouped agenda for a forward-looking window.
 *
 * Window is inclusive: starts at todayStr, ends at todayStr + (days - 1).
 * Only emits days that contain at least one event.
 *
 * Event kinds (sorted in this order within a day):
 *   - check_in   { kind, dateStr, bookingId, guestName, unit, source, nights, checkInTime? }
 *   - check_out  { kind, dateStr, bookingId, guestName, unit, source, nights }
 *   - cleaning   { kind, dateStr, cleaningJobId, unit, status, assigneeName?, checkoutTime?, manualOverride? }
 *
 * Returns: [{ dateStr, events: [...] }]  sorted by dateStr ascending.
 */
export function buildAgendaForWindow(bookings, cleaningJobs, todayStr, days) {
  const windowEnd = addDaysYmd(todayStr, days - 1);
  const byDate = new Map();

  function push(dateStr, event) {
    if (dateStr < todayStr || dateStr > windowEnd) return;
    if (!byDate.has(dateStr)) byDate.set(dateStr, []);
    byDate.get(dateStr).push(event);
  }

  for (const booking of bookings) {
    if (booking.status === 'cancelled') continue;
    const ci = ymd(booking.checkInDate);
    const co = ymd(booking.checkOutDate);
    const nights = getNightCount(ci, co);

    push(ci, {
      kind: 'check_in',
      dateStr: ci,
      bookingId: booking.id,
      guestName: booking.guestName || 'Guest',
      unit: booking.unit,
      source: booking.source || 'manual',
      nights,
      checkInTime: booking.checkInTime || null,
    });
    push(co, {
      kind: 'check_out',
      dateStr: co,
      bookingId: booking.id,
      guestName: booking.guestName || 'Guest',
      unit: booking.unit,
      source: booking.source || 'manual',
      nights,
    });
  }

  for (const job of cleaningJobs) {
    if (['cancelled', 'deleted', 'archived'].includes(job.status)) continue;
    push(job.scheduledDate, {
      kind: 'cleaning',
      dateStr: job.scheduledDate,
      cleaningJobId: job.id,
      unit: job.unit,
      status: job.status,
      assigneeName: job.assigneeName || null,
      checkoutTime: job.checkoutTime || null,
      manualOverride: !!job.manualOverride,
    });
  }

  const kindOrder = { check_in: 0, check_out: 1, cleaning: 2 };
  const out = [];
  for (const [dateStr, events] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    events.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
    out.push({ dateStr, events });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern=buildAgendaForWindow`
Expected: 7 tests, all PASS.

- [ ] **Step 5: Run full helpers test suite to verify no regressions**

Run: `npm test`
Expected: ALL existing + new tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/calendar-helpers.js lib/__tests__/calendar-helpers.test.js
git commit -m "feat(calendar-helpers): add buildAgendaForWindow with event grouping + sort"
```

---

## Task 3: Add prefill props to `CleaningJobForm`

**Files:**
- Modify: `components/admin/CleaningJobForm.js`

Purpose: let a caller pre-seed `unit` and `scheduledDate` so the `Fix →` deep-link opens the form ready-to-save. No tests are added here (no existing test infra for React components; verification is manual in Task 4).

- [ ] **Step 1: Read the current file top**

Read: `components/admin/CleaningJobForm.js` lines 1-90 to locate the `useState` declarations and the `useEffect(open)` block.

- [ ] **Step 2: Update the component signature + add a prefill useEffect**

Replace the current signature and state init (`export default function CleaningJobForm({ open, onClose, onCreated }) { ... const [unit, setUnit] = useState(''); const [scheduledDate, setScheduledDate] = useState('');`) with:

```javascript
/**
 * CleaningJobForm — modal form for creating ad-hoc cleaning jobs.
 *
 * Props:
 *   open         {boolean}           whether the modal is visible
 *   onClose      {function}          close callback
 *   onCreated    {function}          called with the new job data after successful creation
 *   initialUnit  {string} (optional) prefill unit name on open
 *   initialDate  {string} (optional) prefill scheduledDate (YYYY-MM-DD) on open
 */
export default function CleaningJobForm({ open, onClose, onCreated, initialUnit = '', initialDate = '' }) {
  const [unit, setUnit] = useState(initialUnit);
  const [scheduledDate, setScheduledDate] = useState(initialDate);
```

- [ ] **Step 3: Seed state on open transition**

Immediately after the existing `useEffect(() => { if (!open) return; async function fetchData() ...` block, add a second `useEffect` that re-seeds `unit` and `scheduledDate` every time the modal opens:

```javascript
  // Re-seed prefill when modal opens (props may change between opens)
  useEffect(() => {
    if (!open) return;
    if (initialUnit) setUnit(initialUnit);
    if (initialDate) setScheduledDate(initialDate);
  }, [open, initialUnit, initialDate]);
```

- [ ] **Step 4: Verify the app still builds**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds (or existing pre-change warnings only; no new errors referencing `CleaningJobForm`).

- [ ] **Step 5: Commit**

```bash
git add components/admin/CleaningJobForm.js
git commit -m "feat(cleaning-form): accept initialUnit + initialDate prefill props"
```

---

## Task 4: Auto-open Cleaning Job form from query params

**Files:**
- Modify: `app/admin/cleaning/page.js`

Purpose: when the admin calendar deep-links to `/admin/cleaning?new=1&unit=<name>&date=<YYYY-MM-DD>&bookingId=<id>`, the cleaning page opens the `CleaningJobForm` with the unit + date pre-filled, then strips those params from the URL.

- [ ] **Step 1: Locate the `showForm` state and `CleaningJobForm` usage**

Read `app/admin/cleaning/page.js` top ~30 lines + the area around `<CleaningJobForm` (around line 407). Note the `useState` for `showForm` and the current render of the form.

- [ ] **Step 2: Add query-param reading + auto-open effect**

Near the top of the component (just after the existing `useState`/hook calls), add:

```javascript
import { useRouter, useSearchParams } from 'next/navigation';

// inside the component, after existing state:
const router = useRouter();
const searchParams = useSearchParams();
const [prefill, setPrefill] = useState({ unit: '', date: '' });

useEffect(() => {
  if (searchParams.get('new') !== '1') return;
  const unit = searchParams.get('unit') || '';
  const date = searchParams.get('date') || '';
  setPrefill({ unit, date });
  setShowForm(true);
  // Clear query params so reload doesn't re-open the form
  const params = new URLSearchParams(searchParams.toString());
  ['new', 'unit', 'date', 'bookingId'].forEach((k) => params.delete(k));
  const qs = params.toString();
  router.replace(qs ? `/admin/cleaning?${qs}` : '/admin/cleaning', { scroll: false });
}, [searchParams, router]);
```

If `useRouter`/`useSearchParams` is already imported, don't duplicate the import — merge into the existing line.

- [ ] **Step 3: Pass prefill into `CleaningJobForm`**

Change the existing form render (around line 407):

```javascript
      <CleaningJobForm
        open={showForm}
        onClose={() => { setShowForm(false); setPrefill({ unit: '', date: '' }); }}
        onCreated={() => {}}
        initialUnit={prefill.unit}
        initialDate={prefill.date}
      />
```

- [ ] **Step 4: Manual verification**

1. Run dev server: `npm run dev`
2. Navigate manually to `http://localhost:3000/admin/cleaning?new=1&unit=Coqui%20Tierra&date=2026-04-20`
3. Confirm: the form opens with unit "Coqui Tierra" selected and date "2026-04-20" prefilled.
4. Confirm: the URL changes to `/admin/cleaning` (no query params) without reloading.
5. Close the form — reopening it via "New Job" button should not pre-fill any unit/date.

- [ ] **Step 5: Commit**

```bash
git add app/admin/cleaning/page.js
git commit -m "feat(cleaning-page): auto-open form from ?new=1&unit&date deep-links"
```

---

## Task 5: Refactor admin calendar — extract `CalendarView` with new cell design

**Files:**
- Modify: `app/admin/calendar/page.js`

Purpose: replace the current day cell (unit bars + CI/CO text + cleaning dots + A + ⚠) with two stacked unit color pills + day number + optional warning outline. Extract into an in-file `CalendarView` component. Keep the existing month navigation + unit filter tabs.

- [ ] **Step 1: Pre-read the full file**

Read `app/admin/calendar/page.js` in full (603 lines). Note: `CalendarDayCell`, `DayDetailSheet`, `CalendarLegend`, `detectConflicts`, and the main `OperationalCalendar` export all live here.

- [ ] **Step 2: Replace `CalendarDayCell` with the new pill-cell design**

Replace the full `CalendarDayCell` function (currently lines ~93-169) with:

```javascript
function CalendarDayCell({ cell, dayData, isToday, isSelected, onTap, unitNames }) {
  if (!cell) return <div className="min-h-[58px]" />;

  const { bookings = [], conflicts = [] } = dayData || {};
  const hasConflict = conflicts.length > 0;

  // For each unit (by index, stable across the month), is that unit occupied this day?
  const unitOccupied = unitNames.map((name) =>
    bookings.some((b) => b.booking.unit === name && !b.isCheckOut)
  );

  return (
    <button
      onClick={() => onTap(cell.dateStr)}
      className={`relative min-h-[58px] rounded-lg p-1.5 w-full text-left transition-colors ${
        isSelected ? 'ring-2 ring-green-500' : ''
      } ${hasConflict ? 'ring-1 ring-red-400' : ''}`}
    >
      {/* Warning dot (top-right) */}
      {hasConflict && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
      )}

      {/* Day number */}
      <div className="flex justify-center mb-1.5">
        <span
          className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
            isToday ? 'bg-green-600 text-white font-bold' : 'text-gray-600'
          }`}
        >
          {cell.dayNum}
        </span>
      </div>

      {/* Two stacked unit pills */}
      <div className="flex flex-col gap-1 px-0.5">
        {unitNames.map((_, unitIdx) => {
          const palette = UNIT_PALETTES[unitIdx % UNIT_PALETTES.length];
          const filled = unitOccupied[unitIdx];
          return (
            <div
              key={unitIdx}
              className={`h-[6px] rounded ${filled ? palette.bar.active : 'bg-gray-100'}`}
            />
          );
        })}
      </div>
    </button>
  );
}
```

Notes on semantics:
- `isCheckOut` filter: checkout day doesn't count as "occupied" — the guest leaves that morning. This matches the existing `bookingDaysInMonth` exclusion.
- Status-based shading (`upcoming` / `active` / `completed`) is intentionally dropped from cells; it was over-granular for a glance view.

- [ ] **Step 3: Replace `CalendarLegend` with a minimal unit-only legend**

Replace the full `CalendarLegend` function (currently lines ~325-368) with:

```javascript
function CalendarLegend({ unitNames }) {
  return (
    <div className="border-t border-gray-100 pt-3 px-1 flex flex-wrap gap-3 text-[11px] text-gray-500">
      {unitNames.map((name, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <span className={`w-4 h-1.5 rounded ${UNIT_PALETTES[idx % UNIT_PALETTES.length].bar.active}`} />
          <span>{name}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        <span>Warning</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the page still compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds (unused imports may warn — fix those as they arise).

- [ ] **Step 5: Manual sanity-check the cell rendering**

Run dev server (`npm run dev`), navigate to `/admin/calendar`, confirm:
- Days render as day-number + 2 stacked pills.
- Days with active bookings for Tierra show top pill filled (teal); Cielo shows bottom pill filled (amber).
- Days with no bookings show both pills as faint grey.
- Conflict days show a thin red outline + tiny red dot.
- Legend below shows only 2 unit swatches + "Warning".

Do not commit yet — this is the pre-Agenda state. Moving on to add the toggle.

---

## Task 6: Add `AgendaView` component + Agenda/Calendar segmented toggle

**Files:**
- Modify: `app/admin/calendar/page.js`

Purpose: add the landing Agenda view and a segmented toggle so the admin can switch between Agenda and Calendar. Agenda pins warnings above day-grouped event cards for the next 14 days.

- [ ] **Step 1: Add imports at the top of the file**

Inside the existing import from `@/lib/calendar-helpers`, add `buildAgendaForWindow`, `buildWarningList`:

```javascript
import {
  ymd,
  dateToYMD,
  formatMonthYear,
  formatDateFull,
  formatDateShort,
  getNightCount,
  firstName,
  bookingStatus,
  buildCalendarGrid,
  bookingDaysInMonth,
  getUnitPalette,
  UNIT_PALETTES,
  CLEANING_STATUS_COLORS,
  CLEANING_STATUS_LABELS,
  getDayContext,
  TODAY,
  buildAgendaForWindow,
  buildWarningList,
} from '@/lib/calendar-helpers';
```

Also add at the top of the file (after the existing `import Link`):

```javascript
import { useMemo } from 'react'; // if not already imported in this file
```

(It is already imported; no change needed — verify with your editor.)

- [ ] **Step 2: Add `AgendaView` component above `OperationalCalendar`**

Insert this new component just above the `export default function OperationalCalendar()` declaration:

```javascript
// ---------------------------------------------------------------------------
// Agenda View
// ---------------------------------------------------------------------------

function AgendaView({ warnings, agendaDays, unitNames, todayStr, tomorrowStr }) {
  function dayLabel(dateStr) {
    if (dateStr === todayStr) return `Today · ${formatDateFull(dateStr)}`;
    if (dateStr === tomorrowStr) return `Tomorrow · ${formatDateFull(dateStr)}`;
    return formatDateFull(dateStr);
  }

  if (warnings.length === 0 && agendaDays.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center">
        <p className="text-sm text-gray-400">Nothing scheduled in the next 14 days.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Warnings — pinned above day-grouped cards */}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-2">
          {warnings.map((w, i) => (
            <div
              key={i}
              className="bg-red-50 border border-red-200 border-l-[3px] border-l-red-500 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-red-800">
                  ⚠ {w.kind === 'missing_cleaning' ? 'No cleaning scheduled' : 'Cleaning date mismatch'}
                </span>
                <span className="text-xs text-red-600">{formatDateShort(w.dateStr)}</span>
              </div>
              <p className="text-xs text-red-700">{w.message}</p>
              <Link
                href={w.fixHref}
                className="mt-1.5 inline-block text-xs font-semibold text-red-700 hover:text-red-800 underline"
              >
                {w.kind === 'missing_cleaning' ? 'Schedule cleaning →' : 'Fix date →'}
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Day-grouped events */}
      {agendaDays.map(({ dateStr, events }) => (
        <div key={dateStr}>
          <h3 className={`text-[10px] font-bold uppercase tracking-wider mb-2 px-0.5 ${
            dateStr === todayStr ? 'text-green-700' : 'text-gray-400'
          }`}>
            {dayLabel(dateStr)}
          </h3>
          <div className="flex flex-col gap-2">
            {events.map((ev, i) => (
              <AgendaEventCard key={i} event={ev} unitNames={unitNames} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgendaEventCard({ event, unitNames }) {
  const palette = getUnitPalette(event.unit, unitNames);
  const accent = palette.accent.active;

  let title;
  let badges = [];
  let meta;

  if (event.kind === 'check_in') {
    title = event.guestName;
    badges.push({ label: 'Check-in', className: 'bg-blue-100 text-blue-700' });
    if (event.source === 'airbnb') badges.push({ label: 'Airbnb', className: 'bg-pink-100 text-pink-700' });
    meta = `${event.unit} · ${event.checkInTime || '4:00 PM'} · ${event.nights} night${event.nights !== 1 ? 's' : ''}`;
  } else if (event.kind === 'check_out') {
    title = event.guestName;
    badges.push({ label: 'Check-out', className: 'bg-red-100 text-red-700' });
    if (event.source === 'airbnb') badges.push({ label: 'Airbnb', className: 'bg-pink-100 text-pink-700' });
    meta = `${event.unit} · 11:00 AM · ${event.nights} night${event.nights !== 1 ? 's' : ''}`;
  } else {
    // cleaning
    title = `${event.unit} cleaning`;
    const label = CLEANING_STATUS_LABELS[event.status] || event.status;
    const cls = event.status === 'completed'
      ? 'bg-green-100 text-green-700'
      : event.status === 'scheduled'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-amber-100 text-amber-800';
    badges.push({ label, className: cls });
    meta = `${event.assigneeName || 'Unassigned'} · checkout ${event.checkoutTime || '11:00 AM'}`;
  }

  const href = event.kind === 'cleaning'
    ? `/admin/cleaning#job-${event.cleaningJobId}`
    : `/admin/bookings#booking-${event.bookingId}`;

  return (
    <Link
      href={href}
      className={`block bg-white border-l-[3px] ${accent} rounded-r-lg shadow-sm hover:shadow-md transition p-3`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-gray-900">{title}</span>
        <div className="flex gap-1.5">
          {badges.map((b, i) => (
            <span key={i} className={`text-[10px] font-semibold px-2 py-0.5 rounded ${b.className}`}>
              {b.label}
            </span>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">{meta}</p>
    </Link>
  );
}
```

- [ ] **Step 3: Replace the body of `OperationalCalendar` to add the toggle**

Locate the `OperationalCalendar` component body (around line 374 onward) and replace its state + memoized values + return JSX with:

```javascript
export default function OperationalCalendar() {
  const { data: bookings, loading: bookingsLoading } = useCollection('bookings', [orderBy('checkInDate', 'asc')]);
  const { data: cleaningJobs, loading: jobsLoading } = useCollection('cleaning_jobs', [orderBy('scheduledDate', 'asc')]);
  const { data: settings } = useDocument('settings', 'property');
  const { isAdmin } = useAuth();
  const unitNames = getUnitNames(settings);

  const now = new Date();
  const [view, setView] = useState('agenda'); // 'agenda' | 'calendar'
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [unitFilter, setUnitFilter] = useState('All');

  const loading = bookingsLoading || jobsLoading;
  const todayStr = TODAY;
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return dateToYMD(d);
  }, []);

  // Filter bookings + jobs by unit
  const filteredBookings = useMemo(() => {
    let filtered = bookings.filter((b) => b.status !== 'cancelled');
    if (unitFilter !== 'All') filtered = filtered.filter((b) => b.unit === unitFilter);
    return filtered;
  }, [bookings, unitFilter]);

  const filteredJobs = useMemo(() => {
    let filtered = cleaningJobs;
    if (unitFilter !== 'All') filtered = filtered.filter((j) => j.unit === unitFilter);
    return filtered;
  }, [cleaningJobs, unitFilter]);

  // Agenda data (14-day forward window)
  const AGENDA_WINDOW_DAYS = 14;
  const agendaDays = useMemo(
    () => buildAgendaForWindow(filteredBookings, filteredJobs, todayStr, AGENDA_WINDOW_DAYS),
    [filteredBookings, filteredJobs, todayStr]
  );

  const agendaWarnings = useMemo(() => {
    const windowEnd = (() => {
      const d = new Date();
      d.setDate(d.getDate() + AGENDA_WINDOW_DAYS - 1);
      return dateToYMD(d);
    })();
    // Warnings use unfiltered bookings (we always want to see warnings even when filtering to one unit)
    const list = buildWarningList(bookings, cleaningJobs, unitNames, todayStr, windowEnd);
    if (unitFilter === 'All') return list;
    return list.filter((w) => w.unit === unitFilter);
  }, [bookings, cleaningJobs, unitNames, todayStr, unitFilter]);

  // Calendar data (current month)
  const calendarGrid = useMemo(
    () => buildCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const dayDataMap = useMemo(() => {
    const map = {};
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const monthStart = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
    const monthEnd = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      map[dateStr] = { bookings: [], cleaningJobs: [], conflicts: [] };
    }

    for (const booking of filteredBookings) {
      const range = bookingDaysInMonth(booking, viewYear, viewMonth);
      if (!range) continue;
      const status = bookingStatus(booking);
      const ci = ymd(booking.checkInDate);
      const co = ymd(booking.checkOutDate);

      for (let d = range.startDay; d <= range.endDay; d++) {
        const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (map[dateStr]) {
          map[dateStr].bookings.push({
            booking,
            status,
            isCheckIn: dateStr === ci,
            isCheckOut: false,
          });
        }
      }

      const coMonth = parseInt(co.split('-')[1], 10) - 1;
      const coYear = parseInt(co.split('-')[0], 10);
      if (coYear === viewYear && coMonth === viewMonth && map[co]) {
        map[co].bookings.push({ booking, status, isCheckIn: false, isCheckOut: true });
      }
    }

    for (const job of filteredJobs) {
      if (map[job.scheduledDate]) map[job.scheduledDate].cleaningJobs.push(job);
    }

    const monthWarnings = buildWarningList(bookings, filteredJobs, unitNames, monthStart, monthEnd);
    for (const w of monthWarnings) {
      if (map[w.dateStr]) map[w.dateStr].conflicts.push(w);
    }

    return map;
  }, [filteredBookings, filteredJobs, bookings, viewYear, viewMonth, unitNames]);

  const monthConflictCount = useMemo(
    () => Object.values(dayDataMap).reduce((sum, d) => sum + d.conflicts.length, 0),
    [dayDataMap]
  );

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }
  function goToToday() {
    const n = new Date();
    setViewYear(n.getFullYear());
    setViewMonth(n.getMonth());
  }
  function handleDayTap(dateStr) {
    setSelectedDate(selectedDate === dateStr ? null : dateStr);
  }

  if (loading) {
    return (
      <div className="px-4 py-6 flex flex-col gap-4 animate-pulse">
        <div className="h-7 bg-gray-200 rounded w-1/3" />
        <div className="h-80 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
        <p className="text-sm text-gray-500">Reservations, checkouts, and cleaning jobs</p>
      </div>

      {/* Agenda / Calendar segmented toggle */}
      <div className="flex bg-gray-100 rounded-full p-1">
        {[
          { key: 'agenda', label: 'Agenda' },
          { key: 'calendar', label: 'Calendar' },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setView(opt.key)}
            className={`flex-1 py-2 text-sm font-semibold rounded-full transition ${
              view === opt.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Unit filter */}
      <div className="flex gap-2">
        {['All', ...unitNames].map((label) => (
          <button
            key={label}
            onClick={() => setUnitFilter(label)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              unitFilter === label ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'agenda' ? (
        <AgendaView
          warnings={agendaWarnings}
          agendaDays={agendaDays}
          unitNames={unitNames}
          todayStr={todayStr}
          tomorrowStr={tomorrowStr}
        />
      ) : (
        <>
          {/* Warning-count banner (tap → Agenda) */}
          {monthConflictCount > 0 && (
            <button
              onClick={() => setView('agenda')}
              className="w-full bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2 hover:bg-red-100 transition"
            >
              <span>⚠</span>
              <span className="flex-1 text-left">{monthConflictCount} warning{monthConflictCount !== 1 ? 's' : ''} this month</span>
              <span>→</span>
            </button>
          )}

          {/* Calendar card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
              <button onClick={goToToday} className="text-sm font-bold text-gray-900 hover:text-green-700 transition">
                {formatMonthYear(viewYear, viewMonth)}
              </button>
              <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </button>
            </div>

            <div className="grid grid-cols-7 border-b border-gray-100">
              {DAY_HEADERS.map((d) => (
                <div key={d} className="text-center py-2 text-[10px] font-semibold text-gray-400 uppercase">{d}</div>
              ))}
            </div>

            <div className="p-1">
              {calendarGrid.map((row, rowIdx) => (
                <div key={rowIdx} className="grid grid-cols-7">
                  {row.map((cell, cellIdx) => (
                    <CalendarDayCell
                      key={cellIdx}
                      cell={cell}
                      dayData={cell ? dayDataMap[cell.dateStr] : null}
                      isToday={cell?.dateStr === TODAY}
                      isSelected={cell?.dateStr === selectedDate}
                      onTap={handleDayTap}
                      unitNames={unitNames}
                    />
                  ))}
                </div>
              ))}
            </div>

            <div className="px-3 pb-3">
              <CalendarLegend unitNames={unitNames} />
            </div>
          </div>

          {selectedDate && dayDataMap[selectedDate] && (
            <DayDetailSheet
              dateStr={selectedDate}
              dayData={dayDataMap[selectedDate]}
              unitNames={unitNames}
              onClose={() => setSelectedDate(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Delete the obsolete `detectConflicts` function**

Remove the `detectConflicts` function (currently lines ~42-87) entirely — it's replaced by `buildWarningList`.

- [ ] **Step 5: Verify build**

Run: `npm run build 2>&1 | tail -30`
Expected: build succeeds. Fix any unused-import warnings by removing the unused imports.

- [ ] **Step 6: Manual verification (dev server)**

Run `npm run dev`, navigate to `/admin/calendar`:
- Toggle shows Agenda selected by default.
- Agenda lists Today/Tomorrow/future days with check-in / check-out / cleaning cards.
- Warnings (if any exist for the next 14 days) appear as red cards above the day groups with a Fix link.
- Clicking toggle → Calendar shows month grid with 2-pill-per-day cells.
- Warning banner appears when month has conflicts; tapping it switches back to Agenda.
- Unit filter tabs work on both views.

- [ ] **Step 7: Commit**

```bash
git add app/admin/calendar/page.js
git commit -m "feat(admin-calendar): add Agenda/Calendar toggle + redesign cell as unit pills"
```

---

## Task 7: Simplify `DayDetailSheet`

**Files:**
- Modify: `app/admin/calendar/page.js`

Purpose: drop the "A" Airbnb duplication and the "View Forum →" cleaning link. Keep section order Warnings → Reservations → Cleaning.

- [ ] **Step 1: Replace `DayDetailSheet` body**

Replace the existing `DayDetailSheet` function (currently ~lines 175-319) with:

```javascript
function DayDetailSheet({ dateStr, dayData, unitNames, onClose }) {
  const { bookings = [], cleaningJobs = [], conflicts = [] } = dayData || {};
  const activeJobs = cleaningJobs.filter((j) => !['cancelled', 'deleted', 'archived'].includes(j.status));

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl w-full max-w-lg max-h-[75vh] overflow-y-auto shadow-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="px-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">{formatDateFull(dateStr)}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-4">
          {/* Warnings */}
          {conflicts.length > 0 && (
            <div className="space-y-2">
              {conflicts.map((c, i) => (
                <div key={i} className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
                  <span>⚠</span>
                  <div className="flex-1">
                    <div className="font-semibold">{c.message}</div>
                    <Link href={c.fixHref} className="mt-1 inline-block underline font-semibold">
                      {c.kind === 'missing_cleaning' ? 'Schedule cleaning →' : 'Fix date →'}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reservations */}
          {bookings.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Reservations</h4>
              <div className="space-y-2">
                {bookings.map(({ booking, status, isCheckIn, isCheckOut }) => {
                  const palette = getUnitPalette(booking.unit, unitNames);
                  const ci = ymd(booking.checkInDate);
                  const co = ymd(booking.checkOutDate);
                  const nights = getNightCount(ci, co);
                  const statusLabel = isCheckIn ? 'Check-in' : isCheckOut ? 'Check-out' : status === 'active' ? 'Active' : status === 'upcoming' ? 'Upcoming' : 'Past';
                  const statusCls = isCheckIn ? 'bg-blue-100 text-blue-700' : isCheckOut ? 'bg-red-100 text-red-700' : status === 'active' ? 'bg-green-100 text-green-700' : status === 'upcoming' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500';

                  return (
                    <div key={`${booking.id}-${isCheckIn}-${isCheckOut}`} className={`border-l-[3px] ${palette.accent.active} rounded-r-lg bg-gray-50 p-3`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-900">{booking.guestName || 'Guest'}</span>
                        <div className="flex items-center gap-1.5">
                          {booking.source === 'airbnb' && (
                            <span className="text-[10px] font-semibold bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">Airbnb</span>
                          )}
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusCls}`}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={`font-medium ${palette.text}`}>{booking.unit}</span>
                        <span>·</span>
                        <span>{formatDateShort(ci)} → {formatDateShort(co)}</span>
                        <span>·</span>
                        <span>{nights} night{nights !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cleaning */}
          {activeJobs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Cleaning</h4>
              <div className="space-y-2">
                {activeJobs.map((job) => {
                  const palette = getUnitPalette(job.unit, unitNames);
                  return (
                    <Link
                      key={job.id}
                      href={`/admin/cleaning#job-${job.id}`}
                      className={`block border-l-[3px] ${palette.accent.active} rounded-r-lg bg-gray-50 p-3 hover:bg-gray-100 transition`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${CLEANING_STATUS_COLORS[job.status] || 'bg-gray-400'}`} />
                          <span className="text-sm font-semibold text-gray-900">
                            {CLEANING_STATUS_LABELS[job.status] || job.status}
                          </span>
                        </div>
                        {job.manualOverride && (
                          <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Pinned</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={`font-medium ${palette.text}`}>{job.unit}</span>
                        <span>·</span>
                        <span>Checkout {job.checkoutTime || '11:00 AM'}</span>
                        <span>·</span>
                        <span>{job.assigneeName || 'Unassigned'}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {bookings.length === 0 && activeJobs.length === 0 && conflicts.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No activity on this date</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds.

- [ ] **Step 3: Manual verification**

Dev server, `/admin/calendar`, Calendar view:
- Tap a day with a reservation + cleaning. Sheet shows Reservations section first, then Cleaning.
- Airbnb bookings show ONE "Airbnb" chip (not duplicated).
- No "View Forum →" link anywhere; clicking a cleaning card navigates to `/admin/cleaning#job-<id>`.
- Tap a day with a warning — warning appears with a Fix link.

- [ ] **Step 4: Commit**

```bash
git add app/admin/calendar/page.js
git commit -m "refactor(admin-calendar): simplify DayDetailSheet — drop Airbnb duplicate + Forum link"
```

---

## Task 8: Final integration verification

**Files:** none modified — this is a verification pass.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: ALL tests PASS (existing + new helper tests).

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: build succeeds, zero errors. Note any warnings and inspect — they should all be pre-existing or trivially unrelated.

- [ ] **Step 3: End-to-end manual verification**

Dev server. Open `/admin/calendar` on a desktop browser (mobile viewport if possible — admin is mobile-first per CLAUDE.md).

Agenda view checklist:
- [ ] Loads by default with "Agenda" tab active.
- [ ] Shows "Today · <weekday, date>" header if any events today.
- [ ] Shows "Tomorrow · <date>" header if any events tomorrow.
- [ ] Warnings (if any) render as red cards pinned above the day groups with working Fix → links.
- [ ] Clicking a reservation card navigates to `/admin/bookings` with the `#booking-<id>` hash.
- [ ] Clicking a cleaning card navigates to `/admin/cleaning` with the `#job-<id>` hash.
- [ ] Unit filter tabs (All / <unit1> / <unit2>) restrict both warnings AND day events.

Calendar view checklist:
- [ ] Toggle switches to month grid.
- [ ] Each day cell shows day number + 2 stacked unit pills (filled color / faint grey).
- [ ] No CI/CO text, no "A" tag, no cleaning status dots in cells.
- [ ] Today's day number is highlighted green.
- [ ] Warning days have thin red outline + small red dot top-right.
- [ ] Warning banner at top (when conflicts exist) — tap jumps to Agenda.
- [ ] Month nav arrows work; tap month label jumps to current month.
- [ ] Tapping a day opens the detail sheet with Warnings → Reservations → Cleaning sections (as applicable).

Deep-link check:
- [ ] In Agenda or sheet, click a missing-cleaning "Schedule cleaning →" link → routes to `/admin/cleaning` with form auto-opened, unit + date pre-filled, URL cleaned.

Cleaner page check:
- [ ] Navigate to `/cleaning` as a cleaner user (or verify visually from role). Confirm cleaner Agenda / Calendar view is unchanged from before.

- [ ] **Step 4: Write a brief verification note to the task log**

Append to `tasks/todo.md` (create if it doesn't exist):

```markdown
## 2026-04-XX Admin Calendar Cleanup — Review

- Spec: `docs/superpowers/specs/2026-04-15-admin-calendar-cleanup-design.md`
- Plan: `docs/superpowers/plans/2026-04-15-admin-calendar-cleanup.md`
- Branch: `feat/admin-calendar-cleanup`
- Tests: `npm test` — all pass
- Manual: verified Agenda/Calendar toggle, color-pill cells, warning pinning, Fix → deep-link prefill, cleaner view unchanged.
```

- [ ] **Step 5: Commit the review note**

```bash
git add tasks/todo.md
git commit -m "docs: note admin calendar cleanup verification"
```

---

## Self-review notes

- Every task has exact files, complete code, and concrete verification commands.
- Tasks 1-2 follow TDD (unit tests for pure helpers).
- Tasks 3-7 do not add tests because the project has no React-component test infrastructure — they rely on manual browser verification with explicit checklists.
- Spec coverage:
  - Agenda + Calendar toggle → Task 6.
  - Color-pill day cell → Task 5.
  - Warnings as action cards → Task 6 (Agenda) + Task 7 (sheet).
  - `Fix →` deep-link → Tasks 1 (`fixHref`), 3 (prefill props), 4 (auto-open).
  - Simplified sheet → Task 7.
  - Cleaner view untouched → implicitly: no task modifies `components/cleaner/CleanerHome.js` (spelled out in Task 8 checklist).
- Type consistency: `buildWarningList` returns `{ kind, dateStr, unit, bookingId, cleaningJobId?, message, fixHref }` — same shape consumed in Agenda warnings and sheet warnings.
- No placeholders, no "similar to" shortcuts, no TBDs.
