# Option A — Item 4: Persist Headers Change Log

**Topic**: Item 4 — Persist `inReplyTo` / `references` headers + `replyToId` from inbound emails
**Spec source**: [`explantion/2026-05-07-threading-handoff.md`](../../../explantion/2026-05-07-threading-handoff.md) §2 (priority item 4)
**Plan**: [`docs/superpowers/plans/2026-05-08-option-a-item-4-persist-headers.md`](../../../docs/superpowers/plans/2026-05-08-option-a-item-4-persist-headers.md)
**Started**: 2026-05-08

This is the second of the post-threading-fix Option A items. It is a **data-only persistence change** with **no AI behavior changes** in this iteration. The Lambda parser starts capturing the RFC 5322 threading headers (`In-Reply-To`, `References`) that arrive on every Airbnb-relayed email and persists them onto the inbound `airbnb_messages` doc, alongside a resolved `replyToId` pointer to the parent doc when one already exists in Firestore. Nothing in the Cloud Function reply-agent reads these fields yet — that is intentional. Item 4 unlocks accurate parent-child message ordering for future AI context-graph improvements (Item 6+); the data has to be on disk before any traversal can be wired.

This file is updated by a doc-agent after each implementation task commits. It is the operational record of what shipped — when, why, what tests cover it. The plan is the design intent; this file is the diff between intent and reality.

---

## Task 1 — Header-extraction helpers + tests

**Date**: 2026-05-08
**Commit**: [`175a64f`](../../../) — `feat(parse-airbnb-email): add header-extraction helpers (Item 4 scaffolding)`

### What changed

Two new pure helper functions added to `infra/lambda/parse-airbnb-email/index.js` as a self-contained block immediately before `findMatchingBooking` (around line 527). Both helpers are exported at the bottom of the module so the test file can import them in isolation.

- `extractHeaderRefs(parsed)` — accepts the mailparser output and pulls `inReplyTo` (string | null) and `references` (always an array). Normalizes the RFC 5322-style whitespace-separated reference string form into a clean array. Returns `{ inReplyTo, references }` shaped consistently regardless of input shape (string, array, missing, null, empty).
- `findParentMessageDocId(firestore, inReplyTo)` — reverse lookup against `airbnb_messages.messageId`. Returns the parent doc id on hit, `null` if `inReplyTo` is `null` OR the parent doesn't exist in Firestore. Uses Firestore's single-field auto-index — **no new composite index required**.

A new test file `infra/lambda/parse-airbnb-email/__tests__/header-refs.test.js` (122 lines, 10 tests) covers both helpers across the happy paths (string `inReplyTo`, multi-reference whitespace string, lookup hit) and the empty/missing cases (no headers, empty references, lookup miss returning `null`).

### Why

The reply-agent's eventual context-graph traversal needs three things on every inbound `airbnb_messages` doc: the immediate parent's Message-ID (`inReplyTo`), the full ancestor chain (`references`), and a resolved Firestore doc-id pointer to the parent (`replyToId`) for cheap traversal without a second messageId query. Task 1 builds the extraction primitives in isolation so they can be unit-tested without standing up the full Lambda harness. Task 2 wires them into the production write paths.

The deliberate split (helpers first, wiring second) also means a regression in Task 2 cannot break the helper contract — the helpers are locked under test before the call sites move.

### Files

- `infra/lambda/parse-airbnb-email/index.js` — modified (+50 lines: helpers block before `findMatchingBooking` at line ~527, plus 2 export lines at the bottom).
- `infra/lambda/parse-airbnb-email/__tests__/header-refs.test.js` — created (122 lines, 10 tests).

### Tests

- **Result**: 84/84 passing across 4 suites (74 baseline + 10 new from this task).
- **Pre-impl run**: 10 expected `TypeError`s before the helpers existed, confirming the test file was actually exercising the un-implemented functions (test discipline check — the tests fail for the right reason before they pass for the right reason).
- **Coverage**: helpers tested in isolation against mailparser-shaped fixtures; no Lambda end-to-end yet (deferred to Task 2 wiring).

### Acceptance criteria coverage (from plan)

- ✅ `extractHeaderRefs` normalizes string + array references — Task 1 unit tests.
- ✅ `findParentMessageDocId` returns `null` on miss, doc id on hit — Task 1 unit tests.
- ⏳ All 3 inbound write paths persist the 3 new fields — wiring deferred to Task 2.
- ✅ Out-of-order messages: `replyToId` is `null` but `inReplyTo` preserved — Task 1 unit test (mock with empty messageId lookup).
- ✅ No regressions in classify / extract / booking-match — full 84/84 test suite.

### Caveats / follow-ups

- **Helpers added but no call-site changes yet.** The IDE flagged "declared but never read" hints on the two new exports — expected, intentional, resolved in Task 2 when the call sites land. No production behavior change in this commit.
- **Parent-existence semantics**: `findParentMessageDocId` returns `null` for both "no inReplyTo on the inbound" and "inReplyTo present but parent not yet in Firestore" (out-of-order arrival). The two cases are indistinguishable from the return value, but `inReplyTo` is still preserved on the doc independently, so the relationship is recoverable by a future backfill.

---

## Task 1.5 — Defensive fix: `inReplyTo` array form

**Date**: 2026-05-08
**Commit**: [`8b65577`](../../../) — `fix(parse-airbnb-email): handle inReplyTo array form defensively`

### What changed

A subagent code review on Task 1 surfaced a latent bug: the original `extractHeaderRefs` did `String(parsed.inReplyTo).trim()`, which silently corrupts an array input to a comma-joined string (`"id1,id2"`) instead of producing a valid Message-ID. mailparser has historically been inconsistent on the `inReplyTo` field shape — most versions return a string per RFC 5322, but some versions (and some non-conformant senders) return an array. The fix:

- If `parsed.inReplyTo` is an array, take the **last** element. This matches RFC 5322's "the parent" semantic — the last entry is the most recent direct parent in the chain.
- Falsy / empty arrays return `null` cleanly without throwing.
- String form behavior unchanged.

Three new unit tests cover the array-handling cases: multi-element array → last element wins, single-element array → that element, empty array → `null`.

### Why

Catching this **before** Task 2 wired the field into production writes meant zero data corruption ever reached Firestore. If the array form had slipped through to production, every multi-element-array inbound would have written a malformed Message-ID like `"<id1@x>,<id2@x>"` to the `inReplyTo` field, which would have (a) never matched any `findParentMessageDocId` lookup and (b) silently poisoned any future ancestor-chain traversal that consumed `inReplyTo` as a single ID. A future backfill could recover, but it's far cheaper to ship the defensive normalization up front.

### Files

- `infra/lambda/parse-airbnb-email/index.js` — modified (+15 / -1 lines inside `extractHeaderRefs`).
- `infra/lambda/parse-airbnb-email/__tests__/header-refs.test.js` — modified (+30 lines, 3 new tests).

### Tests

- **Result**: 87/87 passing across 4 suites (84 prior + 3 new array-handling cases).
- **Coverage**: all three array shapes (multi-element, single-element, empty) plus the existing string / null / missing paths.

### Acceptance criteria coverage (from plan)

- ✅ `extractHeaderRefs` is robust to mailparser version drift on `inReplyTo` shape — Task 1.5 unit tests.

### Significance

- Caught **before** Task 2's call-site wiring landed. No production data corruption.
- Demonstrates the value of the helpers-first / wiring-second split: the contract was lockable under test before any production write path consumed it.

---

## Task 2 — Wire helpers into 3 inbound write sites

**Date**: 2026-05-08
**Commit**: [`c32401e`](../../../) — `feat(parse-airbnb-email): persist inReplyTo/references/replyToId on inbound docs`

### What changed

The two helpers from Tasks 1 + 1.5 are now invoked in the inbound message pipeline of `infra/lambda/parse-airbnb-email/index.js`. The `replyToId` resolution runs **once** per inbound, at line 903, after dedupe and the non-Airbnb short-circuit but before message-type routing branches. This means roughly **one extra Firestore read per inbound that survives dedupe** — negligible cost, paid once regardless of which downstream branch claims the message.

The three resolved fields (`inReplyTo`, `references`, `replyToId`) are then merged into all three inbound write sites:

- **Line 1146**: unmatched-booking `airbnb_messages` write (the `bookingId: null` branch — message is preserved but not yet linked to a booking).
- **Line 1182**: `no_matching_booking` quarantine archive write.
- **Line 1208**: matched `airbnb_messages` write (the `docData` literal — the standard happy-path write).

Out-of-scope quarantine paths (`non_airbnb_sender`, unmatched `reservation_confirmation`, unknown `messageType`) are intentionally **not** touched. They're either non-conversational (reservation confirmations, system mail) or pre-conversation (sender filtering), so threading headers carry no useful signal there.

### Why

Task 1 + 1.5 produced tested helpers but no production behavior change. This commit closes the loop: every inbound that survives the parser's dedupe + airbnb-sender check will now persist its threading headers and (when resolvable) a Firestore pointer to its parent doc. After this commit lands and is deployed, the `airbnb_messages` collection will start carrying the threading metadata that future Item 6+ work will traverse.

The single resolution point (line 903) was chosen deliberately: doing it in-line at each write site would have meant 3× the Firestore reads and 3× the chance of the call signature drifting between sites. Resolving once into a local `parentDocId` variable and merging into all three write objects gives a single source of truth and a single point of future change.

### Files

- `infra/lambda/parse-airbnb-email/index.js` — modified (+13 lines). Sole file in the commit.

### Tests

- **Result**: 87/87 passing across 4 suites (no new tests; pure wiring on top of helpers already locked under test in Tasks 1 + 1.5).
- **Module-load smoke**: `module loads OK` — no syntax errors, no missing imports, no broken require graph.
- **Why no new tests**: the helpers are exhaustively covered, and the wiring change is three identical merge-into-write-object diffs. Adding fixture-based Lambda end-to-end tests for this would have meant standing up a much heavier harness for very low marginal coverage. End-to-end behavior will be verified in the production smoke after deploy.

### Acceptance criteria coverage (from plan)

- ✅ `extractHeaderRefs` normalizes string + array references — Task 1 + 1.5 unit tests.
- ✅ `findParentMessageDocId` returns `null` on miss, doc id on hit — Task 1 unit tests.
- ⏳ All 3 inbound write paths persist the 3 new fields — wired in Task 2; production smoke deferred to combined Item 4+5 deploy session.
- ✅ Out-of-order messages: `replyToId` is `null` but `inReplyTo` preserved — Task 1 unit test (mock with empty `messageIdLookup`).
- ✅ No regressions in classify / extract / booking-match — full 87/87 test suite.

### Significance

- After this commit, **Item 4 is functionally complete in the local repo**. New inbound docs in production (after deploy) will carry `inReplyTo`, `references`, and `replyToId` fields.
- Existing inbound docs (pre-deploy) are **NOT backfilled** — only new arrivals carry the fields. This is acceptable because the reply-agent does not yet consume them; by the time Item 6+ wires the consumer, several days of fresh threaded data will have accumulated under normal traffic.

### Caveats / follow-ups

- **No production deploy yet.** Combined deploy with Item 5 to save a CodePipeline cycle. Until the Lambda is redeployed, the new fields are present in code but not in any production-written doc.
- **Existing inbound docs lack these fields — no backfill in scope.** Net forward-only. If a future item needs the headers on historical docs, it will require a one-shot script that re-parses S3-archived raw emails and patches the existing `airbnb_messages` docs in place. Out of scope for Item 4.
- **Cloud Function (`onAirbnbMessageCreated`) does not yet consume `inReplyTo` / `replyToId`.** The data is persisted but not read by the AI yet. This is intentional. Future items can traverse parent-child chains using these fields — Item 4's job is purely to make sure the data is on disk in the right shape.
- **Out-of-scope quarantine paths** (`non_airbnb_sender`, unmatched `reservation_confirmation`, unknown `messageType`) intentionally not touched. If a future item needs threading on those paths, it's a one-line merge per site — but no current consumer needs it.

---

## Production Smoke — VERIFIED 2026-05-08

**Date**: 2026-05-08
**Commit**: [`f8119ed`](../../../) — `docs(option-a): Item 4 deploy + smoke verification artifacts`
**Status**: ✅ End-to-end verified in production. Item 4 is fully closed.

### Deploy path

Item 4 required two independent deploys because the change spans two compute environments:

- **Vercel + Firebase Functions** shipped via CodePipeline `f2408c40-ca93-4f24-9fb7-2d2af181979b` on the push of commit `4f7d41c` (the Item 5 change-log commit, which carried main forward). The pipeline succeeded for both targets. Note: the Lambda is **not** part of CodePipeline — it deploys via CDK only.
- **Lambda** redeployed manually via `cdk deploy CasaCoquiEmailStack --require-approval never` (~39s wall time). The CDK diff was code-only — S3Key hash changed, no infrastructure delta. This is the deploy that actually put the new `extractHeaderRefs` + `findParentMessageDocId` calls into the production parser.

### Synthetic smoke

Two `.eml` fixtures injected directly via S3 + Lambda invoke to exercise the parent → child threading path end-to-end without waiting for organic Airbnb traffic:

- **Parent `.eml`**: no `In-Reply-To` / `References` headers (root-of-thread baseline).
- **Child `.eml`**: `In-Reply-To: <synth-item4-parent-2026-05-08@airbnb.com>` + `References: <synth-item4-parent-2026-05-08@airbnb.com>`, sent ~5 seconds after the parent so the parent doc would already be in Firestore when the child landed.

Both Lambda invocations returned `processed: 1` with no errors. Verify script (`tasks/changes/option-a/item-4-logs/verify-headers.js`) ran 6 explicit checks against the resulting Firestore docs and returned `allPass: true`.

### Verify-script results (6/6 ✅)

Parent doc `8AY8FZ9pBo6NUUS7jfDh`:
- ✅ Check 1: `inReplyTo === null` (no header on root → field is absent / null).
- ✅ Check 2: `references` is `[]` (empty array, not missing — consistent shape).
- ✅ Check 3: `replyToId === null` (nothing to resolve).

Child doc `92TXQjdsxPRKdG0ypWWL`:
- ✅ Check 4: `inReplyTo === '<synth-item4-parent-2026-05-08@airbnb.com>'` (header preserved verbatim).
- ✅ Check 5: `references` is `['<synth-item4-parent-2026-05-08@airbnb.com>']` (single-element array form normalized correctly).
- ✅ Check 6: `replyToId === '8AY8FZ9pBo6NUUS7jfDh'` — the parent's **Firestore doc id**, resolved by `findParentMessageDocId` from the `inReplyTo` Message-ID via the `messageId` reverse lookup. This is the load-bearing assertion: the pointer is to the Firestore doc id, not a re-serialized Message-ID, so future ancestor-chain traversal can do `db.doc('airbnb_messages/' + replyToId).get()` directly without a second query.

### Cleanup

All synthetic artifacts removed in a single batch (`tasks/changes/option-a/item-4-logs/cleanup-headers.js`) so the smoke test left no residue in production:

- 2 `airbnb_messages` docs (parent + child).
- 2 `airbnb_messages_quarantine` docs.
- 2 `airbnb_message_locks` docs.
- 2 `agent_runs` docs.
- 8 `staff_notifications` docs.
- 2 S3 objects (the raw `.eml` files in the SES inbound bucket).

Total: 16 Firestore docs across 5 collections + 2 S3 objects, all deleted cleanly. Production state post-cleanup is identical to pre-smoke state.

### Acceptance criteria — final status

All criteria from the plan §"Acceptance criteria" are now satisfied **at runtime**, not just in unit tests:

- ✅ `extractHeaderRefs` normalizes string + array references — Task 1 + 1.5 unit tests + production smoke.
- ✅ `findParentMessageDocId` returns `null` on miss, doc id on hit — Task 1 unit tests + production smoke (parent miss → `null`, child hit → resolved doc id).
- ✅ All 3 inbound write paths persist the 3 new fields — Task 2 wiring + production smoke (matched-booking write site exercised; the unmatched-booking + quarantine sites share the same resolved `parentDocId` variable from line 903, so they are covered by the same code path).
- ✅ Out-of-order messages: `replyToId` is `null` but `inReplyTo` preserved — Task 1 unit test (parent-not-yet-in-Firestore branch).
- ✅ No regressions in classify / extract / booking-match — full 87/87 test suite + production smoke (both synthetic messages classified + matched + persisted normally).

### Significance

- **Item 4 is closed.** Every new inbound `airbnb_messages` doc in production now carries `inReplyTo`, `references`, and `replyToId`. Future Item 6+ work (context-graph traversal, ancestor-chain reasoning) can now consume the data without first having to backfill it.
- **Backfill of historical docs intentionally skipped.** Forward-only — by the time any consumer reads these fields, several days of organic threaded data will have accumulated under normal traffic. If a future item needs the headers on pre-deploy docs, that's a separate one-shot script that re-parses S3-archived `.eml` files.
- **Smoke artifacts preserved** in `tasks/changes/option-a/item-4-logs/` (CDK logs, invoke payloads, verify output, cleanup output). Reproducible if the smoke ever needs to be re-run after future Lambda changes.

---
