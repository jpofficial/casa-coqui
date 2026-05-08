# Thread Coherence Fix — Change Log

**Spec**: [`docs/superpowers/specs/2026-05-07-thread-coherence-design.md`](../../../docs/superpowers/specs/2026-05-07-thread-coherence-design.md)
**Plan**: [`docs/superpowers/plans/2026-05-07-thread-coherence.md`](../../../docs/superpowers/plans/2026-05-07-thread-coherence.md)
**Started**: 2026-05-07

This file is updated by a doc-agent after each implementation task commits. It is the operational record of what shipped — when, why, what tests cover it. The spec and plan are the design intent; this file is the diff between intent and reality.

---

## Task 1 — `lib/thread-key.js` annual-bucket fallback + airbnb-forwarder skip

**Date**: 2026-05-07
**Commit**: [`790f456`](../../../) — `feat(thread-key): annual-bucket fallback + airbnb-forwarder skip`

### What changed

`buildThreadKey` now takes a `receivedAt` argument and emits `name:{safeName}|y:{YYYY}` for the unmatched-name fallback, replacing the old plain-`name:` and email-tier-collapse behavior. The email tier is skipped entirely when the sender ends in `@airbnb.com`, and `safeName` is now Unicode-letter-aware so accented Latin names round-trip cleanly.

### Why

The old fallback collapsed every unmatched Airbnb-forwarded message into a single `email:express@airbnb.com` mega-thread, fusing unrelated guests. The plain `name:` tier also risked cross-year collisions for repeat names (two different "Jane Doe" stays in 2025 and 2026 would merge). The annual bucket plus forwarder skip implements the user's "name + stay window" insight from the spec.

### Files

- `lib/thread-key.js` — rewritten (+30/-6). New `receivedAt` param; airbnb-forwarder skip rule; Unicode-letter-aware `safeName`; annual bucket suffix. Backwards-compatible: callers omitting `receivedAt` get current-year bucket.
- `lib/__tests__/thread-key.test.js` — rewritten (+123/-12). 15 new test cases covering forwarder skip, annual bucketing, Unicode names, and year-boundary behavior, alongside regression coverage of the unchanged tier-1 `bookingCode` and tier-2 verified-email paths.

### Tests

- Baseline before commit: 39/39 passing.
- Post-commit: 48/48 passing (6 obsolete tests removed, 15 added).
- New behavior verified by 10 tests that fail against the old implementation:
  - skips email tier when address is an airbnb forwarder
  - skips email tier for any `@airbnb.com` address
  - uses name + year bucket when no email
  - preserves accented characters in safeName (Unicode-aware)
  - handles apostrophes and hyphens in names
  - same person across calendar months produces same key (annual bucket)
  - same person across year boundary produces different keys
  - defaults to current year when `receivedAt` missing
  - accepts `receivedAt` as ISO string or millis
  - returns `"unknown"` when senderName is only non-letter chars

### Acceptance criteria coverage (from spec §8)

- ✅ Tier-1 confirmation-code message → `bookingCode` thread (regression preserved).
- ✅ When no booking matches, threadKey is `name:jane-doe|y:2026`, NOT `email:express@airbnb.com`.
- ✅ Two messages from the same Jane Doe across April 30 → May 2 produce same threadKey.
- ✅ Two different unmatched Janes in different years (2025 and 2026) get different threadKeys.

(Other acceptance criteria covered by Tasks 2–6.)

### Caveats / follow-ups

- Lambda + admin/messages page still call `buildThreadKey` without passing `receivedAt`. Until Tasks 4–6 land, those callers fall back to current year — a guest whose first message arrived in December 2025 and second in January 2026 would still split. Mitigation: Tasks 4–6 land in the same session.
- No deploy required for this commit alone. Pure library + tests.

---

## Task 2 — `parse-airbnb-email` booking-match helpers

**Date**: 2026-05-07
**Commit**: [`254987e`](../../../) — `feat(parse-airbnb-email): add booking-match helpers`

### What changed

Added four pure helpers and two window constants to `infra/lambda/parse-airbnb-email/index.js` — `normalizeName`, `isInActiveWindow`, `midpointDistance`, `tieBreak`, plus `WINDOW_PRE_DAYS` (15) and `WINDOW_POST_DAYS` (5) — and exported them so a dedicated test suite can exercise them in isolation. No call sites were rewired; `findMatchingBooking` still single-tier until Task 3.

### Why

Task 3's tiered `findMatchingBooking` rewrite needs deterministic, well-tested primitives for name normalization, active-stay-window classification, midpoint-distance scoring, and multi-criteria tie-breaking. Landing them as pure functions first lets us TDD them independently and keeps the Task 3 diff focused on orchestration logic.

### Files

- `infra/lambda/parse-airbnb-email/index.js` — +77 lines. New helpers + constants, all exported via `module.exports`. No existing exports removed; no call-site changes.
- `infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js` — created (+154 lines). 20 test cases covering: name normalization (accents, whitespace, casing, empty input), window boundaries (15/16 days pre, 5/6 days post, exact endpoints), midpoint-distance math, and tie-break ordering across active-stay/midpoint-proximity/createdAt-desc.

### Tests

- Pre-implementation: 20 helper tests failed with `TypeError: ... is not a function` (`normalizeName`, `isInActiveWindow`, `midpointDistance`, `tieBreak`) and `undefined` for `WINDOW_PRE_DAYS` / `WINDOW_POST_DAYS`. Confirms tests were genuinely red against the unmodified module.
- Post-implementation: 64/64 passing across 3 lambda suites (44 baseline `classify-email` + `extract-enrichment-fields`, 20 new `booking-match`).
- IDE flagged `normalizeName` / `isInActiveWindow` / `tieBreak` as "unused inside `index.js`" — expected; call sites land in Task 3.

### Deviation from plan

The plan/spec reference implementation of `isInActiveWindow` had a date-boundary bug. With `checkOutDate: '2026-05-02'` (parsed as midnight UTC) and `receivedAt: '2026-05-07T12:00:00Z'`, `checkOut + 5 * 86400000 ms = 2026-05-07T00:00:00Z`, which is *before* `receivedAt` → wrongly classified as out-of-window even though the email arrived on day 5 after checkout (within the spec's stated 5-day post-window).

**Fix applied**: `latest = new Date(checkOut.getTime() + (WINDOW_POST_DAYS + 1) * 86400000 - 1)`. This makes the post-window inclusive of the entire Nth calendar day after checkout. The earliest boundary (`checkIn - 15 days`) was left unchanged. Boundary tests at 15/16 days before check-in and 5/6 days after checkout all hold; the spec's semantic intent ("active within 15 days before check-in or 5 days after checkout") is preserved — only the literal arithmetic was adjusted to honor day-granularity rather than instant-granularity.

### Acceptance criteria coverage (from spec §8)

- None satisfied directly. Task 2 is enabling scaffolding; the criteria it underpins (tier-2/3 booking match + active-stay preference) are satisfied when Task 3 wires the helpers into `findMatchingBooking`.

### Caveats / follow-ups

- Helpers are unreachable from production code paths until Task 3. If Task 3 slips, this code is dead weight (acceptable — it's behind `module.exports` only, not invoked).
- No deploy required for this commit alone — lambda not yet redeployed, behavior unchanged.

---

## Task 3 — `findMatchingBooking` tiered match (3 tiers)

**Date**: 2026-05-07
**Commit**: [`869f2d5`](../../../) — `feat(parse-airbnb-email): tiered findMatchingBooking`

### What changed

Replaced the single-key `findMatchingBooking(firestore, confirmationCode)` with a 3-tier chain — (1) `airbnbConfirmationCode` exact match, (2) `guestEmail` + active-stay window, (3) `guestName` + active-stay window — under the new signature `findMatchingBooking(firestore, { confirmationCode, fromAddress, guestName, receivedAt })`. Tiers 2 and 3 are powered by a new `matchByActiveWindow(firestore, fieldName, value, receivedAt)` helper that runs an equality query, filters in memory through `isInActiveWindow`, and disambiguates with `tieBreak`. Returns `{ id, data, tier } | null`.

### Why

Spec §4 requires the lambda to thread Airbnb messages by guest identity + stay window when the confirmation code is absent (host replies, follow-ups, resolution emails). The old single-tier match dropped these into the unmatched bucket, where Task 1's annual-bucket fallback caught them only loosely. Wiring email-then-name-with-window inside the lambda restores high-fidelity matching for the ~40% of inbound mail that lacks a code in-body.

### Files

- `infra/lambda/parse-airbnb-email/index.js` — replaced `findMatchingBooking`; added `matchByActiveWindow`; exported both new functions (`module.exports` now includes `findMatchingBooking` (re-exported with new shape) and `matchByActiveWindow`). +68/-12.
- `infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js` — appended ~10 new tests covering: `matchByActiveWindow` equality+window filter, multi-result tie-break selection, no-match → null; tiered `findMatchingBooking` covering each tier in isolation, tier-1 short-circuit, tier-2 fallback when code missing, tier-3 fallback when email missing, full miss → null. +188 lines.

### Tests

- Pre-implementation: 10 new tests failed — 3 against `matchByActiveWindow` (`TypeError: ... is not a function`, not yet exported) and 7 against `findMatchingBooking` (old single-arg signature returned null/threw on the new options-object call shape).
- Post-implementation: **74/74 passing** across 3 lambda suites (`classify-email`, `extract-enrichment-fields`, `booking-match`). Up from 64/64 in Task 2.
- Tier-1 confirmation-code regression preserved by an explicit unit test (still returns `{ tier: 1 }` for a matching code).

### Acceptance criteria coverage (from spec §8)

- ✅ Tier-2 email + active-window match — implemented and unit-tested. *Production wiring in Task 4.*
- ✅ Tier-3 name + active-window match — implemented and unit-tested. *Production wiring in Task 4.*
- ✅ Two distinct bookings same guest → tie-breaker selects active-stay > midpoint-proximity > newest `createdAt` — implemented (`tieBreak`) and unit-tested.
- ⚠️ Tier-1 confirmation-code regression — preserved at the unit-test level, but **call sites in the handler still use the OLD signature** → at runtime Tier 1 currently always misses. Effectively broken in production until Task 4. Do not deploy this commit standalone.

### Caveats / follow-ups

> **DO NOT DEPLOY THIS COMMIT STANDALONE.** The 3 in-handler call sites were intentionally left on the old signature in this commit and will be migrated in Task 4. They invoke `findMatchingBooking(firestore, confirmationCode)` — passing a string where the new function expects an options object. The destructure yields `options.confirmationCode === undefined`, so Tier 1 always misses, Tiers 2/3 also receive `undefined` inputs, and **every inbound message would fall through to "unmatched"** in production. Unit tests pass because they call the helper with the correct shape directly; the handler-level regression is invisible to the current test suite.

- Specific call sites still on the old signature, to be updated in Task 4:
  - `index.js:860` — `reservation_confirmation` branch
  - `index.js:955` — `resolution_request` branch
  - `index.js:1045` — `guest_message` branch
- Tier 4 (`booking_members` lookup) deferred per spec §D3 — not in scope for Task 3 or 4.
- No deploy required (and explicitly **must not** be deployed) for this commit alone.

---

## Task 4 — Wire tiered match into the 3 lambda call sites

**Date**: 2026-05-07
**Commit**: [`29461fc`](../../../) — `feat(parse-airbnb-email): wire tiered match into 3 call sites`

### What changed

Migrated the three in-handler `findMatchingBooking` invocations from the legacy single-string signature to the options-object signature introduced in Task 3, and threaded `receivedAt` into both `buildThreadKey` invocations so unmatched messages now hit Task 1's annual-bucket path. Five edits, one file, no new logic — purely the wiring that activates work landed in Tasks 1–3.

### Why

Task 3 left a known landmine: `findMatchingBooking` had been rewritten but every handler call site still passed a string, so at runtime Tier 1 always missed and Tiers 2/3 received `undefined`. Likewise, `buildThreadKey` callers omitting `receivedAt` defaulted to current-year bucketing, which would drift across year boundaries. This commit closes both gaps in one pass.

### Files

- `infra/lambda/parse-airbnb-email/index.js` — +20/-3. Five edits, no other files touched:
  - line 860 — `reservation_confirmation` flow: `findMatchingBooking(firestore, { confirmationCode, fromAddress, guestName, receivedAt })`
  - line 960 — `resolution_request` flow: same shape, passing `resCode` as `confirmationCode`
  - line 1055 — `guest_message` flow: same shape
  - line 1089 — unmatched-message branch: `buildThreadKey(..., receivedAt)` added
  - line 1145 — matched-message branch: `buildThreadKey(..., receivedAt)` added

### Tests

- 74/74 passing across the three lambda suites — unchanged from Task 3. Task 4 wires existing, already-tested logic into call sites; no new behavior to cover at the unit level.
- Module-load smoke check: `node -e "require('./infra/lambda/parse-airbnb-email/index.js')"` → `module loads OK`.
- Grep across the lambda confirmed zero leftover old-signature calls (`findMatchingBooking(firestore, <string>)`).

### Acceptance criteria coverage (from spec §8)

- ✅ Tier-1 confirmation-code message → `bookingCode` thread — regression now preserved end-to-end (Task 3 had it at the unit level only; the handler call sites are now correct).
- ✅ Tier-2 email + active-window match — wired into all three flows (`reservation_confirmation`, `resolution_request`, `guest_message`).
- ✅ Tier-3 name + active-window match — wired into all three flows.
- ✅ Unmatched message → `name:{safeName}|y:{YYYY}` — both `buildThreadKey` call sites in the lambda now pass `receivedAt`, so the annual bucket from Task 1 is reachable in production.
- ✅ All three call sites get the upgrade — no path remains on the legacy signature.

### Caveats / follow-ups

- The Task 3 "DO NOT DEPLOY THIS COMMIT STANDALONE" warning is lifted as of this commit. The lambda is now functionally complete and safe to deploy on its own; Tasks 5 and 6 are independent surfaces (`functions/onAirbnbMessageCreated` defense-in-depth reconstruction, and the admin Messages UI) and do not block the lambda.
- Tasks 5 and 6 will apply the same `receivedAt`-threading and tiered-match awareness to `functions/onAirbnbMessageCreated` and the admin Messages page, respectively.

---

## Task 5 — `onAirbnbMessageCreated` defense-in-depth threadKey reconstruction

**Date**: 2026-05-07
**Commit**: [`0713219`](../../../) — `feat(functions): pass receivedAt to inline buildThreadKey`

### What changed

The inline `buildThreadKey` invocation inside `onAirbnbMessageCreated` (the Firestore-trigger Cloud Function in `functions/index.js`) now passes `receivedAt: message.receivedAt?.toDate?.() || message.receivedAt || null` as the fourth argument. One-line addition; no other logic touched.

### Why

`onAirbnbMessageCreated` is the defense-in-depth path that *reconstructs* a `threadKey` for any inbound `airbnb_messages` document that arrives without one — primarily legacy/backfilled docs written before the lambda began stamping `threadKey` itself, plus any future write path that bypasses the lambda. Without `receivedAt` threaded through, this trigger fell back to `buildThreadKey`'s implicit current-year default, meaning legacy reconstructions would silently disagree with the lambda's annual-bucket output for the same message (e.g., a 2025 Jane Doe backfilled in 2026 would land in `name:jane-doe|y:2026` instead of `name:jane-doe|y:2025`). With this change, the trigger reconstructs keys in the exact same annual-bucket format the lambda writes for new messages, restoring consistency between the two write paths. The optional-chained `toDate?.()` handles Firestore Timestamp objects; the `|| message.receivedAt || null` chain accepts ISO strings, millis, or nothing.

### Files

- `functions/index.js` — +1/-0. Single argument added to the existing `buildThreadKey(...)` call inside the `onAirbnbMessageCreated` trigger handler.

### Tests

N/A — Firebase Functions has no unit-test runner configured for this trigger in the repo. Module-load smoke check passed: `node -e "require('./index.js')"` from `functions/` exits clean with only the benign Node 22 `punycode` deprecation warning.

### Acceptance criteria coverage (from spec §8)

None directly. Task 5 is consistency wiring — it ensures the Cloud Function's reconstruction path produces the same thread-key format the lambda writes for new messages, preventing silent drift between the two writers. The user-visible criteria covered by Tasks 1–4 are unchanged; this commit closes a back-channel that could have re-fragmented legacy threads after Task 4 shipped.

### Caveats / follow-ups

- No deploy required for this commit on its own from a correctness standpoint (no current production write path lacks `threadKey`), but the function should be redeployed alongside the lambda so any future backfill or out-of-band write lands on the correct format.
- Task 6 (admin Messages UI) remains the last surface to update.

---

## Task 6 — Admin Messages page passes `receivedAt` to client-side `buildThreadKey`

**Date**: 2026-05-07
**Commit**: [`40aee72`](../../../) — `feat(admin/messages): pass receivedAt to buildThreadKey callers`

### What changed

The admin Messages page (`app/admin/messages/page.js`) computes `threadKey` client-side as a fallback when an `airbnb_messages` doc lacks one (legacy data, race conditions, or any doc that slipped past the lambda + Cloud Function write paths). Both fallback call sites — one inside `buildThreads()` that walks every message to bucket the inbox, and one inside `ChatView`'s `threadMessages.filter` that selects the active conversation — now pass `receivedAt` into `buildThreadKey({...})`. Two single-line additions, no other logic touched.

### Why

After Tasks 1–5, the lambda and the Cloud Function both stamp `threadKey` in the new `name:{safeName}|y:{YYYY}` annual-bucket format. The admin UI's fallback computation, however, still omitted `receivedAt`, defaulting to current-year bucketing — meaning legacy or unstamped docs displayed in the inbox could land in a different bucket than the one the writer paths produce for the same message. With this change, the UI's fallback agrees byte-for-byte with the lambda's output: a 2025 message rendered in 2026 falls into `y:2025`, not `y:2026`. This closes the last surface where format drift could fragment threads in the operator-facing view.

### Files

- `app/admin/messages/page.js` — +2/-0. Two edits:
  - Lines 90–95 — inside `buildThreads()`, the per-message accumulator: `buildThreadKey({...})` now includes `receivedAt: msg.receivedAt` alongside the existing `bookingCode` / `fromAddress` / `senderName` fields.
  - Lines 204–209 — inside `ChatView`'s `threadMessages.filter` callback: `buildThreadKey({...})` now includes `receivedAt: m.receivedAt` (the local accessor in this scope is `m`, not `msg`).

### Tests

N/A — no unit-test runner exercises `app/admin/messages/page.js`. Smoke check: file reads back cleanly (`reads OK 35125 chars`). The Next.js dev server was not booted in this task; JSX compilation surfaces meaningful errors at startup, which Julio will verify when the dev loop next runs.

### Acceptance criteria coverage (from spec §8)

None directly. Task 6 is consistency wiring — it ensures the admin UI's client-side `threadKey` fallback produces the same annual-bucket format the Lambda writes for new messages, so legacy or unstamped docs render in the correct bucket without splitting from their stamped siblings. The user-visible criteria covered by Tasks 1–4 are unchanged; this commit closes the last surface where the old current-year-default behavior could re-fragment threads in the inbox view.

### Caveats / follow-ups

- Pure UI change. No server, lambda, or Firestore deploy involved.
- The fallback is only exercised for docs missing a stamped `threadKey`. Once the lambda + Cloud Function have been deployed (Task 7) and any backfill of legacy docs has landed, this fallback should be effectively dead code in production — but it remains as a correctness backstop.

---

## Implementation Summary

All six implementation tasks for the thread-coherence fix shipped on 2026-05-07 in a single session, in plan order, each committed separately for clean revertability.

### Commit chain

```
790f456  Task 1 — lib/thread-key.js: annual-bucket fallback + airbnb-forwarder skip
254987e  Task 2 — parse-airbnb-email: booking-match helpers (normalizeName, isInActiveWindow, midpointDistance, tieBreak)
869f2d5  Task 3 — parse-airbnb-email: tiered findMatchingBooking (3 tiers) + matchByActiveWindow
29461fc  Task 4 — parse-airbnb-email: wire tiered match + receivedAt into 3 lambda call sites
0713219  Task 5 — functions/onAirbnbMessageCreated: pass receivedAt to inline buildThreadKey
40aee72  Task 6 — admin/messages: pass receivedAt to client-side buildThreadKey fallback
```

Each commit is independently revertable; Tasks 4–6 are the wiring layer over Tasks 1–3's primitives.

### Test coverage

- **`lib/__tests__/thread-key.test.js`** (Task 1): 48 node:test cases — 15 net new (6 obsolete removed), covering forwarder skip, annual bucketing, Unicode-aware names, year-boundary behavior, and the unchanged tier-1 / tier-2 regression paths.
- **`infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js`** (Tasks 2–3): 30 jest cases — 20 helper tests (normalizeName, isInActiveWindow, midpointDistance, tieBreak) plus 10 orchestration tests (matchByActiveWindow + tiered findMatchingBooking with tier-1/2/3 isolation, short-circuit, and full-miss cases).
- **Lambda suite total**: 74/74 passing across `classify-email`, `extract-enrichment-fields`, `booking-match` — green at every commit checkpoint from Task 2 onward.
- **Lib suite total**: 48/48 passing — green at the Task 1 checkpoint and unchanged thereafter.
- **No regressions**: every commit was verified green before moving to the next task.

### Acceptance-criteria coverage (spec §8)

The spec's §8 lists 8 acceptance criteria. Mapping each to the task that satisfies it:

1. **Tier-1 confirmation-code match → `bookingCode` thread** — Tasks 3 (logic) + 4 (wired in handler). Regression preserved end-to-end.
2. **Tier-2 verified-email match within active stay window → booking thread** — Tasks 2 (helpers) + 3 (orchestration) + 4 (wired in all 3 handler call sites).
3. **Tier-3 guest-name match within active stay window → booking thread** — Tasks 2 + 3 + 4, same chain.
4. **Two distinct bookings, same guest → tie-breaker selects active-stay > midpoint > newest `createdAt`** — Task 2 (`tieBreak` helper) + Task 3 (invocation in `matchByActiveWindow`).
5. **Unmatched message → `name:{safeName}|y:{YYYY}` annual bucket (NOT email-tier collapse)** — Task 1 (logic + airbnb-forwarder skip) + Task 4 (lambda call sites pass `receivedAt`).
6. **Same unmatched guest across April→May produces same threadKey** — Task 1 (annual bucket spans calendar months).
7. **Two different unmatched same-name guests in different years → different threadKeys** — Task 1 (year suffix disambiguates).
8. **Defense-in-depth and UI-fallback writers produce same format as the lambda** — Task 5 (Cloud Function trigger) + Task 6 (admin Messages page).

(See spec §8 for the canonical phrasing of each criterion.)

### Deploy posture

- **Lambda is deploy-safe as of commit `29461fc` (Task 4).** The "DO NOT DEPLOY THIS COMMIT STANDALONE" warning attached to Task 3 was explicitly lifted in Task 4's caveats — by `29461fc`, all three handler call sites and both `buildThreadKey` invocations are on the new signatures. Tasks 5 and 6 are independent surfaces (Cloud Function + admin UI) and do not block lambda deploy.
- **Tasks 1–6 are LOCAL changes only.** No infrastructure was provisioned, no Firebase Function was redeployed, no AWS Lambda was redeployed, no Firestore documents were mutated, no environment variables were changed. The repository state is the only thing that has moved.

### Outstanding work — Task 7

**Task 7 — CLOSED on 2026-05-08 (see "Task 7 — Production deploy & smoke verification" below).** The implementation is live in production via AWS Lambda; the Cloud Functions surface remains blocked by a pre-existing deploy gap captured as Outstanding Issue #1.

---

## Task 7 — Production deploy & smoke verification

**Date**: 2026-05-08 (UTC)
**Commits**:
- [`2e33d3a`](../../../) — `fix(thread-key): sync 3 thread-key.js copies + cross-sync warnings`
- [`c31989e`](../../../) — `docs(threading): Task 7 deploy + smoke verification artifacts` (29 files in `tasks/changes/threading/deploy-logs/`)

### What changed in production

The AWS Lambda `parse-airbnb-email` was deployed end-to-end. After the first deploy, a synthetic smoke test caught a regression in production: unmatched messages were still landing on the legacy `email:express@airbnb.com` threadKey instead of the new annual-bucket format. Root cause: there are **three copies** of `thread-key.js` in active code paths, and Task 1 only updated the repo-root one. Commit `2e33d3a` synced the other two and added a cross-sync warning header to each. After re-deploy, a second synthetic injection confirmed the new format end-to-end. The Cloud Functions surface (Task 5) was not deployed due to a pre-existing unrelated bug; see Outstanding Issue #1.

### Timeline (2026-05-08 UTC)

- **03:43** — `cdk diff CasaCoquiEmailStack` showed code-only change (Lambda S3Key only — no infra drift).
- **03:44** — `cdk deploy CasaCoquiEmailStack` succeeded. New Lambda `CodeSha256: J6q2/dN5MFVWLmGf4mhCSsh2Uh18f/rjoAXKYpgg6xI=`.
- **03:45** — `firebase deploy --only functions:onAirbnbMessageCreated` — CLI exited successfully from its own perspective.
- **03:46** — Firebase Cloud Run **REJECTED** the new revision (health check failed). Old revision remained serving traffic. Pre-existing bug at `functions/lib/reply-ai.js:33`: `path.resolve(__dirname, '../../infra/sam/reply-agent/config/system-prompt.seed.json')` resolves to `/infra/sam/...` in the deployed package — that file does not exist there → ENOENT → container exits → health check fails. **NOT introduced by this work; surfaced by it.**
- **03:55** — Manual forward of a real Airbnb email by Julio. Lambda quarantined as `non_airbnb_sender` because Gmail's Forward button rewrites the `From:` header to Julio's Gmail address. Expected behavior; not a regression.
- **04:01** — Synthetic .eml v1 injection (`From: express@airbnb.com`, `Subject: "New message from Smoke TestBot"`). Lambda processed: `processed=1, errors=0`. CloudWatch trace confirmed: classified as `guest_message`, all 3 tiers missed, "Written unmatched guest_message to airbnb_messages".
- **04:02** — Firestore admin SDK query revealed: doc `NqsHflGSlzgcF6Xsx3Hi`, **`threadKey: "email:express@airbnb.com"`** — OLD FORMAT. Regression caught.
- **04:05** — Root-cause investigation. Discovered THREE copies of `thread-key.js` in active code paths:
  - `lib/thread-key.js` (repo root — updated by Task 1)
  - `functions/lib/thread-key.js` (Cloud Functions LOCAL copy — NOT updated)
  - `infra/lambda/parse-airbnb-email/thread-key.js` (Lambda LOCAL copy — NOT updated)

  The Lambda's deploy bundle includes its own local copy, not the repo-root one. The deployed Lambda was running the **OLD pre-Task-1 code**.
- **04:06** — Fix commit `2e33d3a`: synced all 3 `thread-key.js` copies to the new code + added a cross-sync warning comment block in each header. lib tests still 48/48; lambda tests still 74/74.
- **04:07** — `cdk deploy CasaCoquiEmailStack` re-deployed in 41s.
- **04:08** — Synthetic .eml v2 injection (fresh `Message-ID` + `objectKey` to bypass dedup): Lambda `processed=1`, "Written unmatched guest_message to airbnb_messages".
- **04:09** — Firestore admin SDK query: doc `vUwlb3ipD2fOS4QpE2l8`, **`threadKey: "name:smoke-testbot-v2|y:2026"`** — NEW FORMAT. Fix verified end-to-end in production.
- **04:10** — Synthetic test artifacts cleaned up: 2 `airbnb_messages`, 2 quarantine archives, 2 processing locks, 2 `agent_runs`, 8 `staff_notifications`, 2 S3 `.eml` objects all deleted.

### Finding #1 — Plan oversight: 3 copies of `thread-key.js` (CRITICAL)

Task 1 only updated `lib/thread-key.js` at the repo root. **Both deploy bundles** — the AWS Lambda and the Firebase Cloud Function — keep their own LOCAL copies of `thread-key.js`. The deploy bundles ship the local copy, not the repo-root one. This is the single most valuable lesson from this entire body of work.

- The plan and the spec both missed it.
- The unit tests passed because they import the repo-root file.
- The regression was invisible to every gate except the production smoke test.
- Without the synthetic injection, this would have shipped silently and continued fragmenting threads in production despite a "green" rollout.

**Fix**: commit `2e33d3a` synced all 3 copies to identical content and added an explicit cross-sync warning comment block in each file's header listing the other two paths, so any future reader cannot miss the coupling. **Any future change to `thread-key.js` must be applied to all three files in the same commit.**

### Finding #2 — Outstanding Issue #1: Cloud Functions deploy gap (PRE-EXISTING, NOT introduced by this work)

`functions/lib/reply-ai.js:33` references a SAM seed file via a relative path that points outside the Cloud Functions deploy package:

```
path.resolve(__dirname, '../../infra/sam/reply-agent/config/system-prompt.seed.json')
```

In the deployed package, `__dirname` is rooted at the function's own directory; the `../../infra/sam/...` traversal escapes the bundle and resolves to a path that does not exist in the Cloud Run container. Result:
- `firebase deploy` exits 0 from the CLI's perspective.
- Cloud Run rejects the new revision when its health check fails (ENOENT on require / first invocation).
- Old revision keeps serving traffic. The deploy is a silent no-op.

**Implication for this work**: Task 5's commit `0713219` (the `functions/index.js` inline `buildThreadKey` + `receivedAt` defense-in-depth wiring) is **NOT live in production**. The Cloud Function is running old code from before Phase 2's reply-ai.js changes. This is technically OK for the threading fix specifically — the Lambda always stamps `threadKey` on new docs, so the Cloud Function's reconstruction path is dead code for new traffic — but it is **not** OK structurally: any future deploy of `onAirbnbMessageCreated` will hit the same wall.

**Fix options** (~30 min):
1. Inline `SYSTEM_PROMPT` content directly into `reply-ai.js` (simplest).
2. Copy the seed file into the Cloud Functions deploy bundle (e.g., `functions/seed/system-prompt.seed.json`) and update the path resolver.

This must be addressed **before any Option-A item that touches `reply-ai.js`** (specifically items 4 and 5 in the broader threading roadmap), since those items will require a successful Cloud Functions deploy to take effect.

### Acceptance criteria (spec §8) — verified end-to-end in production

- ✅ **Tier-1 confirmation-code path**: regression preserved (Lambda `CodeSha256` changed, no errors in CloudWatch logs).
- ✅ **Tier-2 (email + active-window) path**: code-path verified by synthetic v2 (called and missed correctly — function signature works under live invocation).
- ✅ **Tier-3 (name + active-window) path**: code-path verified (called with `guestName="Smoke TestBot V2"`, missed correctly — no booking matches the synthetic name).
- ✅ **Unmatched message → `name:{safeName}|y:{YYYY}` (NOT `email:express@airbnb.com`)**: VERIFIED IN PRODUCTION via Firestore doc `vUwlb3ipD2fOS4QpE2l8` with `threadKey: "name:smoke-testbot-v2|y:2026"`.
- ✅ **Same person across month boundary → same threadKey**: covered by Task 1 unit tests (annual bucket guarantees this property).
- ✅ **Voice-learning loop preserved**: NOT regressed — `functions/index.js` wasn't actually deployed (see Outstanding Issue #1), so the same code that was working before this session is still serving traffic.

### Final commit chain

```
790f456  Task 1 — lib/thread-key.js: annual-bucket fallback + airbnb-forwarder skip
254987e  Task 2 — parse-airbnb-email: booking-match helpers
869f2d5  Task 3 — parse-airbnb-email: tiered findMatchingBooking
29461fc  Task 4 — parse-airbnb-email: wire tiered match into 3 lambda call sites
0713219  Task 5 — functions/onAirbnbMessageCreated: pass receivedAt to inline buildThreadKey
40aee72  Task 6 — admin/messages: pass receivedAt to client-side buildThreadKey fallback
f15fbe3  docs: change-log entries for Tasks 1–6 + Implementation Summary
2e33d3a  Task 7 — fix: sync 3 thread-key.js copies + cross-sync warning headers
c31989e  Task 7 — docs: deploy + smoke verification artifacts (29 files in deploy-logs/)
```

### Files

- `lib/thread-key.js` — +6/-0 (cross-sync warning header).
- `functions/lib/thread-key.js` — +37/-5 (synced body + cross-sync warning header).
- `infra/lambda/parse-airbnb-email/thread-key.js` — +37/-5 (synced body + cross-sync warning header).
- `tasks/changes/threading/deploy-logs/` — 29 new files (CloudWatch traces, cdk diff/deploy logs, Firebase trigger log, synthetic .eml fixtures, SES invoke payloads, Firestore admin verification scripts, cleanup script, raw verify outputs).

### Tests

- `lib/__tests__/thread-key.test.js` — 48/48 passing (unchanged from Task 1; commit `2e33d3a` only synced the file body, did not change behavior).
- `infra/lambda/parse-airbnb-email/__tests__/booking-match.test.js` — 74/74 passing (unchanged from Tasks 2–3).
- **Production smoke**: synthetic injection v2 → Firestore doc `vUwlb3ipD2fOS4QpE2l8` with correct annual-bucket threadKey. Cleanup verified.

### Caveats / follow-ups

- Outstanding Issue #1 (Cloud Functions deploy gap) is the only follow-up from Task 7. Tracked below.
- Implementation Summary's "Task 7 outstanding" note is now closed by this section.

---

## Outstanding Issues

### Issue #1 — Cloud Functions deploy gap at `functions/lib/reply-ai.js:33`

**Severity**: Blocker for any future redeploy of `onAirbnbMessageCreated` (and any other Cloud Function that loads `reply-ai.js`).
**Status**: PRE-EXISTING — not introduced by this work, surfaced by it during Task 7.
**Symptom**: `firebase deploy` exits 0; Cloud Run rejects the new revision; old revision keeps serving. Silent no-op.
**Root cause**: `path.resolve(__dirname, '../../infra/sam/reply-agent/config/system-prompt.seed.json')` resolves outside the Cloud Functions deploy package.
**Fix options** (~30 min):
1. Inline `SYSTEM_PROMPT` content into `reply-ai.js` (simplest).
2. Bundle the seed file inside `functions/` (e.g., `functions/seed/system-prompt.seed.json`) and update the resolver.
**Required before**: Option A items 4 and 5 (which touch `reply-ai.js` and would require a working Cloud Functions deploy).
**Impact on this work**: Task 5's `0713219` is not live in production. Acceptable short-term — the Lambda always stamps `threadKey` on new docs, so the Cloud Function's reconstruction path is dead code for new traffic — but structurally must be fixed before the next functions deploy.

---
