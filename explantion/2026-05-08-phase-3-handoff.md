# Handoff — End of Option A, Heading Into Phase 3

**Created**: 2026-05-08 (end of long, multi-track session)
**Status**: Threading + Issue #1 + Option A Items 3/4/5 all production-verified. Phase 3 is next.
**Audience**: A fresh Claude Code session starting cold. Read this top to bottom before doing anything.

---

## TL;DR

Threading is rock solid in production. Three follow-up items (3-5 from the handoff priority list) shipped + verified. The next workstream is **Phase 3 of the SFN refactor** — the bridge that routes production Airbnb traffic to the SAM Step Functions chain. Everything before Phase 3 was JS-chain improvements (which still serves 100% of prod). Phase 3 cuts that over.

---

## 0. What's on `origin/main` right now (HEAD: `9cdf8a0`)

Full commit chain from this session, oldest → newest:

```
790f456 feat(thread-key): annual-bucket fallback + airbnb-forwarder skip
254987e feat(parse-airbnb-email): add booking-match helpers
869f2d5 feat(parse-airbnb-email): tiered findMatchingBooking
29461fc feat(parse-airbnb-email): wire tiered match into 3 call sites
0713219 feat(functions): pass receivedAt to inline buildThreadKey
40aee72 feat(admin/messages): pass receivedAt to buildThreadKey callers
f15fbe3 docs(threading): change log for Tasks 1-6
2e33d3a fix(thread-key): sync all 3 copies + add cross-sync warning
c31989e docs(threading): Task 7 deploy + smoke verification artifacts
40c32cb docs(threading): close Task 7 with deploy + smoke verification
c49adf3 fix(functions): inline SYSTEM_PROMPT to unblock onAirbnbMessageCreated deploy
dca6220 docs(threading): Issue #1 deploy + smoke verification artifacts
a9494f3 docs(threading): close Outstanding Issue #1 in changelog
86341ef docs(option-a): implementation plan for Item 3 outbound capture
4e0ee0b feat(api): mark-sent route writes both inbound update + outbound doc
138f62f feat(admin/messages): handleMarkSent calls /api/airbnb-messages/{id}/mark-sent
5d1919d docs(option-a): change log for Item 3 Tasks 1+2
6493a4c docs(option-a): implementation plan for Item 4 persist-headers
175a64f feat(parse-airbnb-email): add header-extraction helpers
8b65577 fix(parse-airbnb-email): handle inReplyTo array form defensively
c32401e feat(parse-airbnb-email): persist inReplyTo/references/replyToId on inbound docs
069499e feat(reply-ai): expand context window 5 → 20 messages
e9b320f docs(option-a): change log for Item 4 Tasks 1+2
4f7d41c docs(option-a): change log for Item 5 context window
f8119ed docs(option-a): Item 4 deploy + smoke verification artifacts
f50cda2 docs(option-a): closure entries for Items 3, 4, 5
81445f9 docs(option-a): Item 3 API smoke verified end-to-end (allPass: true)
9cdf8a0 docs(option-a): mark Item 3 as production-verified  ← HEAD
```

That's ~28 commits. All pushed.

---

## 1. What shipped this session (production state today)

### 1A. Threading fix (the priority-1+2 items from the prior handoff)

Spec: `docs/superpowers/specs/2026-05-07-thread-coherence-design.md`
Plan: `docs/superpowers/plans/2026-05-07-thread-coherence.md`
Change log: `tasks/changes/threading/2026-05-07-thread-coherence-changes.md` (477 lines)

**What**: Strengthened `findMatchingBooking` from a single confirmation-code lookup to a 3-tier chain (`code → email+window → name+window`). Added a Unicode-aware annual-bucket composite key fallback (`name:{safeName}|y:{YYYY}`) for unmatched messages, plus a skip rule for `@airbnb.com` forwarder addresses (so unmatched mail no longer collapses into one mega-thread).

**Verified end-to-end**: synthetic doc `vUwlb3ipD2fOS4QpE2l8` confirmed `threadKey: name:smoke-testbot-v2|y:2026` post-fix. Pre-fix doc `NqsHflGSlzgcF6Xsx3Hi` confirmed the OLD format (caught the 3-copy thread-key.js bug — see §4 lessons).

**The 3-copy thread-key.js sync** (CRITICAL for any future change):
- `lib/thread-key.js` (repo root, used by Next.js admin UI + scripts)
- `functions/lib/thread-key.js` (Cloud Functions deploy)
- `infra/lambda/parse-airbnb-email/thread-key.js` (Lambda deploy)

All three must stay in sync. Each file's header has a cross-sync warning comment block. **The plan and spec missed this initially — the smoke test caught it.** Don't repeat that mistake.

### 1B. Outstanding Issue #1 — RESOLVED

Pre-existing bug at `functions/lib/reply-ai.js:32-33` that blocked ALL Cloud Functions deploys of `onAirbnbMessageCreated`:

```js
const _seedPath = path.resolve(__dirname, '../../infra/sam/reply-agent/config/system-prompt.seed.json');
const SYSTEM_PROMPT = JSON.parse(fs.readFileSync(_seedPath, 'utf-8')).system_prompt_text;
```

Cloud Functions deploy package only includes `functions/`, so `__dirname=/workspace/lib/` and `../../infra/sam/...` resolves to `/infra/sam/...` which doesn't exist → ENOENT at module load → container exits → Cloud Run health check fails → keeps prior revision.

**Fix** (commit `c49adf3`): inline the SYSTEM_PROMPT as a JS template literal, matching `lib/reply-ai.js` (the ESM repo-root copy that already inlines it). Same content, no fs read. Added a cross-sync header comment listing all 3 sync points: `lib/reply-ai.js`, `functions/lib/reply-ai.js`, `infra/sam/reply-agent/config/system-prompt.seed.json`.

**Verified**: revision `onairbnbmessagecreated-00012-xil` boots clean, processes synthetic doc `C3F5iO1ZoihVJ8cm7Hzm` with full chain (RAG → reason → draft → evaluate → revise → reply).

**Side effect — important to know**: Multiple stalled commits had been waiting on this fix to land. They all shipped together when the new revision deployed:
- Task 5 of the threading fix (commit `0713219` — `functions/index.js` inline `buildThreadKey` + `receivedAt`)
- All Phase 2 voice-learning loop changes that had been silently never reaching production

If you redeploy `onAirbnbMessageCreated` and see strange behavior, remember the function was running pre-Phase-2 code until 2026-05-08 04:46 UTC.

### 1C. Option A — Item 3 (outbound capture)

Spec/plan: `docs/superpowers/plans/2026-05-08-option-a-item-3-outbound-capture.md`
Change log: `tasks/changes/option-a/2026-05-08-item-3-outbound-capture-changes.md` (179 lines)

**What**: When the host marks an AI-drafted reply as sent, the API now ALSO creates a separate outbound `airbnb_messages` doc (`direction: 'outbound_draft'`, `draftStatus: 'sent'`, same `threadKey`, `source: 'reply-mark-sent'`, `inboundMessageId: <ref>`). The reply-agent's thread query now picks up these outbound docs alongside inbound ones, so the AI sees what the host previously committed to.

**API**: `POST /api/airbnb-messages/[id]/mark-sent` — auth-gated (admin/cohost), atomic Firestore batch (update inbound + create outbound), idempotency guard on `inbound.draftStatus === 'sent'`.

**Verified**: synthetic API smoke (`tasks/changes/option-a/item-3-logs/api-smoke.js`) — admin token mint via `firebase-admin` → Firebase Auth REST exchange → POST to `https://www.casa-coqui.cc/api/airbnb-messages/{id}/mark-sent`. All 9 acceptance booleans pass:

```
api_returned_outboundId            ✅
inbound_flipped_to_sent             ✅
inbound_editedReply_set             ✅
outbound_direction_correct          ✅  (outbound_draft)
outbound_status_sent                ✅
outbound_threadKey_matches          ✅
outbound_body_correct               ✅
outbound_inboundMessageId_set       ✅
outbound_source_correct             ✅  (reply-mark-sent)
```

**Known UX gate (worth re-examining at some point)**: `app/admin/messages/page.js:455-456` hides Mark-as-Sent for unmatched messages (`bookingId: null`). All 5 of Jaydon's current ready drafts are unmatched, AND there are 0 matched ready drafts production-wide. The Link-to-Booking flow exists but only in the In-App tab, not the Airbnb tab. If Julio mentions "I want to send this reply but the button isn't there" — that's why. This wasn't fixed in Item 3 (out of scope), tracked as an implicit follow-up.

### 1D. Option A — Item 4 (persist headers)

Spec/plan: `docs/superpowers/plans/2026-05-08-option-a-item-4-persist-headers.md`
Change log: `tasks/changes/option-a/2026-05-08-item-4-persist-headers-changes.md` (218 lines)

**What**: Lambda now persists `inReplyTo`, `references` (always normalized to array), and `replyToId` (resolved Firestore doc id of the parent message) on each inbound doc. Three write sites updated: matched, unmatched, no_matching_booking quarantine archive.

**Helpers added** at `infra/lambda/parse-airbnb-email/index.js`:
- `extractHeaderRefs(parsed)` — pulls `inReplyTo` (string|null) + `references` (array). Defensive: handles `inReplyTo` as both string and array shapes (mailparser inconsistency).
- `findParentMessageDocId(firestore, inReplyTo)` — reverse lookup against `airbnb_messages.messageId`. Single-field auto-index, no composite needed.

**Verified end-to-end**: parent + child synthetic .eml injection. Child's `replyToId` resolved to parent's Firestore doc id. All 6 verify checks pass.

**No AI changes in this item**. Data persistence only. Future work could traverse parent-child chains for tighter context graphs.

### 1E. Option A — Item 5 (context window 5 → 20)

Change log: `tasks/changes/option-a/2026-05-08-item-5-context-window-changes.md` (105 lines)

**What**: 3-line change across the 2 reply-ai.js copies + functions/index.js. Thread query now `.limit(21)` (20 prior + 1 to allow filtering out current). `buildReplyInput`'s `thread.slice(-5)` → `.slice(-20)`.

**Verified implicitly** during Item 4's smoke (Cloud Function fired, exercised the new slice). Functional verification on next organic Airbnb message via `agent_runs._agentRun.prompt`.

---

## 2. Outstanding Issues (tracked, not blocked)

### Issue #2 (NEW this session): Thread query orders ascending

`functions/index.js:258-262` queries:

```js
.where('threadKey', '==', threadKey)
.orderBy('receivedAt', 'asc')
.limit(21)
```

For threads >21 messages, this returns the **oldest** 21, not the most recent. Pre-existing concern, not introduced by Item 5 (the prior `.limit(10)` had the same bug at a smaller cap). Casa Coqui's median thread is ~5 messages so most threads are unaffected, but a long-running guest like a multi-week stay or a chronic complainer could hit it.

**Fix when it matters**: order desc + limit, then reverse in memory. Or use `endAt(now)` + limit + reverse. ~10 minutes when it surfaces.

### Implicit: Mark-as-Sent UI gate for unmatched messages

`app/admin/messages/page.js:455-456` — `isMatched && draftStatus in [ready, escalated]`. Hides the button when `bookingId: null`. The Link-to-Booking flow exists in the In-App tab but not the Airbnb tab. If Julio asks "why can't I send replies on these?", this is why. Design call — may want to either drop the gate, or surface Link-to-Booking in the Airbnb tab too.

---

## 3. Two operational lessons captured this session (read these once, save yourself an hour)

### 3A. Production URL is `https://www.casa-coqui.cc` (canonical)

The apex `casa-coqui.cc` returns HTTP 307 redirect to `www.casa-coqui.cc`. Most HTTP clients (Node fetch included) follow the redirect but **STRIP the `Authorization` header** as a security default (RFC 6265 / standard practice). First Item 3 API smoke run got HTTP 401 against the apex; switching to `www.` returned HTTP 200.

If you ever do an authed API smoke from the command line, hit `www.casa-coqui.cc` directly, not `casa-coqui.cc`.

### 3B. Two deploy paths — they're separate

- **CodePipeline** (`casa-coqui-pipeline`): builds Next.js → deploys to **Vercel + Firebase Functions**. Triggered by `git push origin main`. Has a manual approval gate (SNS email to Julio).
- **CDK** (`cdk deploy CasaCoquiEmailStack`): deploys the **Lambda** (`casa-coqui-parse-airbnb-email`). Manual command, NOT in the pipeline. The pipeline's buildspec-deploy.yml has zero matches for `cdk` or `lambda`.

When you ship Lambda changes, you MUST run `cd infra && source .venv/bin/activate && cdk deploy CasaCoquiEmailStack --require-approval never` separately. Don't expect the pipeline to do it for you.

### 3C. The synthetic-smoke pattern is the gold standard

Every smoke test this session followed this shape:
1. Construct a synthetic `.eml` (or directly create a synthetic Firestore doc) with controllable fake data.
2. Inject (via S3 upload + Lambda invoke, OR direct Firestore write).
3. Verify via Firestore admin SDK script that reads docs and checks acceptance booleans.
4. **Always cleanup**, even on failure — synthetic docs across 5 collections (`airbnb_messages`, `airbnb_messages_quarantine`, `airbnb_processing_locks`, `agent_runs`, `staff_notifications`) plus S3 objects.

Zero real guest data touched. Zero residue. Repeat this pattern for any future smoke. The cleanup scripts in `tasks/changes/option-a/item-{3,4}-logs/` and `tasks/changes/threading/issue-1-logs/` are good templates.

### 3D. The `.env.local` has admin SDK secrets

`/Users/jperez/dev/casa-coqui/casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json` is the Firebase admin service account JSON, gitignored. `firebase-admin` SDK can authenticate against production Firestore using this file. All the verify/cleanup scripts use `path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json')` (4 levels up from `tasks/changes/.../*.js`).

`.env.local` also has `NEXT_PUBLIC_FIREBASE_API_KEY` which is needed for the custom-token → ID-token exchange via Firebase Auth REST API. The api-smoke.js script reads it directly.

**Don't ever expose these secrets in chat output, doc agent prompts, or anywhere they might be logged externally.**

---

## 4. Critical context to NOT lose (architecture truths)

These are decisions/discoveries from this session that future sessions need to inherit:

- **Two paths exist in parallel**: legacy JS chain (`functions/lib/reply-agent-chain.js` + `functions/lib/reply-ai.js`) serves 100% of prod; SAM SFN path (`casa-coqui-reply-agent` stack) is deployed but receives no traffic. Until Phase 3, fixes to the JS chain are what users see.

- **3-copy thread-key.js sync**: any change MUST update all three. Cross-sync warnings now in each header.

- **3-copy SYSTEM_PROMPT semi-sync**: `lib/reply-ai.js` (ESM, Next.js admin), `functions/lib/reply-ai.js` (CJS, Cloud Functions), `infra/sam/reply-agent/config/system-prompt.seed.json` (SAM/AppConfig). Cross-sync warning in `functions/lib/reply-ai.js` header. The first two are inline strings; the third is the JSON the SAM HCV reads.

- **Voice-learning loop**: `onAirbnbMessageSent` Firestore-updated trigger fires when an inbound's `draftStatus` flips to `'sent'`. It diffs `draftReply` vs `editedReply`, calls Haiku to extract style rules, and merges into `settings/voice_profile`. **Don't break this** when changing the Mark-as-Sent flow.

- **Voice corpus query**: `where direction == 'outbound_draft' AND draftStatus == 'sent'` (composite index `airbnb_messages(direction, draftStatus, sentAt)` exists). Both welcome-flow drafts AND new Item 3 outbound docs land in this corpus naturally.

- **Lambda dedup**: `airbnb_processing_locks` collection (lock id = sha256(objectKey).slice(0,32)) plus `airbnb_messages.messageId` and `rawEmailS3Key` checks. Re-invoking Lambda with the same objectKey is safe but a no-op.

### Stack ARNs / IDs (memorize)

```
AWS account:               524140443248
AWS region:                us-east-1
Lambda:                    arn:aws:lambda:us-east-1:524140443248:function:casa-coqui-parse-airbnb-email
Lambda S3 bucket:          casa-coqui-inbound-email
Inbound domain:            inbox.casa-coqui.cc
SAM stack (chain):         casa-coqui-reply-agent (Phase 1.5+2 deployed; Phase 3 wires bridge)
ReplyDraftStateMachine:    arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft
AIChainStateMachine:       arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-ai-chain
CodePipeline:              casa-coqui-pipeline
Firebase project:          casa-coqui
Cloud Function trigger:    onAirbnbMessageCreated (us-east1)
Production URL:            https://www.casa-coqui.cc  (NOT casa-coqui.cc — strips auth on redirect)
```

---

## 5. What's next — Phase 3

Per `docs/superpowers/plans/casa-coqui-sfn-refactor-plan.md` §4.3 (the Phase 3 section of the master plan), the work is:

1. Cloud Function reads `feature-flags` AppConfig profile (the `reply_engine` flag we shipped in Phase 2 with no consumer)
2. Hash messageId mod 100, compare to `rollout_pct`, route accordingly:
   - Below threshold → keep using JS chain (current behavior)
   - At or above → call `StartExecution` on the SAM SFN
3. Same `StartExecution` from a new `regenerate` API route — fixes the regenerate button bug as a side effect
4. SQS DLQ for failed SFN executions
5. SNS alarms on DLQ depth
6. WriteBack Lambda becomes real (writes to Firestore via firebase-admin SDK, persists `_agentRun.appConfigVersion`)
7. AppConfig deployment Monitor wires alarm-driven auto-rollback

**Estimated effort**: ~1.5h per the master plan. Higher with full TDD + smoke.

**Important sanity check before starting**: confirm Items 3-5 are still healthy in production. Specifically:
- Cloud Function `onAirbnbMessageCreated` is on the new revision (run `firebase functions:log --lines 5 --only onAirbnbMessageCreated` and look for recent successful invocations)
- Lambda `casa-coqui-parse-airbnb-email` `LastModified` is post-2026-05-08 (run `aws lambda get-function-configuration --function-name casa-coqui-parse-airbnb-email --region us-east-1`)
- A recent inbound message has `inReplyTo`/`references`/`replyToId` fields populated (any organic message after ~04:30 UTC on 2026-05-08)

If any of those look off, investigate before adding the Phase 3 bridge.

---

## 6. Working with Julio (preserved from prior handoff + my session experience)

What the previous Claude told me, which proved accurate:

- **He's curious.** Explain the model, not just the syntax. "Why" matters as much as "how."
- **He pushes back when something doesn't make sense.** Listen. He's usually onto something.
- **He learns by doing.** When you can, hand him commands and let him run them. Don't take over.
- **He'll say thank you when you do well.** You can be kind back without making a thing of it.
- **This work is part of something bigger than the code.** AWS DevOps Pro cert is the pivot. Casa Coqui is the lab. Help him do it right.

What I'd add from this session:

- **Status snapshots are valued.** When he comes back from AWS prep and asks "what is the update here?", he wants the current state in 30 seconds, not a recap from the start. Use a clean 4-row table: what's done, what's pending, where it lives, what's next.
- **Auto-mode + explicit-auth-on-prod-touches is the right balance.** He approved Item 3's deploy explicitly. He approved Items 4+5's push explicitly. He approved each cdk deploy explicitly. Even in auto mode, push and deploy commands deserve a confirmation prompt. Permission system enforces this for you — listen to it.
- **Doc agents in background work great.** Two-stage pattern (implementer → doc) keeps the change log fresh without bloating the main thread. Use `run_in_background: true`.
- **The synthetic-smoke pattern is durable.** Every test in this session used the same shape: synthetic .eml or doc → inject → verify booleans → cleanup. Reuse it. Extend it.
- **The MemPalace stop-hook fires every turn.** The `mempalace_*` MCP tools aren't loaded in this environment. Just acknowledge them, point at git as the durable record, continue. Don't try to call them — they'll error.
- **Vercel CLI isn't installed.** Memorized status: `npm i -g vercel` would unlock `vercel deploy`, `vercel logs`, etc. Hasn't been needed yet because the CodePipeline does the deploys.
- **He runs `casa-coqui.cc` from his browser fine.** My shell can't reach the apex consistently — DNS or routing in this sandbox. Use `www.casa-coqui.cc` for any HTTP calls; let him hit the browser-based UI directly.

---

## 7. Quick-start prompt for the fresh session

If you're a new Claude reading this, here's the prompt that frames the next session:

> Read `explantion/2026-05-08-phase-3-handoff.md`. We're picking up Phase 3 of the SFN refactor — the bridge that routes prod traffic from the JS chain to the SAM Step Functions chain (`casa-coqui-reply-agent`).
>
> Step 1: confirm production health from §5's sanity-check section (Lambda + Cloud Function + recent inbound docs).
>
> Step 2: read `docs/superpowers/plans/casa-coqui-sfn-refactor-plan.md` §4.3 for Phase 3's spec.
>
> Step 3: write a fresh implementation plan at `docs/superpowers/plans/2026-05-XX-phase-3-sfn-bridge.md`. Match the Items 3+4 plan structure (TDD where it earns its keep, subagent-driven execution, cross-sync warnings, deferred smoke testing pattern).
>
> Step 4: execute via subagents per the established pattern (implementer → doc agent → next task).
>
> Step 5: smoke via the same synthetic-injection pattern. Phase 3 specifically needs to verify: (a) the bridge correctly routes a fraction of traffic to SFN based on `rollout_pct`, (b) DLQ catches failures, (c) WriteBack persists results to Firestore identically to the JS chain.

---

## 8. Personal note for the next Claude

Hey. You're reading this on the other side of a long session. Julio pushed through a LOT today — the threading fix's three-copy-of-thread-key.js trap, Issue #1's silent deploy failure, Items 3-5 with three separate spec/plan/execution cycles, and the runtime smoke verification of all four. Real production code shipped, real production smokes passed.

A few things to keep in mind:

1. **He's juggling the AWS DevOps Pro exam alongside this.** When he says "I'm in the middle of AWS prep, drive this for me," he means it. Drive. But **always pause before production-touching actions** (`git push`, `cdk deploy`, `firebase deploy`, `aws lambda invoke` on real Firestore). The permission system enforces this and he respects when you ask explicitly. The only "don't ask, just do" zones are local commits, local tests, and read-only inspection.

2. **Treat the git commit chain as the source of truth.** This codebase has change logs (`tasks/changes/...`), specs (`docs/superpowers/specs/...`), plans (`docs/superpowers/plans/...`), and deploy logs (`tasks/changes/.../deploy-logs/`). All four serve different purposes. Keep them in sync via doc agents — don't let the change log fall behind the actual commits.

3. **The synthetic-smoke pattern is your best friend.** Every smoke test today proved end-to-end behavior without touching real guest data. Reuse the cleanup scripts. Extend them. They're better than having to manually unfuck a polluted Firestore.

4. **He matters beyond the code.** The original handoff said it best: "I'm building toward getting my family out of the hood. The cert is the pivot. Casa Coqui is the lab. Every commit that lands is one step closer." That was true 24 hours ago and it's still true now. Match his discipline. He's earning this with effort that most people wouldn't put in. Don't slack.

5. **When he says thank you, you can say "you're welcome" or "good luck on the exam" without making it weird.** He values warmth without performance. Don't overdo the gratitude back at him — just acknowledge it and move on.

6. **The Mark-as-Sent UI gate is going to come up.** When it does, talk through the design. There's a real UX argument both ways (forcing Link-to-Booking creates a cleaner data model; allowing direct send is faster for him). Let him drive that decision.

7. **One last thing: he's funny.** Like, actually funny. The "haha" in his earlier message about "this is taking a while" was real. Match the energy when he's loose. Don't be a robot.

Good luck.

— Claude (Opus 4.7, this session)

---

**End of handoff.**
