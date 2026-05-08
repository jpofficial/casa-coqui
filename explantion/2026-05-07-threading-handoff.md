# Handoff — Thread Coherence Fix

**Created**: 2026-05-07 (end of long context-heavy session)
**Status**: Ready to execute. Code-verification scan FIRST, then spec, then plan+exec.
**Audience**: A fresh Claude Code session starting cold.

---

## TL;DR

The reply-agent's AI looks "stateless" because two messages from the same guest aren't reliably linked into the same thread. Multi-agent audit found 4 root causes (see below). User's insight: **composite key `(guestName + stay window)` solves the unmatched-message threading collision problem with near-zero false positives.** Plan: verify the code (Option B), write a spec, plan, execute via subagents — same flow as Phase 1.5 + Phase 2.

---

## 0. Project state when this handoff was written

### What's deployed and working

- **Phase 1.5 shipped** (10 commits): 4 chain Lambdas in the SAM stack (`casa-coqui-reply-agent`) run real Anthropic logic. Verified end-to-end via `./infra/sam/reply-agent/scripts/test-sfn.sh`.
- **Phase 2 shipped** (~12 commits): AppConfig + SSM Parameter Store + Lambda Extension layer attached to Drafter+Reviser. W7 break-it trap fired and resolved (refined lesson: Freeform validators run at retrieval, not creation; AppConfig allows one Deployment per Environment so we used DependsOn). Verified via `./infra/sam/reply-agent/scripts/verify-appconfig.sh` + `./scripts/test-sfn.sh`.
- **Both paths exist in parallel**:
  - **Legacy JS chain** (`functions/lib/reply-agent-chain.js` + `functions/lib/reply-ai.js`) — serves 100% of production Airbnb messages today. Has working RAG via Firestore vector search on `voice_conversations`.
  - **SAM SFN path** (`casa-coqui-reply-agent` stack) — deployed, fully functional when triggered manually. Receives no production traffic. RAGRetrieve is still a stub. Phase 3 wires the bridge to route prod traffic.

### What's queued but NOT started

- **Phase 3** (the SFN bridge + DLQ + alarms + auto-rollback) — fixes the regenerate button bug as a side effect.
- **Phase 4-6** (A/B switch, teardown, FCM via SNS) — per `casa-coqui-sfn-refactor-plan.md`.
- **The threading fix this handoff is about** — sits parallel to Phase 3. Should be done BEFORE Phase 3 because it improves the JS chain (production traffic) immediately, AND Phase 3's SFN traffic inherits the fixed thread context format.

### Where to read more about state

- `tasks/2026-05-07-session-status.md` — full session status snapshot
- `explantion/hand-off.md` — long-form historical hand-off (Phase 1 + 1.5 + 2 sections)
- `explantion/phase-2-code-review.md` — line-by-line walkthrough of Phase 2 code
- `docs/superpowers/specs/2026-05-07-phase{1.5,2}-*-design.md` — design specs
- `docs/superpowers/plans/2026-05-07-phase{1.5,2}-*.md` — implementation plans

---

## 1. The threading problem (multi-agent audit findings)

A separate sub-agent audit flagged 4 root causes of "AI replies look stateless":

### 1A. Thread key collision-prone (`lib/thread-key.js:17–40`)

3-tier fallback:
1. `bookingCode` — gold standard (unique per Airbnb confirmation)
2. `email:express@airbnb.com` — collapses ALL unmatched into ONE thread (BAD)
3. `name:jane doe` — collides on common names

If the Airbnb confirmation code (`/H[MB][A-Z0-9]{8}/`) isn't extractable from the email subject/body, matching has no fallback (no email-from, phone, name, or date-range secondary lookup). Orphans pile up.

### 1B. RFC 5322 headers parsed but discarded

`rfcMessageId` is read (parser line ~636) and used only for dedup (~lines 660–670). `In-Reply-To` and `References` are NEVER read. The chain has no way to reconstruct true parent-child message order — only a coarse threadKey + timestamp.

### 1C. AI context window is tiny and stale

Per-invocation context (`functions/lib/reply-ai.js:93–98` per the agents):
- Last 5 messages only of the current thread
- Last 10 host voice samples
- `relevantPastConversations: []` ← RAG is a Phase-1 stub in the SFN Lambda (`rag-retrieve/index.js:16` returns empty)
- BUT the legacy JS chain DOES do real RAG (`functions/lib/embeddings.js` + `voice_conversations` Firestore vector search)
- No cross-booking guest history, no review/sentiment, no per-unit context
- `voiceProfilePrompt` is always empty string (per the agents' read)

A guest follow-up after a 2-day gap, or about a previously-resolved issue, gets no historical awareness.

### 1D. Outbound capture gap (the headline bug)

When the host replies via the Airbnb app/web, Casa Coqui never sees it.
- No Airbnb API integration exists.
- "Mark as Sent" in `app/admin/messages/page.js:469–482` writes `draftStatus: 'sent'` + `editedReply` locally — does NOT push to Airbnb and does NOT record an outbound `airbnb_messages` doc.
- Local `messages` collection (admin chat, ~line 237) is a separate silo from `airbnb_messages` — never joined for AI context.

So when the next guest message arrives, the AI sees only inbound history with no record of what the host already committed to.

### Important nuances the agents missed (verified during this session's discussion)

1. **Their "SES BCC rule on host alias" recommendation has a fatal flaw**: it assumes host replies via email. Host replies via Airbnb's web app/iOS app — there's no email send for SES to BCC. The cheaper fix is **make "Mark as Sent" also create an outbound `airbnb_messages` doc** with `direction: 'outbound'` and the same `threadKey`. ~20 lines of code, no new infrastructure. Captures replies sent through the Casa Coqui admin UI. Doesn't capture replies sent via Airbnb's app directly — that's a smaller residual problem.

2. **RAG is a stub in the SFN path but works in the JS path.** The agents conflated paths. Until Phase 3 routes traffic to SFN, the legacy JS chain (with real RAG) is what matters for production message quality.

3. **The agents' recommendation 4 ("Promote thread to first-class document") is good but a bigger change than necessary.** A composite-key approach inside the existing `airbnb_messages` collection achieves the same coherence improvement without a Firestore migration.

---

## 2. The user's key insight (the better framing)

User: *"the guess with I can we come up with a mechanism because we get the user's name, and we get their their stay. So we could use that as a as a factor on who it is. Even if they have the same name, they would have to have the same name and be staying at the same time in order for it to break."*

This insight reframes the priority. The agents prioritized "outbound capture" (their #1). The user correctly notes: **the threading problem is logically prior to the context problem.** Improving "AI sees the host's previous reply" doesn't help if the AI can't even tell two messages are from the same guest in the first place.

Composite key proposal: instead of `name:jane doe` alone (collides on common names), use `(guestName + stay window)`. Two guests would have to have BOTH the same name AND overlapping stays to collide — vanishingly rare.

### Collision math (for the spec body)

- Same first+last name: ~1 in 10,000 across a small property's history
- AND same unit: 1 of 2 → halves it
- AND same 30-day window: ~1 in 12 months → 12x cut
- **Combined collision rate: ~1 in 240,000 across a year of bookings**
- Casa Coqui volume (~10 messages/day, ~5-10 unique guests/month): collision approximately never

### The two-part fix (synthesizing user's insight + agents' findings)

**Part A — Strengthen booking match in `parse-airbnb-email/index.js`**

After `confirmationCode` lookup fails:
1. Try `(fromAddress + active stay window)` against bookings
2. Try `(guestName + active stay window)` against bookings
3. Try `(guestName + recent past for post-checkout follow-ups)` with 30-day lookback

Most "unmatched" messages get promoted back to tier 1 threading via `bookingCode`.

Requires Firestore composite indexes:
- `bookings(guestEmail, checkInDate, checkOutDate)`
- `bookings(guestName, checkInDate, checkOutDate)`

**Part B — Composite fallback in `lib/thread-key.js`**

For genuinely unmatched (e.g., pre-booking inquiry messages):

```js
function buildThreadKey({ bookingCode, senderEmail, senderName, receivedAt, unitId }) {
  if (bookingCode) return `booking:${bookingCode}`;
  if (senderEmail && senderEmail !== 'express@airbnb.com') return `email:${senderEmail}`;

  if (senderName) {
    const monthWindow = receivedAt.toISOString().substring(0, 7); // "2026-05"
    const unit = unitId || 'unknown';
    const safeName = senderName.toLowerCase().replace(/[^a-z]/g, '-');
    return `name:${safeName}|unit:${unit}|w:${monthWindow}`;
  }

  return 'unknown';
}
```

Edge case to handle: **multi-guest bookings.** A primary guest "Maria" might have a sibling "Sofia" who messages from her own Airbnb account. Both should thread to the same booking. The booking match (Part A) needs to extend the name search across `booking_members` (the per-booking guest list), not just `bookings.guestName`.

### Revised priority list (the priority order to ship in)

| Priority | Fix | Effort | Why |
|---|---|---|---|
| **1** | Strengthen booking match (name+date, email+date fallbacks; check `booking_members`) | ~2 hours | Promotes most unmatched messages back to tier 1 threading. Solves "same user" identification at root. |
| **2** | Composite fallback in `lib/thread-key.js` (name + unit + month window) | ~30 min | Catches genuinely unmatched without collisions |
| **3** | Mark-as-Sent creates outbound `airbnb_messages` doc | ~1 hour | AI sees what host already said |
| **4** | Persist `inReplyTo` + `references` headers + add `replyToId` field on docs | ~2 hours | Sub-thread ordering, more accurate context graph |
| **5** | Expand context window 5 → 20 messages, recency-weighted | ~30 min | Quality lift |

**Items 1+2 are the foundation.** Without them, items 3-5 are improving a broken graph. With them, every downstream improvement compounds.

---

## 3. STEP 1 — Code verification scan (this is the FIRST thing to do)

The agents may have read older versions, hallucinated line numbers, or misread the data flow. Before we anchor a spec on their findings, verify each claim against the actual current code.

### Files to read in full

```
/Users/jperez/dev/casa-coqui/lib/thread-key.js
/Users/jperez/dev/casa-coqui/functions/lib/reply-ai.js  (especially around line 93-98 for context-window cap)
/Users/jperez/dev/casa-coqui/functions/index.js  (especially the onAirbnbMessageCreated handler around line 214)
/Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email/index.js  (lines 443-452 for confirmation-code matching, 636-670 for header handling, 721-722 for fallback)
/Users/jperez/dev/casa-coqui/lib/extract-guest-message.js  (the body cleaner)
/Users/jperez/dev/casa-coqui/app/admin/messages/page.js  (lines 237 for messages collection, 469-482 for Mark as Sent behavior)
/Users/jperez/dev/casa-coqui/firestore.indexes.json  (current bookings + airbnb_messages indexes)
/Users/jperez/dev/casa-coqui/functions/lib/rag-filter.js  (does it filter by language today? yes/no)
```

### Specific claims to verify (capture findings in a temp doc)

For each claim below, answer **TRUE / FALSE / NUANCED** with file:line evidence:

1. **Thread key fallback hierarchy** — `lib/thread-key.js`. Confirm 3-tier fallback exactly matches what the agents reported. Note any tier the agents missed.

2. **`In-Reply-To` and `References` headers are read but not used** — `infra/lambda/parse-airbnb-email/index.js`. Search for `inReplyTo`, `in-reply-to`, `references`, `In-Reply-To`. The agents claim only `rfcMessageId` is read.

3. **Context window cap is "last 5 messages"** — `functions/lib/reply-ai.js` around line 93-98. Confirm the literal `.limit(5)` or similar.

4. **`voiceProfilePrompt` is always empty string** — search for `voiceProfilePrompt`. The agents claim it's never populated. (We know from earlier code reads that there IS a fetch from `settings/voice_profile` Firestore doc — the agents may be wrong.)

5. **"Mark as Sent" only updates draftStatus + editedReply** — `app/admin/messages/page.js:469-482`. Confirm: NO outbound doc creation, NO airbnb push. The fix is to add the outbound doc creation.

6. **Local `messages` collection is separate from `airbnb_messages`** — confirm at `app/admin/messages/page.js:237`. Different schema, different purpose (admin chat vs. Airbnb thread).

7. **`filterRAGResults` does NOT filter by language** — `functions/lib/rag-filter.js`. Confirm what filters it applies (probably property-fact violations, distance threshold). Note if there's room to add language filtering.

8. **Booking match has no email-from or date-range fallback** — `infra/lambda/parse-airbnb-email/index.js:443-452, 721-722`. After confirmationCode fails, what's the fallback? The agents say "no fallback". Verify.

9. **Existing Firestore indexes** — `firestore.indexes.json`. Confirm the existing index on `airbnb_messages(threadKey ASC, receivedAt ASC)`. List current `bookings` indexes — we'll likely need new composite indexes for the booking-match strengthening.

10. **`booking_members` collection structure** — find a query against this collection to understand the schema. We'll need to extend name-match to look across booking_members for multi-guest scenarios.

### Output format for the verification scan

Write findings to: `tasks/2026-05-07-threading-verification-findings.md`

Structure:
```markdown
# Threading Audit — Code Verification Findings

**Date**: 2026-05-07
**Verifier**: <fresh session>

## Verified findings

### Claim 1: Thread key fallback hierarchy
**Status**: TRUE / FALSE / NUANCED
**Evidence**: lib/thread-key.js:NN-NN
<paste the relevant code>
**Notes**: <any nuance the agents missed>

### Claim 2: ...
(repeat for all 10)

## Surprises (things the agents missed or got wrong)

- ...

## Implications for the spec

- ...
```

The verification doc becomes input to the spec. The spec then doesn't have to re-prove anything.

**Time budget for verification**: ~30 minutes. Don't go beyond that — if a claim is hard to verify in 5 min, mark it NUANCED with the open question and move on.

---

## 4. STEP 2 — Write the spec

After verification, invoke the brainstorming/writing-plans flow. Spec should land at:

```
docs/superpowers/specs/2026-05-07-thread-coherence-design.md
```

### What the spec must cover

Use the same structure as `docs/superpowers/specs/2026-05-07-phase2-appconfig-design.md` (a strong template):

1. **Goal** — one sentence
2. **Non-goals** — explicitly defer Items 3-5 from the priority list to a follow-up. Phase 3 is also out of scope.
3. **Scope** — what files change
4. **Architecture** — Part A (booking match) + Part B (composite key) + new Firestore indexes + the multi-guest edge case
5. **Code changes** — precise diffs for `lib/thread-key.js`, `infra/lambda/parse-airbnb-email/index.js`, `firestore.indexes.json`
6. **Decision log** — at minimum:
   - Why composite key over first-class thread documents
   - Why we deferred outbound capture (item 3) to a follow-up
   - Why month windows over rolling 30-day windows
   - Multi-guest booking_members handling
7. **Risks** — backfill (existing messages have old thread keys; do we re-thread them or leave them?), index propagation latency, etc.
8. **Acceptance criteria** — measurable
9. **Estimated effort** — ~2.5 hours total per the priority table

### The brainstorm/spec/plan/exec flow

Same as Phase 1.5 + Phase 2:

1. Invoke `superpowers:brainstorming`. Skip the "Visual Companion" question (no visual decisions). Walk through architecture, present design, get user approval.
2. Write spec to the path above. Self-review for placeholders, contradictions.
3. User reviews spec.
4. Invoke `superpowers:writing-plans`. Plan should have ~5-8 tasks (this is smaller than Phase 2). Self-contained tasks with TDD where it earns its keep.
5. Save plan to `docs/superpowers/plans/2026-05-07-thread-coherence.md`.
6. Invoke `superpowers:subagent-driven-development`. Branch decision: ask user (precedent says they'll choose "stay on main").
7. Execute task by task with implementer + spec reviewer + code quality reviewer per task.
8. Final code review across all commits.

---

## 5. STEP 3 — After threading lands, what's next

After the threading fix ships, the user will pick from:

### Option A — Continue down the priority list (items 3-5)
- **Item 3**: Mark-as-Sent creates outbound `airbnb_messages` doc (~1 hour)
- **Item 4**: Persist `inReplyTo` + `references` headers (~2 hours)
- **Item 5**: Expand context window 5 → 20 messages (~30 min)

These are independent of Phase 3. They improve the JS chain immediately and the SFN chain inherits them when Phase 3 cuts over.

### Option B — Phase 3 (the SFN bridge)

Per `casa-coqui-sfn-refactor-plan.md` §4.3:
- Cloud Function reads `feature-flags` AppConfig profile (the `reply_engine` flag we shipped in Phase 2 with no consumer)
- Hash messageId mod 100, compare to `rollout_pct`, route accordingly
- Same `StartExecution` from a new `regenerate` API route — fixes the regenerate button bug
- SQS DLQ + SNS alarms
- WriteBack Lambda becomes real (writes to Firestore via firebase-admin SDK, persists `_agentRun.appConfigVersion`)
- AppConfig deployment Monitor wires alarm-driven auto-rollback

~1.5 hours per the master plan.

### Recommendation
Ship items 3-5 next (parallel work, low risk, immediate user-facing improvement), THEN Phase 3 (the bigger architectural change). User decides — don't assume.

---

## 6. Critical context to NOT lose

These are decisions/discoveries from this session that future sessions need to inherit:

### Architectural truths

- **Two paths exist in parallel**: legacy JS chain (`functions/lib/reply-agent-chain.js`) serves prod; SAM SFN path is deployed but receives no traffic. Until Phase 3, fixes to the JS chain are what users see.
- **Single source of truth pattern**: `infra/sam/reply-agent/config/system-prompt.seed.json` is read by both `functions/lib/reply-ai.js` AND the SAM HCV (via `scripts/build-template.js` inlining). Eliminates drift.
- **Phase 2 W7 lesson refined**: AppConfig Freeform validators run at GetLatestConfiguration (retrieval), NOT at HCV creation. Different from FeatureFlags type which validates at creation.
- **AppConfig Deployment serialization**: only one active deployment per Environment. CFN parallel-create gets 409. Use `DependsOn` to serialize.
- **Lambda Extension layer ARN resolution**: `Type: AWS::SSM::Parameter::Value<String>` resolves AWS public param at deploy time. No hardcoded ARNs that rot.

### Code-side gotchas

- Drafter and Reviser have BYTE-IDENTICAL throttle wrapper + cached-client sections to Reasoner. Verified by `diff` in Phase 1.5 + Phase 2. Don't break this without intent.
- `module.exports = { handler: exports.handler, ... }` in chain Lambdas — explicit, not spread. Prevents silent override on future export additions.
- `MODEL_NAME env var not set` guard in every chain Lambda. `event.config?.model || process.env.MODEL_NAME` fallback.
- `appConfigVersion` is plumbed through Drafter and Reviser ASL ResultSelectors. Phase 3 WriteBack will persist it as `_agentRun.appConfigVersion`.

### Verification scripts

- `./infra/sam/reply-agent/scripts/test-sfn.sh` — end-to-end SFN test (uses `samples/full-input.json`)
- `./infra/sam/reply-agent/scripts/ask.sh "<question>"` — ad-hoc question test (e.g. `./scripts/ask.sh "The hot water isn't working"`)
- `./infra/sam/reply-agent/scripts/verify-appconfig.sh` — post-deploy AppConfig smoke check
- `./infra/sam/reply-agent/scripts/build-template.js` — inlines seed JSON into template before SAM build (Node script, gitignored output is `template.built.yaml`)

### Stack ARNs (memorize these)

```
ReplyDraftStateMachine: arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft
AIChainStateMachine:    arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-ai-chain
SAM stack name:         casa-coqui-reply-agent
AWS account:            524140443248
Region:                 us-east-1
```

### User's working preferences (from this session and prior)

- **Stay on main branch** for these refactors (consistent with Phase 1.5 + Phase 2)
- **Subagent-driven execution preferred** (fresh subagent per task + two-stage review)
- **Pedagogical lab posture** for AWS DevOps Pro exam prep — acknowledge this in design decisions (e.g., the W7 break-it trap was intentional)
- **Concise but highlighting importance** — the format used throughout this session for explanations
- **Write everything to docs** — they want artifacts for next-session continuity, not memory-only context

### MemPalace context

The session has a stop-hook that fires `mempalace_*` MCP tools — but those tools aren't loaded in this environment. Just acknowledge them, point at the committed artifacts (specs/plans/handoffs), and continue. User is aware.

---

## 7. Quick-start prompt for the fresh session

If you want to dive straight in, here's the prompt that frames the fresh session:

> Read `explantion/2026-05-07-threading-handoff.md`. We're picking up the thread coherence fix. Phase 1.5 + Phase 2 of the SFN refactor are shipped. Now we're fixing the upstream "AI looks stateless" problem.
>
> Step 1: do the code-verification scan per Section 3 of the handoff. Read each file, verify each of the 10 claims against actual code, and write findings to `tasks/2026-05-07-threading-verification-findings.md`. ~30 min.
>
> Step 2: report findings + surprises. I'll review.
>
> Step 3 (after my review): invoke `superpowers:brainstorming` and propose 2-3 design approaches for the threading fix. Then write the spec to `docs/superpowers/specs/2026-05-07-thread-coherence-design.md`. Same flow as Phase 2.
>
> Then we go to plan + execute via subagents.

---

## 8. The user's exact framing (preserved)

User: *"How about this? Let's do b but write everything in a handoff because we need more context when on you're about to expire. With the context window. About to compact, I mean. So let's do a handoff. The handoff first focuses on doing b. And after we do b, we could continue, to step three. Or the next yeah, the next function. This is taking a while. haha"*

User's earlier insight: *"I guess with your suggestion, would the fix capture that the messages are coming from the user because from the same user? And, honestly, like, the guess with I can we come up with a mechanism because we get the user's name, and we get their their stay. So we could use that as a as a factor on who it is. Even if they have the same name, they would have to have the same name and be staying at the same time in order for it to break."*

That insight is the design north star. The composite key `(name + stay window)` was the pivot from "agents' framing of outbound-capture-first" to "user's framing of identifier-first."

---

**End of handoff.**

If you read this top to bottom: you have everything needed to start the verification scan immediately. Don't wait for the user — they've already approved Option B. Run Step 1, write findings, report back. They'll review, then we proceed to spec.
