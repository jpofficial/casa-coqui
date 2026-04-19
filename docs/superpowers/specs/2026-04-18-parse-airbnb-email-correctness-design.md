# parse-airbnb-email Correctness — Design

**Status:** Ready for review
**Date:** 2026-04-18
**Authors:** Julio + Claude (Opus 4.7) + coordinator (Opus 4.6)
**Supersedes:** none (amends `AGENT-RESERVATION-FLOW-PLAN.md` v3.2 → v3.3; see companion amendment PR)
**Companion spec:** `docs/superpowers/specs/2026-04-15-welcome-drafts-and-messaging-unification-design.md` — authoritative on welcome queue UX, `welcomeStatus` 6-state machine, `threadKey` system, and `welcomeSweeper`. This spec does not re-litigate any of it.

---

## 1. Problem

`infra/lambda/parse-airbnb-email/index.js` has four correctness issues that accumulated since the 2026-04-15 welcome-drafts deploy:

1. **`findMatchingBooking` double-broken fallback.** Filters the non-existent field `checkOut` (real name `checkOutDate`) and calls `.toDate()` on ISO strings that have no such method. Dead since it shipped — never matches.
2. **`createBookingFromConfirmation` is racy + underhardened.** Uses `bookings.collection.add()` (random IDs) with a query-then-create dedupe — two invocations can pass the dedupe check concurrently. Silent first-unit fallback on unmapped listings. Regex date parser with no sanity checks (misparsed `checkInDate` = silent wrong-day booking).
3. **Welcome-draft ownership race.** Both `functions/icsSync.js:243` and `infra/lambda/parse-airbnb-email/index.js:1034` call `generateWelcomeMessage` on the same booking doc. The `welcomeStatus !== 'pending'` guard is a read-then-write race; simultaneous writers both pass.
4. **Idempotency check ordering.** SES → Lambda is at-least-once. Dedupe runs *after* side effects (booking writes, FCM pushes) in the reservation_confirmation branch, so retries duplicate state.

## 2. Goals

- Make Lambda's reservation_confirmation handling safe under concurrent invocations and SES redelivery.
- Collapse the two-writer welcome-draft race by ending Lambda's participation.
- Preserve near-real-time staff FCM push notifications for incoming bookings (Julio confirmed this is a fixed, working experience today).
- Close the architectural story cleanly: Lambda enriches or quarantines, ICS creates.

## 3. Non-goals

- No changes to the welcome queue UX, `welcomeStatus` state machine, `threadKey` system, `welcomeSweeper`, or the reply agent. All owned by the 2026-04-15 spec.
- No DLQ, CloudWatch alarms, or `NodejsFunction` migration. Those are P1/P2 PRs tracked separately.
- No `SECRETS.md` creation. Separate PR.
- No RAG filter changes.
- No admin UI for the quarantine collection. Firestore console query is the stopgap until a follow-up PR ships one.

## 4. Architecture decision — Path A

**Lambda never creates bookings.** On reservation_confirmation emails:

- **Match** by `airbnbConfirmationCode` → enrich existing booking doc with extracted contact fields. Emit a staff FCM push on first enrichment.
- **No match** → write to `airbnb_messages_quarantine` with `reason: 'unmatched_awaiting_ics'` and stash the extracted fields on the quarantine doc for later consumption.

**ICS remains the sole booking creator.** When ICS polls and creates a booking, it **reactively drains** any matching `unmatched_awaiting_ics` quarantine docs, applying their enrichment fields to the new booking.

**Near-real-time push preserved via two mechanisms:**
1. ICS poll frequency increases from 30-min → 5-min (Julio confirmed no Airbnb iCal rate-limit concerns at this rate).
2. Enrichment path fires a staff FCM push on first enrichment of a booking, gated on `lastEnrichedFromEmailAt`. Covers the window where email arrives before ICS catches up.

## 5. Scope of change

| File | Change |
|---|---|
| `infra/lambda/parse-airbnb-email/index.js` | Heavy surgery (~350 LOC deleted, ~120 added). See Commits 1-4. |
| `infra/lambda/parse-airbnb-email/package.json` | Remove `@anthropic-ai/sdk` dependency. |
| `functions/lib/welcome-ai.js` | Add `TERMINAL_WELCOME_STATES` export and 6-state guard. |
| `functions/icsSync.js` | Cron 30-min → 5-min. New reactive-drain block after booking create. |
| `functions/scheduled.js` | New `lockSweeper` sibling of `welcomeSweeper`. |
| `lib/notification-strings.js` | New EN + ES locale keys for `staff.airbnbEmailEnriched.{title,body}`. |
| `firestore.indexes.json` | New composite: `airbnb_messages_quarantine(airbnbConfirmationCode, reason, status)`. |
| Firestore TTL (out-of-band) | Enable TTL on `airbnb_processing_locks.expiresAt`. |

## 6. Data model

### 6.1 `bookings` — new field

| Field | Type | Notes |
|---|---|---|
| `lastEnrichedFromEmailAt` | ISO string \| unset | Set on first enrichment from a reservation_confirmation email. Gates the push-on-enrich to fire exactly once per booking. |

### 6.2 `airbnb_messages_quarantine` — new fields

| Field | Type | Notes |
|---|---|---|
| `enrichmentFields` | object | Extracted `guestName`, `guestCount`, `payoutAmount`, `guestMessage` from the reservation_confirmation email. Consumed by the reactive drain. |
| `status` | `'pending' \| 'resolved'` | New field; drained docs flip to `resolved`. |
| `resolvedAt` | ISO string | Set when drained. |
| `resolvedBookingId` | string | The booking that consumed this quarantine doc. |
| `resolvedBy` | string | `'icsSync:drain'` today. Reserved for future drain sources. |

### 6.3 `airbnb_processing_locks` — new collection

| Field | Type | Notes |
|---|---|---|
| `rawEmailS3Key` | string | S3 object key for the email being processed. |
| `messageId` | string \| null | RFC-2822 Message-ID header from the parsed MIME email. |
| `status` | `'processing' \| 'reclaimable' \| 'completed'` | State machine for the lock. |
| `claimedAt` | Firestore Timestamp | Updated on every claim or reclaim. |
| `claimedBy` | string | Lambda request ID of the current owner. |
| `reclaimedFrom` | string \| null | Previous owner's request ID if this lock was reclaimed. |
| `expiresAt` | Firestore Timestamp | `claimedAt + 7d`. Firestore TTL source. |
| `completedAt` | Firestore Timestamp \| null | Set on successful handler completion. |

Doc ID: `sha256(rawEmailS3Key).slice(0, 32)`. Content-addressable — same email produces same lock doc ID across retries.

## 7. Commits

### Commit 1 — Delete Lambda booking creation; match-or-quarantine enrichment

**Commit message:**
```
refactor(lambda): remove booking auto-creation, enrich-or-quarantine only

createBookingFromConfirmation had a silent first-unit fallback (wrong apartment
risk), a regex date parser with no sanity checks (silent wrong-date risk), and
a query-then-create dedupe race against concurrent ICS writes.

Per Path A: ICS is the sole booking creator. Lambda matches existing bookings
by airbnbConfirmationCode and either enriches in place or quarantines with
reason 'unmatched_awaiting_ics'. The quarantine doc now carries the extracted
enrichment fields so Commit 5's reactive drain can consume them when ICS
catches up.

findMatchingBooking's dead guest-name fallback deleted in the same pass
(double-broken field-name bug: checkOut vs checkOutDate + .toDate() on ISO).
```

**Deletions in `infra/lambda/parse-airbnb-email/index.js`:**

| Lines | Symbol |
|---|---|
| 206-219 | `MONTHS` constant |
| 229-252 | `parseShortDate` |
| 262-338 | `extractReservationDetails` |
| 342-624 | `createBookingFromConfirmation` |
| 799-823 | `findMatchingBooking` guest-name fallback branch |

**New function — `extractEnrichmentFields`:**

```js
/**
 * Extract fields used to enrich an existing booking. No date parsing — dates
 * come from ICS which is the authoritative source. Payout regex bounded to
 * avoid matching across unrelated dollar amounts (cleaning fee / service fee
 * / total) in Airbnb email bodies.
 */
function extractEnrichmentFields(subject, body) {
  const fields = {
    guestName: extractGuestNameFromSubject(subject),
    guestCount: null,
    payoutAmount: null,
    guestMessage: null,
  };

  const countMatch = body.match(/(\d+)\s+(?:adults?|guests?)/i);
  if (countMatch) fields.guestCount = parseInt(countMatch[1], 10);

  const payoutMatch = body.match(
    /(?:total|guest paid|you earn|payout)[^$]{0,200}\$([0-9,]+\.?\d*)/i
  );
  if (payoutMatch) {
    fields.payoutAmount = parseFloat(payoutMatch[1].replace(/,/g, ''));
  }

  const msgMatch = body.match(/"([^"]{20,})"/);
  if (msgMatch) fields.guestMessage = msgMatch[1].trim();

  return fields;
}
```

**New `findMatchingBooking`:**

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

**New reservation_confirmation branch** (replaces lines 979-1042):

```js
if (messageType === 'reservation_confirmation') {
  const matched = await findMatchingBooking(firestore, confirmationCode);
  const fields = extractEnrichmentFields(subject, bodyText);

  if (!matched) {
    await firestore.collection('airbnb_messages_quarantine').add({
      messageType: 'reservation_confirmation',
      reason: 'unmatched_awaiting_ics',
      status: 'pending',
      subject,
      body: bodyText.slice(0, 4000),
      receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
      rawEmailS3Key: objectKey,
      messageId: rfcMessageId,
      sesMessageId,
      airbnbConfirmationCode: confirmationCode || null,
      enrichmentFields: fields,
      quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('reservation confirmation unmatched — quarantined', {
      airbnbConfirmationCode: confirmationCode,
    });
    quarantinedCount++;
    continue;
  }

  // Enrich — never overwrite existing non-null fields.
  const existing = matched.data;
  const genericNames = ['airbnb guest', 'guest', ''];
  const existingNameGeneric = genericNames.includes(
    (existing.guestName || '').toLowerCase().trim()
  );

  const updates = {};
  if (fields.guestName && existingNameGeneric) updates.guestName = fields.guestName;
  if (fields.guestCount && !existing.guestCount) updates.guestCount = fields.guestCount;
  if (fields.payoutAmount && !existing.payoutAmount) updates.payoutAmount = fields.payoutAmount;
  if (fields.guestMessage && !existing.guestMessage) updates.guestMessage = fields.guestMessage;

  // Push-on-first-enrich (Commit 4 adds this block)
  // ...

  if (Object.keys(updates).length > 0) {
    updates.lastEnrichedFromEmailAt = new Date().toISOString();
    await firestore.collection('bookings').doc(matched.id).update(updates);
    console.log('booking enriched from email', {
      bookingId: matched.id,
      fieldsUpdated: Object.keys(updates),
    });
  }

  processedCount++;
  continue;
}
```

---

### Commit 2 — Tombstone claim with transactional reclaim

**Commit message:**
```
fix(lambda): hoist dedupe to pre-write, add tombstone claim for crash safety

SES → Lambda is at-least-once. Today duplicate checks run AFTER side effects
in the reservation_confirmation path; SES retry of the same S3 object produces
duplicate Firestore state even if dedupe eventually fires.

This commit: (1) moves dedupe to immediately after MIME parse, reading three
collections (airbnb_messages, airbnb_messages_quarantine, airbnb_processing_locks)
in parallel; (2) adds a tombstone claim via .create() on airbnb_processing_locks
— fails with ALREADY_EXISTS if the doc exists, giving compare-and-swap on first
claim; (3) stale-lock reclaim runs under runTransaction for CAS on the
read-then-conditional-write path, preventing concurrent reclaimers from both
taking the lock.

Lock doc ID = sha256(rawEmailS3Key).slice(0,32) — content-addressable, same
email produces the same lock across SES retries. expiresAt = claimedAt + 7d
for Firestore TTL-based cleanup (policy enabled out-of-band).

Crashed invocations leave stuck 'processing' locks; functions/scheduled.js
lockSweeper (Commit 4) flips them to 'reclaimable'. The Lambda treats
'reclaimable' the same as stale-'processing' for reclaim purposes.
```

**New `claimTombstone` helper:**

```js
async function claimTombstone(firestore, objectKey, rfcMessageId) {
  const lockId = sha256(objectKey).slice(0, 32);
  const lockRef = firestore.collection('airbnb_processing_locks').doc(lockId);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Fast path — .create() gives CAS on first claim.
  try {
    await lockRef.create({
      rawEmailS3Key: objectKey,
      messageId: rfcMessageId || null,
      status: 'processing',
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimedBy: process.env.AWS_LAMBDA_REQUEST_ID || 'unknown',
      expiresAt,
    });
    return { claimed: true, lockRef };
  } catch (err) {
    if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
  }

  // Slow path — lock exists. Transaction gives CAS on the read-then-conditional-
  // write. Concurrent reclaimers serialize: the loser sees the winner's fresh
  // claimedAt and concludes !isStale on retry.
  return await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = snap.data() || {};
    const claimedAtMs = data.claimedAt?.toMillis?.() || 0;
    const staleThresholdMs = Date.now() - 5 * 60 * 1000;
    const isStale =
      (data.status === 'processing' && claimedAtMs < staleThresholdMs) ||
      data.status === 'reclaimable';

    if (!isStale) return { claimed: false, lockRef };

    tx.update(lockRef, {
      status: 'processing',
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimedBy: process.env.AWS_LAMBDA_REQUEST_ID || 'unknown',
      reclaimedFrom: data.claimedBy || 'unknown',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return { claimed: true, lockRef };
  });
}

async function markTombstoneCompleted(lockRef) {
  await lockRef.update({
    status: 'completed',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
```

**Handler change** — replace the existing per-branch dedupe checks with a hoisted block right after `simpleParser`:

```js
const firestore = await getFirestore();

// Dedupe across all three terminal collections before any side effect.
const [msgDup, quarDup] = await Promise.all([
  isDuplicate(firestore, 'airbnb_messages', objectKey, rfcMessageId),
  isDuplicate(firestore, 'airbnb_messages_quarantine', objectKey, rfcMessageId),
]);
if (msgDup || quarDup) {
  console.log('duplicate — terminal record exists, skipping');
  skippedCount++;
  continue;
}

// Authoritative claim — .create() fails if lock doc exists (CAS).
const claim = await claimTombstone(firestore, objectKey, rfcMessageId);
if (!claim.claimed) {
  console.log('duplicate — lock held by another invocation');
  skippedCount++;
  continue;
}

// ... classify/extract/branch logic runs under the claim ...

// At the end of every successful path (matched + quarantine + guest_message):
await markTombstoneCompleted(claim.lockRef);
```

**Remove** the per-branch `isDuplicate` calls at lines 1002, 1050, 1086, 1116 — now redundant.

---

### Commit 3 — Welcome ownership locked to ICS

**Commit message:**
```
refactor(lambda): remove welcome-draft generation; ICS owns sole write path

functions/icsSync.js:243 already calls generateWelcomeMessage after booking
creation. Lambda's copy at index.js:691-766 is a second writer that races
against ICS on the shared booking doc — today the welcomeStatus !== 'pending'
guard is the only thing preventing duplicate drafts, and it has a read-then-
write race.

This commit: deletes Lambda's generateWelcomeDraft + WELCOME_SYSTEM_PROMPT +
WELCOME_TOOL + getAnthropicApiKey + the Anthropic SDK dependency. Adds the
6-state TERMINAL_WELCOME_STATES guard to the canonical generator at
functions/lib/welcome-ai.js, exported so functions/scheduled.js welcomeSweeper
imports it rather than duplicating the literal.

ICS becomes the sole welcome writer — no transaction needed. Future regressions
(a fourth generator) become visible as duplicate drafts in agent_runs, not
silent races.
```

**Deletions in `infra/lambda/parse-airbnb-email/index.js`:**

| Lines | Symbol |
|---|---|
| 24 | `const Anthropic = require('@anthropic-ai/sdk').default;` |
| 630-646 | `cachedAnthropicKey` + `getAnthropicApiKey` |
| 648-667 | `WELCOME_SYSTEM_PROMPT` |
| 669-680 | `WELCOME_TOOL` |
| 691-766 | `generateWelcomeDraft` function |

**Update `infra/lambda/parse-airbnb-email/package.json`:** remove `@anthropic-ai/sdk` from `dependencies`.

**Addition to `functions/lib/welcome-ai.js`** (prepend to `generateWelcomeMessage`):

```js
const TERMINAL_WELCOME_STATES = new Set([
  'ready', 'sent', 'skipped', 'snoozed',
]);

async function generateWelcomeMessage({ booking, settings, template }) {
  // 'pending' and 'error' should regenerate — 'error' is the welcomeSweeper's
  // retry signal. Terminal states are no-ops. The `&& booking.welcomeStatus`
  // short-circuit permits seed-script bookings (scripts/seed-data.js,
  // scripts/seed-test-bookings.js) that don't initialize the field.
  if (booking.welcomeStatus && TERMINAL_WELCOME_STATES.has(booking.welcomeStatus)) {
    console.log('welcome generation skipped — terminal state', {
      bookingId: booking.id,
      welcomeStatus: booking.welcomeStatus,
    });
    return { message: booking.welcomeMessage || null, language: null, skipped: true };
  }

  // ... existing implementation unchanged ...
}

module.exports = { generateWelcomeMessage, TERMINAL_WELCOME_STATES };
```

The `TERMINAL_WELCOME_STATES` export is defensive — `welcomeSweeper` today queries on non-terminal states (`pending`, `snoozed`) and doesn't need the set, but future callers (retry scripts, admin tooling) should import it rather than hardcoding the literal.

---

### Commit 4 — Push-on-enrich + ICS 5-min + `lockSweeper` + TTL

**Commit message:**
```
feat(lambda,functions): preserve near-real-time push + add lock hygiene

After Commit 1 removed Lambda booking creation, the staff FCM push that fired
on "new booking auto-created" is lost for the case where email arrives before
ICS polls. This commit restores near-real-time push via two mechanisms that
ship together:

1. Enrichment path emits staff FCM push on first enrichment only, gated on
   lastEnrichedFromEmailAt. Idempotent — resend of the same email produces no
   duplicate push.
2. functions/icsSync.js cron frequency 30-min → 5-min. Julio confirmed no
   Airbnb iCal rate-limit concerns at this rate.

Adds lockSweeper to functions/scheduled.js — sibling of welcomeSweeper, runs
every 15 min, flips airbnb_processing_locks with status: 'processing' and
claimedAt < now - 5min to status: 'reclaimable'. Kept as a separate function
(not welcomeSweeper extension) so its lifecycle is independently controllable.

Firestore TTL policy on airbnb_processing_locks.expiresAt enables automatic
cleanup of completed + stuck + reclaimable locks after 7 days. Enabled via
gcloud out-of-band (see pre-merge checklist).
```

**Push-on-first-enrich** — addition to the enrichment block in Commit 1:

```js
const firstEnrichment = !existing.lastEnrichedFromEmailAt;
if (Object.keys(updates).length > 0) {
  updates.lastEnrichedFromEmailAt = new Date().toISOString();
  await firestore.collection('bookings').doc(matched.id).update(updates);

  if (firstEnrichment) {
    await notifyAdminAndCohost({
      titleKey: 'staff.airbnbEmailEnriched.title',
      bodyKey: 'staff.airbnbEmailEnriched.body',
      bodyParams: { guestName: updates.guestName || existing.guestName || 'Guest' },
      type: 'booking_enriched',
      data: { bookingId: matched.id, targetPath: '/admin/bookings' },
    });
  }
}
```

**New locale keys in `lib/notification-strings.js`:**

```js
// EN
'staff.airbnbEmailEnriched.title': 'Airbnb email received',
'staff.airbnbEmailEnriched.body': 'Booking details enriched from email for {guestName}',

// ES
'staff.airbnbEmailEnriched.title': 'Email de Airbnb recibido',
'staff.airbnbEmailEnriched.body': 'Detalles de reserva enriquecidos por email para {guestName}',
```

Note: `booking_enriched` is a new type not in `TYPE_TO_PREF_KEY`. Per the existing staff-notification design (unknown types always send), it bypasses preference filtering. If staff want this addable to prefs later, it's a one-line follow-up change.

**ICS cron frequency** — in `functions/icsSync.js` or wherever the schedule is declared:

```js
// Before
exports.icsSync = onSchedule('every 30 minutes', async (event) => { /* ... */ });

// After
exports.icsSync = onSchedule('every 5 minutes', async (event) => { /* ... */ });
```

If the schedule is out-of-band (gcloud scheduler), the change becomes a pre-merge ops step instead.

**New `lockSweeper` in `functions/scheduled.js`:**

```js
const LOCK_STALE_THRESHOLD_MS = 5 * 60 * 1000;

exports.lockSweeper = onSchedule('every 15 minutes', async () => {
  const cutoff = new Date(Date.now() - LOCK_STALE_THRESHOLD_MS);
  const snap = await db
    .collection('airbnb_processing_locks')
    .where('status', '==', 'processing')
    .where('claimedAt', '<', cutoff)
    .limit(50)
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  snap.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: 'reclaimable',
      reclaimedAt: new Date().toISOString(),
    });
  });
  await batch.commit();

  console.log(`lockSweeper reclaimed ${snap.size} stale tombstones`);
});
```

**TTL policy** — enable out-of-band (see pre-merge checklist):

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=airbnb_processing_locks \
  --enable-ttl
```

---

### Commit 5 — Reactive quarantine drain in `icsSync.js`

**Commit message:**
```
feat(icsSync): drain unmatched-awaiting-ics quarantine on new booking create

Closes the Path A loop. When email arrives before ICS polls, Lambda quarantines
with reason: 'unmatched_awaiting_ics' and stashes extracted enrichment fields
on the quarantine doc. ICS then creates the canonical booking 0-5 min later.

Without this drain the quarantine doc sits unread forever; the booking keeps
its ICS-provided placeholder guestName + null guestCount/payoutAmount.

Post-create hook queries airbnb_messages_quarantine by airbnbConfirmationCode,
applies enrichment to the new booking, and marks quarantine docs resolved.
Silent (no push) — the ICS-create push already fired; duplicate push for the
same booking would be noise.

New composite index: airbnb_messages_quarantine(airbnbConfirmationCode, reason,
status).
```

**Addition in `functions/icsSync.js`** — immediately after `bookingRef = await db.collection('bookings').add(bookingData);`:

```js
// Reactive drain: consume email-arrived-first enrichment from quarantine.
// Non-fatal — drain failure doesn't block booking creation.
try {
  const quarantineSnap = await db
    .collection('airbnb_messages_quarantine')
    .where('airbnbConfirmationCode', '==', bookingData.airbnbConfirmationCode || '')
    .where('reason', '==', 'unmatched_awaiting_ics')
    .where('status', '==', 'pending')
    .get();

  if (!quarantineSnap.empty) {
    const fields = quarantineSnap.docs[0].data().enrichmentFields || {};
    const genericNames = ['airbnb guest', 'guest', ''];
    const nameGeneric = genericNames.includes(
      (bookingData.guestName || '').toLowerCase().trim()
    );

    const updates = {};
    if (fields.guestName && nameGeneric) updates.guestName = fields.guestName;
    if (fields.guestCount && !bookingData.guestCount) updates.guestCount = fields.guestCount;
    if (fields.payoutAmount && !bookingData.payoutAmount) updates.payoutAmount = fields.payoutAmount;
    if (fields.guestMessage && !bookingData.guestMessage) updates.guestMessage = fields.guestMessage;

    if (Object.keys(updates).length > 0) {
      updates.lastEnrichedFromEmailAt = new Date().toISOString();
      await bookingRef.update(updates);
    }

    const batch = db.batch();
    quarantineSnap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'icsSync:drain',
        resolvedBookingId: bookingRef.id,
      });
    });
    await batch.commit();

    console.log('reactive drain applied email enrichment', {
      bookingId: bookingRef.id,
      airbnbConfirmationCode: bookingData.airbnbConfirmationCode,
      fieldsUpdated: Object.keys(updates),
      quarantineDocsResolved: quarantineSnap.size,
    });
  }
} catch (err) {
  console.error('Reactive drain failed (non-fatal)', {
    bookingId: bookingRef.id,
    error: err.message,
  });
}
```

**New composite index in `firestore.indexes.json`:**

```json
{
  "collectionGroup": "airbnb_messages_quarantine",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "airbnbConfirmationCode", "order": "ASCENDING" },
    { "fieldPath": "reason",                 "order": "ASCENDING" },
    { "fieldPath": "status",                 "order": "ASCENDING" }
  ]
}
```

---

## 8. Rollback

Per-commit rollback plan if a commit misbehaves in production:

| Commit | Rollback action |
|---|---|
| 1 | Revert the commit. No data migration needed — `airbnb_messages_quarantine` with `reason: 'unmatched_awaiting_ics'` and `status: 'pending'` docs become inert (nothing reads them on the old code path). |
| 2 | **Revert the code only.** Leave the `airbnb_processing_locks` collection and its TTL policy in place — harmless when unused, and deleting mid-rollback risks racing with in-flight writes from the pre-revert traffic. The collection self-cleans via TTL over the following 7 days. |
| 3 | Revert the commit. Restores Lambda's `generateWelcomeDraft` and the dual-writer race — undesirable, but operationally safe. If rolled back, file a follow-up to re-attempt Commit 3. |
| 4 | **Check quarantine first.** If reverting the ICS cron from 5-min back to 30-min, query `airbnb_messages_quarantine where reason='unmatched_awaiting_ics' and status='pending'` — those docs will sit longer (up to 30 min) awaiting drain. Decide per-doc whether to drain manually before the revert takes effect. `lockSweeper` and the TTL policy can stay in place regardless. |
| 5 | Revert the commit. Orphans `airbnb_messages_quarantine` docs to their pre-drain state — status stays `pending`, no booking gets the enrichment. Run a one-off manual drain script if needed (same logic as the reverted commit) against the backlog. |

## 9. Pre-merge operational checklist

- [ ] **Confirm Anthropic API key in Secrets Manager is the current key (not mid-rotation).** Commit 3 removes Lambda's reference; a rotation in flight means ICS's shared-lib call will continue to work on the current key, but the Lambda's last reads before deploy will fail if the key was already cycled. Finish any rotation before deploying.
- [ ] **Audit query:** `bookings.where('source', '==', 'airbnb_email').count()` via Firestore console. If non-zero, inspect the docs — per-booking decision (merge-to-ICS-twin, leave alone, or delete) before Commit 1 deploys.
- [ ] **TTL policy:**
  ```bash
  gcloud firestore fields ttls update expiresAt \
    --collection-group=airbnb_processing_locks \
    --enable-ttl
  ```
- [ ] **ICS cron** (only if schedule is out-of-band, not in `functions/index.js` code):
  ```bash
  gcloud scheduler jobs update pubsub firebase-schedule-icsSync-us-east1 \
    --schedule "every 5 minutes"
  ```
- [ ] **Composite index:**
  ```bash
  firebase deploy --only firestore:indexes
  ```
  Verify index on `airbnb_messages_quarantine(airbnbConfirmationCode, reason, status)` reaches `READY` state (can take up to 15 min).

## 10. Test matrix

Convention: manual smoke tests, no Firestore emulator (matches the 2026-04-15 spec §10).

### Regression (2026-04-15 spec §10 — must still pass unchanged)

1. Fresh forward → Drafts tab populated within 10 s.
2. Mark as Sent → thread shows the welcome.
3. Send later → snooze round-trip via `welcomeSweeper`.
4. Stuck pending → `welcomeSweeper` flips to `error`.
5. Unmatched thread separation.
6. Link to booking.
7. Reply agent context includes welcome.

### New — Commit 1 (enrich-or-quarantine)

8. **Email corpus replay (DRY_RUN).** Re-run every email from the last 30 days of `s3://casa-coqui-inbound-email/airbnb/` through the Lambda in dry-run mode. Assertions:
   - Zero calls to `bookings.collection.add()`.
   - Every `reservation_confirmation` email either matches → log `booking enriched from email`, or produces a quarantine write with `reason: 'unmatched_awaiting_ics'` + non-empty `enrichmentFields`.
9. **Unmapped listing.** Send a reservation_confirmation with a listing title that doesn't match any `listingMappings`. Assert quarantine write with `reason: 'unmatched_awaiting_ics'`; **no booking created**.

### New — Commit 2 (tombstone + transaction)

10. **Concurrent invocation on same S3 object.** Fire two Lambda invocations back-to-back on the same `objectKey`. Assert: exactly one `airbnb_processing_locks` doc; exactly one invocation past classify/extract; no duplicate Firestore writes.
11. **Crash-mid-processing + `lockSweeper` reclaim.** Set `SIMULATE_CRASH_AFTER_CLAIM=true` env var; invoke Lambda once. Lock remains `processing`. Wait 16 minutes. Assert `status` flipped to `reclaimable`. Replay the same `objectKey`; transaction reclaims, full processing completes, lock reaches `completed`.
12. **Concurrent reclaim race (transaction fix).** Seed a stale lock (`status: 'processing'`, `claimedAt: 10 min ago`). Fire two Lambda invocations simultaneously. Assert: exactly one invocation reaches post-claim work; the other logs `duplicate — lock held`.

### New — Commit 3 (welcome ownership)

13. **ICS-only welcome generation.** Create a booking via ICS sync. Immediately send the matching reservation_confirmation email through SES. Wait 2 min. Assertions:
    - Exactly one `agent_runs` doc with `kind: 'welcome'` for this booking.
    - `booking.welcomeStatus === 'ready'` and `welcomeMessage` present.
    - No Anthropic call logged from Lambda (grep CloudWatch).
14. **Error-state retry.** Set `welcomeStatus: 'error'`. Call `POST /api/bookings/{id}/welcome?force=true`. Assert generator runs (not skipped) and status flips to `ready`.

### New — Commit 4 (push + cron + TTL)

15. **Push-on-first-enrich — REAL-DEVICE VERIFICATION.** Seed a booking via ICS with `guestName: 'Airbnb Guest'` and `lastEnrichedFromEmailAt: unset`. Send matching email through SES. Assertions:
    - Booking enriched (guestName updated).
    - **On actual iOS + Android device**: staff sees push with title *"Airbnb email received"* / body *"Booking details enriched from email for {real guest name}"*.
    - Resending the same email updates nothing and fires no second push.
16. **ICS cron at 5-min.** `gcloud scheduler jobs describe firebase-schedule-icsSync-us-east1` → `schedule: every 5 minutes`. Observe 3 consecutive runs in Cloud Functions logs over 15 min.
17. **Lock TTL policy enabled.** `gcloud firestore fields ttls list --collection-group=airbnb_processing_locks` shows `expiresAt` with `ENABLED`. Actual deletion timing is Firestore-infra-dependent, not test-gated.

### New — Commit 5 (reactive drain)

18. **Email-then-ICS sequence.** Delete any existing booking for a recent Airbnb confirmation. Resend the confirmation email through SES → Lambda quarantines with `enrichmentFields`. Trigger ICS manually. Assertions:
    - New booking created by ICS.
    - Drain query finds the quarantine doc (check logs).
    - Booking gets enrichment updates.
    - Quarantine doc flips to `status: 'resolved'`, `resolvedBookingId` set.
    - Only the ICS-create push fires (no duplicate).
19. **Drain failure non-fatal.** Inject `throw new Error('drain test')` in the drain try block. Trigger ICS sync. Assert: booking created, logs show `Reactive drain failed (non-fatal)`.

## 11. Out of scope (tracked separately)

| Item | Priority | Target |
|---|---|---|
| `SECRETS.md` with Anthropic + Firebase rotation runbooks | P2 | Separate small PR |
| DLQ + CloudWatch alarms (errors, throttles, DLQ depth, quarantine depth) | P1 | Separate PR |
| `NodejsFunction` bundling migration | P2 | Separate PR |
| RAG filter `no_traffic_hedging` airport-context narrowing | P2 | Amend existing RAG filter plan |
| Admin UI for `airbnb_messages_quarantine` | P2 | Separate PR |
| Add `booking_enriched` to `TYPE_TO_PREF_KEY` if staff wants it pref-filtered | P3 | One-line change, demand-driven |

## 12. Open questions

None. All ambiguities were closed across five rounds of review. If review surfaces new ones, route via the coordinator.
