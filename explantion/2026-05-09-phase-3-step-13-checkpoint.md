# Checkpoint — Phase 3 Steps 12 + 13 Landed (Step 14+ Pending)

**Created**: 2026-05-09 (continuation of `2026-05-09-phase-3-w7-trap-fired-handoff.md`)
**Status**: Steps 12 + 13 verified end-to-end. Working tree has 2 uncommitted files. Step 14 is next.
**Audience**: Fresh Claude Code session resuming Phase 3 from Step 14.

---

## TL;DR

The W7 trap is closed. The synthetic SFN execution succeeded end-to-end with the Firestore writeback verified. Step 12's IAM grant deployed cleanly; Step 13 surfaced (and resolved) a previously-masked test-fixture gap that was *not* in the original handoff. Two uncommitted files sit on the working tree. Steps 14-17 remain — they are mechanical (regex, sweep, cross-cloud merge, smoke).

---

## 0. Production state right now

- **SAM stack `casa-coqui-reply-agent`**: `UPDATE_COMPLETE` at `2026-05-09T21:58:12Z`
- **`WriteBackFunctionRole`** now carries inline policy `WriteBackFunctionRolePolicy0`:
  - Action: `secretsmanager:GetSecretValue`
  - Resource: `arn:aws:secretsmanager:us-east-1:524140443248:secret:casa-coqui/firebase-service-account-*`
- **All 4 Phase 3 alarms**: `OK` (`reply-draft-executions-failed`, `bridge-route-failures`, `anthropic-throttles`, `reply-draft-latency-p95`)
- **`BridgeIamUser`**: exists, no access key generated yet (Step 16's job)
- **AppConfig `feature-flags.reply_engine.rollout_pct`**: `0` (no organic traffic to SFN until Phase 4)
- **Cloud Function bridge code**: written + tested locally on `feat/phase-3-sfn-bridge`, NOT yet deployed to production (Step 16 ships it)

---

## 1. What landed in this session

### 1A. Step 12 — Restore the secretsmanager grant

Reverted the W7-trap explainer comment block in `infra/sam/reply-agent/template.yaml` and restored the original Phase 1 inline `Policies` block on `WriteBackFunction`:

```yaml
Policies:
  - Version: '2012-10-17'
    Statement:
      - Effect: Allow
        Action: secretsmanager:GetSecretValue
        Resource:
          - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${FirebaseSecretName}-*
```

Diff was the inverse of W7 trap commit `7c2c793`. Reviewed by three independent agents (Plan agent for handoff fidelity, general-purpose for IAM correctness, firebase-auth for cross-cloud scope) — all green.

Built and deployed via the standard chain:
```bash
node scripts/build-template.js
sam build -t template.built.yaml
sam deploy --confirm-changeset
```

Stack went `UPDATE_COMPLETE` cleanly. Verified the inline policy is exactly what we wrote.

### 1B. Impromptu Step 12.5 — Test fixture seeding

The first synthetic execution after Step 12 **FAILED** with:

```
5 NOT_FOUND: No document to update:
projects/casa-coqui/databases/(default)/documents/airbnb_messages/sample-001
```

This was *not* an IAM problem — the error type changed from `AccessDeniedException` to `NOT_FOUND`, which is strong evidence Step 12 worked. The Lambda fetched the secret, initialized firebase-admin, made a gRPC call, and Firestore replied "document doesn't exist."

**Root cause investigated**:
- `sample-001` is a synthetic ID introduced by Phase 1.5's PII-sanitizing input builder (`scripts/build-sfn-sample.js`) — it rewrites the real message ID to `sample-001` and the real guest name to `Tester` in `samples/full-input.json`
- No corresponding Firestore doc was ever expected to exist
- Phase 1.5's chain (Reasoner / Drafter / Evaluator / Reviser) doesn't touch Firestore, so the gap was invisible
- Phase 3 introduced WriteBack but the W7 IAM trap masked the gap until now
- **The original handoff implied SUCCEEDED was achievable without seeding — that was a documentation gap**

**Fix — new file `infra/sam/reply-agent/scripts/seed-sample-001.js`**:
- Idempotent (uses `{ merge: true }`)
- Marks doc with `_seedFixture: true` so it's clearly identifiable in Firestore queries
- Sets `editedReply: ''` so WriteBack's skip-gate doesn't trigger
- Mirrors the schema in `samples/full-input.json` (body, guestName, threadKey)

**One-time developer-machine setup required to run any firebase-admin script**:
```bash
gcloud auth application-default login
gcloud config set project casa-coqui
gcloud auth application-default set-quota-project casa-coqui
```

Note: this is **separate** from `gcloud auth login` (which is for the gcloud CLI itself) and from `firebase login` (which is for the firebase CLI). Three different Google auth systems, three different commands.

### 1C. Step 13 — Synthetic execution end-to-end

After seeding, re-fired the synthetic execution.

- **Execution name**: `phase3-trap-fixed-verify-1778365636`
- **Status**: `SUCCEEDED` in 26 seconds
- **All Firestore writeback acceptance criteria pass**:

| Field | Value |
|---|---|
| `_agentRun.routedBy` | `'rollout-routed'` |
| `_agentRun.executionArn` | (correct ARN) |
| `_agentRun.appConfigVersion` | `'1'` (AppConfig client successfully loaded) |
| `_agentRun.inputTokens` | 7864 |
| `_agentRun.outputTokens` | 934 |
| `_agentRun.latencyMs` | 20398 |
| `draftStatus` | `'ready'` |
| `draftReply` | populated |

The actual generated draft:

> Hi Tester, checkout is at 11am. Your parking spot is right in front of the gate—park diagonally. We have space for two cars. Let me know if you need a late checkout. 🙏🏼

Voice quality solid (opens with name, ~30 words near the 26-word median, signature "Let me know if…", correct emoji 🙏🏼). **One violation**: an em-dash in "the gate—park diagonally". Em-dashes are on the HARD BAN list. Phase 3.5 quality-monitor concern, not blocking Phase 3.

### What this proves

The chain executed end-to-end — meaning all of these worked:

1. AppConfig Extension fetched system prompt (the IAM debugging arc paid off)
2. Reasoner → Drafter → Evaluator → Reviser chain ran with proper token threading
3. `$$.Execution.StartTime` and `$$.Execution.Id` correctly passed through ASL Payload to WriteBack (F13)
4. WriteBack fetched the Firebase service-account from Secrets Manager (Step 12 IAM grant)
5. firebase-admin initialized cross-cloud
6. Token aggregation across stages worked
7. Firestore `update()` with dotted-path notation worked
8. SFN execution returned the correct output payload

**The hard part is genuinely done.**

---

## 2. Uncommitted on working tree

| File | Change | Recommended commit |
|---|---|---|
| `infra/sam/reply-agent/template.yaml` | Step 12 IAM grant restoration | `fix(sam/reply-agent): restore secretsmanager grant — closes W7 trap` |
| `infra/sam/reply-agent/scripts/seed-sample-001.js` | NEW: Firestore test fixture seeder | `chore(sam/reply-agent): add Firestore seed script for synthetic SFN tests` |

Two clean commits before Step 14 keeps history readable.

---

## 3. Notes captured this session

- `tasks/2026-05-09-ai-response-guardrails.md` — voice quality observations for Phase 3.5. Captures the em-dash violation pattern, recommends a deterministic post-generation HARD BAN linter, ties to Decision 14.

---

## 4. Concurrent investigation (out of scope for this checkpoint)

Julio observed inbound emails appearing as individual messages instead of threaded conversations and asked whether unpushed Phase 3 commits were the cause. Quick git audit confirmed:

- Threading work is **fully shipped on main**: Tasks 1-7, Issue #1, Item 3 (outbound capture), Item 4 (persist headers `inReplyTo`/`references`/`replyToId`)
- Last threading-related commits: `c32401e`, `8b65577`, `f8119ed`, `9cdf8a0`
- `feat/phase-3-sfn-bridge` does NOT touch threading
- **Pushing Phase 3 will not fix the threading display issue**

A separate diagnostic investigation runs in parallel to this checkpoint write.

---

## 5. Future flow idea raised but not specced — Gmail Resolutions Drafter

During this session Julio asked whether the now-working SFN chain could power a separate flow for AirCover resolution emails. Captured here so the idea doesn't evaporate.

**The idea**: when a resolution email arrives at `01juliop@gmail.com` (sender = `resolutions@airbnb.com`), route it through SFN to draft a response, but the response goes to **Gmail as a draft** (not an Airbnb DM via Firestore writeback).

**Recommended architecture (Option 3)**: keep the existing SFN; add a `_target` discriminator on the input; ASL adds a `Choice` state at the end branching on `$._target`:
- `_target = 'firestore'` (current default) → existing `WriteBackToFirestore`
- `_target = 'gmail-draft'` (new) → new `WriteBackToGmail` Lambda calling Gmail API `users.drafts.create`

The chain (Reasoner / Drafter / Evaluator / Reviser) is voice-agnostic — voice flows in via input. Resolution voice prompt would be different (formal, claim-ID aware, no emojis, "Please advise" instead of "Let me know"). New voice samples would need to be mined from Julio's prior AirCover responses.

**Phase home**: Phase 5+, after Phase 4 hits 100% on the existing guest-DM flow. Not now.

**Open questions for spec time**: Gmail OAuth vs service account, threading (reply-in-thread vs new compose), auto-send vs always-draft, voice sample mining script, deadline-sensitive failure path (separate SNS topic?).

---

## 6. What's next — Steps 14-17

### Step 14 — AppConfig validator regex (~5 min)
Update `FeatureFlagsProfile.Validators` in `template.yaml` to constrain `mode` enum to `^(firebase|aws-sfn)$`. Test by attempting a `mode: shadow` HCV creation — AppConfig should reject. Then verify normal `mode: firebase` content deploys cleanly.

### Step 15 — Final SAM verify (~5 min)
Sanity sweep through spec acceptance criteria #1-#16. Check each is satisfied in the deployed stack.

### Step 16 — Cross-cloud deploy (~30 min) — first Firebase-touching step
1. `aws iam create-access-key --user-name casa-coqui-firebase-bridge` (capture, store in 1Password)
2. `firebase functions:secrets:set AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
3. `vercel env add` for production + preview + development (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + REPLY_DRAFT_STATE_MACHINE_ARN)
4. Squash-merge `feat/phase-3-sfn-bridge` to main, push, watch CodePipeline approval gate, approve

This is the moment the Cloud Function bridge code goes live in production.

### Step 17 — Synthetic smoke (~30-45 min)
Run all 10 scenarios from spec AC #17 (a-j) plus scenario k (automated voice-parity regex booleans). Then **17.7**: delete the feature branch.

---

## 7. Notes for the next Claude

You're picking up Phase 3 with **the architectural lift behind you**. Steps 12 + 13 confirmed every cross-cloud + cross-service contract works. What's left is execution.

Things to internalize about working with Julio:

- **He noticed when reviewer opinions and runtime evidence disagreed.** When the original handoff implied Step 13 would SUCCEED without seeding, he didn't argue — he investigated. That's the trust-runtime-over-docs pattern from the IAM debugging arc, applied to documentation.
- **He's got a concurrent thread always running in his head.** During Step 12+13 he asked about threading (separate workstream), then about message ingestion (architecture review), then floated the Gmail Resolutions idea (Phase 5+). Don't try to merge them — keep contexts separate.
- **He values warmth that doesn't perform.** When he says "yee!" at a SUCCEEDED execution, match the energy. When he says "Defenently progress," congratulate him, don't lecture.
- **He pauses before destructive actions.** He explicitly approved each deploy. He didn't push to main. He didn't generate the BridgeIamUser access key yet (Step 16). When approaching anything that touches production-or-shared-state, pause and confirm.
- **He's curious about the model.** Em-dash voice violation, ADC vs gcloud auth login vs firebase login, Secrets Manager 6-char ARN suffix, AppConfig `appconfig:` vs `appconfigdata:` — every time you can tie a concrete observation to an exam concept, do it.
- **A note on tool interruption**: typing in the input box while a tool is running CANCELS the tool. If a Write or Agent looks like it's hanging, just wait — don't type "continue" or any other word. Tools usually take 5-60s.

Match his discipline. He's earning this.

— Claude (Opus 4.7, this session)

---

**End of checkpoint.**
