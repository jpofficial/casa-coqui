# Thread Coherence Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Workflow chosen for this plan:** Subagents prepare a self-contained implementation brief per task (exact diffs + reasoning + test commands). Julio applies the diffs himself in his editor and runs the tests. After each commit, a doc-agent records what shipped to `tasks/changes/threading/2026-05-07-thread-coherence-changes.md`.

**Goal:** Reliably route every inbound Airbnb message to a stable, correct conversation thread by adding a tiered booking-match (confirmation code → email+window → name+window) and a collision-resistant composite-key fallback.

**Architecture:** Two parts that compose. **Part A** strengthens `findMatchingBooking` in the parse-airbnb-email Lambda from a single-key lookup to a 3-tier chain (with a tier-4 plug-in slot). **Part B** extends `buildThreadKey` in `lib/thread-key.js` with an annual bucket for unmatched messages and skips Airbnb forwarder emails so unmatched mail no longer collapses into one mega-thread. No new Firestore composite indexes — single-field auto-indexes cover the new queries.

**Tech Stack:** Node.js 20, Jest (Lambda tests), Node built-in `node:test` (lib tests), Firebase Admin SDK, AWS Lambda + S3 + SES.

**Spec:** [`docs/superpowers/specs/2026-05-07-thread-coherence-design.md`](../specs/2026-05-07-thread-coherence-design.md)

**Verification doc:** [`tasks/2026-05-07-threading-verification-findings.md`](../../../tasks/2026-05-07-threading-verification-findings.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/thread-key.js` | Modify | Extend `buildThreadKey` with `receivedAt` param, airbnb-forwarder skip, annual bucket |
| `lib/__tests__/thread-key.test.js` | Modify | Update existing tests for new format; add tests for new behavior |
| `infra/lambda/parse-airbnb-email/index.js` | Modify | Add helpers + tiered `findMatchingBooking`; update 3 call sites + 2 `buildThreadKey` calls |
| `infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js` | **Create** | Unit tests for new helpers + tiered matcher (jest) |
| `functions/index.js` | Modify | Update 1 inline `buildThreadKey` call to pass `receivedAt` (line ~247) |
| `app/admin/messages/page.js` | Modify | Update 2 `buildThreadKey` calls to pass `receivedAt` (lines ~88, ~200) |
| `tasks/changes/threading/2026-05-07-thread-coherence-changes.md` | **Create** | Append-only change log; doc agent updates after each commit |

**No changes to:** `firestore.indexes.json`, `firestore.rules`, `package.json` files (no new deps).

---

## Workflow per task

For each Task N below:

1. **Dispatch subagent** with `general-purpose` type to produce a self-contained "implementation brief" — diffs, file paths, line numbers, reasoning, test commands. The brief MUST include the exact `git diff`-style content Julio will paste.
2. **Julio applies the diffs** manually in his editor (or via `git apply` on the brief if cleaner).
3. **Julio runs the test command** the brief specifies. If green, commits.
4. **Dispatch doc-agent** (`general-purpose`) to append a section to `tasks/changes/threading/2026-05-07-thread-coherence-changes.md` summarizing: what changed, why, what tests cover it, the commit SHA.
5. Move to Task N+1.

**Branch decision:** stay on `main` (consistent with Phase 1.5 + Phase 2 precedent in handoff §6).

---

## Task 1: Extend `lib/thread-key.js` (Part B foundation)

**Files:**
- Modify: `lib/thread-key.js`
- Modify: `lib/__tests__/thread-key.test.js`

**Goal:** `buildThreadKey` accepts optional `receivedAt`, skips Airbnb-forwarder email addresses, uses annual bucket for name fallback.

- [ ] **Step 1.1: Update existing tests + add new tests (TDD red)**

Replace the entire contents of `lib/__tests__/thread-key.test.js` with:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildThreadKey, isUnmatchedKey } = require('../thread-key');

const FIXED_DATE = new Date('2026-05-07T12:00:00Z');

test('uses bookingCode when present', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: 'ABC123', senderEmail: 'x@y.com', receivedAt: FIXED_DATE }),
    'ABC123'
  );
  assert.strictEqual(
    buildThreadKey({ bookingCode: '  ABC123  ', receivedAt: FIXED_DATE }),
    'ABC123'
  );
});

test('falls back to lowercased email when no bookingCode (non-airbnb)', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: 'Rob@Yahoo.COM', receivedAt: FIXED_DATE }),
    'email:rob@yahoo.com'
  );
});

test('SKIPS email tier when address is an airbnb forwarder', () => {
  // Falls through to name + year bucket
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderEmail: 'express@airbnb.com',
      senderName: 'Jane Doe',
      receivedAt: FIXED_DATE,
    }),
    'name:jane-doe|y:2026'
  );
});

test('SKIPS email tier for any @airbnb.com address', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderEmail: 'noreply@airbnb.com',
      senderName: 'John Smith',
      receivedAt: FIXED_DATE,
    }),
    'name:john-smith|y:2026'
  );
});

test('uses name + year bucket when no email', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderEmail: null,
      senderName: '  John Doe ',
      receivedAt: FIXED_DATE,
    }),
    'name:john-doe|y:2026'
  );
});

test('preserves accented characters in safeName (Unicode-aware)', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: 'José Pérez',
      receivedAt: FIXED_DATE,
    }),
    'name:josé-pérez|y:2026'
  );
});

test('handles apostrophes and hyphens in names', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: "O'Brien-Smith",
      receivedAt: FIXED_DATE,
    }),
    'name:o-brien-smith|y:2026'
  );
});

test('same person across calendar months produces SAME key (annual bucket)', () => {
  const apr30 = new Date('2026-04-30T23:00:00Z');
  const may2 = new Date('2026-05-02T08:00:00Z');
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderName: 'Jane Doe', receivedAt: apr30 }),
    buildThreadKey({ bookingCode: null, senderName: 'Jane Doe', receivedAt: may2 })
  );
});

test('same person across year boundary produces DIFFERENT keys', () => {
  const dec31 = new Date('2025-12-31T23:00:00Z');
  const jan1 = new Date('2026-01-01T01:00:00Z');
  const k1 = buildThreadKey({ bookingCode: null, senderName: 'Jane Doe', receivedAt: dec31 });
  const k2 = buildThreadKey({ bookingCode: null, senderName: 'Jane Doe', receivedAt: jan1 });
  assert.notStrictEqual(k1, k2);
  assert.strictEqual(k1, 'name:jane-doe|y:2025');
  assert.strictEqual(k2, 'name:jane-doe|y:2026');
});

test('defaults to current year when receivedAt missing', () => {
  const result = buildThreadKey({ bookingCode: null, senderName: 'Jane Doe' });
  const currentYear = new Date().getUTCFullYear();
  assert.strictEqual(result, `name:jane-doe|y:${currentYear}`);
});

test('accepts receivedAt as ISO string or millis', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: 'Jane',
      receivedAt: '2026-05-07T12:00:00Z',
    }),
    'name:jane|y:2026'
  );
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: 'Jane',
      receivedAt: FIXED_DATE.getTime(),
    }),
    'name:jane|y:2026'
  );
});

test('returns "unknown" when nothing identifies the sender', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: null, senderName: null, receivedAt: FIXED_DATE }),
    'unknown'
  );
});

test('returns "unknown" when senderName is only non-letter chars', () => {
  // safeName ends up empty after strip → fall through
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: '???',
      receivedAt: FIXED_DATE,
    }),
    'unknown'
  );
});

test('ignores empty strings', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: '', senderEmail: '', senderName: 'Jane', receivedAt: FIXED_DATE }),
    'name:jane|y:2026'
  );
});

test('isUnmatchedKey detects email:, name:, and unknown keys', () => {
  assert.strictEqual(isUnmatchedKey('ABC123'), false);
  assert.strictEqual(isUnmatchedKey('email:a@b.com'), true);
  assert.strictEqual(isUnmatchedKey('name:foo|y:2026'), true);
  assert.strictEqual(isUnmatchedKey('name:foo'), true); // legacy format still matches
  assert.strictEqual(isUnmatchedKey('unknown'), true);
  assert.strictEqual(isUnmatchedKey(null), true);
  assert.strictEqual(isUnmatchedKey(undefined), true);
});
```

- [ ] **Step 1.2: Run tests to verify they FAIL**

```bash
npm test -- --test-name-pattern='thread-key|annual|airbnb forwarder|Unicode'
```

Expected: multiple failures (current implementation doesn't accept `receivedAt`, doesn't skip airbnb forwarders, doesn't use annual bucket, strips Unicode).

- [ ] **Step 1.3: Implement the new `buildThreadKey`**

Replace contents of `lib/thread-key.js` with:

```js
/**
 * Build a stable grouping key for an airbnb_messages document.
 *
 * Used by:
 *   - Lambda on inbound write (infra/lambda/parse-airbnb-email)
 *   - Mark-as-Sent write (app/api/bookings/[id]/welcome)
 *   - Backfill script (scripts/backfill-thread-keys.js)
 *   - Messages page grouping (app/admin/messages/page.js)
 *   - Reply agent context load (functions/index.js)
 *
 * Precedence:
 *   1. bookingCode (matched booking)
 *   2. 'email:' + lowercased email — UNLESS address is an Airbnb forwarder
 *      (@airbnb.com), which collapses unrelated conversations
 *   3. 'name:' + Unicode-safe name + '|y:' + UTC year of receivedAt
 *   4. 'unknown' (fully anonymous, preserved for backwards-compat)
 *
 * @param {{
 *   bookingCode?: string|null,
 *   senderEmail?: string|null,
 *   senderName?: string|null,
 *   receivedAt?: Date|string|number|null,
 * }} input
 */
function buildThreadKey({ bookingCode, senderEmail, senderName, receivedAt } = {}) {
  if (bookingCode && String(bookingCode).trim()) {
    return String(bookingCode).trim();
  }

  const email = senderEmail && String(senderEmail).trim().toLowerCase();
  const isAirbnbForwarder = email && /@airbnb\.com$/.test(email);

  if (email && !isAirbnbForwarder) {
    return 'email:' + email;
  }

  if (senderName && String(senderName).trim()) {
    // Unicode-letter-aware: preserves "josé" / "müller" intact instead of stripping.
    const safeName = String(senderName).trim().toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '');
    if (safeName) {
      const dt = receivedAt instanceof Date
        ? receivedAt
        : (receivedAt ? new Date(receivedAt) : new Date());
      const year = dt.getUTCFullYear();
      return `name:${safeName}|y:${year}`;
    }
  }

  return 'unknown';
}

/** Assumes input came from buildThreadKey — does NOT validate raw user input. */
function isUnmatchedKey(threadKey) {
  if (!threadKey) return true;
  return (
    threadKey === 'unknown' ||
    threadKey.startsWith('email:') ||
    threadKey.startsWith('name:')
  );
}

module.exports = { buildThreadKey, isUnmatchedKey };
```

- [ ] **Step 1.4: Run tests to verify they PASS**

```bash
npm test -- --test-name-pattern='thread-key|annual|airbnb forwarder|Unicode|same person|isUnmatchedKey'
```

Expected: all pass. If any fail, fix the implementation (NOT the tests).

- [ ] **Step 1.5: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 1.6: Commit**

```bash
git add lib/thread-key.js lib/__tests__/thread-key.test.js
git commit -m "$(cat <<'EOF'
feat(thread-key): annual-bucket fallback + airbnb-forwarder skip

buildThreadKey now accepts receivedAt and produces name:{safeName}|y:{YYYY}
for the unmatched-name fallback (annual bucket). Skips email tier when the
sender address ends in @airbnb.com — fixes the legacy bug where every
unmatched Airbnb-forwarded message collapsed into email:express@airbnb.com.

Unicode-letter-aware safeName regex preserves accented characters
(josé, müller) which matters for Casa Coqui's Latin clientele.

Backwards-compat: callers that don't pass receivedAt get current-year bucket.

Spec: docs/superpowers/specs/2026-05-07-thread-coherence-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.7: Doc agent records to changelog**

Dispatch doc-agent to append Task 1 entry to `tasks/changes/threading/2026-05-07-thread-coherence-changes.md` (create file if missing).

---

## Task 2: Add Lambda matching helpers (Part A scaffolding)

**Files:**
- Modify: `infra/lambda/parse-airbnb-email/index.js` (add helpers — does NOT yet replace `findMatchingBooking`)
- Create: `infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js`

**Goal:** Add pure-function helpers `normalizeName`, `isInActiveWindow`, `midpointDistance`, `tieBreak`. (We add `matchByActiveWindow` and the new `findMatchingBooking` in Task 3 because they need a Firestore mock.)

- [ ] **Step 2.1: Write failing tests for helpers**

Create `infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js`:

```js
'use strict';

const {
  normalizeName,
  isInActiveWindow,
  midpointDistance,
  tieBreak,
  WINDOW_PRE_DAYS,
  WINDOW_POST_DAYS,
} = require('../index');

describe('window constants', () => {
  test('WINDOW_PRE_DAYS = 15', () => {
    expect(WINDOW_PRE_DAYS).toBe(15);
  });
  test('WINDOW_POST_DAYS = 5', () => {
    expect(WINDOW_POST_DAYS).toBe(5);
  });
});

describe('normalizeName', () => {
  test('lowercases', () => {
    expect(normalizeName('Jane DOE')).toBe('jane doe');
  });
  test('collapses internal whitespace', () => {
    expect(normalizeName('Jane    Doe')).toBe('jane doe');
  });
  test('trims', () => {
    expect(normalizeName('  Jane Doe  ')).toBe('jane doe');
  });
  test('preserves accented characters', () => {
    expect(normalizeName('José Pérez')).toBe('josé pérez');
  });
});

describe('isInActiveWindow', () => {
  const recv = new Date('2026-05-07T12:00:00Z');

  test('within stay window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
      recv
    )).toBe(true);
  });

  test('exactly 15 days before checkIn — IN window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-05-22', checkOutDate: '2026-05-25' },
      recv
    )).toBe(true);
  });

  test('16 days before checkIn — OUT of window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-05-23', checkOutDate: '2026-05-25' },
      recv
    )).toBe(false);
  });

  test('exactly 5 days after checkOut — IN window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-04-25', checkOutDate: '2026-05-02' },
      recv
    )).toBe(true);
  });

  test('6 days after checkOut — OUT of window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-04-25', checkOutDate: '2026-05-01' },
      recv
    )).toBe(false);
  });

  test('missing dates returns false', () => {
    expect(isInActiveWindow({}, recv)).toBe(false);
    expect(isInActiveWindow({ checkInDate: '2026-05-01' }, recv)).toBe(false);
  });

  test('invalid dates returns false', () => {
    expect(isInActiveWindow(
      { checkInDate: 'not-a-date', checkOutDate: '2026-05-15' },
      recv
    )).toBe(false);
  });
});

describe('midpointDistance', () => {
  test('returns ms distance from receivedAt to stay-midpoint', () => {
    const booking = {
      data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-11' },
    };
    const recv = new Date('2026-05-06T00:00:00Z'); // exactly midpoint
    expect(midpointDistance(booking, recv)).toBe(0);
  });

  test('symmetric: same distance before and after midpoint', () => {
    const booking = {
      data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-11' },
    };
    const before = new Date('2026-05-04T00:00:00Z');
    const after = new Date('2026-05-08T00:00:00Z');
    expect(midpointDistance(booking, before)).toBe(midpointDistance(booking, after));
  });
});

describe('tieBreak', () => {
  const recv = new Date('2026-05-07T12:00:00Z');

  test('returns single candidate as-is', () => {
    const c = { id: 'b1', data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-15' } };
    expect(tieBreak([c], recv)).toBe(c);
  });

  test('prefers active-stay candidate over future-stay', () => {
    const active = { id: 'b1', data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-15' } };
    const future = { id: 'b2', data: { checkInDate: '2026-09-10', checkOutDate: '2026-09-15' } };
    expect(tieBreak([active, future], recv)).toBe(active);
    expect(tieBreak([future, active], recv)).toBe(active); // order independent
  });

  test('falls through to closest-midpoint when no active stay', () => {
    const past = { id: 'b1', data: { checkInDate: '2026-04-01', checkOutDate: '2026-04-08' } };
    const future = { id: 'b2', data: { checkInDate: '2026-09-10', checkOutDate: '2026-09-15' } };
    // Past midpoint Apr 4-5, distance ~33 days. Future midpoint Sep 12-13, distance ~128 days. Past wins.
    expect(tieBreak([past, future], recv)).toBe(past);
  });

  test('two active stays: closest-midpoint wins', () => {
    const a = { id: 'b1', data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-15' } }; // mid May 8
    const b = { id: 'b2', data: { checkInDate: '2026-05-05', checkOutDate: '2026-05-10' } }; // mid May 7-8
    // recv = May 7 noon. Both midpoints close; b should win (smaller distance).
    expect(tieBreak([a, b], recv)).toBe(b);
  });

  test('createdAt-desc breaks midpoint tie', () => {
    const older = {
      id: 'b1',
      data: {
        checkInDate: '2026-04-01',
        checkOutDate: '2026-04-08',
        createdAt: { toMillis: () => 1000 },
      },
    };
    const newer = {
      id: 'b2',
      data: {
        checkInDate: '2026-04-01',
        checkOutDate: '2026-04-08',
        createdAt: { toMillis: () => 2000 },
      },
    };
    expect(tieBreak([older, newer], recv)).toBe(newer);
  });
});
```

- [ ] **Step 2.2: Run tests to verify they FAIL**

```bash
cd infra/lambda/parse-airbnb-email && npm test -- booking-match.test.js
```

Expected: errors like `normalizeName is not a function` (helpers don't exist yet).

- [ ] **Step 2.3: Add helpers to `infra/lambda/parse-airbnb-email/index.js`**

Add the following block **immediately above** the existing `findMatchingBooking` function (around line 442 — find the comment `// ----- Booking match -----`):

```js
// ---------------------------------------------------------------------------
// Active-stay window matching helpers (Part A of thread-coherence fix)
// ---------------------------------------------------------------------------

const WINDOW_PRE_DAYS = 15;
const WINDOW_POST_DAYS = 5;

/** Lowercase + trim + collapse internal whitespace. Preserves accented chars. */
function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True iff `receivedAt` falls within (checkIn − 15d) … (checkOut + 5d). */
function isInActiveWindow(booking, receivedAt) {
  if (!booking.checkInDate || !booking.checkOutDate) return false;
  const checkIn = new Date(booking.checkInDate);
  const checkOut = new Date(booking.checkOutDate);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) return false;
  const earliest = new Date(checkIn.getTime() - WINDOW_PRE_DAYS * 86400000);
  const latest = new Date(checkOut.getTime() + WINDOW_POST_DAYS * 86400000);
  return receivedAt >= earliest && receivedAt <= latest;
}

/** Absolute ms between receivedAt and the booking's stay-window midpoint. */
function midpointDistance(booking, receivedAt) {
  const checkIn = new Date(booking.data.checkInDate).getTime();
  const checkOut = new Date(booking.data.checkOutDate).getTime();
  const mid = (checkIn + checkOut) / 2;
  return Math.abs(receivedAt.getTime() - mid);
}

/**
 * Pick the best booking when tier 2 or tier 3 returns multiple candidates.
 * Order: active-stay → closest-midpoint → most-recently-created.
 */
function tieBreak(candidates, receivedAt) {
  if (candidates.length === 1) return candidates[0];

  // Step 1: prefer active-stay (receivedAt strictly within checkIn..checkOut)
  const active = candidates.filter((c) => {
    const checkIn = new Date(c.data.checkInDate);
    const checkOut = new Date(c.data.checkOutDate);
    return receivedAt >= checkIn && receivedAt <= checkOut;
  });

  let pool;
  if (active.length === 1) return active[0];
  pool = active.length > 1 ? active : candidates;

  // Step 2: closest stay-midpoint
  const sorted = [...pool].sort(
    (a, b) => midpointDistance(a, receivedAt) - midpointDistance(b, receivedAt)
  );

  // Step 3: createdAt-desc breaks midpoint tie
  if (
    sorted.length >= 2 &&
    midpointDistance(sorted[0], receivedAt) === midpointDistance(sorted[1], receivedAt)
  ) {
    const byCreated = [...sorted].sort((a, b) => {
      const aMs = a.data.createdAt?.toMillis?.() || 0;
      const bMs = b.data.createdAt?.toMillis?.() || 0;
      return bMs - aMs;
    });
    return byCreated[0];
  }

  return sorted[0];
}
```

Add to the bottom-of-file `module.exports` block (the existing `Exports for unit tests` section near line 1054):

```js
// Exports for unit tests. `exports.handler` remains the Lambda entrypoint.
module.exports.extractEnrichmentFields = extractEnrichmentFields;
module.exports.classifyEmail = classifyEmail;
module.exports.isAirbnbSender = isAirbnbSender;
module.exports.extractGuestNameFromSubject = extractGuestNameFromSubject;
module.exports.parseResolutionFields = parseResolutionFields;
module.exports.normalizeName = normalizeName;            // NEW
module.exports.isInActiveWindow = isInActiveWindow;      // NEW
module.exports.midpointDistance = midpointDistance;      // NEW
module.exports.tieBreak = tieBreak;                      // NEW
module.exports.WINDOW_PRE_DAYS = WINDOW_PRE_DAYS;        // NEW
module.exports.WINDOW_POST_DAYS = WINDOW_POST_DAYS;      // NEW
```

- [ ] **Step 2.4: Run tests to verify they PASS**

```bash
cd infra/lambda/parse-airbnb-email && npm test -- booking-match.test.js
```

Expected: all `describe('window constants')`, `describe('normalizeName')`, `describe('isInActiveWindow')`, `describe('midpointDistance')`, `describe('tieBreak')` tests pass. (`matchByActiveWindow` and `findMatchingBooking` tests will be added in Task 3.)

- [ ] **Step 2.5: Run full Lambda test suite to confirm no regressions**

```bash
cd infra/lambda/parse-airbnb-email && npm test
```

Expected: all `classify-email.test.js` and `extract-enrichment-fields.test.js` tests pass alongside the new ones.

- [ ] **Step 2.6: Commit**

```bash
git add infra/lambda/parse-airbnb-email/index.js infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js
git commit -m "$(cat <<'EOF'
feat(parse-airbnb-email): add booking-match helpers

Pure-function helpers for the upcoming tiered findMatchingBooking:
- normalizeName: lowercase + collapse whitespace, preserves accents
- isInActiveWindow: 15d-pre / 5d-post window check
- midpointDistance: ms distance from receivedAt to stay-midpoint
- tieBreak: active-stay → closest-midpoint → createdAt-desc

WINDOW_PRE_DAYS / WINDOW_POST_DAYS exposed for tests.

No call-site changes yet — findMatchingBooking still single-tier.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2.7: Doc agent appends to changelog**

---

## Task 3: Replace `findMatchingBooking` with tiered chain

**Files:**
- Modify: `infra/lambda/parse-airbnb-email/index.js` (replace `findMatchingBooking` + add `matchByActiveWindow`)
- Modify: `infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js` (add Firestore-mock tests)

**Goal:** `findMatchingBooking` walks tiers 1 → 2 → 3 with Firestore mock-friendly structure.

- [ ] **Step 3.1: Add failing tests for `matchByActiveWindow` and `findMatchingBooking`**

Append to `infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js`:

```js
const { matchByActiveWindow, findMatchingBooking } = require('../index');

// Minimal Firestore mock. Each .where().get() returns whatever was queued.
function mockFirestore({ byField = {} } = {}) {
  return {
    collection(name) {
      if (name !== 'bookings') throw new Error(`unexpected collection: ${name}`);
      return {
        _filters: [],
        where(field, op, value) {
          if (op !== '==') throw new Error(`unsupported op: ${op}`);
          this._filters.push({ field, value });
          return this;
        },
        limit() { return this; },
        async get() {
          // Return the first filter's matching docs from byField.
          const filter = this._filters[0];
          if (!filter) return { empty: true, docs: [] };
          const docs = (byField[filter.field] || []).filter(d => d._matchValue === filter.value);
          return {
            empty: docs.length === 0,
            docs: docs.map(d => ({ id: d.id, data: () => d.data })),
          };
        },
      };
    },
  };
}

describe('matchByActiveWindow', () => {
  const recv = new Date('2026-05-07T12:00:00Z');

  test('returns null when no rows match the equality query', async () => {
    const fs = mockFirestore({ byField: { guestEmail: [] } });
    const result = await matchByActiveWindow(fs, 'guestEmail', 'jane@x.com', recv);
    expect(result).toBeNull();
  });

  test('returns null when row matches but window does not', async () => {
    const fs = mockFirestore({
      byField: {
        guestEmail: [{
          id: 'b1',
          _matchValue: 'jane@x.com',
          data: { guestEmail: 'jane@x.com', checkInDate: '2025-01-01', checkOutDate: '2025-01-05' },
        }],
      },
    });
    const result = await matchByActiveWindow(fs, 'guestEmail', 'jane@x.com', recv);
    expect(result).toBeNull();
  });

  test('returns the booking when row matches AND window matches', async () => {
    const fs = mockFirestore({
      byField: {
        guestEmail: [{
          id: 'b1',
          _matchValue: 'jane@x.com',
          data: { guestEmail: 'jane@x.com', checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
        }],
      },
    });
    const result = await matchByActiveWindow(fs, 'guestEmail', 'jane@x.com', recv);
    expect(result.id).toBe('b1');
    expect(result.data.guestEmail).toBe('jane@x.com');
  });
});

describe('findMatchingBooking — tiered chain', () => {
  const recv = new Date('2026-05-07T12:00:00Z');

  test('Tier 1: confirmation code match wins immediately', async () => {
    const fs = mockFirestore({
      byField: {
        airbnbConfirmationCode: [{
          id: 'b1',
          _matchValue: 'HMABCDEFGH',
          data: { airbnbConfirmationCode: 'HMABCDEFGH' },
        }],
      },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: 'HMABCDEFGH',
      fromAddress: 'jane@x.com',
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result.tier).toBe(1);
    expect(result.id).toBe('b1');
  });

  test('Tier 2: email + window when confirmation code missing', async () => {
    const fs = mockFirestore({
      byField: {
        guestEmail: [{
          id: 'b2',
          _matchValue: 'jane@x.com',
          data: { guestEmail: 'jane@x.com', checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
        }],
      },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: 'jane@x.com',
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result.tier).toBe(2);
    expect(result.id).toBe('b2');
  });

  test('Tier 3: name + window when email tier misses', async () => {
    const fs = mockFirestore({
      byField: {
        guestEmail: [], // no email match
        guestName: [{
          id: 'b3',
          _matchValue: 'jane doe',
          data: { guestName: 'jane doe', checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
        }],
      },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: 'jane@x.com',
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result.tier).toBe(3);
    expect(result.id).toBe('b3');
  });

  test('returns null when all tiers miss', async () => {
    const fs = mockFirestore({ byField: {} });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: 'jane@x.com',
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result).toBeNull();
  });

  test('returns null when only confirmationCode given but no match', async () => {
    const fs = mockFirestore({
      byField: { airbnbConfirmationCode: [] },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: 'HMNOTREAL',
      fromAddress: null,
      guestName: null,
      receivedAt: recv,
    });
    expect(result).toBeNull();
  });

  test('skips tier 2 when fromAddress missing', async () => {
    const fs = mockFirestore({
      byField: {
        guestName: [{
          id: 'b4',
          _matchValue: 'jane doe',
          data: { guestName: 'jane doe', checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
        }],
      },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: null,
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result.tier).toBe(3);
  });

  test('skips tier 3 when guestName missing', async () => {
    const fs = mockFirestore({ byField: { guestEmail: [] } });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: 'jane@x.com',
      guestName: null,
      receivedAt: recv,
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3.2: Run tests to verify they FAIL**

```bash
cd infra/lambda/parse-airbnb-email && npm test -- booking-match.test.js
```

Expected: `matchByActiveWindow` and `findMatchingBooking — tiered chain` tests fail (functions don't have new shapes yet).

- [ ] **Step 3.3: Replace `findMatchingBooking` + add `matchByActiveWindow`**

In `infra/lambda/parse-airbnb-email/index.js`, find the existing `findMatchingBooking` (around line 443-452):

```js
async function findMatchingBooking(firestore, confirmationCode) {
  if (!confirmationCode) return null;
  const snap = await firestore
    .collection('bookings')
    .where('airbnbConfirmationCode', '==', confirmationCode)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
}
```

Replace with:

```js
/**
 * Generic equality + in-memory active-window filter.
 * @param {string} fieldName  e.g. 'guestEmail' or 'guestName'
 * @param {string} value      already normalized
 * @param {Date}   receivedAt
 * @returns {Promise<{ id, data } | null>}
 */
async function matchByActiveWindow(firestore, fieldName, value, receivedAt) {
  const snap = await firestore
    .collection('bookings')
    .where(fieldName, '==', value)
    .get();
  if (snap.empty) return null;

  const candidates = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((b) => isInActiveWindow(b.data, receivedAt));

  if (candidates.length === 0) return null;
  return tieBreak(candidates, receivedAt);
}

/**
 * Tiered booking match.
 *   Tier 1: airbnbConfirmationCode (gold standard, unchanged behavior).
 *   Tier 2: fromAddress + active stay window → bookings.guestEmail.
 *   Tier 3: normalized guestName + active stay window → bookings.guestName.
 *   Tier 4 (NOT v1): booking_members collection-group lookup.
 *
 * @returns {Promise<{ id, data, tier } | null>}
 */
async function findMatchingBooking(
  firestore,
  { confirmationCode, fromAddress, guestName, receivedAt }
) {
  // Tier 1
  if (confirmationCode) {
    const snap = await firestore
      .collection('bookings')
      .where('airbnbConfirmationCode', '==', confirmationCode)
      .limit(1)
      .get();
    if (!snap.empty) {
      return { id: snap.docs[0].id, data: snap.docs[0].data(), tier: 1 };
    }
  }

  // Tier 2: email + active window
  if (fromAddress && receivedAt) {
    const match = await matchByActiveWindow(
      firestore,
      'guestEmail',
      String(fromAddress).toLowerCase().trim(),
      receivedAt
    );
    if (match) return { ...match, tier: 2 };
  }

  // Tier 3: name + active window
  if (guestName && receivedAt) {
    const match = await matchByActiveWindow(
      firestore,
      'guestName',
      normalizeName(guestName),
      receivedAt
    );
    if (match) return { ...match, tier: 3 };
  }

  // Tier 4 (NOT v1): booking_members collection-group lookup. Add when sibling-guest case grows.

  return null;
}
```

Add to the bottom-of-file exports:

```js
module.exports.matchByActiveWindow = matchByActiveWindow;
module.exports.findMatchingBooking = findMatchingBooking;
```

(`findMatchingBooking` may already be implicit via `exports.handler` closure — adding the explicit export is safe and required by the tests.)

- [ ] **Step 3.4: Run tests to verify they PASS**

```bash
cd infra/lambda/parse-airbnb-email && npm test -- booking-match.test.js
```

Expected: all booking-match tests pass.

- [ ] **Step 3.5: Run full Lambda test suite — DO NOT skip this**

```bash
cd infra/lambda/parse-airbnb-email && npm test
```

Expected: classify-email + extract-enrichment-fields + booking-match all pass. **The 3 in-Lambda call sites still call the OLD `findMatchingBooking` signature** — Task 4 fixes them. Until Task 4 lands, real Lambda invocations would 500. Don't deploy yet.

- [ ] **Step 3.6: Commit**

```bash
git add infra/lambda/parse-airbnb-email/index.js infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js
git commit -m "$(cat <<'EOF'
feat(parse-airbnb-email): tiered findMatchingBooking

Replaces single-key confirmation-code match with a 3-tier chain:
  1. airbnbConfirmationCode (unchanged)
  2. guestEmail + 15d-pre/5d-post window
  3. guestName + window

Adds matchByActiveWindow (equality query + in-memory window filter +
tie-break). New signature: findMatchingBooking(fs, {confirmationCode,
fromAddress, guestName, receivedAt}). The 3 call sites (reservation_
confirmation, resolution_request, guest_message) are updated in the
NEXT commit — do not deploy this commit standalone.

Tier 4 (booking_members) deferred per spec D3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3.7: Doc agent appends to changelog**

---

## Task 4: Update Lambda call sites + `buildThreadKey` calls

**Files:**
- Modify: `infra/lambda/parse-airbnb-email/index.js` (3 call sites + 2 buildThreadKey calls)

**Goal:** Wire the upgraded `findMatchingBooking` into the 3 flows. Pass `receivedAt` into both `buildThreadKey` calls.

- [ ] **Step 4.1: Update `reservation_confirmation` call site (~line 735)**

Find:

```js
if (messageType === 'reservation_confirmation') {
  const matched = await findMatchingBooking(firestore, confirmationCode);
```

Replace with:

```js
if (messageType === 'reservation_confirmation') {
  const matched = await findMatchingBooking(firestore, {
    confirmationCode,
    fromAddress,
    guestName,
    receivedAt,
  });
```

- [ ] **Step 4.2: Update `resolution_request` call site (~line 830)**

Find:

```js
if (resCode) {
  const matched = await findMatchingBooking(firestore, resCode);
  if (matched) bookingId = matched.id;
}
```

Replace with:

```js
if (resCode) {
  const matched = await findMatchingBooking(firestore, {
    confirmationCode: resCode,
    fromAddress,
    guestName,
    receivedAt,
  });
  if (matched) bookingId = matched.id;
}
```

- [ ] **Step 4.3: Update `guest_message` call site (~line 920)**

Find:

```js
const booking = await findMatchingBooking(firestore, confirmationCode);
```

Replace with:

```js
const booking = await findMatchingBooking(firestore, {
  confirmationCode,
  fromAddress,
  guestName,
  receivedAt,
});
```

- [ ] **Step 4.4: Update unmatched `buildThreadKey` call (~line 949)**

Find:

```js
threadKey: buildThreadKey({
  bookingCode: null,
  senderEmail: fromAddress,
  senderName: guestName || fromName,
}),
```

Replace with:

```js
threadKey: buildThreadKey({
  bookingCode: null,
  senderEmail: fromAddress,
  senderName: guestName || fromName,
  receivedAt,
}),
```

- [ ] **Step 4.5: Update matched `buildThreadKey` call (~line 1004)**

Find:

```js
threadKey: buildThreadKey({
  bookingCode: booking.data.code,
  senderEmail: fromAddress,
  senderName: guestName || booking.data.guestName || null,
}),
```

Replace with:

```js
threadKey: buildThreadKey({
  bookingCode: booking.data.code,
  senderEmail: fromAddress,
  senderName: guestName || booking.data.guestName || null,
  receivedAt,
}),
```

- [ ] **Step 4.6: Run full Lambda test suite**

```bash
cd infra/lambda/parse-airbnb-email && npm test
```

Expected: all pass. (No new tests — this task only wires existing logic. Behavior is covered by the unit tests from Tasks 1-3.)

- [ ] **Step 4.7: Manual sanity check — make sure `node -e` loads the module**

```bash
cd infra/lambda/parse-airbnb-email && npm run test:load
```

Expected: prints `module loads OK` (catches syntax errors from the find-replace).

- [ ] **Step 4.8: Commit**

```bash
git add infra/lambda/parse-airbnb-email/index.js
git commit -m "$(cat <<'EOF'
feat(parse-airbnb-email): wire tiered match into 3 call sites

Updates reservation_confirmation, resolution_request, and guest_message
flows to use the new findMatchingBooking signature. Both buildThreadKey
calls now pass receivedAt so unmatched messages get the annual-bucket
key instead of the legacy month-less name: format.

This is the commit that makes the Lambda functionally complete. Safe
to deploy now (after Task 5 + Task 6 land).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4.9: Doc agent appends to changelog**

---

## Task 5: Update `functions/index.js` inline `buildThreadKey` call

**Files:**
- Modify: `functions/index.js`

**Goal:** Pass `receivedAt` to the inline `buildThreadKey` call in `onAirbnbMessageCreated`.

- [ ] **Step 5.1: Update the call at line ~247**

Find:

```js
const threadKey =
  message.threadKey ||
  buildThreadKey({
    bookingCode: message.bookingCode || null,
    senderEmail: message.senderEmail || message.fromAddress || null,
    senderName: message.guestName || message.fromName || null,
  });
```

Replace with:

```js
const threadKey =
  message.threadKey ||
  buildThreadKey({
    bookingCode: message.bookingCode || null,
    senderEmail: message.senderEmail || message.fromAddress || null,
    senderName: message.guestName || message.fromName || null,
    receivedAt: message.receivedAt?.toDate?.() || message.receivedAt || null,
  });
```

- [ ] **Step 5.2: Verify the file still loads (CommonJS syntax check)**

```bash
cd functions && node -e "require('./index.js'); console.log('OK')" 2>&1 | tail -3
```

Expected: prints `OK` (or a known firebase-admin-init warning that's not a syntax error). If you see `SyntaxError`, fix and re-run.

(Firebase Functions has no unit-test runner configured; this load check is the smoke test.)

- [ ] **Step 5.3: Commit**

```bash
git add functions/index.js
git commit -m "$(cat <<'EOF'
feat(functions): pass receivedAt to inline buildThreadKey

onAirbnbMessageCreated's defense-in-depth threadKey reconstruction (for
legacy/backfilled docs without a threadKey field) now produces the new
annual-bucket format. Firestore Timestamp -> Date conversion via
optional toDate().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5.4: Doc agent appends to changelog**

---

## Task 6: Update `app/admin/messages/page.js` callers

**Files:**
- Modify: `app/admin/messages/page.js`

**Goal:** Both `buildThreadKey` callers in the admin Messages UI pass `receivedAt`.

- [ ] **Step 6.1: Update call in `buildThreads` (~line 88-94)**

Find:

```js
const key =
  msg.threadKey ||
  buildThreadKey({
    bookingCode: msg.bookingCode || null,
    senderEmail: msg.senderEmail || msg.fromAddress || null,
    senderName: msg.guestName || msg.fromName || null,
  });
```

Replace with:

```js
const key =
  msg.threadKey ||
  buildThreadKey({
    bookingCode: msg.bookingCode || null,
    senderEmail: msg.senderEmail || msg.fromAddress || null,
    senderName: msg.guestName || msg.fromName || null,
    receivedAt: msg.receivedAt?.toDate?.() || msg.createdAt?.toDate?.() || null,
  });
```

- [ ] **Step 6.2: Update call in `ChatView` filter (~line 200-207)**

Find:

```js
const key =
  m.threadKey ||
  buildThreadKey({
    bookingCode: m.bookingCode || null,
    senderEmail: m.senderEmail || m.fromAddress || null,
    senderName: m.guestName || m.fromName || null,
  });
```

Replace with:

```js
const key =
  m.threadKey ||
  buildThreadKey({
    bookingCode: m.bookingCode || null,
    senderEmail: m.senderEmail || m.fromAddress || null,
    senderName: m.guestName || m.fromName || null,
    receivedAt: m.receivedAt?.toDate?.() || m.createdAt?.toDate?.() || null,
  });
```

- [ ] **Step 6.3: Smoke check — Next.js dev server boots**

```bash
npm run dev
```

(Visit `/admin/messages` in browser; confirm threads still render. Ctrl-C when done.)

If you don't want to spin up the dev server now, do at minimum a syntax check:

```bash
node -e "const fs = require('fs'); const src = fs.readFileSync('app/admin/messages/page.js', 'utf-8'); console.log(src.length > 0 ? 'reads OK' : 'EMPTY')"
```

Expected: `reads OK`. (Next.js does its own JSX compilation at runtime; meaningful syntax errors surface there.)

- [ ] **Step 6.4: Commit**

```bash
git add app/admin/messages/page.js
git commit -m "$(cat <<'EOF'
feat(admin/messages): pass receivedAt to buildThreadKey callers

Two call sites in MessagesPage compute threadKeys client-side as a
fallback for legacy docs. Both now produce the new annual-bucket format,
matching what the Lambda writes for new messages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6.5: Doc agent appends to changelog**

---

## Task 7: Manual smoke test (post-deploy)

**Goal:** Verify the Lambda's new tiered matcher works end-to-end against real Firestore + S3.

**Pre-req:** Tasks 1-6 committed AND deployed to AWS Lambda + Firebase Functions.

- [ ] **Step 7.1: Deploy the Lambda**

Per the existing deploy pipeline:

```bash
# AWS CodeBuild handles Lambda deploys; verify the build is green
aws codebuild list-builds-for-project --project-name casa-coqui-parse-airbnb-email --max-items 1
```

Or, if you deploy manually, follow `infra/lambda/parse-airbnb-email/README.md` (or whichever deploy path matches your current ops).

- [ ] **Step 7.2: Deploy Firebase Functions**

```bash
firebase deploy --only functions:onAirbnbMessageCreated
```

- [ ] **Step 7.3: Tier 1 smoke (regression check)**

Forward yourself an existing real Airbnb guest message that has a known confirmation code. Wait ~30s. Confirm:
- A new doc lands in `airbnb_messages` with `bookingId` set, `tier` not present (only inside the matcher return value, not persisted), `threadKey === bookings.code`.
- AI draft is generated.

- [ ] **Step 7.4: Tier 2 smoke (NEW behavior)**

Construct a synthetic Airbnb-looking email by manually crafting a `.eml` and dropping it into the inbound S3 bucket (or simulating SES delivery via `aws ses-v2 send-email --raw-message`). Use a `From:` address that matches an existing booking's `guestEmail` but DO NOT include the confirmation code in the subject.

Confirm the new doc has `bookingId` set to the matching booking and `threadKey === booking.code`.

- [ ] **Step 7.5: Tier 3 smoke (NEW behavior)**

Construct another synthetic email with `From: express@airbnb.com` and a guest name in the subject (e.g. `RE: Reservation for Casa Coqui, May 1 – 5 — Jane Doe`) where `bookings.guestName` matches and the message date is within the active window.

Confirm doc routes to that booking.

- [ ] **Step 7.6: Composite-key smoke (NEW behavior)**

Construct an email with `From: express@airbnb.com` and a name that has NO matching booking. Confirm:
- Doc lands with `bookingId: null`.
- `threadKey === 'name:{safe-name}|y:{current-year}'`.
- It is NOT `email:express@airbnb.com`.

- [ ] **Step 7.7: Same-person-across-month-boundary smoke**

Replay (or wait for) two messages from the same unmatched sender that arrive on April 30 and May 2. Confirm both produce the SAME threadKey.

- [ ] **Step 7.8: Doc agent appends final changelog entry**

Final entry should include:
- Deploy timestamps (Lambda + Functions)
- Smoke-test results from steps 7.3-7.7
- Any production observations from the next 24 hours

---

## Acceptance criteria (cross-check against spec §8)

| Criterion | Covered by |
|---|---|
| Tier-1 confirmation-code message → `bookingCode` thread | Task 3 unit + Task 7.3 smoke |
| Tier-2 email+window → booking thread | Task 3 unit + Task 7.4 smoke |
| Tier-3 name+window → booking thread | Task 3 unit + Task 7.5 smoke |
| Unmatched message → `name:{safeName}|y:{YYYY}`, NOT `email:express@airbnb.com` | Task 1 unit + Task 7.6 smoke |
| Same person across Apr 30 → May 2 → same threadKey | Task 1 unit + Task 7.7 smoke |
| Different unmatched Janes across years → different threadKeys | Task 1 unit |
| Two distinct bookings same guest → tie-breaker picks correct one | Task 2 unit (`tieBreak`) |
| All 3 call sites get the upgrade | Task 4 |
| Voice-learning loop preserved | Untouched (no changes to `onAirbnbMessageSent`) |

---

## Rollback plan

Each task is its own commit. To roll back:

- Tasks 5-6 (callers): `git revert <sha>` per commit. Lambda continues to write new keys; UI fallback continues to compute old-style keys for legacy docs that lack `threadKey`. No data loss.
- Tasks 1-4 (Lambda + thread-key): `git revert` in reverse order (4 → 3 → 2 → 1). Re-deploy. Old single-key matcher returns. New annual-bucket docs in Firestore stay (read by `isUnmatchedKey` correctly because the prefix check still matches `name:` regardless of suffix).

---

## Self-review (writing-plans skill checklist)

1. ✅ Spec coverage — all 8 acceptance criteria mapped to tasks.
2. ✅ No placeholders — every code block is concrete; commands are exact.
3. ✅ Type/name consistency — `findMatchingBooking({...})` arg shape is the same across Tasks 3 and 4.
4. ✅ Each task is self-contained and produces a green test suite at commit time (Task 4 caveat: don't deploy until Task 5+6 land).

**End of plan.**
