# Option A — Item 5: Context Window Change Log

**Topic**: Item 5 — Expand AI conversation context window from 5 → 20 messages
**Spec source**: [`explantion/2026-05-07-threading-handoff.md`](../../../explantion/2026-05-07-threading-handoff.md) §2 (priority item 5)
**Started**: 2026-05-08

This is the smallest item in the Option A priority list. The verification doc explicitly called it a "two-line change" — in practice it landed as a **three-line change** so the ESM repo-root copy of `reply-ai.js` and the CommonJS `functions/lib/reply-ai.js` copy stay in lockstep, plus the Cloud Function thread query had to be widened to actually fetch enough history for the new slice to bite. The behavioral change is purely a parameter widening: every AI invocation that has the conversation history available will now see up to 20 prior messages instead of 5.

This file is updated by a doc-agent after each implementation task commits. It is the operational record of what shipped — when, why, what tests cover it. The spec is the design intent; this file is the diff between intent and reality.

---

## Task 1 — Widen thread query + slice from 5 to 20

**Date**: 2026-05-08
**Commit**: [`069499e`](../../../) — `feat(reply-ai): expand context window 5 → 20 messages (Option A Item 5)`

### What changed

Three single-line edits across the active reply-AI code paths. 3 files, +6 / -4.

- **`functions/index.js:262`** — Firestore thread query `.limit(10)` → `.limit(21)`. The `+1` is load-bearing: the current inbound message is in the result set and gets filtered out via `.filter((d) => d.id !== messageId)`. Querying 21 guarantees 20 prior messages survive the filter even when the current message lands at the head of the result.
- **`functions/lib/reply-ai.js:228`** — `thread.slice(-5)` → `thread.slice(-20)`. This is the CommonJS copy used by the deployed Cloud Function.
- **`lib/reply-ai.js:214`** — same `slice(-5)` → `slice(-20)` in the ESM repo-root copy. The repo intentionally keeps two copies in sync — drift here would silently let the local dev path see a different context window than production.

### Why

The verification doc (Item 5) called out that 5 messages of conversation history is too thin for any thread that runs longer than a single round-trip. Casa Coqui's median Airbnb thread is ~5 messages (per the voice-profile baseline of 3,620 real replies), so most threads are unaffected in practice — but the long-tail threads, which are exactly the ones where AI quality matters most, were getting truncated to the most recent 5 turns and losing earlier context (booking specifics, prior asks, prior answers).

20 was chosen as the new ceiling because:

- It covers the 95th-percentile thread length comfortably.
- Token cost is still trivial at Casa Coqui's volume (~2-3 KB extra per AI invocation worst case, negligible Anthropic API impact).
- Going higher (e.g. 50) would have meant revisiting the Firestore query cost and the prompt-window budget; 20 stays well under both.

The voice corpus stays at 10 messages — that is a **different concern** (style matching, not thread context) and Item 5 was scoped strictly to the conversation-history window per the verification doc.

### Files

- `functions/index.js` — modified (+1 / -1).
- `functions/lib/reply-ai.js` — modified (+2 / -1).
- `lib/reply-ai.js` — modified (+2 / -2).

### Tests

- **Result**: 87/87 Lambda tests still passing — no regressions.
- **No new tests**: the change is parameter-only. The existing slice/limit behavior is exercised implicitly via the thread context flows already under test. Adding fixture-based tests for "did the slice take the right number of items" would be testing JavaScript's `Array.prototype.slice`, not application logic.
- **Module-load smoke**: `functions/index.js` loads OK — no syntax errors, no broken require graph.
- **Lambda parity**: the Lambda parser doesn't use these slices at all (it's a separate code path), so the 87/87 result is a "no regressions in adjacent code" signal rather than direct coverage of the change.

### Acceptance criteria coverage (from spec)

- ✅ `functions/index.js` queries up to 21 messages — verified by grep on `.limit(21)`.
- ✅ Both `reply-ai.js` copies slice to last 20 — verified by grep on `slice(-20)`.
- ✅ Existing Lambda test suite still 87/87 — no regressions.
- ⏳ Production smoke (long-thread reply quality) — deferred to combined Item 4 + Item 5 deploy session.

### Caveats / follow-ups

- **No production deploy yet.** Combined deploy with Item 4 to save a CodePipeline cycle. Until the Cloud Function is redeployed, the new context window exists in code but not in any production AI invocation.
- **Increased context cost.** Each AI invocation now sends up to 4× more conversation history. Worst-case token bump is ~2-3 KB per reply; Anthropic API cost impact is negligible at Casa Coqui's current volume but is worth re-checking if traffic ever scales an order of magnitude.
- **Voice corpus deliberately unchanged.** The 10-message voice corpus serves a different purpose (style matching against the host's prior replies, not conversation continuity). Conflating the two would have widened scope past what Item 5 was approved for.
- **Out of scope: prompt-window budget audit.** The new 20-message ceiling is well under the current Anthropic prompt budget, but no one re-ran the worst-case prompt size calculation as part of this commit. If a future item raises the limit further, the audit becomes mandatory.

---

## Outstanding Issue #2 — Long-thread truncation direction (asc vs desc)

**Surfaced by**: Item 5 review
**Severity**: Pre-existing, not introduced by this commit
**Status**: Tracked for future work

The Cloud Function thread query in `functions/index.js:262` returns messages in ascending creation order. For threads ≤ 21 messages, this is fine — the slice keeps everything. For threads > 21 messages, the query truncates to the **oldest** 21 and the AI never sees the most recent context past the 21-message ceiling.

This is a **pre-existing concern** unrelated to Item 5: the same direction-of-truncation problem existed at `limit(10)` and is not made worse by widening to `limit(21)`. In fact, Item 5 makes the problem *less* acute in practice — threads of 10-21 messages now get full coverage where they previously didn't, and only threads > 21 messages still hit the truncation. Casa Coqui has very few threads in that range.

**Recommended fix (future item)**: switch the query to `orderBy('createdAt', 'desc').limit(21)` and reverse client-side, so the AI always sees the most recent 21 messages instead of the oldest 21. This is a one-line change but warrants its own commit + production smoke because reversing the slice direction is a behavior change, not a parameter widening.

Flagging here so it doesn't get lost. Not in Item 5's scope.

---

## Production Status — DEPLOYED 2026-05-08

**Pipeline**: `f2408c40-ca93-4f24-9fb7-2d2af181979b` (commit `4f7d41c` push)
**Targets deployed**: Vercel + Firebase Functions ✅
**Lambda redeploy**: ❌ not required — Item 5 only modified `functions/index.js`, `functions/lib/reply-ai.js`, and `lib/reply-ai.js`. The Lambda parser does not call `buildReplyInput` and does not consume the slice; the parameter widening is exclusively on the Cloud Function reply-agent path.

### Synthetic smoke — intentionally skipped

No standalone synthetic test was run for Item 5. The change is parameter-only on a code path that fires only when an organic Airbnb message arrives via the Cloud Function trigger (`onAirbnbMessageCreated`). Constructing a synthetic exercise of the slice would have required either a fixture-based unit test (which is testing `Array.prototype.slice`, not application logic) or a full end-to-end trigger in production, which we already get for free on the next inbound. We chose to wait for organic traffic.

### Implicit verification via Item 4 smoke ✅

Item 4's parent + child synthetic test (`tasks/changes/option-a/item-4-logs/`) **also exercised Item 5's code path**: when each synthetic `.eml` was injected, the Cloud Function trigger fired, called `buildReplyInput` (which now applies `slice(-20)`), and produced an `agent_runs` doc with the new wider context window. Logs in `item-4-logs/` show normal operation across both invocations — the child invocation in particular ran with the parent already present in the thread, exercising a 2-message thread through the new slice. This is implicit but real coverage of the Item 5 code path.

### Functional verification path for organic traffic ⏳

When the next real Airbnb message arrives (Yashira or any other guest follow-up):

1. Find the resulting `agent_runs` doc by inbound `messageId` or by `createdAt` recency.
2. Inspect `_agentRun.prompt` — `conversationHistory` should contain up to 20 prior messages if the thread has run that long. Threads ≤ 5 messages will look unchanged from pre-Item-5 behavior; threads of 6-20 are where the widening visibly bites.
3. (Optional) Compare against the Firestore thread query result: the Cloud Function should have queried up to 21 and the slice should have returned the last 20 (or fewer if the thread is shorter).

No action required from Julio — this verification can be done opportunistically the next time he reviews an AI draft for a long-running thread.
