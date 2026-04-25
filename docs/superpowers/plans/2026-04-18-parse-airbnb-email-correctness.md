# parse-airbnb-email Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four correctness issues in `infra/lambda/parse-airbnb-email/index.js` (dead-code fallback, unsafe booking creation, welcome-draft race, idempotency ordering) without disrupting the 2026-04-15 welcome-drafts queue or threading system.

**Architecture:** Path A — Lambda enriches or quarantines, ICS remains sole booking and welcome-draft creator. Tombstone-claim pattern on `airbnb_processing_locks` gives SES-redelivery + crash safety. Reactive drain closes the email-arrives-first loop.

**Tech Stack:** AWS Lambda (Node.js 20), Firebase Admin SDK (Firestore + FCM), Firebase Cloud Functions (v2 scheduled), Jest for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md` — read it first if you haven't.

**Branch:** work on `ec2-deploy` (dev testing environment). No prod risk.

---

## File Structure

Files this plan creates or modifies, with single responsibility per file:

| File | Responsibility |
|---|---|
| `infra/lambda/parse-airbnb-email/index.js` | Lambda handler — MIME parse, classify, match/enrich/quarantine, tombstone lifecycle. |
| `infra/lambda/parse-airbnb-email/__tests__/extract-enrichment-fields.test.js` | Jest unit tests for the new pure extractor. |
| `infra/lambda/parse-airbnb-email/package.json` | Remove `@anthropic-ai/sdk` dep. |
| `functions/lib/welcome-ai.js` | Canonical welcome generator — add `TERMINAL_WELCOME_STATES` guard + export. |
| `functions/lib/__tests__/welcome-ai-guard.test.js` | Jest unit tests for the 6-state guard. |
| `functions/icsSync.js` | ICS poller — frequency change + reactive drain hook. |
| `functions/scheduled.js` | Add `lockSweeper` sibling of `welcomeSweeper`. |
| `lib/notification-strings.js` | Two new EN + ES locale keys for enrichment push. |
| `firestore.indexes.json` | New composite index for drain query. |

---

## Task 1: Pre-flight — verify current state

**Files:**
- Read: `infra/lambda/parse-airbnb-email/index.js`
- Read: `functions/icsSync.js`
- Read: `functions/lib/welcome-ai.js`
- Read: `functions/scheduled.js`

- [ ] **Step 1: Confirm branch**

Run: `git status && git branch --show-current`
Expected: branch `ec2-deploy`, clean working tree (or document any unrelated WIP).

- [ ] **Step 2: Audit email-created bookings**

Open Firestore console, run query:
```
Collection: bookings
Filter: source == airbnb_email
```
Expected: list (possibly zero) of bookings Lambda created via the old path.

If non-zero: inspect each. For each one, check whether a matching ICS-created booking exists by `airbnbConfirmationCode`. Decide per-booking:
- If ICS twin exists: delete the email-created one (orphan).
- If no ICS twin: leave it; ICS will eventually create the canonical one and Commit 5's drain handles enrichment.

Record findings in a scratch note for the PR description.

- [ ] **Step 3: Confirm Anthropic API key in Secrets Manager is not mid-rotation**

Run:
```bash
aws secretsmanager describe-secret --secret-id casa-coqui/anthropic-api-key --region us-east-1 | jq '.VersionIdsToStages'
```
Expected: exactly one version with stage `AWSCURRENT`. If multiple stages are in flight, pause rotation before proceeding (Commit 3 removes Lambda's reference to this secret).

- [ ] **Step 4: Verify ICS schedule location**

Run: `grep -rn "every 30 minutes\|schedule.*30" functions/` in the codebase.
Expected: find the `onSchedule()` call for `icsSync`. Note whether it's in `functions/icsSync.js`, `functions/index.js`, or requires a gcloud scheduler update.

If the schedule lives in code → Commit 4 updates it inline. If it's external (gcloud scheduler) → Commit 4 includes an ops step instead.

---

## Task 2: Commit 1 — Delete booking creation, add enrichment extractor, dual-key ICS migration

**Files:**
- Create: `infra/lambda/parse-airbnb-email/__tests__/extract-enrichment-fields.test.js`
- Modify: `infra/lambda/parse-airbnb-email/index.js` (heavy surgery)
- Modify: `functions/icsSync.js` (dual-key match for legacy Lambda-created bookings)
- Create: `functions/lib/vevent-confirmation-code.js` (pure helper, extracted for testability)
- Create: `functions/lib/__tests__/vevent-confirmation-code.test.js`

**Why dual-key in this commit:** Pre-flight audit found 6 bookings in production with `source: 'airbnb_email'` that Lambda created. Their `externalId` is the confirmation code (e.g. `HMRJNRRYF5`), not the VEVENT UID (`abc@airbnb.com`) that ICS uses for matching. Without a dual-key fallback in `icsSync.js`, deleting Lambda booking creation causes ICS to create duplicate bookings for those 6 reservations. Ship the safety net atomically with the deletion.

- [ ] **Step 1: Write failing unit test for `extractEnrichmentFields`**

Create `infra/lambda/parse-airbnb-email/__tests__/extract-enrichment-fields.test.js`:

```js
'use strict';

const { extractEnrichmentFields } = require('../index');

describe('extractEnrichmentFields', () => {
  test('extracts all four fields from a typical Airbnb email', () => {
    const subject = 'New message from Angelina Pascual';
    const body =
      'Angelina Pascual\n' +
      '2 adults\n' +
      'Total paid: $774.40\n' +
      '"Looking forward to our stay!"\n';
    const fields = extractEnrichmentFields(subject, body);
    expect(fields.guestName).toBe('Angelina Pascual');
    expect(fields.guestCount).toBe(2);
    expect(fields.payoutAmount).toBe(774.4);
    expect(fields.guestMessage).toBe('Looking forward to our stay!');
  });

  test('returns nulls when fields are absent', () => {
    const fields = extractEnrichmentFields('Unrelated subject', 'empty body');
    expect(fields.guestName).toBeNull();
    expect(fields.guestCount).toBeNull();
    expect(fields.payoutAmount).toBeNull();
    expect(fields.guestMessage).toBeNull();
  });

  test('payout regex bounded — does not match across multiple dollar amounts', () => {
    const body =
      'Cleaning fee: $50\n' +
      'Service fee: $25\n' +
      // 300+ chars of filler pushing the "total" line past the 200-char bound
      'x'.repeat(300) +
      'Total paid: $774.40';
    const fields = extractEnrichmentFields('subject', body);
    expect(fields.payoutAmount).toBeNull();
  });

  test('guest count matches adults or guests', () => {
    expect(extractEnrichmentFields('s', '7 adults').guestCount).toBe(7);
    expect(extractEnrichmentFields('s', '3 guests').guestCount).toBe(3);
    expect(extractEnrichmentFields('s', '1 adult').guestCount).toBe(1);
  });

  test('guest message requires minimum 20 chars inside quotes', () => {
    const fields = extractEnrichmentFields('s', '"short"');
    expect(fields.guestMessage).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/lambda/parse-airbnb-email && npm test -- extract-enrichment-fields`
Expected: FAIL — `extractEnrichmentFields is not exported` or `is not a function`.

- [ ] **Step 3: Delete dead code in `index.js`**

Remove these blocks (line numbers approximate — use the symbol to locate):

| Symbol | Approx lines |
|---|---|
| `MONTHS` constant | 206-219 |
| `parseShortDate` function | 229-252 |
| `extractReservationDetails` function | 262-338 |
| `createBookingFromConfirmation` function | 342-624 |
| `findMatchingBooking` guest-name fallback branch | 799-823 (the second `if (guestName) { ... }` block after the primary-match early return) |

- [ ] **Step 4: Add `extractEnrichmentFields` to `index.js`**

Insert above the `// Booking match` comment block:

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

module.exports.extractEnrichmentFields = extractEnrichmentFields;
```

(If the file doesn't yet use `module.exports` for testing, add at bottom: `module.exports = { handler: exports.handler, extractEnrichmentFields };` — keep the existing `exports.handler` working for Lambda.)

- [ ] **Step 5: Rewrite `findMatchingBooking` to primary-match only**

Replace the function with:

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

- [ ] **Step 6: Rewrite the reservation_confirmation branch in the handler**

Find the block starting at `if (messageType === 'reservation_confirmation') {` (around line 979) and replace through to the `continue;` at line 1042 with:

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

- [ ] **Step 7: Run unit tests to verify they pass**

Run: `cd infra/lambda/parse-airbnb-email && npm test -- extract-enrichment-fields`
Expected: all 5 tests PASS.

- [ ] **Step 8: Verify module still loads (Lambda cold-start sanity)**

Run: `cd infra/lambda/parse-airbnb-email && node -e "require('./index'); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 9: Write failing unit test for `extractConfirmationCodeFromVevent`**

Create `functions/lib/__tests__/vevent-confirmation-code.test.js`:

```js
'use strict';

const { extractConfirmationCodeFromVevent } = require('../vevent-confirmation-code');

describe('extractConfirmationCodeFromVevent', () => {
  test('extracts HM-code from reservation URL in description', () => {
    const vevent = {
      summary: 'Reserved — Shalie Llorens',
      description: 'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMKQCBA92M',
    };
    expect(extractConfirmationCodeFromVevent(vevent)).toBe('HMKQCBA92M');
  });

  test('extracts HM-code from summary fallback', () => {
    const vevent = {
      summary: 'Reservation HMRJNRRYF5 — Akbar Kamanda',
      description: null,
    };
    expect(extractConfirmationCodeFromVevent(vevent)).toBe('HMRJNRRYF5');
  });

  test('returns null when no HM-code found', () => {
    const vevent = { summary: 'Not available', description: 'blocked dates' };
    expect(extractConfirmationCodeFromVevent(vevent)).toBeNull();
  });

  test('handles missing summary and description', () => {
    expect(extractConfirmationCodeFromVevent({})).toBeNull();
    expect(extractConfirmationCodeFromVevent({ summary: null, description: null })).toBeNull();
  });

  test('prefers description match over summary (more authoritative)', () => {
    const vevent = {
      summary: 'Reservation HMAAAAAAAA',
      description: 'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMBBBBBBBB',
    };
    expect(extractConfirmationCodeFromVevent(vevent)).toBe('HMBBBBBBBB');
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd functions && npm test -- vevent-confirmation-code`
Expected: FAIL — `vevent-confirmation-code module not found`.

- [ ] **Step 11: Create `functions/lib/vevent-confirmation-code.js`**

```js
'use strict';

/**
 * Extract an Airbnb confirmation code (HMxxxxxxxx, 10 chars) from a VEVENT.
 *
 * Used by icsSync to dual-key match against legacy Lambda-created bookings
 * whose `externalId` was set to the confirmation code rather than the VEVENT
 * UID. On match, icsSync migrates the booking's externalId to the VEVENT UID
 * in place.
 *
 * Priority: description (Airbnb includes a reservation URL with the code) over
 * summary (may or may not contain it).
 */
function extractConfirmationCodeFromVevent(vevent) {
  if (!vevent) return null;

  const pattern = /\b(HM[A-Z0-9]{8})\b/;

  const description = vevent.description || '';
  const descMatch = description.match(pattern);
  if (descMatch) return descMatch[1];

  const summary = vevent.summary || '';
  const summaryMatch = summary.match(pattern);
  if (summaryMatch) return summaryMatch[1];

  return null;
}

module.exports = { extractConfirmationCodeFromVevent };
```

- [ ] **Step 12: Run unit test to verify it passes**

Run: `cd functions && npm test -- vevent-confirmation-code`
Expected: all 5 tests PASS.

- [ ] **Step 13: Add dual-key match to `functions/icsSync.js`**

Find the block at line 478-483 (existing match by `externalId == vevent.uid`). Replace with:

```js
const { extractConfirmationCodeFromVevent } = require('./lib/vevent-confirmation-code');

// ... inside the for loop, where the existing match currently lives ...

// Primary match: VEVENT UID (covers ICS-created bookings)
let existingSnap = await db
  .collection('bookings')
  .where('externalId', '==', vevent.uid)
  .where('unit', '==', unitName)
  .get();

// Fallback match: airbnbConfirmationCode (covers legacy Lambda-created
// bookings whose externalId was set to the HM-code rather than the VEVENT UID).
// On match, migrate externalId in place so subsequent syncs use the primary path.
if (existingSnap.empty) {
  const confirmationCode = extractConfirmationCodeFromVevent({
    summary: vevent.summary,
    description: vevent.description,
  });

  if (confirmationCode) {
    existingSnap = await db
      .collection('bookings')
      .where('airbnbConfirmationCode', '==', confirmationCode)
      .where('unit', '==', unitName)
      .get();

    if (!existingSnap.empty) {
      const doc = existingSnap.docs[0];
      await doc.ref.update({
        externalId: vevent.uid,
        source: 'airbnb',
        migratedFromEmailAt: new Date().toISOString(),
      });
      console.log('[icsSync] Migrated legacy Lambda-created booking to VEVENT UID', {
        bookingId: doc.id,
        confirmationCode,
        veventUid: vevent.uid,
      });
    }
  }
}
```

Note: the VEVENT object passed to the helper needs `summary` and `description`. The existing parsing at `icsSync.js:450` captures `event.uid`, `dtstart`, `dtend`. Check whether `summary` and `description` are already captured on the vevent object; if not, add them in the push at line 450.

- [ ] **Step 14: Verify the module still loads**

Run: `cd functions && node -e "require('./icsSync'); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 15: Commit**

```bash
git add infra/lambda/parse-airbnb-email/index.js \
        infra/lambda/parse-airbnb-email/__tests__/extract-enrichment-fields.test.js \
        functions/icsSync.js \
        functions/lib/vevent-confirmation-code.js \
        functions/lib/__tests__/vevent-confirmation-code.test.js
git commit -m "$(cat <<'EOF'
refactor(lambda,icsSync): remove booking auto-creation + dual-key legacy migration

createBookingFromConfirmation had a silent first-unit fallback (wrong apartment
risk), a regex date parser with no sanity checks (silent wrong-date risk), and
a query-then-create dedupe race against concurrent ICS writes.

Per Path A (AGENT-RESERVATION-FLOW-PLAN.md v3.3): ICS is the sole booking
creator. Lambda matches existing bookings by airbnbConfirmationCode and either
enriches in place or quarantines with reason 'unmatched_awaiting_ics'. The
quarantine doc now carries the extracted enrichment fields so Commit 5's
reactive drain can consume them when ICS catches up.

findMatchingBooking's dead guest-name fallback deleted in the same pass
(double-broken field-name bug: checkOut vs checkOutDate + .toDate() on ISO).

Legacy migration: ICS now dual-keys its existing-booking check — primary match
on externalId == vevent.uid, fallback on airbnbConfirmationCode extracted from
the VEVENT. Covers 6 bookings in production that the Lambda created before
this refactor, whose externalId was the confirmation code not the VEVENT UID.
On fallback match, ICS migrates externalId in place so subsequent syncs use
the primary path.

Unit tests: extract-enrichment-fields.test.js (4 extractors incl. bounded
payout regex) and vevent-confirmation-code.test.js (5 cases for HM-code
extraction).
EOF
)"
```

---

## Task 3: Commit 2 — Tombstone claim with transactional reclaim

**Files:**
- Modify: `infra/lambda/parse-airbnb-email/index.js`

- [ ] **Step 1: Add `sha256` helper if not already present**

Check `index.js` for a sha256 import. If absent, add near top:

```js
const crypto = require('crypto');
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}
```

- [ ] **Step 2: Add `claimTombstone` + `markTombstoneCompleted`**

Insert after the `isDuplicate` helper (around line 862):

```js
/**
 * Claim a processing lock for this email. Returns { claimed: bool, lockRef }.
 *
 * Fast path: .create() is the Firestore primitive that fails with
 * ALREADY_EXISTS if the doc exists — gives us CAS on first claim.
 *
 * Slow path (lock exists): runTransaction gives CAS on the read-then-
 * conditional-write reclaim of stale locks. Firestore auto-retries the
 * transaction on contention; concurrent reclaimers serialize.
 */
async function claimTombstone(firestore, objectKey, rfcMessageId) {
  const lockId = sha256(objectKey).slice(0, 32);
  const lockRef = firestore.collection('airbnb_processing_locks').doc(lockId);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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

- [ ] **Step 3: Hoist dedupe + claim in the handler**

Find the handler loop body right after `const parsed = await simpleParser(rawBuffer);` and the subsequent `const rfcMessageId = parsed.messageId || null;` block (around line 942). Insert right before the `// Classify message type` comment:

```js
// Dedupe across all three terminal collections before any side effect.
const [msgDup, quarDup] = await Promise.all([
  isDuplicate(firestore, 'airbnb_messages', objectKey, rfcMessageId),
  isDuplicate(firestore, 'airbnb_messages_quarantine', objectKey, rfcMessageId),
]);
if (msgDup || quarDup) {
  console.log('duplicate — terminal record exists, skipping', {
    sesMessageId, objectKey,
  });
  skippedCount++;
  continue;
}

// Authoritative claim — .create() fails if lock doc exists (CAS).
const claim = await claimTombstone(firestore, objectKey, rfcMessageId);
if (!claim.claimed) {
  console.log('duplicate — lock held by another invocation', {
    sesMessageId, objectKey,
  });
  skippedCount++;
  continue;
}
```

Note: you need `const firestore = await getFirestore();` to be called before this block. Today it's called later inside the reservation_confirmation branch — hoist it to just before the dedupe block.

- [ ] **Step 4: Remove per-branch `isDuplicate` calls**

Search for all `isDuplicate(` calls in the handler loop body (lines 1002, 1050, 1086, 1116 approx). Each should be inside a branch that now runs AFTER the hoisted claim. Delete each block (including the `if (alreadyProcessed)` / `if (alreadyQuarantined)` / `if (alreadyWritten)` conditionals + their `continue`). The hoist covers them.

- [ ] **Step 5: Add `markTombstoneCompleted` at every successful end-of-record path**

Find every `continue;` inside the handler loop that follows a successful write (reservation_confirmation matched branch end, reservation_confirmation unmatched quarantine end, non-guest-message quarantine end, guest-message unmatched branch end, guest-message matched write end). Immediately before each successful `continue;`, add:

```js
await markTombstoneCompleted(claim.lockRef);
```

For the error path in the `catch (err)` block at the end of the loop body, **do not** call `markTombstoneCompleted` — leave the lock at `status: 'processing'` so `lockSweeper` reclaims it.

- [ ] **Step 6: Verify module still loads**

Run: `cd infra/lambda/parse-airbnb-email && node -e "require('./index'); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 7: Manual smoke test — concurrent invocation**

Deploy Lambda to dev (`cdk deploy CasaCoquiEmailStack`). Then fire two invocations in parallel on the same S3 object:

```bash
KEY="airbnb/<existing-email-object-key>"
aws lambda invoke --function-name casa-coqui-parse-airbnb-email \
  --invocation-type Event \
  --payload "$(jq -n --arg k "$KEY" '{Records:[{ses:{mail:{messageId:"test"},receipt:{action:{bucketName:"casa-coqui-inbound-email",objectKey:$k}}}}]}')" \
  /dev/null &
aws lambda invoke --function-name casa-coqui-parse-airbnb-email \
  --invocation-type Event \
  --payload "$(jq -n --arg k "$KEY" '{Records:[{ses:{mail:{messageId:"test"},receipt:{action:{bucketName:"casa-coqui-inbound-email",objectKey:$k}}}}]}')" \
  /dev/null &
wait
```

Wait ~30 seconds, then in Firestore console:
- Collection `airbnb_processing_locks` — confirm exactly 1 doc for this object (deterministic lockId).
- CloudWatch logs — confirm one invocation logs `duplicate — lock held` and the other completes the work.

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/parse-airbnb-email/index.js
git commit -m "$(cat <<'EOF'
fix(lambda): hoist dedupe to pre-write, add tombstone claim for crash safety

SES → Lambda is at-least-once. Today duplicate checks run AFTER side effects
in the reservation_confirmation path; SES retry of the same S3 object produces
duplicate Firestore state even if dedupe eventually fires.

Adds claimTombstone with two CAS paths:
  Fast: .create() — fails with ALREADY_EXISTS on first-claim collision.
  Slow: runTransaction — concurrent reclaimers serialize via auto-retry.

Lock doc ID = sha256(rawEmailS3Key).slice(0,32); content-addressable across
SES retries. expiresAt = claimedAt + 7d for Firestore TTL (policy enabled
out-of-band in Commit 4).

Stale threshold 5 min. Crashed invocations leave locks in 'processing';
lockSweeper (Commit 4) flips them to 'reclaimable'.
EOF
)"
```

---

## Task 4: Commit 3 — Welcome ownership locked to ICS

**Files:**
- Create: `functions/lib/__tests__/welcome-ai-guard.test.js`
- Modify: `functions/lib/welcome-ai.js`
- Modify: `infra/lambda/parse-airbnb-email/index.js`
- Modify: `infra/lambda/parse-airbnb-email/package.json`

- [ ] **Step 1: Write failing unit test for the guard**

Create `functions/lib/__tests__/welcome-ai-guard.test.js`:

```js
'use strict';

// The guard is synchronous and short-circuits before any API call.
// Mock firebase-admin + anthropic so the require doesn't fail in test env.
jest.mock('firebase-admin', () => ({}));
jest.mock('@anthropic-ai/sdk', () => ({ default: jest.fn() }));

const { generateWelcomeMessage, TERMINAL_WELCOME_STATES } = require('../welcome-ai');

describe('generateWelcomeMessage terminal-state guard', () => {
  test('TERMINAL_WELCOME_STATES contains the 4 locked states', () => {
    expect(TERMINAL_WELCOME_STATES.has('ready')).toBe(true);
    expect(TERMINAL_WELCOME_STATES.has('sent')).toBe(true);
    expect(TERMINAL_WELCOME_STATES.has('skipped')).toBe(true);
    expect(TERMINAL_WELCOME_STATES.has('snoozed')).toBe(true);
    expect(TERMINAL_WELCOME_STATES.has('pending')).toBe(false);
    expect(TERMINAL_WELCOME_STATES.has('error')).toBe(false);
  });

  test.each(['ready', 'sent', 'skipped', 'snoozed'])(
    'skips generation when welcomeStatus is terminal: %s',
    async (status) => {
      const result = await generateWelcomeMessage({
        booking: { id: 'b1', welcomeStatus: status, welcomeMessage: 'prev' },
        settings: {},
        template: null,
      });
      expect(result.skipped).toBe(true);
      expect(result.message).toBe('prev');
    }
  );

  test('does not skip when welcomeStatus is pending', async () => {
    // Can't easily test the full generation without mocking Anthropic further.
    // We only assert the guard does NOT early-return.
    // Replace generateWelcomeMessage body in implementation to throw a sentinel
    // after the guard; if we hit it, the guard didn't short-circuit.
    // For this test we just assert skipped is not set.
    // (If the function would error later, we tolerate that — the guard passed.)
    try {
      const result = await generateWelcomeMessage({
        booking: { id: 'b1', welcomeStatus: 'pending' },
        settings: {},
        template: null,
      });
      expect(result.skipped).toBeFalsy();
    } catch {
      // Non-guard error — acceptable, guard passed.
    }
  });

  test('does not skip when welcomeStatus is undefined (seed-script bookings)', async () => {
    try {
      const result = await generateWelcomeMessage({
        booking: { id: 'b1' /* no welcomeStatus */ },
        settings: {},
        template: null,
      });
      expect(result.skipped).toBeFalsy();
    } catch {
      // Non-guard error — acceptable, guard passed.
    }
  });

  test('does not skip when welcomeStatus is error (retry path)', async () => {
    try {
      const result = await generateWelcomeMessage({
        booking: { id: 'b1', welcomeStatus: 'error' },
        settings: {},
        template: null,
      });
      expect(result.skipped).toBeFalsy();
    } catch {
      // Non-guard error — acceptable, guard passed.
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm test -- welcome-ai-guard`
Expected: FAIL — `TERMINAL_WELCOME_STATES is undefined` or similar.

- [ ] **Step 3: Add guard to `functions/lib/welcome-ai.js`**

Open the file. Near the top (before `async function generateWelcomeMessage`):

```js
const TERMINAL_WELCOME_STATES = new Set([
  'ready', 'sent', 'skipped', 'snoozed',
]);
```

Prepend to the body of `generateWelcomeMessage`:

```js
async function generateWelcomeMessage({ booking, settings, template }) {
  // 'pending' and 'error' should regenerate — 'error' is welcomeSweeper's
  // retry signal. The `&& booking.welcomeStatus` short-circuit permits
  // seed-script bookings (scripts/seed-data.js, scripts/seed-test-bookings.js)
  // that never initialized the field.
  if (booking.welcomeStatus && TERMINAL_WELCOME_STATES.has(booking.welcomeStatus)) {
    console.log('welcome generation skipped — terminal state', {
      bookingId: booking.id,
      welcomeStatus: booking.welcomeStatus,
    });
    return { message: booking.welcomeMessage || null, language: null, skipped: true };
  }

  // ... existing body unchanged ...
}
```

Update the `module.exports` at bottom:

```js
module.exports = { generateWelcomeMessage, TERMINAL_WELCOME_STATES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npm test -- welcome-ai-guard`
Expected: all tests PASS.

- [ ] **Step 5: Delete Lambda's welcome-draft code**

In `infra/lambda/parse-airbnb-email/index.js`, delete:

| Symbol | Approx lines |
|---|---|
| `const Anthropic = require('@anthropic-ai/sdk').default;` | 24 |
| `cachedAnthropicKey` + `getAnthropicApiKey` | 630-646 |
| `WELCOME_SYSTEM_PROMPT` | 648-667 |
| `WELCOME_TOOL` | 669-680 |
| `generateWelcomeDraft` function | 691-766 |

Also delete the call-site `await generateWelcomeDraft(firestore, result.bookingId, bookingDoc.data(), propertySettings);` — should already be gone from Commit 1's handler rewrite, but verify.

- [ ] **Step 6: Remove Anthropic from Lambda's `package.json`**

Edit `infra/lambda/parse-airbnb-email/package.json`, remove the `@anthropic-ai/sdk` line from `dependencies`. Delete the existing `node_modules/` directory to force clean reinstall:

```bash
rm -rf infra/lambda/parse-airbnb-email/node_modules
rm infra/lambda/parse-airbnb-email/package-lock.json
cd infra/lambda/parse-airbnb-email && npm install
```

- [ ] **Step 7: Verify module still loads**

Run: `cd infra/lambda/parse-airbnb-email && node -e "require('./index'); console.log('OK')"`
Expected: `OK` (no `Cannot find module '@anthropic-ai/sdk'`).

- [ ] **Step 8: Manual smoke test — ICS-only welcome generation**

Deploy the updated Cloud Functions + Lambda:

```bash
firebase deploy --only functions:icsSync
cd infra && cdk deploy CasaCoquiEmailStack
```

Create a test booking via ICS sync (force-run `gcloud scheduler jobs run firebase-schedule-icsSync-us-east1 --location us-east1`). Immediately after, send the matching reservation_confirmation email through SES.

Wait 2 min, then verify:
- Exactly one `agent_runs` doc with `kind: 'welcome'` for this booking.
- `booking.welcomeStatus === 'ready'` and `welcomeMessage` present.
- CloudWatch Lambda logs contain no Anthropic SDK activity (`grep -i anthropic`).

- [ ] **Step 9: Commit**

```bash
git add functions/lib/welcome-ai.js \
        functions/lib/__tests__/welcome-ai-guard.test.js \
        infra/lambda/parse-airbnb-email/index.js \
        infra/lambda/parse-airbnb-email/package.json \
        infra/lambda/parse-airbnb-email/package-lock.json
git commit -m "$(cat <<'EOF'
refactor(lambda): remove welcome-draft generation; ICS owns sole write path

functions/icsSync.js:243 already calls generateWelcomeMessage after booking
creation. Lambda's copy was a second writer racing against ICS on the shared
booking doc; the welcomeStatus !== 'pending' guard had a read-then-write race.

Deletes Lambda's generateWelcomeDraft + WELCOME_SYSTEM_PROMPT + WELCOME_TOOL
+ getAnthropicApiKey + @anthropic-ai/sdk dependency. Adds 6-state
TERMINAL_WELCOME_STATES guard to the canonical generator in
functions/lib/welcome-ai.js, exported for future callers.

ICS becomes the sole welcome writer — no transaction needed. Future
regressions (a fourth generator) become visible as duplicate drafts in
agent_runs, not silent races.
EOF
)"
```

---

## Task 5: Commit 4 — Push-on-enrich, ICS 5-min, lockSweeper, TTL

**Files:**
- Modify: `infra/lambda/parse-airbnb-email/index.js`
- Modify: `functions/icsSync.js` (cron frequency only; reactive drain is Commit 5)
- Modify: `functions/scheduled.js`
- Modify: `lib/notification-strings.js`
- Ops: gcloud TTL command

- [ ] **Step 1: Add locale keys**

Open `lib/notification-strings.js`. Find the EN section, add:

```js
'staff.airbnbEmailEnriched.title': 'Airbnb email received',
'staff.airbnbEmailEnriched.body': 'Booking details enriched from email for {guestName}',
```

Find the ES section, add:

```js
'staff.airbnbEmailEnriched.title': 'Email de Airbnb recibido',
'staff.airbnbEmailEnriched.body': 'Detalles de reserva enriquecidos por email para {guestName}',
```

- [ ] **Step 2: Add push-on-first-enrich to Lambda enrichment block**

In `infra/lambda/parse-airbnb-email/index.js`, find the enrichment block inside the reservation_confirmation branch (from Commit 1). Modify:

```js
// BEFORE (from Commit 1):
if (Object.keys(updates).length > 0) {
  updates.lastEnrichedFromEmailAt = new Date().toISOString();
  await firestore.collection('bookings').doc(matched.id).update(updates);
  console.log('booking enriched from email', { ... });
}

// AFTER:
const firstEnrichment = !existing.lastEnrichedFromEmailAt;
if (Object.keys(updates).length > 0) {
  updates.lastEnrichedFromEmailAt = new Date().toISOString();
  await firestore.collection('bookings').doc(matched.id).update(updates);
  console.log('booking enriched from email', {
    bookingId: matched.id,
    fieldsUpdated: Object.keys(updates),
  });

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

Ensure `notifyAdminAndCohost` is imported at the top of `index.js`. It may need to be added — check if the Lambda already imports it (Cloud Functions code vs Lambda code). If the Lambda doesn't have access to `lib/staff-notifications.js`, use the inline FCM-send pattern that was in the deleted `createBookingFromConfirmation` (lines 560-621 of the original), but updated to:
- Query staff by `role in ['admin', 'cohost']` + `status === 'active'`
- For each staff: write `staff_notifications` doc + send FCM to each token
- Use the new `staff.airbnbEmailEnriched` locale keys via a small inline localizer

If the Lambda cannot reuse `notifyAdminAndCohost` (different deploy bundle), copy the minimal inline version — ~30 LOC. Add a code comment: "DUPLICATED from lib/staff-notifications.js — kept in sync manually for Lambda bundle separation."

- [ ] **Step 3: Update ICS cron**

If `functions/icsSync.js` (or `functions/index.js`) declares the schedule in code:

```js
// BEFORE
exports.icsSync = onSchedule('every 30 minutes', async (event) => { /* ... */ });

// AFTER
exports.icsSync = onSchedule('every 5 minutes', async (event) => { /* ... */ });
```

If the schedule is out-of-band, skip this step and handle via gcloud in the pre-merge checklist.

- [ ] **Step 4: Add `lockSweeper` to `functions/scheduled.js`**

Append:

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

If `db` and `onSchedule` aren't already imported at the top of `functions/scheduled.js`, add:

```js
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { db } = require('./firebaseInit');
```

- [ ] **Step 5: Deploy changes to dev**

```bash
firebase deploy --only functions:icsSync,functions:lockSweeper,functions:welcomeSweeper
cd infra && cdk deploy CasaCoquiEmailStack
```

- [ ] **Step 6: Enable Firestore TTL on `airbnb_processing_locks.expiresAt`**

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=airbnb_processing_locks \
  --enable-ttl \
  --project=casa-coqui
```

Verify:
```bash
gcloud firestore fields ttls list \
  --collection-group=airbnb_processing_locks \
  --project=casa-coqui
```

Expected: `expiresAt` with state `ACTIVE`.

- [ ] **Step 7: Manual smoke test — push-on-first-enrich, REAL DEVICE**

Requires a physical iOS or Android device logged in as admin/cohost with push enabled.

Seed a booking via ICS with `guestName: 'Airbnb Guest'` and `lastEnrichedFromEmailAt: unset`:

```bash
# Create via admin UI or directly in Firestore console with:
# airbnbConfirmationCode: 'HMTEST12345', guestName: 'Airbnb Guest'
```

Send a test reservation_confirmation email with confirmationCode `HMTEST12345` through SES:

```bash
aws ses send-raw-email --raw-message "Data=$(base64 -i test-reservation.eml)"
```

Within ~30 seconds:
- Staff device receives push: title *"Airbnb email received"*, body *"Booking details enriched from email for {real-guest-name}"*.
- Verify on both iOS and Android if possible.

Resend the same email:
- No second push should fire (gated on `lastEnrichedFromEmailAt`).

- [ ] **Step 8: Verify ICS cron frequency**

```bash
gcloud scheduler jobs describe firebase-schedule-icsSync-us-east1 \
  --location us-east1 \
  --project=casa-coqui | grep schedule
```

Expected: `schedule: every 5 minutes`.

- [ ] **Step 9: Commit**

```bash
git add infra/lambda/parse-airbnb-email/index.js \
        functions/icsSync.js \
        functions/scheduled.js \
        lib/notification-strings.js
git commit -m "$(cat <<'EOF'
feat(lambda,functions): preserve near-real-time push + add lock hygiene

After Commit 1 removed Lambda booking creation, the staff FCM push that fired
on "new booking auto-created" is lost when email arrives before ICS polls.
This commit restores near-real-time push via two mechanisms shipping together:

1. Enrichment path emits staff FCM push on first enrichment only, gated on
   lastEnrichedFromEmailAt. Idempotent.
2. functions/icsSync.js cron frequency 30-min → 5-min. Julio confirmed no
   Airbnb iCal rate-limit concerns.

Adds lockSweeper to functions/scheduled.js — sibling of welcomeSweeper, runs
every 15 min, flips airbnb_processing_locks status 'processing' → 'reclaimable'
when claimedAt < now - 5min. Kept separate from welcomeSweeper so lifecycles
are independently controllable.

Firestore TTL policy on airbnb_processing_locks.expiresAt enabled out-of-band
for automatic cleanup of completed + stuck locks after 7 days.
EOF
)"
```

---

## Task 6: Commit 5 — Reactive quarantine drain

**Files:**
- Modify: `functions/icsSync.js`
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Add composite index**

Open `firestore.indexes.json`. Inside the `indexes` array, add:

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

- [ ] **Step 2: Deploy index**

```bash
firebase deploy --only firestore:indexes
```

Verify in Firebase console → Firestore → Indexes that the new index reaches `ENABLED` state. This can take 5-15 min for a small collection.

- [ ] **Step 3: Add reactive drain to `functions/icsSync.js`**

Find the line `const bookingRef = await db.collection('bookings').add(bookingData);` (around line 550). Immediately after that line, insert:

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

- [ ] **Step 4: Deploy**

```bash
firebase deploy --only functions:icsSync
```

- [ ] **Step 5: Manual smoke test — email-then-ICS sequence**

1. Delete an existing ICS-synced booking for a recent Airbnb confirmation (via admin UI or Firestore console).
2. Resend the matching Airbnb confirmation email through SES. Within ~30 s, confirm:
   - New quarantine doc in `airbnb_messages_quarantine` with `reason: 'unmatched_awaiting_ics'`, `status: 'pending'`, and non-empty `enrichmentFields`.
3. Trigger ICS manually:
   ```bash
   gcloud scheduler jobs run firebase-schedule-icsSync-us-east1 --location us-east1
   ```
4. Within ~1 min, confirm in Firestore console:
   - New `bookings` doc created by ICS, has `lastEnrichedFromEmailAt` set.
   - Booking's `guestName`/`guestCount`/`payoutAmount`/`guestMessage` populated from the quarantine `enrichmentFields`.
   - Quarantine doc now has `status: 'resolved'` + `resolvedBookingId` + `resolvedBy: 'icsSync:drain'`.
5. Verify in logs:
   - Cloud Functions log for `icsSync` contains `reactive drain applied email enrichment`.
   - Exactly one staff push fired (ICS-create push). No `booking_enriched` push (drain is silent).

- [ ] **Step 6: Drain failure non-fatal smoke test**

Temporarily insert `throw new Error('drain test');` at the top of the drain `try` block. Deploy. Trigger a new ICS sync. Verify:
- Booking still created (drain failure non-fatal).
- Cloud Functions log shows `Reactive drain failed (non-fatal)`.

Revert the injected throw, redeploy.

- [ ] **Step 7: Commit**

```bash
git add functions/icsSync.js firestore.indexes.json
git commit -m "$(cat <<'EOF'
feat(icsSync): drain unmatched-awaiting-ics quarantine on new booking create

Closes the Path A loop. When email arrives before ICS polls, Lambda quarantines
with reason 'unmatched_awaiting_ics' and stashes extracted enrichment fields.
ICS then creates the canonical booking 0-5 min later.

Without this drain the quarantine doc would sit unread forever; the booking
would keep its ICS-provided placeholder guestName + null guestCount /
payoutAmount.

Post-create hook queries airbnb_messages_quarantine by airbnbConfirmationCode,
applies enrichment to the new booking, and marks quarantine docs resolved.
Silent (no push) — the ICS-create push already fired.

New composite index: airbnb_messages_quarantine(airbnbConfirmationCode, reason,
status).
EOF
)"
```

---

## Task 7: Plan-doc amendment (v3.3)

**Files:**
- Modify: `AGENT-RESERVATION-FLOW-PLAN.md`

- [ ] **Step 1: Bump to v3.3**

Open `AGENT-RESERVATION-FLOW-PLAN.md`. Change the header:

```diff
-**Status:** Ready to execute
-**Date:** 2026-04-14
+**Status:** v3.2 deployed; v3.3 captures Path A correctness amendments (2026-04-18 review)
+**Date:** 2026-04-18 (v3.3)
```

- [ ] **Step 2: Add §0.5 pointing at shipped welcome-drafts spec**

After §0 Goal, insert:

```markdown
## 0.5 Current state (shipped 2026-04-15)

Welcome queue UX, `welcomeStatus` 6-state machine, `threadKey` unmatched-sender
threading, `welcomeSweeper`, and the reply agent's RAG pipeline are canonical
per `docs/superpowers/specs/2026-04-15-welcome-drafts-and-messaging-unification-design.md`
and `docs/superpowers/specs/2026-04-15-rag-pipeline-design.md`. This plan does
not re-litigate those decisions.
```

- [ ] **Step 3: Amend §5 (Lambda scope)**

Replace the §5 description of the Lambda with a summary pointing at the correctness spec:

```markdown
## 5. Lambda correctness gaps (P0)

Lambda is an enrich-or-quarantine surface. It does not create bookings.
See `docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md`
for the 5-commit remediation: delete booking creation, tombstone claim for
SES-redelivery safety, welcome-draft ownership lock to ICS, push-on-first-enrich,
reactive drain of quarantine on ICS booking create.
```

- [ ] **Step 4: Commit**

```bash
git add AGENT-RESERVATION-FLOW-PLAN.md
git commit -m "docs: bump reservation flow plan to v3.3 (Path A correctness)"
```

---

## Task 8: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin ec2-deploy
```

- [ ] **Step 2: Create PR with pre-merge checklist**

```bash
gh pr create --title "fix(lambda): parse-airbnb-email correctness — Path A (5 commits)" --body "$(cat <<'EOF'
## Summary

- Delete Lambda booking creation → enrich-or-quarantine only
- Tombstone-claim pattern for SES-redelivery + crash safety
- Welcome-draft ownership locked to ICS (ends two-writer race)
- Push-on-first-enrich + ICS 5-min cron + lockSweeper + TTL
- Reactive quarantine drain in icsSync.js

Spec: [docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md](docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md)

## Pre-merge operational checklist

- [ ] Confirm Anthropic API key in Secrets Manager is not mid-rotation
- [ ] Audit query: `bookings.where('source', '==', 'airbnb_email').count()` — decision per-booking if non-zero
- [ ] `gcloud firestore fields ttls update expiresAt --collection-group=airbnb_processing_locks --enable-ttl`
- [ ] ICS cron to 5-min (inline if code-scheduled, gcloud if out-of-band)
- [ ] `firebase deploy --only firestore:indexes` — confirm composite reaches READY

## Test plan

All 19 manual smoke tests from the spec §10. Key checks:
- [ ] Email corpus replay — zero `bookings.add()` calls
- [ ] Concurrent invocation — exactly 1 lock doc
- [ ] Concurrent reclaim race — transaction serializes
- [ ] ICS-only welcome gen — exactly 1 agent_runs doc per booking
- [ ] Push-on-first-enrich — **real device verification on iOS + Android**
- [ ] Email-then-ICS sequence — drain resolves quarantine + enriches booking

## Rollback

Per-commit plan in spec §8. Commits 1, 3, 5 revert cleanly. Commits 2 and 4
need explicit attention (see spec).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-Review

**Spec coverage check:**
- ✅ Commit 1 in Task 2 → spec §7 Commit 1
- ✅ Commit 2 in Task 3 → spec §7 Commit 2
- ✅ Commit 3 in Task 4 → spec §7 Commit 3
- ✅ Commit 4 in Task 5 → spec §7 Commit 4
- ✅ Commit 5 in Task 6 → spec §7 Commit 5
- ✅ Pre-merge checklist in Task 8 PR body → spec §9
- ✅ Rollback in PR body → spec §8
- ✅ Plan doc bump in Task 7 → v3.3 amendment

**Placeholder scan:** no TBDs or vague "handle edge cases". Step 2 of Task 5 references an inline-FCM fallback; if `notifyAdminAndCohost` isn't available in Lambda's bundle, the alternative is specified with line count and comment.

**Type consistency:** `lockRef` / `claim.lockRef` consistent across Task 3. `airbnbConfirmationCode` consistent across Tasks 2, 5, 6. `lastEnrichedFromEmailAt` consistent across Tasks 2, 5, 6. Locale key `staff.airbnbEmailEnriched.{title,body}` consistent in Task 5.

---

## Execution options

After each task completes, verify against the spec's test matrix (§10) before moving to the next. Commits 1-3 are reviewable independently; commit 4 depends on Commit 1's enrichment block; Commit 5 depends on the `enrichmentFields` write from Commit 1.
