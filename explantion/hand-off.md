# Casa Coqui — Session Hand-Off

**Date**: 2026-05-07 (session that started 2026-05-06 evening)
**Purpose**: Clean handoff to a new Claude Code session with everything needed to pick up exactly where we left off.

---

## 🎯 30-Second Summary

Today we shipped **6 commits** spanning 4 different deployments:

1. Anthropic SDK retry bump + Airbnb classifier expansion
2. **Resolution Center email parser** (full backbone) + Gmail `Fwd:` classifier bug fix
3. Admin Messages tab body cleaner (preview rendering)
4. **Phase 0 of SFN refactor** — explicit exp backoff + jitter wrapper
5. **Phase 1 of SFN refactor** — SAM scaffold (template + 2 SFNs + 7 Lambdas)
6. EventBridge IAM trap fix that made Phase 1 actually deploy

Phase 1 is **LIVE in AWS** running stub Lambdas. End-to-end test executed successfully in 3.7s.

---

## Today's Commit Chain (on origin/main)

```
a077c7e fix(infra/sam): grant ReplyDraftSM events:Put*/Describe* for sync child SFN
8afb0de feat(infra): SAM scaffold for reply-agent SFN refactor (Phase 1)
cafe6bd feat(reply-agent): explicit exp backoff + jitter wrapper around Anthropic calls
03e0877 fix(admin/messages): render real guest text instead of tracking-pixel junk
3e8593a feat: parse Airbnb resolution emails + fix Gmail Fwd: classifier bug
7cac393 chore: bump anthropic retries, expand airbnb classifier, ignore local artifacts
```

---

## 🚀 What's LIVE in Production

| Layer | Deploy mechanism | Status |
|---|---|---|
| Vercel (Next.js app) | Auto-deploy on push to `main` | ✅ Includes body cleaner + admin Messages tab fixes |
| Firestore rules + indexes | AWS CodePipeline (manual SNS approval) | ✅ Includes `airbnb_resolutions` rule + airbnb_messages composite index |
| Firebase Cloud Functions | `firebase deploy --only functions` | ✅ Includes Phase 0 backoff wrapper |
| AWS Lambda `parse-airbnb-email` | `cdk deploy CasaCoquiEmailStack` | ✅ Includes resolution_request classifier + Fwd: fix + parser |
| **AWS SAM stack `casa-coqui-reply-agent`** | `sam deploy` | ✅ Phase 2: AppConfig + SSM Parameters; LoadConfig real (SSM fetch); Drafter/Reviser fetch system_prompt_text from AppConfig with version stamping; RAGRetrieve/WriteBack still stubs |

### Phase 1 SAM stack ARNs (memorize these)

```
ReplyDraftStateMachineArn = arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft
AIChainStateMachineArn    = arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-ai-chain
WriteBackFunctionArn      = arn:aws:lambda:us-east-1:524140443248:function:casa-coqui-reply-write-back
```

Test command (verified working in 3.7s):
```bash
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --input '{"message":{"id":"test-001","guestName":"Tester","body":"Hello, what time is checkout?"}}'
```

---

## 📂 Critical File Locations

### SFN Refactor (the new work)

| File | Purpose |
|---|---|
| `infra/sam/reply-agent/template.yaml` | SAM template — defines all AWS resources |
| `infra/sam/reply-agent/statemachines/reply-draft.asl.json` | Outer Standard SM (LoadConfig → RAGRetrieve → AIChain → WriteBack) |
| `infra/sam/reply-agent/statemachines/ai-chain.asl.json` | Inner Express SM (Reasoner → Drafter → Evaluator → Choice → ChainSucceeded/Reviser) |
| `infra/sam/reply-agent/functions/{load-config,rag-retrieve,reasoner,drafter,evaluator,reviser,write-back}/index.js` | 7 Lambda handler stubs |
| `functions/lib/anthropic-with-backoff.js` | Phase 0 retry wrapper (live in production) |
| `functions/lib/__tests__/anthropic-with-backoff.test.js` | 18 unit tests, all passing |

### Resolution Center work (also live)

| File | Purpose |
|---|---|
| `infra/lambda/parse-airbnb-email/index.js` | Updated classifier + `parseResolutionFields` + routing branch |
| `firestore.rules` lines 454+ | `airbnb_resolutions` collection rule |
| `scripts/backfill-airbnb-resolutions.js` | Re-classify quarantine into airbnb_resolutions |
| `scripts/backfill-quarantine-reclassify.js` | Re-classify quarantine into airbnb_messages |
| `lib/extract-guest-message.js` | Body cleaner for admin Messages tab |
| `app/admin/messages/page.js` line 563 | Renders cleaned preview |

### Reference docs (committed)

| File | Purpose |
|---|---|
| `explantion/airbnb_resolutions.md` | Full explainer of the resolution parser backbone |
| `explantion/phase_1.md` | Full explainer of the SFN Phase 1 architecture |
| `explantion/hand-off.md` | THIS file |
| `tasks/2026-05-06-phase1-lesson-plan.md` | Lesson plan from Phase 1 of Operations UX (separate workstream) |

### The original SFN plan (in JulioOS, NOT in this repo)

```
/Users/jperez/dev/JulioOS/01 - Projects/AWS DevOps Professional/casa-coqui-sfn-refactor-plan.md
```

This is the master plan with all 6 phases. We've shipped Phases 0 + 1.

---

## ✅ What's Done

### Phase 0 — Backoff wrapper (deployed, observable)

`functions/lib/anthropic-with-backoff.js`:
- Replaces SDK `maxRetries: 4` with explicit `min(2^attempt × 500ms + rand(0,500ms), 30000ms)` backoff
- Max 5 attempts, retryable on 429/529/5xx + ECONNRESET/ETIMEDOUT
- Non-retryable errors throw immediately (preserves single-shot fallback behavior)
- 18 unit tests
- Wired into 5 call sites: `reply-ai.js:256`, `reply-agent-chain.js:235/258/298/332`
- Live in production (commit `cafe6bd` deployed via `firebase deploy --only functions:onAirbnbMessageCreated`)

### Phase 1 — SAM scaffold (deployed, stubs working)

`infra/sam/reply-agent/`:
- 20 AWS resources created via CFN
- 7 Lambda stubs return well-shaped output for SFN to flow through
- ASL state machines have explicit Retry blocks with `JitterStrategy: FULL`
- IAM roles per Lambda, scoped EventBridge perms on outer SM
- End-to-end test ran in 3.7s

### Resolution Center email parser (deployed, working)

- New `airbnb_resolutions/{claimId}` Firestore collection
- 5 classifier patterns added for AirCover / Reimbursement / CLSF cases
- `parseResolutionFields()` extracts claimId, confirmationCode, resolutionUrl
- Lambda routes resolution_request emails to the new collection
- Admin notification fires on first arrival (via `notifyAdminAndCohost`)
- Backfill script created `airbnb_resolutions/CLSF-05873844` for the existing reimbursement case
- Firestore rule allows admin/cohost read; restricted update to status/notes/updatedAt

### Gmail `Fwd:` classifier bug fix (deployed)

- `Fwd:`/`Fw:` prefix stripped at start of `classifyEmail`
- New patterns added: bare `^Reservation for` and `^Inquiry for` (handles Gmail's RE-collapse)
- 12 stuck guest messages recovered from quarantine via `backfill-quarantine-reclassify.js --apply`
- Reply agent fired AI drafts on all 12

### Admin Messages tab body cleaner (deployed)

- New `lib/extract-guest-message.js` — strips Airbnb's email boilerplate
- Verified: 36/36 backfilled docs produce clean previews
- Handles RE: replies AND initial inquiries (multiple metadata variants: Identity verified / On Airbnb since / Joined / N reviews / Location)
- Render fallback chain: `body ? extractGuestMessage(body) : (text || messageBody || '')`
- Welcome drafts (which use `text` field) now render correctly too

---

## ⏳ What's Pending (queued for next session)

### ~~Phase 1.5 — Port real Anthropic logic into SFN Lambdas~~ ✅ DONE 2026-05-07

The 4 chain Lambdas (Reasoner, Drafter, Evaluator, Reviser) now run real Anthropic API logic. Each is self-contained (no Lambda Layer): own `package.json` with `@anthropic-ai/sdk` + `@aws-sdk/client-secrets-manager`, own inline copy of the throttle wrapper (with `AnthropicThrottle` named-error re-throw on retry exhaustion), own embedded prompt + tool schema. Module-cached secret value + Anthropic client to amortize cold-start latency.

Verified end-to-end: `infra/sam/reply-agent/scripts/test-sfn.sh` runs the deployed SFN against a sanitized real production message in **16 seconds** and produces a real reply draft (28 words, voice score 8/10, evaluation passed inline).

**Bonus fix during verification**: latent Phase 1 ASL bug — `reply-draft.asl.json` `AIChainExecution` Input block was missing 4 context fields. Fixed in commit `3124d18`.

Spec: `docs/superpowers/specs/2026-05-07-phase1.5-anthropic-port-design.md`
Plan: `docs/superpowers/plans/2026-05-07-phase1.5-anthropic-port.md`

**Next**: Phase 2 (AppConfig + prompt config + validators) or Phase 3 (bridge from Cloud Function — fixes the regenerate button bug).

### ~~Phase 2 — AppConfig + prompt config + validators~~ ✅ DONE 2026-05-07

The host voice prompt now lives in AWS AppConfig (Linear 10%/min/5min-bake rollout). Model knobs live in SSM Parameter Store. LoadConfig fetches them at workflow start. Drafter+Reviser fetch system_prompt_text from AppConfig via the Lambda Extension (localhost:2772) and capture the Configuration-Version response header → propagated through SFN result as `appConfigVersion` for forensic tracing.

W7 break-it trap fired and resolved — but with a refined lesson:
- **Expected**: validator on `CreateHostedConfigurationVersion` would fail the missing-`version` seed → CFN rollback
- **Actual**: AppConfig Freeform validators run at `GetLatestConfiguration` (retrieval), not at HCV creation. The HCVs created cleanly. The deploy ROLLED BACK because CFN created `SystemPromptDeployment` and `FeatureFlagsDeployment` in parallel and AppConfig only allows one active deployment per environment → second got 409 → rollback.
- **Fix**: added `DependsOn: SystemPromptDeployment` on `FeatureFlagsDeployment` to serialize them. AND added `version: "1.0.0"` to the seed (validator runs at runtime, would have failed Drafter/Reviser otherwise).

Single source of truth: `infra/sam/reply-agent/config/system-prompt.seed.json` is read by both `functions/lib/reply-ai.js` (legacy JS chain) and the SAM HCV (via `scripts/build-template.js` inlining at sam build time, since `Fn::Transform: AWS::Include` doesn't work for HCV.Content). No drift window.

End-to-end verified post-Phase 2: 18-second SFN execution, real reply produced, `appConfigVersion: "1"` plumbed through Drafter result.

Spec: `docs/superpowers/specs/2026-05-07-phase2-appconfig-design.md`
Plan: `docs/superpowers/plans/2026-05-07-phase2-appconfig.md`

**Next**: Phase 3 (bridge from Cloud Function → StartExecution + DLQ + alarms + auto-rollback). The `feature-flags` profile's `reply_engine` flag has no consumer until Phase 3 wires the Cloud Function to read it.

### Phase 3 — Bridge + DLQ + alarms + auto-rollback

The unlock for the **regenerate button bug**:
- In `functions/index.js` `onAirbnbMessageCreated`, replace the in-process chain call with `StartExecutionCommand` against `casa-coqui-reply-draft` SM
- Add `regenerate` API route that also calls `StartExecution` (fixes the bug at `app/admin/messages/page.js:485-498` where the onCreate trigger never re-fires)
- SQS DLQ named `reply-draft-dlq`, set as SFN execution failure target via `Catch` on top-level state
- SNS topic `reply-draft-failures` with email subscription
- CloudWatch alarms: SFN-ExecutionsFailed > 5/5min, AnthropicThrottles > 20/min, Latency-p95 > 30s
- Wire failure alarm to AppConfig deployment as Monitor for auto-rollback

Estimated time: 1.5 hours.

### Phase 4 — A/B switch (~30 min)
### Phase 5 — Teardown sandbox (~30 min)
### Phase 6 — Fix staff push notification dead-end (~45 min)

### NOT in the SFN plan but on the queue

- **`/admin/resolutions` UI page** — backbone data exists, page doesn't. Notification deeplink targets it.
- **Phase 2 of Casa Coqui security hardening** — legacy `set-claims` route is still callable as a bypass for the new `validate-token` flow. Explicit decision: defer until SFN refactor done.
- **Pricing pipeline tasks** (3 in `tasks/2026-04-24-*`)
- **EC2 deploy consolidation** — merge `ec2-deploy` branch into `main`

---

## 🧠 Critical Context (don't lose this)

### How the deploys actually work

1. **Vercel** — auto-deploys Next.js app on push to `main`. No manual step.
2. **AWS CodePipeline** (`CasaCoquiPipelineStack`) — auto-fires on push to `main`, builds, pauses at SNS approval gate, then runs `firebase deploy --only functions,firestore:rules,firestore:indexes`.
3. **Firebase CLI** — direct deploy bypassing the pipeline. We used `firebase deploy --only functions:onAirbnbMessageCreated` for Phase 0 to avoid the full pipeline + approval delay.
4. **AWS CDK** — `cdk deploy CasaCoquiEmailStack` from `infra/` directory. Updates the parse-airbnb-email Lambda. NOT auto-deployed.
5. **AWS SAM** — `cd infra/sam/reply-agent && sam deploy`. NOT auto-deployed; not yet in any pipeline.

### Casa Coqui has THREE pipelines (one per stack)

- `CasaCoquiPipelineStack` — tracks `main` branch — Vercel + Firebase
- `CasaCoquiEC2PipelineStack` — tracks `ec2-deploy` branch — separate experiment
- `CasaCoquiPricingStack` — tracks `main` — pricing data autopilot

### EventBridge dependency for SFN `.sync:2`

Critical exam-grade lesson banked. The Standard SM uses `arn:aws:states:::states:startExecution.sync:2` to invoke the Express child. AWS uses an EventBridge managed rule (singleton per account+region) to deliver the child's completion event back to the parent. SAM's `StepFunctionsExecutionPolicy` connector does NOT include the `events:Put*`/`events:Describe*` perms required for this. Manual inline policy in `template.yaml` covers it.

### The 429 problem is essentially solved

User reported messages stuck. We diagnosed:
1. **NOT a quota problem** (only 1.24% of monthly used)
2. **Burst rate problem** (4-call agent chain × concurrent messages → per-min ITPM violations)
3. **maxRetries: 2 was insufficient** for Anthropic's typical 30-60s retry-after windows

Phase 0 backoff wrapper deployed with maxRetries: 0 on SDK + explicit 5-attempt exp backoff in our wrapper. Currently in production. Future-stuck messages will be visible in CloudWatch logs with explicit retry log lines.

### The Regenerate button is still broken

`handleRegenerate` at `app/admin/messages/page.js:485-498` flips `draftStatus: 'pending'` but the Cloud Function `onAirbnbMessageCreated` is `onDocumentCreated` (not `onWrite`), so the agent never re-fires. **Fixed in Phase 3** when the bridge calls `StartExecution` for both new emails AND regenerate clicks.

### Anthropic API key location

Lives in AWS Secrets Manager as:
```
arn:aws:secretsmanager:us-east-1:524140443248:secret:casa-coqui/anthropic-api-key-ILoIK6
```

Our SAM template references it by name (`casa-coqui/anthropic-api-key`) — IAM grants are scoped via `Sub` interpolation to the wildcarded ARN suffix.

### Firebase service account

Lives in:
```
arn:aws:secretsmanager:us-east-1:524140443248:secret:casa-coqui/firebase-service-account-*
```

Used by parse-airbnb-email Lambda + (eventually) the WriteBack Lambda in Phase 1.5.

---

## 🤔 Open Decisions for Next Session

### Q1 — Anthropic rate limit ceiling

**Status**: Still unanswered.
**To resolve**: Open https://console.anthropic.com/settings/limits → check Haiku 4.5 ITPM (input tokens per minute).
- Tier 1 = 50k TPM (likely current)
- Tier 4 = 500k TPM
- If below Tier 4: request a tier bump (free, 24-48h approval).

This affects Phase 3 alarm thresholds. Doesn't block earlier phases.

### Q2 — Architecture review

**Open question**: We picked Standard outer + Express inner with `.sync:2` for educational/exam value, but a single Standard SM with 5-6 task states would be **simpler** at our volume (10 messages/day). Cost difference is pennies/month.

Decision: keep the dual-SM architecture for the lab. Simplification is a one-PR refactor anytime.

### Q3 — Should the regenerate button get a quick-fix patch or wait for Phase 3?

**Options**:
- **A — Quick fix tonight (~15 min)**: Add an `onDocumentUpdated` Cloud Function that watches for `draftStatus → pending && regeneratedAt set` and runs the same agent chain.
- **B — Wait for Phase 3**: The proper fix is bridging the regenerate route to `StartExecution` on the new SFN.

**Decision**: Wait for Phase 3. Quick fix would just be deleted when SFN takes over.

---

## 🛠 Useful Commands for Next Session

### Verify deploy state
```bash
# Phase 1 SAM stack
aws cloudformation describe-stacks --stack-name casa-coqui-reply-agent \
  --query "Stacks[0].StackStatus" --output text

# Lambda freshness (should match commit timestamp)
aws lambda get-function --function-name casa-coqui-parse-airbnb-email \
  --query "Configuration.LastModified" --output text

# Firebase Cloud Function freshness
firebase functions:list --project casa-coqui | grep onAirbnbMessageCreated
```

### Test the deployed SFN
```bash
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --input '{"message":{"id":"test-X","guestName":"Tester","body":"Hello"}}'

# Then check status with the returned executionArn:
aws stepfunctions describe-execution --execution-arn <ARN> \
  --query "{Status:status,Output:output}"
```

### Tear down Phase 1 SAM stack (if needed)
```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam delete --stack-name casa-coqui-reply-agent --region us-east-1
```

### Re-deploy SAM
```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam build && sam deploy --no-confirm-changeset
# samconfig.toml is gitignored but persists locally — no need for --guided after first time
```

### Run all tests
```bash
# Functions tests
cd functions && npx jest

# Lambda parse-airbnb-email tests
cd infra/lambda/parse-airbnb-email && npx jest
```

### Watch Cloud Function logs (the agent chain)
```bash
firebase functions:log --only onAirbnbMessageCreated --lines 100
```

### Watch SFN execution history (Phase 1 stack)
```bash
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --max-results 10
```

---

## 🎓 Exam Concepts Banked Today

**SAM**:
- `Transform: AWS::Serverless-2016-10-31`
- `Globals` block for shared Function/Api defaults
- `AWS::Serverless::Function` → expands to Lambda + Role + Permission
- `AWS::Serverless::StateMachine` → expands to SFN + Role + LogGroup config
- `DefinitionUri` + `DefinitionSubstitutions` for external ASL files
- SAM connector policies (LambdaInvokePolicy, StepFunctionsExecutionPolicy)
- `--resolve-s3` flag auto-creates managed deployment bucket
- `--no-execute-changeset` for preview-only deploys

**CDK + Lambda**:
- `Code.from_asset()` SHA-256 hashes the bundle for deterministic deploys
- `UpdateFunctionCode` vs `UpdateFunctionConfiguration` (different CFN property → different Lambda API)
- Lambda updates are **always in-place** (no resource replacement, ARN stable)
- `from_inline()` embeds code in CFN template (4 KiB limit — useful for tiny handlers)
- CDK asset bucket created by `cdk bootstrap` (one per account+region)

**CloudFormation**:
- Change sets — `create-change-set` / `execute-change-set`
- `ROLLBACK_COMPLETE` state — must `delete-stack` before retry
- Drift detection has Lambda blind spots (console code edits don't show)
- Parameters / Globals / Resources / Outputs structure

**Step Functions**:
- Standard ($25/M transitions, 90-day history) vs Express ($1/M, logs only)
- ASL Retry block with `JitterStrategy: FULL`
- ASL Catch with ResultPath for error routing without state loss
- Choice / Pass / Task / Succeed / Fail state types
- `arn:aws:states:::lambda:invoke` (standard Lambda task)
- `arn:aws:states:::states:startExecution.sync:2` (sync child SFN)
- `.sync:2` returns parsed JSON; `.sync` (v1) returns string blob
- Named errors for typed Retry (`err.name = 'AnthropicThrottle'`)

**EventBridge**:
- Singleton managed rule per account+region for `.sync` SFN integrations
- Rule name: `StepFunctionsGetEventsForStepFunctionsExecutionRule`
- Per-execution PutTargets/RemoveTargets churn
- IAM scoping: target the specific rule ARN, not wildcard

**Git/Deploy**:
- Working tree → staging area → repository (the 3-place model)
- `git add <path>` style discipline beats `git add .` for production repos
- 6-commit ship day with multiple deploy targets requires careful sequencing

---

## 💡 First Prompt for the Next Session

If you want to dive straight into Phase 1.5:

> "Read explantion/hand-off.md for context. We're picking up Phase 1.5 of the SFN refactor — porting the real Anthropic-call logic from functions/lib/reply-agent-chain.js into the 4 chain Lambdas in infra/sam/reply-agent/functions/. Each Lambda needs Anthropic SDK + Secrets Manager client cached at module level, the specific prompt + tool definition for that step, and named AnthropicThrottle errors so the SFN ASL Retry catches them specifically. Walk through the design before writing code."

If you want a smaller tactical task first:

> "Read explantion/hand-off.md. Build the /admin/resolutions UI page — list view + detail drawer + status dropdown. Data already exists in airbnb_resolutions/{claimId}. The notification deeplink targets this path. Match the existing admin styling pattern."

---

**Total time invested today**: ~7 hours
**Lines of code shipped**: ~2,000 across 6 commits
**Production deploys**: 5 (Vercel auto, pipeline, CDK, firebase, SAM)
**Major bugs fixed**: 3 (Fwd: classifier, body rendering, EventBridge IAM gap)
**Major features shipped**: 2 (Resolution Center backbone, Phase 0+1 SFN)

Sleep well. 🌴
