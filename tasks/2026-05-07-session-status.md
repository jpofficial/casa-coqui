# Session Status — 2026-05-07

**Snapshot time**: 2026-05-07 evening
**Branch**: main (working directly, user authorized)

---

## ✅ DONE this session

### Phase 1.5 — Port Anthropic logic into chain Lambdas (10 commits)

The 4 chain Lambdas (Reasoner, Drafter, Evaluator, Reviser) now run real Anthropic logic in the deployed `casa-coqui-reply-agent` SAM stack.

| Commit | Title |
|---|---|
| `faf1884` | chore: bootstrap jest test infrastructure |
| `fb86519` | feat: port Reasoner Lambda with throttle-name contract |
| `971f1fd` | fix: MODEL_NAME guard + cleaner module.exports |
| `ef582d4` | feat: port Drafter Lambda |
| `249e5f8` | feat: port Evaluator Lambda |
| `a605d3c` | feat: port Reviser Lambda |
| `a3f6b8f` | feat: add sample SFN input + builder script |
| `c39bc2e` | feat: add test-sfn.sh end-to-end runner |
| `3124d18` | fix: pass context fields through to inner AIChain SFN (latent Phase 1 ASL bug caught during E2E) |
| `a4012a8` | docs: mark Phase 1.5 complete + add spec/plan |

**End-to-end verified**: 16-second SFN execution, real reply produced. *"Hi Tester, checkout is at 11am. You have parking for two cars right in front of the gate..."*

### Phase 2 — AppConfig + SSM Parameter Store (10 commits)

Host voice prompt now lives in AppConfig (with JSON Schema validator). Model knobs in SSM Parameter Store. LoadConfig fetches them at workflow start. Drafter+Reviser fetch system_prompt_text from AppConfig via Lambda Extension and capture `appConfigVersion` for forensic tracing.

| Commit | Title |
|---|---|
| `3530be7` | docs: AppConfig + W7 validator trap design spec |
| `a5a8f3b` | refactor: extract SYSTEM_PROMPT to shared seed file |
| `6e98cbe` | feat: make LoadConfig real (SSM fetch) |
| `e9e7a67` | feat: add SSM Parameters + AppConfig static resources |
| `0dfd1ef` | feat: attach AppConfig Lambda Extension to Drafter+Reviser |
| `05535f7` | feat: Drafter+Reviser fetch system prompt from AppConfig |
| `db7fd09` | feat: Reasoner+Evaluator prefer event.config.model + ASL captures appConfigVersion |
| `6cde186` | feat: COMMIT A — add HostedConfigVersion + Deployment resources (broken seed) |
| `fbcb9f7` | fix: COMMIT B — add version field + DependsOn between Deployments |
| `138a08e` | feat: add verify-appconfig.sh post-deploy smoke check |

**End-to-end verified post-Phase 2**: 18-second SFN execution, real reply, `appConfigVersion: "1"` plumbed through Drafter result.

#### W7 trap lessons banked (refined from initial expectation)

The trap fired but for a DIFFERENT reason than initially designed:

1. **Expected**: AppConfig validator rejects the seed at `CreateHostedConfigurationVersion` API time → CFN rolls back.
2. **Actually**: AppConfig Freeform validators run at `GetLatestConfiguration` (retrieval), NOT at HCV creation. So both HCVs reached `CREATE_COMPLETE` even with the missing `version` field.
3. **What actually broke the deploy**: AppConfig only allows ONE active deployment per environment. CFN created `SystemPromptDeployment` and `FeatureFlagsDeployment` in parallel → second got 409 → rollback.
4. **Refined fix**: add `DependsOn: SystemPromptDeployment` on `FeatureFlagsDeployment` to serialize them. AND still add `version: "1.0.0"` to the seed (validator runs at runtime, would fail Drafter/Reviser otherwise).

The CFN-rollback-on-leaf-resource-failure lesson is intact; we got a different specific cause than expected. Lesson banked: validators on Freeform profiles run at retrieval, not at HCV creation.

---

## 🚀 What's LIVE in production AWS

| Layer | Status |
|---|---|
| Vercel (Next.js app) | ✅ unchanged this session |
| Firestore rules + indexes | ✅ unchanged this session |
| Firebase Cloud Functions | ✅ unchanged this session |
| AWS Lambda `parse-airbnb-email` (CDK) | ✅ unchanged this session |
| **AWS SAM stack `casa-coqui-reply-agent`** | ✅ Phase 2 deployed: real chain Lambdas + AppConfig + SSM. LoadConfig real, Drafter/Reviser fetch from AppConfig with version stamping |

**Important**: production Airbnb messages STILL flow through the legacy JS chain at `functions/lib/reply-agent-chain.js` (Firebase Cloud Function). The SAM SFN is deployed and works in isolation when triggered manually via `./scripts/test-sfn.sh` — but receives no real production traffic. **Phase 3 wires the bridge.**

---

## 📂 Where to find things

### Specs (the design docs)
- `docs/superpowers/specs/2026-05-07-phase1.5-anthropic-port-design.md`
- `docs/superpowers/specs/2026-05-07-phase2-appconfig-design.md`

### Plans (the task-by-task implementations)
- `docs/superpowers/plans/2026-05-07-phase1.5-anthropic-port.md`
- `docs/superpowers/plans/2026-05-07-phase2-appconfig.md`

### Hand-off explainer
- `explantion/hand-off.md` — long-form session-to-session context (last updated for Phase 1.5; Phase 2 update is part of remaining Task 10)

### Verification scripts
- `infra/sam/reply-agent/scripts/test-sfn.sh` — end-to-end SFN execution test
- `infra/sam/reply-agent/scripts/verify-appconfig.sh` — post-deploy AppConfig smoke check
- `infra/sam/reply-agent/scripts/build-sfn-sample.js` — sample SFN input from Firestore (or hand-crafted fallback)
- `infra/sam/reply-agent/scripts/build-template.js` — inlines seed JSON content into template.built.yaml (used because `Fn::Transform: AWS::Include` doesn't work for HCV.Content)

### Sample input
- `infra/sam/reply-agent/samples/full-input.json` — sanitized synthetic SFN input for verification

### Phase 2 config seeds (single source of truth)
- `infra/sam/reply-agent/config/system-prompt.seed.json` — host voice config (~9.4KB SYSTEM_PROMPT + version + language_distribution + hard_bans)
- `infra/sam/reply-agent/config/feature-flags.seed.json` — `reply_engine` flag (no consumer until Phase 3)

---

## ⏳ What's left this session (Phase 2 wrap-up)

### Task 10 — Update hand-off doc (~5 min)
Modify `explantion/hand-off.md`:
- Mark Phase 2 as complete (replace the pending section with a completion summary)
- Update production status table row for SAM stack
- Add commit SHA references for Phase 2 commits

### Final code review (~10 min)
Dispatch a single final reviewer subagent to scan all 10 Phase 2 commits for:
- Spec compliance
- Code quality
- Missed concerns

---

## 🔮 Next phases (NOT this session, but queued)

### Phase 3 — Bridge + DLQ + alarms + auto-rollback (~1.5 hr)

The unlock for production traffic. Plan §4.3.

**Builds:**
- In `functions/index.js:214` (`onAirbnbMessageCreated`), add an AppConfig fetch (via Cloud Function — read mode + rollout_pct from the `feature-flags` profile we shipped in Phase 2). Hash messageId mod 100; if under rollout_pct, send to AWS path.
- Wire SDK `StartExecution` from the Cloud Function against `casa-coqui-reply-draft` SFN ARN (Firebase secret holds an IAM user's access key with `states:StartExecution` ONLY, scoped to the one SM ARN — least privilege)
- Same `StartExecution` call from a new `regenerate` API route — fixes the regenerate button bug (`app/admin/messages/page.js:485-498`)
- SQS DLQ named `reply-draft-dlq`, set as SFN execution failure target via `Catch` on top-level state
- SNS topic `reply-draft-failures` with email subscription
- CloudWatch alarms: SFN-ExecutionsFailed > 5/5min, AnthropicThrottles > 20/min, Latency-p95 > 30s
- Wire failure alarm to AppConfig deployment as Monitor for auto-rollback
- WriteBack Lambda becomes real: writes draft to Firestore via firebase-admin, persists `_agentRun.appConfigVersion` from chain output

**Break-it moment** (intentional): deploy a prompt config that produces replies failing the voice score (e.g., remove "no em-dashes" rule). CW alarm fires within 5 min. AppConfig auto-rolls back.

### Phase 4 — A/B switch (~30 min)

Flip `reply_engine` flag from `firebase` → `shadow` (run both, log diff, write only legacy). Then `aws-sfn` with rollout_pct 5%, then 25%, 50%, 100% over a week.

### Phase 5 — Teardown sandbox (~30 min)

`sam delete` dev stack. Verify CW retention is 7 days on dev side.

### Phase 6 — Fix staff push-notification dead-end (~45 min)

The bug at `functions/index.js:384` writes to `staff_notifications` Firestore but never calls FCM. Fix via SNS topic `casa-coqui-draft-events` + new `NotifyStaffFcm` Lambda subscriber. Drills SNS pub/sub + cross-cloud secret access.

### Other queued items (not on the SFN refactor track)

- `/admin/resolutions` UI page (backbone data exists in `airbnb_resolutions/{claimId}`, page doesn't)
- Phase 2 of Casa Coqui security hardening (legacy `set-claims` route bypass)
- 3 pricing pipeline tasks at `tasks/2026-04-24-pricing-*`
- EC2 deploy consolidation: merge `ec2-deploy` branch into main

---

## 🧠 Critical context for future sessions

### Phase 2 build template gotcha
SAM `Fn::Transform: AWS::Include` does NOT work for `AWS::AppConfig::HostedConfigurationVersion.Content` (the property is type String, AWS::Include substitutes an object). Workaround: `infra/sam/reply-agent/scripts/build-template.js` reads the seed JSONs and writes `template.built.yaml` with content inlined as YAML literal blocks. Deploy uses `--template-file template.built.yaml`. The script and `template.built.yaml` are both gitignored on the build artifact side; the script source IS committed.

### AppConfig deployment serialization
Multiple `AWS::AppConfig::Deployment` resources targeting the same Environment WILL collide if CFN creates them in parallel. Always use `DependsOn:` to serialize. Phase 2 caught this.

### AppConfig validator timing
JSON Schema validators on `AWS.Freeform` ConfigurationProfiles run at `GetLatestConfiguration` (retrieval) time, NOT at `CreateHostedConfigurationVersion` time. So a missing required field doesn't fail HCV creation — it fails the Lambda fetch. Plan accordingly.

### Single source of truth for SYSTEM_PROMPT
- File: `infra/sam/reply-agent/config/system-prompt.seed.json`
- Read by: (1) `functions/lib/reply-ai.js` (legacy JS chain via fs.readFileSync at module load), (2) AppConfig HCV (via build-template.js inlining at SAM build time)
- Changes propagate to both readers when this one file is edited

### Lambda Extension layer for AppConfig
- Pinned via SSM public param: `/aws/service/appconfig/extension/arm64/2.0.183`
- Attached to Drafter + Reviser only (Reasoner + Evaluator have inline algorithm prompts)
- `AWS_APPCONFIG_EXTENSION_PRELOAD_LIST` env var set so extension fetches at Lambda init (not first request) — saves cold-start latency

### What still flows through legacy JS chain
- 100% of production Airbnb message replies (until Phase 3 ramps SFN traffic)
- `functions/lib/reply-agent-chain.js` and `functions/lib/reply-ai.js` are the live code path
- Phase 1.5 + Phase 2 added a parallel SFN-based path that's tested via `test-sfn.sh` only

---

## 📊 Session metrics

- **Lines added (rough)**: ~3,500
- **Commits**: 20 (10 Phase 1.5 + 10 Phase 2)
- **AWS deploys**: 4 (Phase 1.5 deploy, Phase 1.5 latent-bug fix, Phase 2 broken Commit A → rollback, Phase 2 Commit B success)
- **Real Anthropic API calls**: 6 (Phase 1.5 e2e, Phase 2 e2e + retry)
- **CFN rollbacks observed**: 1 (Phase 2 Commit A — pedagogical W7 trap)
- **Latent bugs caught + fixed**: 1 (Phase 1 ASL missing context fields, fixed in 3124d18)
