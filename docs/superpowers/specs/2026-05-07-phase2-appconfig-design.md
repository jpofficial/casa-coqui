# Phase 2 — AppConfig + Prompt Config + W7 Validator Trap

**Date:** 2026-05-07
**Status:** Design approved, plan pending
**Author:** Julio (with Claude Code)
**Reviewers:** 3 staff engineers (AWS/SAM, day-2 ops, pedagogy lenses) — synthesis applied
**Predecessor:** Phase 1.5 (4 chain Lambdas with real Anthropic logic, deployed 2026-05-07)
**Successor:** Phase 3 (bridge Cloud Function → StartExecution + DLQ + alarms + auto-rollback)

---

## Goal

Externalize the host voice prompt + model knobs from inline-in-code to AWS-managed config (AppConfig + SSM Parameter Store), with safe gradual rollout via AppConfig Deployment Strategies and JSON Schema validation. Drill the W7 (AWS DevOps Pro Week 7) AppConfig validator-trap pedagogy by intentionally seeding a config that fails the validator, observing CFN rollback, then fixing.

After this phase, the system_prompt_text can be hot-tuned without redeploying Lambda code; chain Lambdas read model knobs from SSM via a real LoadConfig step.

## Non-goals

- Cloud Function bridge to call StartExecution (Phase 3)
- AppConfig deployment Monitors / auto-rollback on alarms (Phase 3)
- DLQ + SNS alarms (Phase 3)
- Algorithm prompts (REASONER_PROMPT, EVALUATOR_PROMPT) moved to AppConfig — they stay inline (algorithm contract, not config)
- Tool schemas (REASONER_TOOL, DRAFTER_TOOL, EVALUATOR_TOOL) moved to AppConfig — they stay inline
- `voiceProfilePrompt` (learned style rules from Firestore `settings/voice_profile`) — stays in Firestore (admin-editable, different concern)
- WriteBack real implementation (Phase 3)
- LoadConfig fetching prompts (only fetches model+temperature from SSM)
- The `feature-flags` profile having a consumer (Phase 3 Cloud Function reads it)
- Secrets Manager rotation drill (Phase 3 or later)

## Scope

### Resources to add to existing `casa-coqui-reply-agent` SAM stack

**SSM Parameter Store** (2 String parameters):
- `/casa-coqui/reply-agent/model` → `claude-haiku-4-5-20251001`
- `/casa-coqui/reply-agent/temperature` → `1.0`

(`max_tokens` stays hardcoded per Lambda — algorithm parameter, not config.)

**AppConfig** (8 resources):
- `AWS::AppConfig::Application` — `casa-coqui-reply-agent`
- `AWS::AppConfig::Environment` — `prod`, scoped to the Application
- `AWS::AppConfig::ConfigurationProfile` × 2:
  - `feature-flags` — type `AWS.AppConfig.FeatureFlags`. Defines flag `reply_engine` with attributes `mode` (enum: `firebase` | `aws-sfn` | `shadow`) and `rollout_pct` (number 0-100). **Phase 2 ships this with no consumer**; Phase 3 wires the Cloud Function to read it.
  - `system-prompt` — type `Freeform`, JSON Schema validator (see below). Holds the host voice config.
- `AWS::AppConfig::DeploymentStrategy` — `casa-coqui-linear-10pct`. Linear, 10% step every 1 min, 5min bake time, growth factor 10. (Per plan §4.2 — pedagogical, not optimized for our 10 msg/day volume.)
- `AWS::AppConfig::HostedConfigurationVersion` × 2 — initial seeds for both profiles
- `AWS::AppConfig::Deployment` × 2 — deploys initial versions through the strategy

**Lambda Extension layer** — AWS-published, attached to **Drafter + Reviser only**:
- ARN resolved via SSM public parameter at template synth time
- Pinned for arm64 (matches our template Globals `Architectures: [arm64]`)

### Code changes

**New file**: `infra/sam/reply-agent/config/system-prompt.seed.json`

Full host-voice payload conforming to the validator schema. **Single source of truth** for SYSTEM_PROMPT (read by both `functions/lib/reply-ai.js` and the SAM HCV at synth time):

```json
{
  "version": "1.0.0",
  "language_distribution": { "en": 0.7, "es": 0.3 },
  "hard_bans": [
    "I hope this message finds you well",
    "I'd be more than happy to",
    "Please don't hesitate",
    "Absolutely!",
    "Certainly!",
    "Kindly",
    "Let me help you get these sorted",
    "Looking forward to getting this fixed"
  ],
  "system_prompt_text": "<the entire content of the existing reply-ai.js SYSTEM_PROMPT constant>"
}
```

**Modify `functions/lib/reply-ai.js`**:
- Replace inline `SYSTEM_PROMPT = \`...\`` constant with `JSON.parse(fs.readFileSync(...)).system_prompt_text`
- File path: relative read of `../infra/sam/reply-agent/config/system-prompt.seed.json` from `functions/lib/reply-ai.js`
- Module-level read (one-time at function init), so no perf cost per invocation
- Production behavior unchanged — same content, different storage

**Modify `infra/sam/reply-agent/functions/load-config/index.js`** — stub → real:
```js
const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');
// Module-cached SSMClient
// Fetch /casa-coqui/reply-agent/{model,temperature} via GetParametersCommand
// Return { model, temperature, loadedAt }
```
- Add `@aws-sdk/client-ssm` to `functions/load-config/package.json`

**Modify `infra/sam/reply-agent/functions/drafter/index.js`** AND `reviser/index.js`:
- Remove `if (!voicePrompt) throw new Error(...)` validation from handler
- Add module-cached AppConfig fetch via `http://localhost:2772/applications/casa-coqui-reply-agent/environments/prod/configurations/system-prompt`
- Capture `Configuration-Version` response header → `appConfigVersion` in Lambda return
- Use `appConfig.system_prompt_text` instead of `event.voicePrompt`
- Read `model` from `event.config?.model` (with `process.env.MODEL_NAME` fallback for direct Lambda invocations)
- Return shape extended: `{ draft, tokens, appConfigVersion }`

**Reasoner + Evaluator** — minimal change:
- Read `model` from `event.config?.model` (with env-var fallback)
- No AppConfig integration. No Lambda Extension. No code changes beyond the model lookup.

**SAM template (`template.yaml`)** — additions:
- `Parameters` section gains `AppConfigExtensionLayerArn` with default resolved from `/aws/service/appconfig/extension/arm64/<version>` SSM public parameter
- New resource block for SSM Parameters, AppConfig App/Env/Profiles/Strategy/HCVs/Deployments
- IAM grants:
  - LoadConfig: `ssm:GetParameters` scoped to `arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/casa-coqui/reply-agent/*`
  - Drafter + Reviser: `appconfig:StartConfigurationSession` + `appconfig:GetLatestConfiguration` scoped via `!Sub` to `arn:aws:appconfig:${AWS::Region}:${AWS::AccountId}:application/${Application.Id}/environment/${Environment.Id}/configuration/${SystemPromptProfile.Id}`
- `Layers: [!Ref AppConfigExtensionLayerArn]` added to Drafter + Reviser
- Environment variables added to Drafter + Reviser:
  - `AWS_APPCONFIG_EXTENSION_PRELOAD_LIST=applications/casa-coqui-reply-agent/environments/prod/configurations/system-prompt` — fetches at Lambda init instead of first request
  - `APPCONFIG_APPLICATION` — `casa-coqui-reply-agent`
  - `APPCONFIG_ENVIRONMENT` — `prod`
  - `APPCONFIG_PROFILE` — `system-prompt`

### JSON Schema validator (on system-prompt profile)

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "required": ["version", "language_distribution", "hard_bans", "system_prompt_text"],
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$"
    },
    "language_distribution": {
      "type": "object",
      "additionalProperties": { "type": "number" }
    },
    "hard_bans": {
      "type": "array",
      "items": { "type": "string" }
    },
    "system_prompt_text": {
      "type": "string",
      "minLength": 100
    }
  }
}
```

The `version` pattern requires SemVer; `system_prompt_text` minLength catches accidentally truncated content. The validator runs at `CreateHostedConfigurationVersion` time (the Phase 2 W7 trap mechanism).

### ASL changes

**None.** `reply-draft.asl.json` already threads `$.config` from LoadConfig output through to the inner SFN (Phase 1.5 Task 8 fix). The chain Lambdas already read from `$.config`.

`ai-chain.asl.json` `ResultSelector` blocks for Drafter and Reviser need extending to capture `appConfigVersion` from the Lambda response:

```json
"ResultSelector": {
  "draft.$": "$.Payload.draft",
  "tokens.$": "$.Payload.tokens",
  "appConfigVersion.$": "$.Payload.appConfigVersion"
}
```

This propagates through the chain output so future WriteBack (Phase 3) can persist `_agentRun.appConfigVersion`.

## The W7 Break-It Trap (Pedagogical, Two Commits)

### Commit A — `feat(sam/reply-agent): add AppConfig + SSM scaffolding [INTENTIONAL: missing version field]`

Lands ALL the changes above EXCEPT the seed JSON `version` field is deliberately absent:

```json
{
  "language_distribution": { "en": 0.7, "es": 0.3 },
  "hard_bans": [...],
  "system_prompt_text": "..."
}
```

Run `sam build && sam deploy --no-confirm-changeset`. Expected behavior:
1. CFN begins UPDATE_IN_PROGRESS
2. Several resources create successfully (Application, Environment, ConfigurationProfiles, DeploymentStrategy, SSM Params)
3. `AWS::AppConfig::HostedConfigurationVersion` for system-prompt resource creation calls `CreateHostedConfigurationVersion` API
4. AppConfig runs the validator against the seed content
5. Validator rejects (missing `required: version` field)
6. CFN fails the resource → stack enters UPDATE_ROLLBACK_IN_PROGRESS
7. Eventually UPDATE_ROLLBACK_COMPLETE — stack returns to Phase 1.5 UPDATE_COMPLETE state

Diagnostic step (still in Commit A's working state):
```bash
aws cloudformation describe-stack-events --stack-name casa-coqui-reply-agent \
  --max-items 50 --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].{Time:Timestamp,Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
  --output table
```

Document the diagnostic findings in Commit A's body so future-readers see the full failure mode. **Phase 1.5 chain Lambdas remain intact** because rollback target is the last UPDATE_COMPLETE state.

### Commit B — `fix(sam/reply-agent): add version field to system-prompt seed (W7 validator trap fix)`

Adds `"version": "1.0.0"` to `infra/sam/reply-agent/config/system-prompt.seed.json`:

```json
{
  "version": "1.0.0",
  "language_distribution": { "en": 0.7, "es": 0.3 },
  ...
}
```

Run `sam build && sam deploy`. Expected behavior:
1. CFN UPDATE_IN_PROGRESS
2. All resources create cleanly (HCV passes validator)
3. AppConfig Deployment begins linear rollout (10% / 1 min / 5 min bake → ~6 min total)
4. CFN reports UPDATE_COMPLETE before deployment finishes (CFN doesn't wait for AppConfig deployment to bake — that happens asynchronously)
5. Watch deployment progress:
   ```bash
   aws appconfig list-deployments --application-id <APP_ID> --environment-id <ENV_ID>
   ```

### Verification (after Commit B)

1. **Smoke check** — fetch deployed config via the Extension or direct API:
   ```bash
   aws appconfig get-configuration --application casa-coqui-reply-agent \
     --environment prod --configuration system-prompt \
     --client-id smoke-test --query 'Content' --output text | base64 -d | jq '.version'
   ```
   Expected: `"1.0.0"`. (This catches the schema-syntax-typo edge case where AppConfig accepts a malformed schema and validates nothing.)

2. **End-to-end SFN test** — `./scripts/test-sfn.sh` against the same `samples/full-input.json` from Phase 1.5. Expected: `Status: SUCCEEDED`, real reply produced. CloudWatch logs for Drafter and Reviser show one AppConfig fetch each (confirming Extension caching + preload).

3. **AppConfig version captured in chain output** — describe the latest execution and verify `chainResult.output.drafter.appConfigVersion` is the version ID returned by AppConfig (e.g., `"1"`).

4. **CloudWatch logs for Lambda Extension** — `/aws/lambda/casa-coqui-reply-drafter` log group should show extension init logs at Lambda cold start (proves preload worked).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Schema syntax typo lets bad seed through validator silently | Low | Post-deploy smoke check fetches config and asserts shape |
| Lambda Extension ARN drifts (AWS deprecates version) | Low | Resolved at template synth via SSM public parameter, not hand-copied |
| CFN rollback on Commit A leaves stack in ROLLBACK_FAILED | Very low | Failure is on a leaf resource (HCV) with no dependencies; CFN unwinds cleanly |
| Drift between `reply-ai.js` SYSTEM_PROMPT and AppConfig content | Eliminated by design | Single source of truth at `config/system-prompt.seed.json` |
| Vercel auto-deploys to main during the failed-rollback window | Medium | Cosmetic noise only — Vercel doesn't read AppConfig. Document in Commit A body. Pre-announce window. |
| Module-cached AppConfig fetch in Lambda doesn't pick up new versions until container recycles | Medium (by design) | Acceptable at 10 msg/day — config changes propagate within minutes via natural Lambda churn. AppConfig Extension polls every 45s by default (vs once per Lambda init), but module-cache is the explicit choice for Phase 2 simplicity. |
| AppConfig deployment fails midway (rare) | Low | `aws appconfig stop-deployment` or `aws appconfig revert-deployment`. Manual revert path documented. |
| Cold-start latency stacks across the chain (4 sequential Lambdas) | Acknowledged | Extension preload (`AWS_APPCONFIG_EXTENSION_PRELOAD_LIST`) does fetch at init. p99 latency adds ~150-300ms per cold Lambda × ~2 active Drafter/Reviser cold containers = ~300-600ms worst case. Acceptable at this volume. |

## Decision log

### Decision 1: Same SAM stack as Phase 1.5 (not a separate config stack)

**Picked over:** Splitting into `casa-coqui-reply-agent-config` for AppConfig + SSM, keeping runtime Lambdas in `casa-coqui-reply-agent`.

**Why:**
- Plan §3 explicitly designs the same-stack pattern for the W7 pedagogy ("CFN deploys the AppConfig Application + ConfigurationProfile + HostedConfigurationVersion in one stack — and the HostedConfigurationVersion fails validator at create time, rolling back the entire CFN stack")
- Risk is genuinely low: CFN rollback target is last UPDATE_COMPLETE; Phase 1.5 chain Lambdas remain intact
- Worst case is cosmetic (orphaned AppConfig Application resource), recoverable via `aws appconfig delete-application`

### Decision 2: SSM read happens once in LoadConfig, threads through state

**Picked over:** Each chain Lambda independently fetches SSM.

**Why:**
- Single SSM call per workflow vs 4 (one per active chain step)
- Cleaner separation of concerns: LoadConfig owns runtime config, chain Lambdas own algorithm
- ASL `$.config` already threads through to inner SFN (Phase 1.5 Task 8 confirmed)
- Matches plan §1 architecture diagram

### Decision 3: Only Drafter + Reviser get AppConfig integration

**Picked over:** All 4 Lambdas attaching the Extension; or moving REASONER_PROMPT and EVALUATOR_PROMPT to AppConfig too.

**Why:**
- The validator schema (`version`, `language_distribution`, `hard_bans`, `system_prompt_text`) is the host voice config, not algorithm prompts
- REASONER_PROMPT and EVALUATOR_PROMPT are algorithm contracts — they describe HOW to classify and HOW to score, not WHAT voice to use. Moving them to AppConfig conflates config with code.
- Smaller scope = smaller blast radius for the W7 trap
- 5-Lambda-Layer cap unchanged (still 1/5 used)

### Decision 4: Single source of truth for SYSTEM_PROMPT (`config/system-prompt.seed.json`)

**Picked over:** AppConfig as new source, leaving `reply-ai.js` SYSTEM_PROMPT as a separate copy that drifts.

**Why:**
- Two staff engineers independently flagged this as the highest-likelihood Phase 2 risk
- 1-3 week Phase 2 → Phase 3 window where both readers exist (JS chain still serves prod; AppConfig serves the SAM SFN test path)
- File-based shared source is the cheapest fix — both readers parse the same JSON

### Decision 5: AppConfig version stamping into draft output

**Picked over:** Skipping observability for Phase 2.

**Why:**
- Two staff engineers independently flagged "no forensic trail when prompt produces a bad reply"
- Cost is trivial: capture response header in Drafter/Reviser, propagate via SFN ResultSelector
- Phase 3 WriteBack persists it to Firestore. Post-Phase-3 debugging "which prompt version produced this" becomes a one-line query.

### Decision 6: Lambda Extension ARN via SSM public parameter

**Picked over:** Hand-copied ARN with version pinned.

**Why:**
- AWS deprecates extension versions over time
- SSM public parameter `/aws/service/appconfig/extension/arm64/<version>` resolves at deploy time
- Updates are explicit but painless (change template Default once)

### Decision 7: Linear 10%/1min/5min-bake DeploymentStrategy

**Picked over:** AllAtOnce (which AWS staff engineer #1 recommended for our 10 msg/day volume).

**Why:**
- Plan §4.2 explicitly prescribes Linear 10%/1min with 5min bake
- It IS theatre at our volume — 6 minutes of rollout for a system that processes one message every 2.4 hours sees zero traffic during the rollout window
- BUT the goal is the AppConfig deployment-strategy concept itself (W7 exam point); using AllAtOnce defeats the lesson
- Acknowledged tradeoff, not a defect

### Decision 8: Two-commit break-it sequence on main

**Picked over:** One commit (broken-in-flight, fixed-before-commit) or three commits (broken split from working changes).

**Why:**
- User explicitly chose the two-commit pedagogical sequence
- Preserves the lesson in git history: future-you can see "we deployed this broken state, here's what failed"
- Real CFN rollback observed firsthand
- Phase 1.5 stack stays intact through the broken-deploy window

### Decision 9: `feature-flags` ConfigurationProfile shipped with no Phase 2 consumer

**Picked over:** Skipping the profile until Phase 3 needs it; or wiring a no-op consumer.

**Why:**
- Plan §4.2 explicitly defines both profiles in Phase 2
- Phase 3 wires the Cloud Function to read it — keeps the Phase 3 PR small
- Risk of "shipping a flag that nothing reads" mitigated by spec-locking the contract here:
  - Flag name: `reply_engine`
  - Attribute `mode`: enum `firebase` | `aws-sfn` | `shadow`
  - Attribute `rollout_pct`: number, 0-100
  - Phase 3 Cloud Function reader MUST honor these field names exactly

## Files touched

### Created
- `infra/sam/reply-agent/config/system-prompt.seed.json` — single source of truth for host voice config
- `infra/sam/reply-agent/config/system-prompt.schema.json` — JSON Schema validator content (referenced by template)
- `infra/sam/reply-agent/config/feature-flags.seed.json` — initial feature flag content
- `infra/sam/reply-agent/scripts/verify-appconfig.sh` — post-deploy smoke check (asserts `version` field present in deployed config)

### Modified
- `infra/sam/reply-agent/template.yaml` — adds Parameters/Resources for SSM, AppConfig, Extension layer, IAM
- `infra/sam/reply-agent/functions/load-config/index.js` — stub → real (SSM fetch)
- `infra/sam/reply-agent/functions/load-config/package.json` — adds `@aws-sdk/client-ssm`
- `infra/sam/reply-agent/functions/drafter/index.js` — AppConfig fetch + version capture + remove voicePrompt requirement
- `infra/sam/reply-agent/functions/reviser/index.js` — same as drafter
- `infra/sam/reply-agent/functions/reasoner/index.js` — minor: prefer `event.config.model`
- `infra/sam/reply-agent/functions/evaluator/index.js` — minor: prefer `event.config.model`
- `infra/sam/reply-agent/statemachines/ai-chain.asl.json` — extend Drafter/Reviser ResultSelector to capture `appConfigVersion`
- `functions/lib/reply-ai.js` — replace inline `SYSTEM_PROMPT` with file-based read of `config/system-prompt.seed.json`

### Unchanged
- `infra/sam/reply-agent/functions/{rag-retrieve,write-back}/index.js` — still stubs (Phase 3)
- `infra/sam/reply-agent/statemachines/reply-draft.asl.json` — `$.config` already threads through (Phase 1.5 Task 8 fix)
- `functions/index.js` — Phase 3 wires the bridge
- `functions/lib/reply-agent-chain.js` — still serves production until Phase 3 cuts over

## Acceptance criteria

1. **Commit A `sam deploy` FAILS** with CFN error mentioning AppConfig validator on `HostedConfigurationVersion` resource. CFN events show `CREATE_FAILED` on the system-prompt HCV, then UPDATE_ROLLBACK_COMPLETE.
2. **Commit B `sam deploy` succeeds** to UPDATE_COMPLETE. New resources visible: 2 SSM Params, AppConfig App, Env, 2 ConfigurationProfiles, DeploymentStrategy, 2 HCVs, 2 Deployments. AppConfig deployment for `system-prompt` progresses through linear rollout.
3. **`scripts/verify-appconfig.sh` passes**: fetched config contains `version` field with value `"1.0.0"`.
4. **`./scripts/test-sfn.sh` passes**: SFN executes end-to-end against `samples/full-input.json`, status `SUCCEEDED`, real reply produced. Token counts > 0 on all active chain steps.
5. **`appConfigVersion` propagates**: SFN execution output's `chainResult.output.drafter.appConfigVersion` is the version ID returned by AppConfig (e.g., `"1"`).
6. **CloudWatch logs** for `/aws/lambda/casa-coqui-reply-drafter` show Lambda Extension init at cold start (proves preload).
7. **No drift**: `functions/lib/reply-ai.js` reads `system_prompt_text` from `config/system-prompt.seed.json`; existing JS chain via `generateReply` produces identical output to pre-Phase-2.

## Open issues (non-blocking)

- **W6 SecureString trap was missed in Phase 1** (we used Secrets Manager from the start). Phase 2 delivers W7 only, not the W6+W7 stacked lesson Plan §3 envisioned. Pedagogy is degraded but real.
- **Vercel auto-deploys on main during the broken-deploy window**: not coupled (Vercel doesn't read AWS resources), but observability gets noisy. Pre-announce window.
- **Module-cached AppConfig fetch vs Extension's 45s polling**: module cache means a config change takes effect on next cold start, not within 45s. At 10 msg/day, cold starts are common — propagation effective within minutes. Phase 4+ may switch to per-invocation reads if hot-tune speed becomes important.

## Estimated effort

2 hours, roughly:
- 30 min — extract SYSTEM_PROMPT to shared file, update reply-ai.js, write seed JSON
- 30 min — template.yaml additions (SSM, AppConfig App/Env/Profiles/Strategy/HCVs/Deployments, IAM)
- 20 min — LoadConfig stub → real (SSM fetch)
- 30 min — Drafter + Reviser AppConfig integration (both byte-identical pattern again)
- 10 min — Reasoner + Evaluator minor `event.config.model` change
- 5 min — ai-chain.asl.json ResultSelector extension
- 10 min — `scripts/verify-appconfig.sh` post-deploy smoke check
- 10 min — Commit A `sam deploy` (expect failure), CFN events review, document findings
- 5 min — Commit B add `version`, `sam deploy`, success
- 10 min — verify acceptance criteria
- buffer for first-deploy debugging

## Phase 2 → Phase 3 handoff state

After Phase 2 ships:
- AppConfig holds the host voice prompt; Drafter+Reviser fetch from it
- SSM holds model knobs; LoadConfig fetches them once at workflow start
- `feature-flags` profile defined with `reply_engine` flag — **no consumer in Phase 2**, Phase 3 wires `functions/index.js` `onAirbnbMessageCreated` to read it before deciding which path to run
- Phase 1.5's chain Lambdas stay deployed and functional
- Production traffic still flows through `functions/lib/reply-agent-chain.js` (no SFN traffic yet — bridge is Phase 3)
- `_agentRun.appConfigVersion` plumbing is wired in chain output but WriteBack is still a stub; persistence to `agent_runs` collection happens in Phase 3
