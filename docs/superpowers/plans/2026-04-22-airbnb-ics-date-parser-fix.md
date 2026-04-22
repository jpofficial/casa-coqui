# Airbnb ICS Date Parser Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Airbnb ICS date parser so all-day VEVENTs stop being displayed one calendar day earlier, backfill existing Airbnb booking docs to restore correct dates, and audit the second ingestion path.

**Architecture:** Rewrite `veventDateToYMD()` in `functions/icsSync.js` to use UTC getters for DATE-only VEVENTs and `Intl.DateTimeFormat` with `America/Puerto_Rico` for DATE-TIME VEVENTs. Unit-test with fixtures. Ship a standalone Node backfill script that re-derives correct dates from live ICS and cascades to `cleaning_jobs` via the existing CJS cascade logic. Confirm the Lambda email parser does not derive VEVENT dates.

**Tech Stack:** Node 20, Jest 30, `node-ical` 0.26, `firebase-admin` 13.7, Next.js 14 (for optional calendar UI toggle).

**Spec:** [`docs/superpowers/specs/2026-04-22-airbnb-ics-date-parser-fix-design.md`](../specs/2026-04-22-airbnb-ics-date-parser-fix-design.md)

---

## File Structure

**Create:**
- `functions/__tests__/vevent-date.test.js` — Jest unit tests for the parser (new folder, first test in this workspace).
- `functions/lib/ics-date.js` — Extract `veventDateToYMD` as a standalone CJS module so the backfill script and Cloud Function share one implementation.
- `scripts/fix-airbnb-dates.js` — One-shot backfill script, dry-run by default, cascades to cleaning_jobs.

**Modify:**
- `functions/icsSync.js` — Replace the inline `veventDateToYMD` with a re-export from `functions/lib/ics-date.js`, update the two call sites to pass `dateOnly`.

**Audit (read only):**
- `infra/lambda/parse-airbnb-email/index.js` — Confirm Lambda does not parse VEVENT dates. Already spot-checked: `toISOString` usage is on `receivedAt`/`lastEnrichedFromEmailAt`, not on booking dates. Formal confirmation is one task.

**Optional (follow-up, not critical path):**
- `app/admin/calendar/page.js` — Add `sourceFilter` state + pill row.

---

## Task 1: Extract the parser into a shared CJS module with the current (broken) behavior

**Goal:** Refactor without behavior change, so we can swap `icsSync.js`'s inline copy for a module import and share it with the backfill script. This lets Task 2 write unit tests against the module.

**Files:**
- Create: `functions/lib/ics-date.js`
- Modify: `functions/icsSync.js` (lines 71-78)

- [ ] **Step 1: Create `functions/lib/ics-date.js` with the current implementation verbatim**

```js
'use strict';

// ---------------------------------------------------------------------------
// ics-date.js
//
// Date helpers for ICS / VEVENT parsing. Shared between the Cloud Function
// sync loop (functions/icsSync.js) and the one-shot backfill script
// (scripts/fix-airbnb-dates.js) so both paths agree on how a VEVENT date
// maps to a YYYY-MM-DD calendar day.
// ---------------------------------------------------------------------------

/** Convert VEVENT date to YYYY-MM-DD string */
function veventDateToYMD(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

module.exports = { veventDateToYMD };
```

- [ ] **Step 2: Replace the inline function in `functions/icsSync.js` with a require**

In `functions/icsSync.js`, replace lines 67-78 (the helper header comment + function body):

```js
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const { veventDateToYMD } = require('./lib/ics-date');
```

Keep the existing call sites in `processFeed` unchanged for now (Task 3 will update them).

- [ ] **Step 3: Sanity-run Jest to confirm the project still loads**

Run: `cd functions && npx jest --listTests`

Expected output: list of test files (empty or existing). No parse errors.

- [ ] **Step 4: Commit**

```bash
git add functions/lib/ics-date.js functions/icsSync.js
git commit -m "refactor(functions): extract veventDateToYMD into shared module

No behavior change. Prepares for unit tests and for the backfill
script to share the same parser implementation."
```

---

## Task 2: Write failing unit tests for the correct parser behavior

**Goal:** Lock in the expected behavior *before* fixing the bug, per TDD. Tests should fail against the current (broken) implementation.

**Files:**
- Create: `functions/__tests__/vevent-date.test.js`

- [ ] **Step 1: Write the test file**

```js
'use strict';

const ical = require('node-ical');
const { veventDateToYMD } = require('../lib/ics-date');

// Build a minimal iCalendar string with a single VEVENT.
// Airbnb's feed uses DATE-only values; we also exercise DATE-TIME for
// safety against future feed format changes.
function buildIcs(veventBody) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:test-uid@example.com',
    'SUMMARY:Reserved',
    veventBody,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function parseFirstEvent(ics) {
  const parsed = ical.sync.parseICS(ics);
  for (const key of Object.keys(parsed)) {
    if (parsed[key].type === 'VEVENT') return parsed[key];
  }
  throw new Error('no VEVENT found in fixture');
}

describe('veventDateToYMD', () => {
  test('DATE-only DTSTART returns the exact calendar day (Airbnb primary case)', () => {
    const ics = buildIcs('DTSTART;VALUE=DATE:20260415\r\nDTEND;VALUE=DATE:20260420');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start, { dateOnly: event.datetype === 'date' })).toBe('2026-04-15');
  });

  test('DATE-only DTEND returns the exact calendar day (exclusive per iCal spec)', () => {
    const ics = buildIcs('DTSTART;VALUE=DATE:20260415\r\nDTEND;VALUE=DATE:20260420');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.end, { dateOnly: event.datetype === 'date' })).toBe('2026-04-20');
  });

  test('DATE-only at month boundary', () => {
    const ics = buildIcs('DTSTART;VALUE=DATE:20260430\r\nDTEND;VALUE=DATE:20260501');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start, { dateOnly: event.datetype === 'date' })).toBe('2026-04-30');
    expect(veventDateToYMD(event.end, { dateOnly: event.datetype === 'date' })).toBe('2026-05-01');
  });

  test('DATE-only at year boundary', () => {
    const ics = buildIcs('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start, { dateOnly: event.datetype === 'date' })).toBe('2026-12-31');
    expect(veventDateToYMD(event.end, { dateOnly: event.datetype === 'date' })).toBe('2027-01-01');
  });

  test('DATE-TIME with TZID=America/Puerto_Rico resolves to local calendar day', () => {
    const ics = buildIcs(
      'DTSTART;TZID=America/Puerto_Rico:20260415T160000\r\n' +
      'DTEND;TZID=America/Puerto_Rico:20260420T110000'
    );
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start)).toBe('2026-04-15');
    expect(veventDateToYMD(event.end)).toBe('2026-04-20');
  });

  test('DATE-TIME in UTC returns the Puerto Rico calendar day', () => {
    // 2026-04-15T02:00:00Z is 2026-04-14T22:00:00 in America/Puerto_Rico (UTC-4).
    // The parser must return the Puerto Rico local day, not the UTC day.
    const ics = buildIcs('DTSTART:20260415T020000Z\r\nDTEND:20260415T030000Z');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start)).toBe('2026-04-14');
  });

  test('null and invalid inputs return null without throwing', () => {
    expect(veventDateToYMD(null)).toBeNull();
    expect(veventDateToYMD(undefined)).toBeNull();
    expect(veventDateToYMD(new Date('not a date'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they FAIL**

Run: `cd functions && npx jest __tests__/vevent-date.test.js`

Expected: At least three test failures. The broken parser will shift DATE-only values by one day in either direction depending on server TZ, and will return the UTC day (not PR local day) for DATE-TIME. Example failure message:

```
Expected: "2026-04-15"
Received: "2026-04-14"
```

Do not proceed to Task 3 until the tests fail for the right reason (wrong date string, not a crash / import error).

- [ ] **Step 3: Commit the failing tests**

```bash
git add functions/__tests__/vevent-date.test.js
git commit -m "test(functions): add failing tests for veventDateToYMD

Covers DATE-only DTSTART/DTEND (Airbnb primary case), month/year
boundaries, DATE-TIME with explicit TZID, DATE-TIME in UTC that
must resolve to America/Puerto_Rico local day, and null handling.

Tests fail against the current broken implementation — Task 3
fixes the parser."
```

---

## Task 3: Fix the parser and update call sites

**Goal:** Replace the broken implementation with the corrected two-branch parser. All unit tests from Task 2 pass.

**Files:**
- Modify: `functions/lib/ics-date.js`
- Modify: `functions/icsSync.js` (call sites around line 455-456)

- [ ] **Step 1: Rewrite `functions/lib/ics-date.js`**

Replace the entire contents:

```js
'use strict';

// ---------------------------------------------------------------------------
// ics-date.js
//
// Date helpers for ICS / VEVENT parsing. Shared between the Cloud Function
// sync loop (functions/icsSync.js) and the one-shot backfill script
// (scripts/fix-airbnb-dates.js) so both paths agree on how a VEVENT date
// maps to a YYYY-MM-DD calendar day.
//
// Property timezone is hardcoded to America/Puerto_Rico (single-location
// property, no DST). Change this constant if the property ever moves.
// ---------------------------------------------------------------------------

const PROPERTY_TZ = 'America/Puerto_Rico';

const _zonedYmdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PROPERTY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Convert a VEVENT date (node-ical Date or similar) to a YYYY-MM-DD string.
 *
 * DATE-only VEVENTs (Airbnb's format: `DTSTART;VALUE=DATE:20260415`) are
 * stored by node-ical at UTC midnight. Using UTC getters yields the exact
 * calendar day from the ICS file, independent of server TZ.
 *
 * DATE-TIME VEVENTs are resolved to the property timezone before extracting
 * YMD, because the user cares about the calendar day *at the property*,
 * not in UTC.
 *
 * @param {Date|string} dt         The VEVENT date (node-ical returns Date objects)
 * @param {object} [opts]
 * @param {boolean} [opts.dateOnly] Pass true when parsing a DATE-only VEVENT
 *                                  (i.e. event.datetype === 'date').
 *                                  Also detected via dt.dateOnly === true as a
 *                                  fallback for older node-ical versions.
 * @returns {string|null}           YYYY-MM-DD, or null for falsy/invalid input.
 */
function veventDateToYMD(dt, opts = {}) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;

  if (opts.dateOnly || dt.dateOnly === true) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Intl.DateTimeFormat with 'en-CA' yields YYYY-MM-DD.
  return _zonedYmdFormatter.format(d);
}

module.exports = { veventDateToYMD, PROPERTY_TZ };
```

- [ ] **Step 2: Update call sites in `functions/icsSync.js`**

Find the block in `processFeed` that reads (around line 452-470):

```js
  for (const [, event] of Object.entries(events)) {
    if (event.type !== 'VEVENT') continue;

    const dtstart = veventDateToYMD(event.start);
    const dtend = veventDateToYMD(event.end);
    if (!dtstart || !dtend) continue;
```

Replace with:

```js
  for (const [, event] of Object.entries(events)) {
    if (event.type !== 'VEVENT') continue;

    const isDateOnly = event.datetype === 'date';
    const dtstart = veventDateToYMD(event.start, { dateOnly: isDateOnly });
    const dtend = veventDateToYMD(event.end, { dateOnly: isDateOnly });
    if (!dtstart || !dtend) continue;
```

- [ ] **Step 3: Run the unit tests**

Run: `cd functions && npx jest __tests__/vevent-date.test.js`

Expected: all tests PASS.

- [ ] **Step 4: Lint the changed files**

Run: `cd functions && npx eslint lib/ics-date.js icsSync.js`

Expected: no errors. Fix any style issues inline before committing.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/ics-date.js functions/icsSync.js
git commit -m "fix(functions): correct VEVENT date parsing for all-day events

Airbnb emits DATE-only VEVENTs (DTSTART;VALUE=DATE:20260415).
node-ical stores these at UTC midnight; the previous parser called
toISOString which normalized away from the calendar date in any TZ
other than UTC, shifting displayed dates one day earlier in the
admin calendar.

Fixed parser branches on dateOnly:
- DATE-only: use UTC getters (the ICS value is the calendar day).
- DATE-TIME: resolve through America/Puerto_Rico via Intl.

Call sites in icsSync.js now pass { dateOnly } explicitly.
Task 6 backfills existing bookings created with the broken parser."
```

---

## Task 4: Audit the Lambda email ingestion path

**Goal:** Confirm `infra/lambda/parse-airbnb-email/index.js` does not derive `checkInDate`/`checkOutDate` via the broken pattern. Spec requires this audit; preliminary grep showed Lambda only sets timestamp fields (`receivedAt`, `lastEnrichedFromEmailAt`) via `toISOString`, not booking dates. Verify formally and document.

**Files:**
- Read: `infra/lambda/parse-airbnb-email/index.js`

- [ ] **Step 1: Confirm Lambda does not write `checkInDate` or `checkOutDate`**

Run: `grep -n "checkInDate\|checkOutDate" infra/lambda/parse-airbnb-email/index.js`

Expected: empty output (Lambda only writes to `airbnb_messages_quarantine` with enrichment fields like `guestName`, `guestCount`, `payoutAmount`, `guestMessage` — never booking dates). If non-empty, STOP and read those lines to decide whether they use `toISOString` on a VEVENT-derived Date; escalate if so.

- [ ] **Step 2: Confirm Lambda does not import `node-ical` or parse VEVENT text**

Run: `grep -nE "node-ical|VEVENT|DTSTART|ical\\." infra/lambda/parse-airbnb-email/index.js`

Expected: empty output. Lambda parses the email HTML body for metadata, not the ICS feed.

- [ ] **Step 3: Document the audit result in the spec**

Edit `docs/superpowers/specs/2026-04-22-airbnb-ics-date-parser-fix-design.md`, append a short paragraph to the "Lambda / email ingestion path audit" section:

```markdown
**Audit result (2026-04-22):** Confirmed Lambda does not derive
`checkInDate`/`checkOutDate`. `infra/lambda/parse-airbnb-email/index.js`
writes only enrichment fields (`guestName`, `guestCount`, `payoutAmount`,
`guestMessage`) into the `airbnb_messages_quarantine` collection. Booking
dates come exclusively from `functions/icsSync.js` via `veventDateToYMD`.
No Lambda patch needed.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-22-airbnb-ics-date-parser-fix-design.md
git commit -m "docs(spec): record Lambda ICS audit result

Lambda email parser writes enrichment fields only, not booking dates.
No second-path patch needed."
```

---

## Task 5: Write the backfill script (dry-run logic)

**Goal:** Add a standalone Node script that re-derives dates from live ICS feeds and reports which bookings need correction. Default mode is `--dry-run`; Task 7 adds and exercises `--apply`.

**Files:**
- Create: `scripts/fix-airbnb-dates.js`

- [ ] **Step 1: Create the script**

```js
/**
 * One-shot backfill: re-derive Airbnb booking dates from live ICS feeds
 * using the fixed parser in functions/lib/ics-date.js, and correct any
 * bookings whose stored checkInDate/checkOutDate disagree with the feed.
 *
 * Cascades corrected checkout dates to linked cleaning_jobs via the same
 * rules as the Cloud Function cascade (respects manualOverride,
 * in-progress statuses, historical statuses).
 *
 * Usage:
 *   node scripts/fix-airbnb-dates.js                 # dry-run (default)
 *   node scripts/fix-airbnb-dates.js --apply         # write changes
 *   node scripts/fix-airbnb-dates.js --feed unit-a   # restrict to one feed
 *
 * Idempotent: a second run after --apply produces zero corrections.
 */

'use strict';

const { readFileSync } = require('fs');
const { resolve } = require('path');
const crypto = require('crypto');
const ical = require('node-ical');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const { veventDateToYMD } = require('../functions/lib/ics-date');

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const feedFilterIdx = args.indexOf('--feed');
const feedFilter = feedFilterIdx >= 0 ? args[feedFilterIdx + 1] : null;

// ── Firebase init (same pattern as other scripts) ──────────────────────────
const envPath = resolve(__dirname, '..', '.env.local');
const envFile = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) continue;
  env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
}
const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

// ── Cascade logic (mirrors functions/icsSync.js:285-350) ───────────────────
const HISTORICAL_STATUSES = ['completed', 'archived', 'deleted', 'cancelled'];
const IN_PROGRESS_STATUSES = [
  'en_route', 'arrived', 'before_photos', 'cleaning', 'after_photos', 'laundry_check',
];
const RESCHEDULABLE_STATUSES = ['scheduled', 'acknowledged', 'declined'];

function computeSyncHash(uid, dtstart, dtend, summary) {
  return crypto
    .createHash('sha256')
    .update(`${uid}|${dtstart}|${dtend}|${summary || ''}`)
    .digest('hex')
    .slice(0, 16);
}

async function cascadeForBacklog(bookingId, newCheckOutDate, oldCheckOutDate, unit) {
  const result = { updated: 0, skippedOverride: 0, skippedInProgress: 0, skippedHistorical: 0 };
  if (!bookingId || newCheckOutDate === oldCheckOutDate) return result;

  const jobsSnap = await db
    .collection('cleaning_jobs')
    .where('bookingId', '==', bookingId)
    .get();
  if (jobsSnap.empty) return result;

  const now = new Date().toISOString();
  for (const jobDoc of jobsSnap.docs) {
    const job = jobDoc.data();
    if (HISTORICAL_STATUSES.includes(job.status)) { result.skippedHistorical++; continue; }
    if (IN_PROGRESS_STATUSES.includes(job.status)) { result.skippedInProgress++; continue; }
    if (job.manualOverride === true) { result.skippedOverride++; continue; }
    if (!RESCHEDULABLE_STATUSES.includes(job.status)) continue;
    if (job.scheduledDate === newCheckOutDate) continue;

    if (!dryRun) {
      await jobDoc.ref.update({
        scheduledDate: newCheckOutDate,
        status: 'scheduled',
        acknowledgedAt: null,
        declinedAt: null,
        declineReason: null,
        updatedAt: now,
      });
    }
    result.updated++;
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}${feedFilter ? ` (feed=${feedFilter})` : ''}\n`);

  const settingsDoc = await db.collection('settings').doc('property').get();
  if (!settingsDoc.exists) {
    console.error('settings/property does not exist. Aborting.');
    process.exit(1);
  }
  const feeds = (settingsDoc.data().icsFeeds || [])
    .filter((f) => f.enabled && f.icsUrl)
    .filter((f) => !feedFilter || f.unitId === feedFilter || f.unitName === feedFilter);

  if (feeds.length === 0) {
    console.error('No matching enabled ICS feeds found. Aborting.');
    process.exit(1);
  }

  const summary = {
    feeds: feeds.length,
    veventsSeen: 0,
    bookingsMatched: 0,
    bookingsCorrected: 0,
    bookingsUnchanged: 0,
    veventsUnmatched: 0,
    cleaningJobsUpdated: 0,
    cleaningJobsSkippedOverride: 0,
    cleaningJobsSkippedInProgress: 0,
    cleaningJobsSkippedHistorical: 0,
  };

  for (const feed of feeds) {
    console.log(`── Feed: ${feed.unitName} (${feed.unitId}) ──`);
    let parsed;
    try {
      parsed = await ical.async.fromURL(feed.icsUrl);
    } catch (err) {
      console.error(`  Failed to fetch: ${err.message}`);
      continue;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90); // wider window than sync (it uses -7)

    for (const event of Object.values(parsed)) {
      if (event.type !== 'VEVENT') continue;
      const isDateOnly = event.datetype === 'date';
      const newCheckIn = veventDateToYMD(event.start, { dateOnly: isDateOnly });
      const newCheckOut = veventDateToYMD(event.end, { dateOnly: isDateOnly });
      if (!newCheckIn || !newCheckOut) continue;
      if (new Date(newCheckOut) < cutoff) continue;
      summary.veventsSeen++;

      const existingSnap = await db
        .collection('bookings')
        .where('externalId', '==', event.uid)
        .where('unit', '==', feed.unitName)
        .get();

      if (existingSnap.empty) {
        summary.veventsUnmatched++;
        console.log(`  UNMATCHED  uid=${event.uid} ${newCheckIn} → ${newCheckOut}`);
        continue;
      }

      const bookingDoc = existingSnap.docs[0];
      const booking = bookingDoc.data();
      summary.bookingsMatched++;

      const needsUpdate =
        booking.checkInDate !== newCheckIn || booking.checkOutDate !== newCheckOut;

      if (!needsUpdate) {
        summary.bookingsUnchanged++;
        continue;
      }

      const newSyncHash = computeSyncHash(event.uid, newCheckIn, newCheckOut, event.summary || '');
      const now = new Date().toISOString();

      console.log(
        `  CORRECT    booking=${bookingDoc.id} unit=${feed.unitName} ` +
        `checkIn ${booking.checkInDate} → ${newCheckIn}, ` +
        `checkOut ${booking.checkOutDate} → ${newCheckOut}`
      );
      summary.bookingsCorrected++;

      if (!dryRun) {
        await bookingDoc.ref.update({
          checkInDate: newCheckIn,
          checkOutDate: newCheckOut,
          syncHash: newSyncHash,
          lastSyncedAt: now,
          updatedAt: now,
        });
      }

      const cascade = await cascadeForBacklog(
        bookingDoc.id,
        newCheckOut,
        booking.checkOutDate,
        feed.unitName
      );
      summary.cleaningJobsUpdated += cascade.updated;
      summary.cleaningJobsSkippedOverride += cascade.skippedOverride;
      summary.cleaningJobsSkippedInProgress += cascade.skippedInProgress;
      summary.cleaningJobsSkippedHistorical += cascade.skippedHistorical;

      if (cascade.updated || cascade.skippedOverride || cascade.skippedInProgress || cascade.skippedHistorical) {
        console.log(
          `             cleaning: updated=${cascade.updated} ` +
          `skippedOverride=${cascade.skippedOverride} ` +
          `skippedInProgress=${cascade.skippedInProgress} ` +
          `skippedHistorical=${cascade.skippedHistorical}`
        );
      }
    }
  }

  console.log('\n── Summary ──');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  console.log(dryRun ? '\nDry-run complete. Re-run with --apply to write changes.' : '\nApplied.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit the script (dry-run only; Task 7 runs it)**

```bash
git add scripts/fix-airbnb-dates.js
git commit -m "scripts: add fix-airbnb-dates backfill

Re-derives Airbnb booking dates from live ICS feeds using the fixed
parser, compares to stored values, and (with --apply) corrects
bookings + cascades to cleaning_jobs.

Dry-run by default. Idempotent."
```

---

## Task 6: Deploy the Cloud Function

**Goal:** The fix goes live in production before the backfill runs, so the next scheduled sync (every 30 min) cannot re-introduce the bug into freshly corrected bookings.

**Files:** none — deploy only.

- [ ] **Step 1: Confirm git state is clean and on the right branch**

Run: `git status && git log --oneline -5`

Expected: clean tree; recent commits include "refactor(functions): extract …", "test(functions): add failing tests …", "fix(functions): correct VEVENT date parsing …".

- [ ] **Step 2: Deploy only the icsSync function**

Run: `cd functions && firebase deploy --only functions:icsSync`

Expected: successful deployment. If the function name is different (check `functions/index.js` for the exported name), substitute accordingly. If there is no scoped target, deploy all functions: `firebase deploy --only functions`.

- [ ] **Step 3: Tail logs briefly and trigger a manual sync**

In one terminal: `firebase functions:log --only icsSync | tail -f`

In another (or a browser, logged in as admin): POST `/api/admin/sync-ics` — the manual trigger endpoint.

Expected log: `[icsSync] Processing N feed(s)` → per-feed event counts → `Complete: {...}`. No stack traces.

- [ ] **Step 4: No commit — deployment is not a code change**

Deployment state is tracked by Firebase, not git.

---

## Task 7: Run the backfill

**Goal:** Correct existing Airbnb booking docs and cascade to linked cleaning_jobs.

**Files:** none — script execution only.

- [ ] **Step 1: Dry-run**

Run: `node scripts/fix-airbnb-dates.js`

Expected output shape:

```
Mode: DRY RUN

── Feed: Unit A (unit-a) ──
  CORRECT    booking=<id> unit=Unit A checkIn 2026-04-14 → 2026-04-15, checkOut 2026-04-19 → 2026-04-20
             cleaning: updated=1 skippedOverride=0 skippedInProgress=0 skippedHistorical=0
── Feed: Unit B (unit-b) ──
  ...
── Summary ──
  feeds: 2
  veventsSeen: N
  bookingsMatched: N
  bookingsCorrected: M
  ...

Dry-run complete. Re-run with --apply to write changes.
```

Sanity check: **every correction should shift dates forward by exactly one day** (i.e. `+1`). If any correction has a different magnitude or direction, STOP — that indicates either a hand-edited booking or a deeper parser issue. Investigate before applying.

- [ ] **Step 2: Apply**

Run: `node scripts/fix-airbnb-dates.js --apply`

Expected: same summary as Step 1, but without the "Dry-run complete" footer; replaced by "Applied."

- [ ] **Step 3: Re-run dry-run to confirm idempotency**

Run: `node scripts/fix-airbnb-dates.js`

Expected summary: `bookingsCorrected: 0`, `bookingsUnchanged: ≈ bookingsMatched`. No `CORRECT` lines.

- [ ] **Step 4: No commit — data migration is not a code change**

---

## Task 8: Spot-check against Airbnb.com

**Goal:** Manual verification that corrected dates match reality.

**Files:** none — manual verification.

- [ ] **Step 1: Open the admin calendar**

Navigate to `/admin/calendar` in the deployed app (or local dev if preferred). Agenda view; next 14 days.

- [ ] **Step 2: Pick 2-3 Airbnb bookings and compare check-in + check-out to Airbnb.com**

For each: open the Airbnb.com hosting dashboard (or the Airbnb mobile app) and confirm the check-in date and check-out date match the admin calendar exactly. Also confirm that any linked cleaning job's scheduled date matches the new checkout date.

Expected: all spot-checked dates match.

- [ ] **Step 3: If any mismatch remains**

Stop. Collect: the booking doc ID, the admin-calendar dates, the Airbnb.com dates, and the relevant VEVENT UID (from `booking.externalId`). Open an issue; do not proceed to Task 9.

---

## Task 9 (optional): Source filter on the admin calendar

**Goal:** Low-cost UI affordance to hide/show Airbnb-sourced bookings on the calendar. Not required for the bug fix; ship only if time permits.

**Files:**
- Modify: `app/admin/calendar/page.js`

- [ ] **Step 1: Add state and filter logic**

In `app/admin/calendar/page.js`, after `const [unitFilter, setUnitFilter] = useState('All');` (line 373), add:

```jsx
const [sourceFilter, setSourceFilter] = useState('All'); // 'All' | 'manual' | 'airbnb'
```

In the `filteredBookings` useMemo (line 383-387), update:

```jsx
const filteredBookings = useMemo(() => {
  let filtered = bookings.filter((b) => b.status !== 'cancelled');
  if (unitFilter !== 'All') filtered = filtered.filter((b) => b.unit === unitFilter);
  if (sourceFilter !== 'All') {
    filtered = filtered.filter((b) => (b.source || 'manual') === sourceFilter);
  }
  return filtered;
}, [bookings, unitFilter, sourceFilter]);
```

- [ ] **Step 2: Add the pill row in the UI**

Directly after the unit filter `<div>` (ends around line 527), add:

```jsx
      {/* Source filter */}
      <div className="flex gap-2">
        {[
          { key: 'All', label: 'All sources' },
          { key: 'manual', label: 'Manual' },
          { key: 'airbnb', label: 'Airbnb' },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSourceFilter(opt.key)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              sourceFilter === opt.key ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 3: Start the dev server and verify**

Run: `npm run dev`

Navigate to `/admin/calendar`. Expected:
- The new pill row renders below the unit filter.
- Selecting "Manual" hides Airbnb-badged bookings from the agenda and calendar grid.
- Selecting "Airbnb" hides manual bookings.
- Selecting "All sources" (default) shows everything.

- [ ] **Step 4: Commit**

```bash
git add app/admin/calendar/page.js
git commit -m "feat(calendar): add source filter (All / Manual / Airbnb)

Low-cost follow-up to the ICS parser fix: lets the host visually
isolate manual-vs-Airbnb bookings without changing the underlying
data model."
```

---

## Rollback plan

If Task 6 (deploy) ships and the new parser causes a regression:

```bash
git revert <commit-sha-of-fix>   # the "fix(functions): correct VEVENT date parsing" commit
cd functions && firebase deploy --only functions:icsSync
```

If Task 7 (`--apply`) corrupts data: the script writes only `checkInDate`, `checkOutDate`, `syncHash`, `lastSyncedAt`, `updatedAt` on bookings and `scheduledDate`, `status`, `acknowledgedAt`, `declinedAt`, `declineReason`, `updatedAt` on cleaning_jobs. Firestore point-in-time restore can roll back to pre-apply state within 7 days (confirm feature is enabled on the project before running `--apply`).

---

## Risks (restated from spec for plan-reader convenience)

- **DTEND exclusivity.** Airbnb DATE-only DTEND is the day *after* the last occupied night. The parser preserves this (it returns the literal iCal DATE). Unit test covers DTEND explicitly.
- **Idempotency.** The script compares stored dates to re-derived dates; a second run finds zero differences. Task 7 Step 3 verifies this.
- **Hand-edited bookings.** If any Airbnb booking was hand-edited via the admin UI to have dates that *happen* to match reality despite the parser bug, the backfill will overwrite them to match the feed. The dry-run's "every correction is +1 day" sanity check surfaces this. If in doubt, investigate that booking before `--apply`.
- **Second ingestion path.** Lambda does not derive VEVENT dates (Task 4 confirms). No additional patch needed.
- **node-ical version drift.** Parser uses both the `opts.dateOnly` explicit flag and `dt.dateOnly === true` fallback. Pinned version is 0.26.0 (functions/package.json).
