# Option A — Item 4: Persist `inReplyTo` / `references` Headers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the RFC 5322 `In-Reply-To` and `References` headers from inbound Airbnb emails as fields on `airbnb_messages` docs, plus a resolved `replyToId` (the Firestore doc id of the parent message). Unlocks accurate parent-child message ordering for future AI context-graph improvements.

**Architecture:** mailparser ALREADY extracts these headers into `parsed.inReplyTo` (string) and `parsed.references` (string or string[]) — they're sitting unused on the parsed object today. Add three fields to the Lambda's inbound write path: `inReplyTo`, `references` (always normalized to an array), and `replyToId` (Firestore doc id resolved via reverse lookup against the existing `messageId` field). Both inbound write sites (matched + unmatched) plus the quarantine archive get the same fields.

**Tech Stack:** Node 20, Jest (Lambda tests), Firestore admin SDK, mailparser (already a dep).

**Source priority list:** [explantion/2026-05-07-threading-handoff.md](../../../explantion/2026-05-07-threading-handoff.md) §2 priority item 4.

**Verification doc** (background): [tasks/2026-05-07-threading-verification-findings.md](../../../tasks/2026-05-07-threading-verification-findings.md) §3 Claim 2 — confirmed mailparser extracts these but Lambda never reads them.

---

## Background

### Today

[`infra/lambda/parse-airbnb-email/index.js:628-636`](../../../infra/lambda/parse-airbnb-email/index.js#L628-L636) extracts only:

```js
const subject = parsed.subject || '';
const fromName = parsed.from?.value?.[0]?.name || null;
const fromAddress = parsed.from?.value?.[0]?.address || null;
const bodyText = parsed.text || parsed.html || '';
const receivedAt = parsed.date ? new Date(parsed.date) : new Date();
const rfcMessageId = parsed.messageId || null;
```

`parsed.inReplyTo` and `parsed.references` are sitting on the object — never read.

Existing inbound docs already have a `messageId` field (the doc's own RFC Message-ID, used for dedup). With `inReplyTo` and `references` persisted on each doc, plus `replyToId` resolved via lookup, the reply-agent can later traverse parent-child chains for tighter context.

### Fix (data-only persistence, NO AI changes)

When writing each inbound doc:
1. Extract `parsed.inReplyTo` (single Message-ID string or undefined).
2. Extract `parsed.references` (string OR string[] depending on header — normalize to array).
3. Look up Firestore for `airbnb_messages` where `messageId === parsed.inReplyTo`. If found, set `replyToId = parentDoc.id`. If not found (out-of-order arrival or external thread), `replyToId = null`.
4. Persist `{ inReplyTo, references, replyToId }` onto the doc.

Same fields go on the quarantine archive doc (the unmatched dual-write path) for completeness.

### Why no AI changes in this item

The reply-agent's current thread query orders by `receivedAt` and feeds the last 5 messages to `buildReplyInput`. Adding parent-child traversal is a follow-up (Item 5 expands the window first, traversal becomes interesting when there's more context to walk). Item 4 just persists the data — the surface area is small and the change is purely additive. No deployment risk to existing AI behavior.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `infra/lambda/parse-airbnb-email/index.js` | Modify | Add `extractHeaderRefs` helper + `findParentMessageDocId` Firestore lookup + thread fields onto 3 doc writes (matched, unmatched-airbnb_messages, unmatched-quarantine archive) |
| `infra/lambda/parse-airbnb-email/__tests__/header-refs.test.js` | **Create** | Unit tests for the new helper + lookup mock |
| `tasks/changes/option-a/2026-05-08-item-4-persist-headers-changes.md` | **Create** | Change log; doc agent updates per task |

**No changes to:** Firestore rules, indexes (the new query `where messageId == inReplyTo` runs against the existing single-field auto-index), `firestore.indexes.json`, `functions/`, `lib/`, UI.

---

## Workflow per task

1. **Implementer subagent** drives end-to-end: read current state, apply diffs, run tests, commit.
2. **Doc agent** appends to change log.
3. Move to next task.

**Branch decision:** stay on `main` (consistent with prior work).

---

## Task 1: Add header-extraction helpers + tests

**Files:**
- Modify: `infra/lambda/parse-airbnb-email/index.js` (add `extractHeaderRefs` + `findParentMessageDocId` helpers; export both for tests)
- Create: `infra/lambda/parse-airbnb-email/__tests__/header-refs.test.js`

**Goal:** Pure-function helpers + Firestore-mocked lookup test, no call-site changes yet.

- [ ] **Step 1.1: Pre-flight**

```bash
cd /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email && npm test 2>&1 | tail -10
```

Expected baseline: 74/74 tests passing across 3 suites (classify-email, extract-enrichment-fields, booking-match).

- [ ] **Step 1.2: Write failing tests**

Create `infra/lambda/parse-airbnb-email/__tests__/header-refs.test.js`:

```js
'use strict';

const {
  extractHeaderRefs,
  findParentMessageDocId,
} = require('../index');

describe('extractHeaderRefs', () => {
  test('returns null inReplyTo and empty references when neither present', () => {
    expect(extractHeaderRefs({})).toEqual({
      inReplyTo: null,
      references: [],
    });
  });

  test('reads single inReplyTo string', () => {
    expect(extractHeaderRefs({
      inReplyTo: '<abc@example.com>',
    })).toEqual({
      inReplyTo: '<abc@example.com>',
      references: [],
    });
  });

  test('normalizes references string to array', () => {
    expect(extractHeaderRefs({
      references: '<a@x.com>',
    })).toEqual({
      inReplyTo: null,
      references: ['<a@x.com>'],
    });
  });

  test('preserves references array as-is', () => {
    expect(extractHeaderRefs({
      references: ['<a@x.com>', '<b@x.com>', '<c@x.com>'],
    })).toEqual({
      inReplyTo: null,
      references: ['<a@x.com>', '<b@x.com>', '<c@x.com>'],
    });
  });

  test('handles whitespace-separated references string (RFC 5322 style)', () => {
    // mailparser sometimes returns a single string with multiple ids separated by whitespace
    expect(extractHeaderRefs({
      references: '<a@x.com> <b@x.com>',
    })).toEqual({
      inReplyTo: null,
      references: ['<a@x.com>', '<b@x.com>'],
    });
  });

  test('reads both inReplyTo and references', () => {
    expect(extractHeaderRefs({
      inReplyTo: '<parent@x.com>',
      references: ['<grandparent@x.com>', '<parent@x.com>'],
    })).toEqual({
      inReplyTo: '<parent@x.com>',
      references: ['<grandparent@x.com>', '<parent@x.com>'],
    });
  });

  test('ignores empty/falsy values', () => {
    expect(extractHeaderRefs({
      inReplyTo: '',
      references: null,
    })).toEqual({
      inReplyTo: null,
      references: [],
    });
  });
});

// Minimal Firestore mock for lookup tests.
function mockFirestore({ messageIdLookup = {} } = {}) {
  return {
    collection(name) {
      if (name !== 'airbnb_messages') throw new Error(`unexpected collection: ${name}`);
      return {
        _filters: [],
        where(field, op, value) {
          if (op !== '==') throw new Error(`unsupported op: ${op}`);
          this._filters.push({ field, value });
          return this;
        },
        limit() { return this; },
        async get() {
          const filter = this._filters[0];
          if (!filter || filter.field !== 'messageId') return { empty: true, docs: [] };
          const docId = messageIdLookup[filter.value];
          if (!docId) return { empty: true, docs: [] };
          return {
            empty: false,
            docs: [{ id: docId, data: () => ({ messageId: filter.value }) }],
          };
        },
      };
    },
  };
}

describe('findParentMessageDocId', () => {
  test('returns null when inReplyTo is null', async () => {
    const fs = mockFirestore({});
    expect(await findParentMessageDocId(fs, null)).toBeNull();
  });

  test('returns null when no parent exists in DB', async () => {
    const fs = mockFirestore({ messageIdLookup: {} });
    expect(await findParentMessageDocId(fs, '<missing@x.com>')).toBeNull();
  });

  test('returns parent doc id when found', async () => {
    const fs = mockFirestore({
      messageIdLookup: { '<parent@x.com>': 'firestore-doc-abc123' },
    });
    expect(await findParentMessageDocId(fs, '<parent@x.com>')).toBe('firestore-doc-abc123');
  });
});
```

- [ ] **Step 1.3: Run tests, expect failure**

```bash
cd /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email && npm test 2>&1 | tail -20
```

Expected: helper tests fail (`extractHeaderRefs is not a function`, `findParentMessageDocId is not a function`).

- [ ] **Step 1.4: Add the helpers to `infra/lambda/parse-airbnb-email/index.js`**

Find a sensible insertion point — somewhere among the other extraction helpers (above `findMatchingBooking`, around the existing booking-match helpers). Insert this block:

```js
// ---------------------------------------------------------------------------
// RFC 5322 thread-header helpers (Option A Item 4)
// ---------------------------------------------------------------------------

/**
 * Pull In-Reply-To and References from a mailparser parsed object.
 * Normalizes references to always be an array (mailparser may return
 * a single string OR an array depending on header format).
 *
 * @param {object} parsed - mailparser output (or a subset for tests)
 * @returns {{ inReplyTo: string|null, references: string[] }}
 */
function extractHeaderRefs(parsed) {
  const inReplyTo = (parsed.inReplyTo && String(parsed.inReplyTo).trim()) || null;

  let references = [];
  if (Array.isArray(parsed.references)) {
    references = parsed.references.filter((r) => r && String(r).trim()).map((r) => String(r).trim());
  } else if (parsed.references && String(parsed.references).trim()) {
    // Single string — may contain whitespace-separated message-ids per RFC 5322.
    references = String(parsed.references)
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return { inReplyTo, references };
}

/**
 * Reverse lookup: given an RFC Message-ID, find the Firestore doc id of an
 * airbnb_messages doc whose messageId field matches. Used to resolve
 * inReplyTo into a direct doc reference.
 *
 * Returns null if inReplyTo is null/empty or no matching doc exists.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string|null} inReplyTo
 * @returns {Promise<string|null>}
 */
async function findParentMessageDocId(firestore, inReplyTo) {
  if (!inReplyTo) return null;
  const snap = await firestore
    .collection('airbnb_messages')
    .where('messageId', '==', inReplyTo)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}
```

Append to the bottom-of-file `module.exports` (the existing `Exports for unit tests` section):

```js
module.exports.extractHeaderRefs = extractHeaderRefs;
module.exports.findParentMessageDocId = findParentMessageDocId;
```

- [ ] **Step 1.5: Run tests, expect pass**

```bash
cd /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email && npm test 2>&1 | tail -10
```

Expected: 74 prior + 10 new = ~84 total, all green. (Exact count may differ by 1-2.)

- [ ] **Step 1.6: Commit**

```bash
cd /Users/jperez/dev/casa-coqui && git add 'infra/lambda/parse-airbnb-email/index.js' 'infra/lambda/parse-airbnb-email/__tests__/header-refs.test.js' && git commit -m "$(cat <<'EOF'
feat(parse-airbnb-email): add header-extraction helpers (Item 4 scaffolding)

Adds two pure-function helpers for the upcoming inbound-write fields:
- extractHeaderRefs: pulls inReplyTo + references from mailparser output,
  normalizes references to always be an array (mailparser may return a
  string or array depending on the header format)
- findParentMessageDocId: reverse-lookup against airbnb_messages.messageId

10 unit tests cover edge cases: missing headers, single-string vs array
references, whitespace-separated RFC 5322 refs, missing parent in DB.

No call-site changes yet — inbound writes still don't use these.
Wired up in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.7: Capture commit SHA via `git rev-parse HEAD`**

- [ ] **Step 1.8: Doc agent records Task 1**

---

## Task 2: Persist headers on all 3 inbound write sites

**Files:**
- Modify: `infra/lambda/parse-airbnb-email/index.js`

**Goal:** Each inbound write (matched airbnb_messages, unmatched airbnb_messages, unmatched quarantine archive) now includes `inReplyTo`, `references`, `replyToId`.

- [ ] **Step 2.1: Find all 3 write sites and the parsed-extraction block**

```bash
grep -n 'rfcMessageId = parsed.messageId' /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email/index.js
```

Expected: 1 match (around line 636). This is where mailparser output is destructured.

```bash
grep -n "collection('airbnb_messages')" /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email/index.js
```

Expected: at least 2 matches — the unmatched-write (`add({ ... bookingId: null ... })`) and the matched-write (`add(docData)`).

```bash
grep -n "collection('airbnb_messages_quarantine')" /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email/index.js
```

Expected: 4-5 matches (multiple quarantine paths). For Item 4 we ONLY touch the `reason: 'no_matching_booking'` path (the dual-write companion to the unmatched airbnb_messages write).

- [ ] **Step 2.2: Extract headers near the parsed-fields block**

Find the existing block:

```js
const subject = parsed.subject || '';
const fromName = parsed.from?.value?.[0]?.name || null;
const fromAddress = parsed.from?.value?.[0]?.address || null;
const bodyText = parsed.text || parsed.html || '';
const receivedAt = parsed.date ? new Date(parsed.date) : new Date();
// The RFC-2822 Message-ID header (different from SES messageId)
const rfcMessageId = parsed.messageId || null;
```

Append immediately after:

```js
const { inReplyTo, references } = extractHeaderRefs(parsed);
```

(The Lambda has access to `extractHeaderRefs` from Task 1's exports — it's a same-file function so no require change needed.)

- [ ] **Step 2.3: Resolve parent doc id**

After the existing `firestore` lookup at step 3 (around line 650, `const firestore = await getFirestore();`), add the resolution. Find a place to add it — ideally near the dedupe check so it runs for every inbound. Around the post-isAirbnbSender, post-classify section, just before the message-type routing branches. Add:

```js
// Resolve inReplyTo to a parent Firestore doc id (best-effort; null if not found).
const replyToId = await findParentMessageDocId(firestore, inReplyTo);
```

This single line runs once per inbound, uses ~1 read against the auto-indexed `messageId` field. Cost is negligible at Casa Coqui's volume.

- [ ] **Step 2.4: Add fields to the matched airbnb_messages write**

Find `const docData = {` (around line 984) and the closing `});` of `await firestore.collection('airbnb_messages').add(docData);`. The `docData` object already has many fields. Add three new properties (anywhere in the object literal — group them with related fields like `messageId`):

```js
inReplyTo,
references,
replyToId,
```

- [ ] **Step 2.5: Add fields to the unmatched airbnb_messages write**

Find the unmatched branch (around line 929) — `await firestore.collection('airbnb_messages').add({ bookingId: null, ... })`. Add the same 3 fields to that object literal.

- [ ] **Step 2.6: Add fields to the no_matching_booking quarantine archive**

Find the quarantine archive companion (around line 960) — `await firestore.collection('airbnb_messages_quarantine').add({ messageType: 'guest_message', ... reason: 'no_matching_booking' })`. Add the same 3 fields.

(The other quarantine writes — non_airbnb_sender, unmatched reservation_confirmation, unknown messageType — DON'T need these fields. They're either non-conversational or pre-conversation. Keep scope tight.)

- [ ] **Step 2.7: Run tests + module-load smoke**

```bash
cd /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email && npm test 2>&1 | tail -10
```

Expected: all ~84 tests still pass. (No new tests in Task 2 — pure wiring.)

```bash
cd /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email && npm run test:load
```

Expected: prints `module loads OK`.

- [ ] **Step 2.8: Verify all 3 sites updated via grep**

```bash
grep -B 1 -A 5 'inReplyTo' /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email/index.js | head -50
```

Expected: 3 sites where `inReplyTo` appears as a field (matched, unmatched, quarantine), plus the extraction line and the helper function.

- [ ] **Step 2.9: Commit**

```bash
cd /Users/jperez/dev/casa-coqui && git add infra/lambda/parse-airbnb-email/index.js && git commit -m "$(cat <<'EOF'
feat(parse-airbnb-email): persist inReplyTo/references/replyToId on inbound docs

Wires the Item 4 helpers into all three inbound write sites:
- matched airbnb_messages (bookingId set)
- unmatched airbnb_messages (bookingId: null)
- quarantine archive (reason: 'no_matching_booking')

Each doc now carries:
- inReplyTo: RFC Message-ID of the parent (or null)
- references: array of ancestor message-ids (RFC 5322 chain)
- replyToId: Firestore doc id of the parent airbnb_messages doc, resolved
  via auto-indexed messageId equality query (or null if parent not found)

Lookup cost: 1 Firestore read per inbound. Negligible at Casa Coqui volume.

No AI behavior change in this commit — data persistence only. Future
items can traverse parent-child chains for tighter context graphs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2.10: Capture commit SHA**

- [ ] **Step 2.11: Doc agent records Task 2**

---

## Acceptance criteria

| Criterion | Covered by |
|---|---|
| `extractHeaderRefs` correctly normalizes string + array references | Task 1 unit tests |
| `findParentMessageDocId` returns null on miss, doc id on hit | Task 1 unit tests |
| All 3 inbound write paths persist the 3 new fields | Task 2 grep verification + Task 3 smoke (combined deploy) |
| Out-of-order messages: `replyToId` is null but `inReplyTo` preserved | Task 1 unit test (mock with empty messageIdLookup) |
| No regressions in existing classify/extract/booking-match flows | Task 1 + Task 2 full test suite (~84/84) |

---

## Smoke test (deferred — combined with Item 5 deploy session)

After Item 5 commits, push main → CodePipeline build → manual approval → Vercel + CDK deploy. Then:

1. Forward an Airbnb threaded reply (or wait for organic). Inbound message arrives.
2. Query Firestore: `node tasks/changes/option-a/item-4-logs/verify-headers.js` (script written separately, similar pattern to Item 3's verify-mark-sent.js).
3. Confirm: most recent inbound has `inReplyTo` and `references` populated. If parent exists, `replyToId` resolves; otherwise null.

---

## Self-review

1. ✅ Spec coverage — all 5 acceptance criteria mapped.
2. ✅ No placeholders — every code block is concrete.
3. ✅ Type/name consistency — `extractHeaderRefs` and `findParentMessageDocId` named identically across plan + code.
4. ✅ Each task self-contained.

**End of plan.**
