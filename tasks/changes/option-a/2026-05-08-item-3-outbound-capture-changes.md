# Option A — Item 3: Outbound Capture Change Log

**Topic**: Item 3 — Outbound capture: Mark-as-Sent creates outbound `airbnb_messages` doc
**Spec source**: [`explantion/2026-05-07-threading-handoff.md`](../../../explantion/2026-05-07-threading-handoff.md) §2 (priority item 3)
**Plan**: [`docs/superpowers/plans/2026-05-08-option-a-item-3-outbound-capture.md`](../../../docs/superpowers/plans/2026-05-08-option-a-item-3-outbound-capture.md)
**Started**: 2026-05-08

This is part of the post-threading-fix priority list. Items 3–5 are the JS-chain improvements that ship before Phase 3. With threading now coherent (Tasks 1–7 + Issue #1 resolution from `tasks/changes/threading/2026-05-07-thread-coherence-changes.md`), the JS-side reply chain can be tightened so it (a) records the host's actual sent reply as a first-class document, (b) feeds that reply back into the conversation history the AI sees on the next inbound, and (c) grows the voice-corpus query (which already reads `outbound_draft + sent`) without any further wiring.

This file is updated by a doc-agent after each implementation task commits. It is the operational record of what shipped — when, why, what tests cover it. The plan is the design intent; this file is the diff between intent and reality.

---

## Task 1 — `POST /api/airbnb-messages/{id}/mark-sent` route

**Date**: 2026-05-08
**Commit**: [`4e0ee0b`](../../../) — `feat(api): mark-sent route writes both inbound update + outbound doc`

### What changed

New API route at `app/api/airbnb-messages/[id]/mark-sent/route.js`. Accepts `POST` with `{ editedReply }` in the body, authenticates as admin/cohost, and runs an atomic Firestore batch that (1) updates the inbound `airbnb_messages/{id}` doc — flipping `draftStatus` to `'sent'`, stamping `sentAt`, recording `editedReply`, and tagging `sentBy: caller.uid` — and (2) creates a separate outbound `airbnb_messages` doc with `direction: 'outbound_draft'`, `draftStatus: 'sent'`, `body: editedReply`, the same `threadKey` as the inbound, `source: 'reply-mark-sent'`, and `inboundMessageId: id` pointing back to the message being replied to. Idempotent: if the inbound is already `draftStatus === 'sent'`, the route short-circuits with `{ alreadySent: true }` and skips the outbound creation. Uses Next.js 15's `await params` pattern for the dynamic segment.

### Why

The reply-agent's thread query in `functions/index.js` reads `airbnb_messages` ordered by `threadKey`. Before this change, only inbound messages existed in that collection — the host's actual reply text never made it back into Firestore as a queryable document, so when a follow-up guest message arrived the AI had no record of what the host had previously committed to. Symptom: contradictions (AI offers Tuesday after the host already promised Monday) and repeated information (AI re-sends parking instructions the host has already replied with).

By recording the reply as an outbound doc with the same `threadKey`, the existing thread query now naturally returns both halves of the conversation, and `buildReplyInput` will surface the prior reply as part of `conversationHistory` on the next inbound. The voice-corpus query (which already reads `outbound_draft` + `draftStatus: 'sent'`) also picks up these new docs without modification, so the host's voice sample grows with every Mark-as-Sent click.

### Files

- `app/api/airbnb-messages/[id]/mark-sent/route.js` — created (3,267 chars). Single `POST` handler. No other files touched.

### Tests

No automated tests added in this task. The route is pure orchestration over Firestore primitives (`runTransaction` / `WriteBatch`); behavior will be covered by an end-to-end smoke when Task 2 wires the UI caller. Module-load and route-shape will be implicitly verified by Next.js' build-time route compilation when the dev server next boots.

### Implementation deviations from plan

- **Auth signature**: The plan specified `requireRole(...)` returning `{ ok, response, ...auth }`. The actual project convention (see `app/api/bookings/[id]/route.js`) returns `{ caller, error }`. The subagent adapted to the real signature: `const { caller, error: authError } = await requireRole(req, ['admin', 'cohost']); if (authError) return authError;`. Behavior is equivalent — 401 on unauthenticated, 403 on wrong role — just routed through the project's actual helper shape.
- **Audit field**: Added `sentBy: caller.uid` to the inbound update (not specified in the plan). Pure observability — does not affect the reply-agent thread query or the voice-learning corpus query. Acceptable scope creep; lets the admin Messages UI eventually attribute "sent by Julio" vs "sent by Maria" without a separate audit collection.
- **Atomic batch preserved**: Both writes (inbound update + outbound create) execute in a single `WriteBatch.commit()` as planned. No partial-write window.
- **Idempotency preserved**: The `inbound.draftStatus === 'sent'` short-circuit is intact; double-clicking Mark-as-Sent will not create duplicate outbound docs.
- **Outbound doc shape preserved**: `direction: 'outbound_draft'`, `draftStatus: 'sent'`, `body: editedReply`, `threadKey: inbound.threadKey`, `source: 'reply-mark-sent'`, `inboundMessageId: id` — all per plan.
- **Next.js 15 `await params` preserved**: Dynamic segment unwrapped via `const { id } = await params` per the framework's current contract.

### Acceptance criteria coverage (from plan)

- ✅ Atomic batch updates inbound + creates outbound (both writes succeed or both fail).
- ✅ Outbound doc carries the same `threadKey` as its inbound parent (reply-agent thread query will return both).
- ✅ Outbound doc shape (`direction`, `draftStatus`, `body`, `source`, `inboundMessageId`) matches what the voice-corpus query already filters on.
- ✅ Idempotent under double-submit (`alreadySent: true` on second call, no duplicate outbound).
- ✅ Auth-gated to admin/cohost.
- ⚠️ End-to-end conversation-history feedback into the reply-agent — code path is in place, but not exercised in production until Task 2 wires the UI caller.

### Caveats / follow-ups

- **API route exists but no UI caller is wired yet.** Task 2 wires the admin Messages page button. Until Task 2 lands, this route is dead code from the user's perspective: it responds correctly when called directly (e.g. via `curl` with a valid admin token) but no production code path invokes it.
- **Vercel deploy posture**: The Vercel deploy will pick up Task 1 + Task 2 together. There is no benefit (and no harm) to deploying Task 1 alone, since with no caller there is no behavior change in production.
- **No Firestore rules change required**: writes to `airbnb_messages` from server-side admin-SDK code bypass client rules. The route runs server-side under the Next.js runtime with admin credentials.

---

## Task 2 — Wire admin Messages page to call mark-sent route

**Date**: 2026-05-08
**Commit**: [`138f62f`](../../../) — `feat(admin/messages): handleMarkSent calls /api/airbnb-messages/{id}/mark-sent`

### What changed

Replaced the body of `handleMarkSent` in `app/admin/messages/page.js` with an authenticated `fetch` to the new server-side route from Task 1. The function now grabs an ID token via `auth.currentUser.getIdToken()`, POSTs to `/api/airbnb-messages/{id}/mark-sent` with `{ editedReply }` in the JSON body and an `Authorization: Bearer <token>` header, and surfaces server errors back through the existing toast/error UI. The function declaration line and surrounding `try { ... } catch { ... } finally { ... }` braces are unchanged — only the inner block was swapped. The existing `auth` import at line 15 (`import { db, auth } from '@/lib/firebase';`) was already in place from prior work, so no import line touched.

### Why

Task 1 built the server-side dual-write but left it as dead code with no caller. This task moves Mark-as-Sent off the direct client-side `updateDoc` path and onto the API route, so the host's reply now lands in Firestore as both an inbound update and a separate outbound `airbnb_messages` doc. With this commit, the full Item 3 flow is functionally complete in the local repo — once main is pushed and Vercel deploys, real users hitting Mark-as-Sent will produce both docs, the reply-agent's thread query will return both halves of the conversation on the next inbound, and the AI will see what the host already replied with instead of contradicting or repeating it.

`handleRegenerate` and `handleEscalate` were intentionally not touched. They still use direct client-side `updateDoc`, which is correct: regenerate just resets `draftStatus` to `'pending'` (no audit trail or outbound doc needed), and escalate just flips it to `'escalated'` (no outbound message to record). Mark-as-Sent is the only handler that needed the dual-write.

### Files

- `app/admin/messages/page.js` — modified (15 insertions, 4 deletions). Sole file in the commit. Resulting file is 35,554 chars and reads cleanly.

### Tests

No automated tests added. Smoke verification done at the source level: file reads cleanly, `handleMarkSent` contains the `fetch` call, and the old `updateDoc(...) draftStatus: 'sent'` pattern has zero remaining matches in client-side code (the static `DRAFT_STATUS_CONFIG.sent` object remains, which is intentional — it's a UI label/colour map, not a write call). End-to-end behavior will be exercised in Task 3 production smoke after deploy.

### Acceptance criteria coverage (from plan)

- ✅ Mark-as-Sent (after deploy) produces an outbound doc with the same `threadKey` — UI now calls the route that does the dual-write.
- ✅ Idempotent — server-side guard from Task 1 still applies; double-click is safe.
- ✅ Voice-learning loop preserved — the inbound update path is unchanged from the user's perspective; the route just writes through the server instead of the client.
- ✅ Voice corpus query picks up new docs — outbound docs carry `direction: 'outbound_draft'` + `draftStatus: 'sent'`, the same values the existing voice-corpus query already filters on.
- ⏳ Reply-agent thread context includes outbound docs — code path complete, awaiting Task 3 production smoke.
- ⏳ Admin UI renders outbound doc inline in the thread — awaiting Task 3 production smoke.

### Caveats / follow-ups

- **Deploy still pending.** The new flow only takes effect once main is pushed and Vercel rebuilds. Until then, production users still hit the old direct-`updateDoc` code path (because Vercel is still serving the previous build), and no outbound docs are being created in production yet. The local repo is functionally complete; deployment closes the loop.
- **Task 3 (production smoke)** is the validation gate: confirm an outbound doc lands when Mark-as-Sent is clicked, confirm the reply-agent picks it up on the next inbound, and confirm the admin Messages UI renders both halves of the thread.
- **Not touched by design**: `handleRegenerate`, `handleEscalate`. If a future change needs an audit trail for those transitions, they'll need their own server-side routes — but that is out of scope for Item 3.

---

## Production Status — DEPLOYED 2026-05-08, manual UI smoke pending

**Vercel pipeline**: `dec6f744` (earlier today) — first build that carried the Item 3 changes (Task 1 route + Task 2 UI wiring) into production. ✅ Deployed.
**Lambda**: not in scope for Item 3 (outbound capture is purely Vercel + Firestore).
**API route status**: `/api/airbnb-messages/{id}/mark-sent` is live and reachable in production. Auth-gated — anonymous calls return 401, non-admin/cohost calls return 403. Smoke-tested at the route-shape level (404 vs 401 discrimination on a known-bad id) but **not** end-to-end against a real production message.

### Manual UI smoke ⏳ deferred

The plan's Task 3 smoke gate requires Julio to click Mark-as-Sent in the admin Messages UI on a real production message. This step is intentionally human-in-the-loop:

- It validates the **full** flow (UI button → ID-token fetch → server route → atomic batch → both docs land) in a single user-observable action.
- It avoids the need to fabricate a synthetic `airbnb_messages` doc + draft just to click a button (which would then have to be cleaned up across two docs and the thread query).
- It exercises the Mark-as-Sent button's loading/error UI under real conditions.

### Verify script ready

`tasks/changes/option-a/item-3-logs/verify-mark-sent.js` is staged and will run 5 acceptance checks against the most recent `reply-mark-sent`-sourced outbound docs:

1. Outbound doc exists with `direction === 'outbound_draft'`.
2. Outbound `draftStatus === 'sent'`.
3. Outbound `threadKey` matches the inbound parent's `threadKey` (so the reply-agent's thread query returns both halves on the next inbound).
4. Outbound `inboundMessageId` points back to the inbound doc id.
5. Outbound `source === 'reply-mark-sent'` (so the voice-corpus query continues to filter as expected).

### Recommended next step

After Julio's next real Mark-as-Sent click, run:

```
node tasks/changes/option-a/item-3-logs/verify-mark-sent.js
```

If all 5 checks pass, Item 3 is closed. If any fail, the script's output narrows down which write went wrong (inbound update vs outbound create) without needing to dump raw Firestore docs.

---
