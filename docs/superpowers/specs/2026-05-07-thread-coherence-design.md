# Thread Coherence Fix — Design Spec

**Date**: 2026-05-07
**Status**: Approved, ready for implementation plan
**Author**: collaboratively, post-Phase-2 brainstorm session
**Inputs**:
- [`explantion/2026-05-07-threading-handoff.md`](../../../explantion/2026-05-07-threading-handoff.md) — handoff from prior session
- [`tasks/2026-05-07-threading-verification-findings.md`](../../../tasks/2026-05-07-threading-verification-findings.md) — code-verification scan

---

## 1. Goal

Reliably route every inbound Airbnb message to a stable, correct conversation thread so the AI sees the right history when drafting replies.

## 2. Non-goals (deferred to follow-up specs)

- **Outbound capture (Item 3)**: making "Mark as Sent" create an outbound `airbnb_messages` doc. Logically downstream of threading.
- **Persist `inReplyTo` / `references` headers (Item 4)**: parent-child message reconstruction.
- **Expand AI context window (Item 5)**: 5 → 20 messages.
- **Tier 4** (`booking_members` collection-group lookup for sibling guests like "Sofia messaging about Maria's booking"). v1 code shape leaves a plug-in slot.
- **Backfill** of existing `airbnb_messages` threadKeys to the new format.
- **Phase 3** of the SFN refactor (the SFN bridge + DLQ). Orthogonal track.

## 3. Background

The reply-agent's AI looks "stateless" because two messages from the same guest aren't reliably linked. A multi-agent audit identified four root causes (handoff §1). This spec addresses **the two most foundational** — without them, downstream context improvements compound on a broken graph.

### Today's matching pipeline

[`infra/lambda/parse-airbnb-email/index.js:443-452`](../../../infra/lambda/parse-airbnb-email/index.js):

```js
async function findMatchingBooking(firestore, confirmationCode) {
  if (!confirmationCode) return null;
  const snap = await firestore.collection('bookings')
    .where('airbnbConfirmationCode', '==', confirmationCode)
    .limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
}
```

Single point of failure: if the HM/HB code isn't extractable from subject or body, **no fallback exists**. Doc lands at [line 922-979](../../../infra/lambda/parse-airbnb-email/index.js#L922) with `bookingId: null` and a threadKey built from a 3-tier fallback in [`lib/thread-key.js:17-28`](../../../lib/thread-key.js#L17):

```js
function buildThreadKey({ bookingCode, senderEmail, senderName } = {}) {
  if (bookingCode) return bookingCode;
  if (senderEmail) return 'email:' + senderEmail.toLowerCase();
  if (senderName) return 'name:' + senderName.toLowerCase();
  return 'unknown';
}
```

Two failure modes:
- `senderEmail` always ends in `@airbnb.com` for Airbnb-forwarded mail → every unmatched conversation collapses into one mega-thread keyed `email:express@airbnb.com`.
- Plain `name:jane` collides on common names across all of time.

## 4. Architecture

The fix has two parts that compose:

```
Inbound message
  │
  ├─► Tier 1: airbnbConfirmationCode → bookings.airbnbConfirmationCode
  │   (unchanged from today; gold standard)
  │
  ├─► Tier 2: (fromAddress + activeStay window) → bookings.guestEmail
  │   NEW. Equality on email + in-memory date filter.
  │
  ├─► Tier 3: (extractedName + activeStay window) → bookings.guestName
  │   NEW. Equality on name (normalized) + in-memory date filter.
  │
  ├─► Tier 4 (NOT in v1): booking_members collection-group lookup
  │   Code structure leaves a `// TODO: tier 4` slot in findMatchingBooking.
  │
  └─► No booking matched → write doc with bookingId: null
      threadKey = composite (Part B):
        - else email:{addr} (only if NOT @airbnb.com)
        - else name:{safeName}|y:{YYYY}  ← annual bucket, NEW
        - else 'unknown'
```

### 4.1 Active stay window

A booking is "active for matching" when:

```
receivedAt >= (checkInDate − 15 days)
AND
receivedAt <= (checkOutDate + 5 days)
```

The window edges are anchored to Casa Coqui's real message volume — host has never received a guest follow-up later than ~5 days post-checkout, and pre-arrival prep questions typically begin 1-2 weeks out.

### 4.2 Tie-breaker (multiple candidates within window)

If a tier returns multiple bookings (e.g. a repeat guest with two recent stays):

1. Prefer the booking where `receivedAt` falls **between** `checkInDate` and `checkOutDate` (active stay).
2. Else: prefer the booking whose stay-window **midpoint is closest in time** to `receivedAt`.
3. Else (truly tied): prefer most recently created (`createdAt` desc).

### 4.3 Composite-key shape (Part B)

For messages that fall through all booking-match tiers:

- **`email:{addr}`** — only if `addr` is NOT an Airbnb forwarder address (regex `/@airbnb\.com$/`). Otherwise skip.
- **`name:{safeName}|y:{YYYY}`** — annual bucket. `safeName = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')` with leading/trailing dashes stripped. Unicode-letter-aware regex preserves accented characters (José → `josé`, not `jos`) — important for Casa Coqui's Latin clientele. Year is `receivedAt.getUTCFullYear()`, defaulting to `new Date().getUTCFullYear()` if `receivedAt` not provided.
- **`'unknown'`** — last-ditch bucket for messages with no extractable name/email.

Rationale for annual bucket: at Casa Coqui's volume (~10-15 unique guests/month), the probability of two distinct guests sharing a normalized name within a single year is effectively zero. Larger buckets fragment threads less than smaller buckets at no real collision cost.

## 5. Code changes

### 5.1 `lib/thread-key.js`

Extend `buildThreadKey` with an optional `receivedAt` param and the airbnb-forwarder skip rule:

```js
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
    // Unicode-letter-aware: preserves "josé" intact instead of stripping to "jos".
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
```

`isUnmatchedKey` updates to recognize the new format:

```js
function isUnmatchedKey(threadKey) {
  if (!threadKey) return true;
  return (
    threadKey === 'unknown' ||
    threadKey.startsWith('email:') ||
    threadKey.startsWith('name:')
  );
}
```

(No change needed — existing prefix check still matches `name:jane|y:2026`.)

### 5.2 `infra/lambda/parse-airbnb-email/index.js`

Replace the single-purpose `findMatchingBooking` with a tiered chain.

**Constants** (top of file, near other config):

```js
const WINDOW_PRE_DAYS = 15;
const WINDOW_POST_DAYS = 5;
```

**New helper functions:**

```js
function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

function isInActiveWindow(booking, receivedAt) {
  if (!booking.checkInDate || !booking.checkOutDate) return false;
  const checkIn = new Date(booking.checkInDate);
  const checkOut = new Date(booking.checkOutDate);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) return false;
  const earliest = new Date(checkIn.getTime() - WINDOW_PRE_DAYS * 86400000);
  const latest = new Date(checkOut.getTime() + WINDOW_POST_DAYS * 86400000);
  return receivedAt >= earliest && receivedAt <= latest;
}

function midpointDistance(booking, receivedAt) {
  const checkIn = new Date(booking.data.checkInDate).getTime();
  const checkOut = new Date(booking.data.checkOutDate).getTime();
  const mid = (checkIn + checkOut) / 2;
  return Math.abs(receivedAt.getTime() - mid);
}

function tieBreak(candidates, receivedAt) {
  if (candidates.length === 1) return candidates[0];

  // Step 1: prefer active-stay (receivedAt between checkIn and checkOut)
  const active = candidates.filter(c => {
    const checkIn = new Date(c.data.checkInDate);
    const checkOut = new Date(c.data.checkOutDate);
    return receivedAt >= checkIn && receivedAt <= checkOut;
  });

  const pool = active.length === 1
    ? active
    : (active.length > 1 ? active : candidates);

  if (pool.length === 1) return pool[0];

  // Step 2: closest stay-midpoint to receivedAt
  const sorted = [...pool].sort((a, b) =>
    midpointDistance(a, receivedAt) - midpointDistance(b, receivedAt)
  );

  // If midpoint distance is identical, fall through to step 3 (most recently created).
  if (sorted.length >= 2 &&
      midpointDistance(sorted[0], receivedAt) === midpointDistance(sorted[1], receivedAt)) {
    const byCreated = [...sorted].sort((a, b) => {
      const aMs = a.data.createdAt?.toMillis?.() || 0;
      const bMs = b.data.createdAt?.toMillis?.() || 0;
      return bMs - aMs;
    });
    return byCreated[0];
  }

  return sorted[0];
}

async function matchByActiveWindow(firestore, fieldName, value, receivedAt) {
  const snap = await firestore.collection('bookings')
    .where(fieldName, '==', value)
    .get();

  const candidates = snap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .filter(b => isInActiveWindow(b.data, receivedAt));

  if (candidates.length === 0) return null;
  return tieBreak(candidates, receivedAt);
}
```

**Replace `findMatchingBooking`:**

```js
/**
 * Tiered booking match.
 * Tier 1: airbnbConfirmationCode (gold standard, unchanged).
 * Tier 2: fromAddress + active stay window → bookings.guestEmail.
 * Tier 3: normalized guestName + active stay window → bookings.guestName.
 * Tier 4 (NOT v1): booking_members collection-group lookup.
 *
 * @returns {Promise<{ id, data, tier } | null>}
 */
async function findMatchingBooking(firestore, { confirmationCode, fromAddress, guestName, receivedAt }) {
  // Tier 1
  if (confirmationCode) {
    const snap = await firestore.collection('bookings')
      .where('airbnbConfirmationCode', '==', confirmationCode)
      .limit(1).get();
    if (!snap.empty) {
      return { id: snap.docs[0].id, data: snap.docs[0].data(), tier: 1 };
    }
  }

  // Tier 2
  if (fromAddress && receivedAt) {
    const match = await matchByActiveWindow(
      firestore,
      'guestEmail',
      String(fromAddress).toLowerCase().trim(),
      receivedAt
    );
    if (match) return { ...match, tier: 2 };
  }

  // Tier 3
  if (guestName && receivedAt) {
    const match = await matchByActiveWindow(
      firestore,
      'guestName',
      normalizeName(guestName),
      receivedAt
    );
    if (match) return { ...match, tier: 3 };
  }

  // Tier 4 (NOT v1) — booking_members collection-group lookup. Add when sibling-guest case grows.

  return null;
}
```

**Update three call sites** to pass the new arg shape and the `receivedAt` Date:

- [Line 735](../../../infra/lambda/parse-airbnb-email/index.js#L735) — `reservation_confirmation` flow
- [Line 830](../../../infra/lambda/parse-airbnb-email/index.js#L830) — `resolution_request` flow
- [Line 920](../../../infra/lambda/parse-airbnb-email/index.js#L920) — `guest_message` flow

Each call becomes:

```js
const matched = await findMatchingBooking(firestore, {
  confirmationCode,
  fromAddress,
  guestName,
  receivedAt, // a Date — already in scope from `parsed.date`
});
```

**Update both `buildThreadKey` calls** in the Lambda ([lines 949-953](../../../infra/lambda/parse-airbnb-email/index.js#L949) and [1004-1008](../../../infra/lambda/parse-airbnb-email/index.js#L1004)) to pass `receivedAt`.

### 5.3 `functions/index.js`

Update the inline `buildThreadKey` call at [line 247-254](../../../functions/index.js#L247) in `onAirbnbMessageCreated`:

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

### 5.4 `app/admin/messages/page.js`

Two `buildThreadKey` callers — [lines 88-94](../../../app/admin/messages/page.js#L88) and [200-207](../../../app/admin/messages/page.js#L200) — take `receivedAt`:

```js
buildThreadKey({
  bookingCode: msg.bookingCode || null,
  senderEmail: msg.senderEmail || msg.fromAddress || null,
  senderName: msg.guestName || msg.fromName || null,
  receivedAt: msg.receivedAt?.toDate?.() || msg.createdAt?.toDate?.() || null,
});
```

### 5.5 `firestore.indexes.json`

**No changes.** All new queries in §5.2 are single-field equality (`where(fieldName, '==', value)`) — Firestore's auto-indexes already cover them. Date filtering happens in memory after retrieval.

## 6. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | Composite key uses **annual bucket** (`y:2026`), not monthly/quarterly | At Casa Coqui's volume, name-collision risk is effectively zero across a year; annual bucket avoids fragmenting threads at calendar boundaries. |
| D2 | Active window = **15 days pre-arrival → 5 days post-checkout** | Anchored to host's real data — never seen a guest follow up >5 days post-checkout. |
| D3 | **Tier 4** (`booking_members` lookup) deferred to follow-up | Sibling-guest case is rare; v1 leaves a code-shape plug-in slot. |
| D4 | **No new Firestore composite indexes** | All new queries are single-field equality; auto-indexes cover them. Adding unused composites costs storage + write overhead and misleads future readers. |
| D5 | **No backfill** of existing `airbnb_messages` threadKeys | YAGNI. Old docs keep old keys; only new messages use the new keying. Worst case: a legacy + new thread for the same person — fixable via admin "Link to booking" UI. |
| D6 | Composite key skips `senderEmail` when address ends in `@airbnb.com` | Without this, every Airbnb-forwarded unmatched message collapses into one mega-thread under `email:express@airbnb.com`. |
| D7 | Tie-break prefers **active stay**, then **midpoint-closest**, then **most-recently-created** | Active-stay is the most likely conversation context; midpoint-closest is the next-most-likely; createdAt-desc is a deterministic last-resort. |
| D8 | Date-window filter is **in-memory after equality query**, not pushed into Firestore | Firestore allows only one inequality field per query; we'd need two. At Casa Coqui's volume, a single guest's bookings list is 1-3 docs — pulling and filtering in JS is cheap. |
| D9 | Outbound capture (Item 3) deferred | Threading is logically prior; without solid threading, an outbound doc lands in a fragile/wrong thread. |

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `receivedAt` could be null on legacy code paths | `buildThreadKey` falls back to `new Date()` (current year). Lambda always has `receivedAt` set from `parsed.date`. |
| Tier 2/3 returns N docs for a single email/name (repeat guest) | At Casa Coqui's volume, N is 1-3. Acceptable. If scale grows, swap to a denormalized active-window field. |
| Name normalization edge cases (Unicode, double-space, hyphens) | `normalizeName` does lowercase + collapse-whitespace. International chars preserved as-is. `safeName` (in `buildThreadKey`) collapses runs of non-letter/non-number to `-` using `\p{L}\p{N}` Unicode classes — preserves "josé" / "müller" / "o'brien" → "o-brien" / "mary-jane". The two normalizers differ on purpose (matching vs. id-safety) but BOTH preserve accented characters. |
| Email tier (T2) before name tier (T3) — correct ordering? | Email is more specific. If a guest changes email between bookings, T3 still catches them. T2-first matches common case (email is stable). |
| Existing `'unknown'` bucket docs | Unchanged. New unknown-bucket docs continue to land there. Not regressive. |
| `findMatchingBooking` is shared across 3 flows | Plan acknowledges all 3 call sites. Tests cover the guest_message flow; reservation_confirmation and resolution_request need smoke tests. |

## 8. Acceptance criteria

- ✅ A confirmation-code-bearing message lands on `threadKey = bookingCode` (tier 1 unchanged).
- ✅ A message from `jane@gmail.com` with no confirmation code, where `bookings` has a stay for that email within the active window, lands on the booking's `bookingCode` thread (tier 2).
- ✅ A message from a name-extractable Airbnb forward (`fromAddress: express@airbnb.com`, name "Jane Doe" in subject), where `bookings` has a stay for "Jane Doe" within the active window, lands on the booking's `bookingCode` thread (tier 3).
- ✅ When no booking matches, the threadKey is `name:jane-doe|y:2026` (or current year), NOT `email:express@airbnb.com`.
- ✅ Two messages from the same Jane Doe across April 30 → May 2 produce the **same** threadKey.
- ✅ Two different unmatched Janes in different years (2025 and 2026) get **different** threadKeys.
- ✅ Two distinct bookings for the same guest (e.g. May 1-5 and Sept 10-15) — a Sept 11 message routes to the September booking, not May.
- ✅ All three existing call sites (`reservation_confirmation`, `resolution_request`, `guest_message`) get the upgraded matcher with no regression on tier-1 behavior.
- ✅ Voice-learning loop (`onAirbnbMessageSent` → `voiceProfilePrompt`) preserved end-to-end. Not regressed.
- ✅ Unit tests cover each tier transition and the tie-breaker (in `infra/lambda/parse-airbnb-email/__tests__/`).

## 9. Test plan

**Unit tests** (TDD per project lessons-md preference):

1. `buildThreadKey` — bookingCode wins; airbnb-forwarder email skipped; name+year produced; empty inputs return `'unknown'`.
2. `findMatchingBooking` — each tier hits in isolation when prior tiers miss.
3. `isInActiveWindow` — boundary cases at exactly −15d, −16d, +5d, +6d.
4. `tieBreak` — single candidate; multi-candidate with one active-stay; multi-candidate with no active-stay (midpoint-closest wins); fully-tied (createdAt-desc).

**Manual smoke** (after deploy):

1. Replay an existing real email through the Lambda (use the lockSweeper-clearable test path) — confirm tier-1 still works.
2. Construct a synthetic email with no confirmation code but a known guest email — confirm tier 2 routes correctly.
3. Construct a synthetic Airbnb-forwarded email with name-only signal — confirm tier 3 routes correctly.
4. Construct a synthetic email matching nothing — confirm new annual-bucket key is written.
5. In admin Messages UI, verify that a real recent unmatched thread doesn't get *worse* (no fragmentation regression).

## 10. Effort estimate

| Task | Effort |
|---|---|
| Extend `lib/thread-key.js` (annual bucket + airbnb-forwarder skip) | 25 min |
| Add helpers (`isInActiveWindow`, `tieBreak`, `matchByActiveWindow`, `normalizeName`) | 30 min |
| Replace `findMatchingBooking` + update 3 call sites | 40 min |
| Update `buildThreadKey` calls in Lambda + functions/index.js + admin/messages/page.js | 15 min |
| Unit tests | 45 min |
| Manual smoke + commit | 15 min |
| **Total** | **~2.5 hours** |

## 11. Out-of-scope but worth a follow-up note

- **Tier 4** (`booking_members` collection-group lookup): adds sibling-guest matching. Probably 30 min of code + 1 collection-group index. Add when first real Sofia case hits.
- **Outbound capture (Item 3)**: ~1 hour. Logically next after threading lands.
- **Headers persistence (Item 4)**: ~2 hours. Accurate parent-child reconstruction within a thread.
- **Context window 5 → 20 (Item 5)**: ~30 min. Two-line change: `.limit(10)` → `.limit(21)` and `.slice(-5)` → `.slice(-20)`.

---

**End of spec.** Ready for implementation plan.
