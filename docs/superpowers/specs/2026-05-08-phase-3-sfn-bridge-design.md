# Phase 3 — SFN Bridge + DLQ + Alarms + Auto-Rollback

**Date**: 2026-05-08 (revised after multi-perspective review)
**Master plan reference**: `/Users/jperez/dev/JulioOS/01 - Projects/AWS DevOps Professional/casa-coqui-sfn-refactor-plan.md` §4.3 (JulioOS-local, not in repo)
**Predecessor**: [2026-05-07-phase2-appconfig-design.md](./2026-05-07-phase2-appconfig-design.md)
**Status**: REVISED v2 — all reviewer concerns folded in; ready for plan

---

## Revision history

- **v1** (initial draft) — circulated to cloud / staff / AWS / AI reviewers
- **v2** — incorporated 4-of-4 NEEDS REVISION feedback:
  - Fixed AWS correctness blockers (ASL Catch shape, DLQ field paths, Monitor on `Environment` not `DeploymentStrategy`, `appconfigdata:` IAM namespace, `TreatMissingData: notBreaching`)
  - Reframed AppConfig Monitor scope: infra failure only, not draft-quality regression
  - Added fail-closed contract for AppConfig/Secrets failures (route to legacy)
  - Added bridge-side observability (success/fail/legacy-fallback metrics)
  - Refactored routing to pure `decideRoute()` for testability
  - Added explicit deploy-ordering requirement (SAM first, then merge CF)
  - Added Phase 4.5 stub for JS-chain decommission with CI hash drift check
  - Added `_agentRun.routedBy` for observability segmentation across regenerate vs rollout
  - Decision 7 simplified: skip-on-`editedReply` instead of executionArn key
  - Decision 9 promoted: "Retry" button in admin UI (not manual Firestore flip) — regenerate API exists this phase, button is essentially free
  - Decision 5 retained with rotation runbook addendum
- **v3** (this) — incorporates 4-of-4 GREEN-LIGHT-with-nits feedback from re-review:
  - **Should-fix A**: `BridgeFailureLogMetric` mechanism corrected — Firebase Cloud Function logs land in GCP Stackdriver, not CloudWatch. Bridge now emits CloudWatch EMF metrics directly via `PutMetricData` from the Cloud Function (using the bridge IAM user's creds). `Logs::MetricFilter` removed; replaced with EMF-fed `BridgeFailureAlarm`.
  - **Should-fix B**: WriteBack persists `_agentRun.inputTokens`, `outputTokens`, `latencyMs` — matches the JS chain's existing telemetry, gives Phase 4 ramp per-bucket cost visibility.
  - **Nits folded in**:
    - Regenerate button disabled in admin UI when `editedReply` is set (surfaces Decision 7 tradeoff in UX).
    - Rotation runbook step 6: 24h soak before key deletion (not 1h — Cloud Function instance lifetime exceeds 1h).
    - Context-window `.slice(-20)` port to SFN's input builder is now a hard scope item (was conditional on smoke).
    - AppConfig validator regex constrains prod `mode` to `^(firebase|aws-sfn)$` — closes the Decision 11 shadow-footgun.
    - AC #15(a) routedBy stamp clarified: `'rollout-routed'` (SFN selected) vs `'rollout-gated'` (legacy selected by % gate) vs `'legacy-fallback'` (AppConfig error).
    - Open issue: confirm Evaluator EMF prerequisites for Phase 3.5 quality monitor.

---

## Goal

Wire the Cloud Function `onAirbnbMessageCreated` to the SAM Step Functions chain (`casa-coqui-reply-agent`). Production Airbnb traffic begins flowing through SFN at a controllable percentage (`rollout_pct`) governed by the AppConfig `feature-flags.reply_engine` flag shipped in Phase 2. Failures land in a SQS DLQ; alarm-driven SNS notifies Julio. AppConfig Monitor auto-rolls back the system-prompt deployment **on infra failure only** (note: this is NOT draft-quality regression detection — see Decision 14). The WriteBack Lambda becomes real and persists results to Firestore identically to the JS chain, with `_agentRun.appConfigVersion` for forensic tracing and `_agentRun.routedBy` for analytics segmentation.

## Non-goals

- **Phase 6 staff push-notification refactor.** Tracked in master plan §4.6.
- **Migrating the regenerate flow off the JS chain entirely.** Phase 3 adds a new `regenerate` API route that calls StartExecution; legacy regenerate via the JS chain stays as fallback for `mode: firebase` traffic.
- **OIDC federation Firebase→AWS.** Master plan §6 Q5 raised this; deferred. Decision 5 stays with long-lived IAM user + rotation runbook.
- **Shadow mode evaluation tooling.** The `mode: shadow` enum value remains in the deployed AppConfig schema for future use, but Phase 3 treats it as `firebase`. **Real shadow mode (run both, log diff) requires its own spec.** See Decision 11.
- **DLQ redrive automation.** Failed executions surface via SNS email; redrive is a one-click "Retry" button in `/admin/messages` that calls the regenerate API (Decision 9, revised). A dedicated redrive Lambda is not built.
- **Phase 4 traffic ramp.** Phase 3 ships at `rollout_pct: 0`. Decision to raise % is a separate Phase 4 plan.
- **JS-chain decommission.** Phase 3 leaves `functions/lib/reply-agent-chain.js` and `functions/lib/reply-ai.js` intact for the legacy path. **Phase 4.5 deletes both** once 100% traffic is on SFN; see Phase 3 → Phase 4 handoff section.
- **Draft-quality auto-rollback.** Phase 3's AppConfig Monitor watches infrastructure failure (`SFNExecutionsFailed`), not voice-score regression. Quality-driven rollback requires Evaluator EMF metrics — out of scope for this phase. See Decision 14.

## Scope

### Resources to add to existing `casa-coqui-reply-agent` SAM stack

| Resource | Type | Purpose |
|---|---|---|
| `ReplyDraftDLQ` | `AWS::SQS::Queue` | Captures SFN executions that exhaust retry budget. `MessageRetentionPeriod: 1209600` (14 days). `SqsManagedSseEnabled: true` (server-side encryption — payloads include error stacks that may contain Firestore IDs / threadKeys). No `RedrivePolicy` (terminal). |
| `ReplyDraftFailureTopic` | `AWS::SNS::Topic` | Email alerts for DLQ messages. One subscription: `01juliop@gmail.com`. |
| `DLQNotifierFunction` | `AWS::Serverless::Function` | SQS-triggered Lambda. Reads DLQ message, formats `{ messageId, executionArn, error, threadKey }`, publishes to SNS. |
| `WriteBackFunction` | (existing stub becomes real) | Adds `firebase-admin` SDK + `casa-coqui/firebase-service-account` Secrets Manager access. Updates `airbnb_messages/{id}` with draft fields + `_agentRun.appConfigVersion` + `_agentRun.routedBy` + `_agentRun.inputTokens` + `_agentRun.outputTokens` + `_agentRun.latencyMs` (cost/telemetry parity with JS chain — see Decision 17). **Idempotency: skip if `editedReply` is set on the inbound** (Decision 7 — host-edit protection via existing signal). |
| `BridgeIamUser` | `AWS::IAM::User` | `casa-coqui-firebase-bridge`. Long-lived access key stored in Firebase Functions secrets. Scoped policy: `states:StartExecution` on `ReplyDraftStateMachine` ARN ONLY; `appconfigdata:StartConfigurationSession` + `appconfigdata:GetLatestConfiguration` on the `feature-flags` ConfigurationProfile ARN ONLY; `cloudwatch:PutMetricData` constrained to namespace `CasaCoqui/Bridge` via condition (for EMF emission — see "Bridge metrics"). |
| `SFNExecutionsFailedAlarm` | `AWS::CloudWatch::Alarm` | `Metric: AWS/States ExecutionsFailed`, `Threshold: 2`, `EvaluationPeriods: 3`, `DatapointsToAlarm: 2`, `Period: 60` (1-min). **`TreatMissingData: notBreaching`** (low-volume app — without this, alarm sits in `INSUFFICIENT_DATA` and never fires). Wired to SNS + `SystemPromptMonitor`. |
| `BridgeFailureAlarm` | `AWS::CloudWatch::Alarm` | Watches custom metric `CasaCoqui/Bridge.BridgeRouteFailures` (emitted via `PutMetricData` from inside the Cloud Function — see "Bridge metrics" below; **NOT a `Logs::MetricFilter` — Firebase logs land in GCP Stackdriver, not CloudWatch**). `> 5 in 5min`. SNS only (informational). Catches the silent-stuck-pending bug Phase 0 originally fixed. |
| `AnthropicThrottlesAlarm` | `AWS::CloudWatch::Alarm` | EMF metric from chain Lambdas. `> 20 in 1 min`. SNS only. |
| `LatencyP95Alarm` | `AWS::CloudWatch::Alarm` | SFN execution duration p95 > 30s. SNS only. |
| `SystemPromptMonitor` | Property of `AWS::AppConfig::Environment` (existing `prod` env) | **Wires `SFNExecutionsFailedAlarm` ARN + `AlarmRoleArn` to the prod environment.** Auto-rollback fires when alarm enters ALARM state during a deployment of EITHER configuration profile. AppConfig Monitor lives on the `Environment` resource (or per-`Deployment`), NOT on `DeploymentStrategy`. |
| `AppConfigMonitorRole` | `AWS::IAM::Role` | Trust policy: `appconfig.amazonaws.com`. Permissions: `cloudwatch:DescribeAlarms`. Referenced by `SystemPromptMonitor.AlarmRoleArn`. |

### Code changes

| File | Change | Reason |
|---|---|---|
| `functions/lib/decide-route.js` | NEW. Pure function: `decideRoute({ messageId, flag })` → `{ engine: 'firebase' \| 'aws-sfn', reason: string }`. No side effects. Trivial unit-test surface. | Reviewer concern F: routing must be testable. |
| `functions/lib/aws-sfn-bridge.js` | NEW. Exports `startReplyDraftExecution({ message, ... })`. Builds SFN input matching the existing reply-draft input shape (`$.message.id`, `$.message.body`, `$.message.guestName`, `$.message.threadKey`, plus `contextJson`/`voicePrompt`/etc. — see ASL `samples/full-input.json` for the canonical shape). Uses `@aws-sdk/client-sfn`. Reads creds from Firebase secrets. **Emits CloudWatch EMF metrics** (`BridgeRouteFailures`, `BridgeRouteSuccesses`) via `@aws-sdk/client-cloudwatch.PutMetricData` to namespace `CasaCoqui/Bridge` — see "Bridge metrics" below. | The bridge. |
| `functions/lib/appconfig-client.js` | NEW. `getReplyEngineFlag()` — fetches `feature-flags.reply_engine` from AppConfig **Data API** (`appconfigdata:*`, NOT `appconfig:*`). 60s in-memory cache. **Fail-closed contract: on any error returns `{ mode: 'firebase', rollout_pct: 0 }` and increments the `BridgeRouteFailures` EMF counter (via `bridge-metrics.js`).** | Cloud Function isn't a Lambda; can't use the Lambda Extension sidecar. Fail-closed avoids retry storm during AppConfig outages. |
| `functions/lib/bridge-metrics.js` | NEW. Exports `emitBridgeMetric(name, value=1)` — wraps `@aws-sdk/client-cloudwatch.PutMetricData` to namespace `CasaCoqui/Bridge`. Used by `appconfig-client.js` and `aws-sfn-bridge.js`. Best-effort: failures here are swallowed + logged (we don't want metric-emission errors to break the request path). | EMF emission directly from the Cloud Function — Stackdriver-vs-CloudWatch fix. |
| `functions/index.js` (`onAirbnbMessageCreated`, ~line 214) | Insert: fetch flag → call `decideRoute()` → if `aws-sfn` call `startReplyDraftExecution()` (catch errors → fall back to legacy + log) → else legacy chain. Stamp `_agentRun.routedBy: 'rollout' \| 'legacy-fallback' \| 'regenerate'` for downstream segmentation. | The bridge wiring. |
| `app/api/airbnb-messages/[id]/regenerate/route.js` | NEW. POST. Auth-gated (admin/cohost). Calls `startReplyDraftExecution()` directly (always SFN — bypasses rollout gate per existing UX expectation). Stamps `_agentRun.routedBy: 'regenerate'`. **Rate limit: max 3 regenerations per inbound, tracked via `_agentRun.regenerateCount`; 30s cooldown via `_agentRun.lastRegenerateAt`.** Returns `{ executionArn }`. | Replaces the broken regenerate button; matches AI engineer concern #6 on abuse surface. |
| `app/admin/messages/page.js` | Wire existing "Regenerate" button to new API route. **Add "Retry" button on `draftStatus: failed` rows that calls the same API** (Decision 9 revised). **Disable Regenerate button when `inbound.editedReply` is set + non-empty** (surfaces the Decision 7 tradeoff in UX — host edits are sticky and won't be clobbered by a fresh draft). Remove call to legacy regenerate path. | UX completion + Decision 7 visibility. |
| `infra/sam/reply-agent/functions/write-back/index.js` | Stub → real. Reads Firebase service account secret, initializes `firebase-admin`, updates Firestore inbound doc. Persists `_agentRun.inputTokens`, `_agentRun.outputTokens`, `_agentRun.latencyMs` from the chain result (parity with JS chain — Decision 17). **Idempotency: if `inbound.editedReply` is set and non-empty, skip write and return `{ skipped: 'host_edit' }`** (Decision 7 — Option A). | WriteBack is the closing seam. Reuses existing `editedReply` signal from voice-learning loop. |
| `infra/sam/reply-agent/functions/write-back/package.json` | Add `firebase-admin`, `@aws-sdk/client-secrets-manager`. | Deps. |
| `infra/sam/reply-agent/template.yaml` | New resources per scope table. **Fix existing latent bug: change `appconfig:StartConfigurationSession` → `appconfigdata:StartConfigurationSession` on Drafter/Reviser policies** (AWS engineer concern #5). New IAM policy for WriteBack to read Firebase service account secret. New Catch redirects in ASL pointing to DLQ. | Stack changes. |
| `infra/sam/reply-agent/statemachines/reply-draft.asl.json` | **Per-state Catch redirects (NOT a top-level Catch — ASL doesn't support that):** Each existing `Next: WorkflowFailed` becomes `Next: SendToDLQ`. Insert new `SendToDLQ` Task state (uses `arn:aws:states:::sqs:sendMessage`) BEFORE the existing `WorkflowFailed` Fail state, with `Next: WorkflowFailed`. | DLQ wiring corrected per AWS engineer concern #1. |
| `scripts/check-prompt-drift.js` | NEW. CI script that hashes `system_prompt_text` from `infra/sam/reply-agent/config/system-prompt.seed.json`, the inline `SYSTEM_PROMPT` template literal in `lib/reply-ai.js`, and the inline in `functions/lib/reply-ai.js`. Fails build if any hash differs. | Reviewer concern A (Staff #1, AI #2): the cross-sync warning comments already failed once (Issue #1, c49adf3); CI check is the durable fix. |
| `.github/workflows/ci.yml` (or equivalent) | Add a step to run `node scripts/check-prompt-drift.js`. | Wires the drift check into CI. |

### IAM model

**Firebase Cloud Function → AWS** (long-lived IAM user — see Decision 5 + rotation runbook):
```yaml
User: casa-coqui-firebase-bridge
Policy:
  - Action: states:StartExecution
    Resource: arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft
  - Action:
      - appconfigdata:StartConfigurationSession   # NOT appconfig:* — Data API uses appconfigdata service prefix
      - appconfigdata:GetLatestConfiguration
    Resource: arn:aws:appconfig:us-east-1:524140443248:application/<app-id>/environment/<env-id>/configuration/feature-flags

Credentials stored in: Firebase Functions secrets via defineSecret('AWS_ACCESS_KEY_ID') + defineSecret('AWS_SECRET_ACCESS_KEY')
```

**WriteBack Lambda → Firebase**:
```yaml
Lambda role:
  - Action: secretsmanager:GetSecretValue
    Resource: arn:aws:secretsmanager:us-east-1:524140443248:secret:casa-coqui/firebase-service-account-*
Lambda code: initializeApp({ credential: cert(JSON.parse(secretValue)) })
```

**AppConfig Monitor role**:
```yaml
Role: AppConfigMonitorRole
TrustPolicy: { Service: appconfig.amazonaws.com }
Policy:
  - Action: cloudwatch:DescribeAlarms
    Resource: arn:aws:cloudwatch:us-east-1:524140443248:alarm:SFNExecutionsFailedAlarm
```

### Bridge metrics (Stackdriver-vs-CloudWatch correction)

The `BridgeFailureAlarm` watches a CloudWatch metric, but the Cloud Function runs on Firebase — its `console.log` lands in GCP Stackdriver, not CloudWatch Logs. A `Logs::MetricFilter` on a Firebase log group does not exist. The fix:

**Emit CloudWatch metrics directly from inside the Cloud Function** via `@aws-sdk/client-cloudwatch.PutMetricData`, using the same `BridgeIamUser` access key already provisioned for `StartExecution`. New helper module `functions/lib/bridge-metrics.js`:

```js
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const cw = new CloudWatchClient({ region: 'us-east-1', credentials: { ... } });

async function emitBridgeMetric(name, value = 1) {
  try {
    await cw.send(new PutMetricDataCommand({
      Namespace: 'CasaCoqui/Bridge',
      MetricData: [{ MetricName: name, Value: value, Unit: 'Count', Timestamp: new Date() }],
    }));
  } catch (e) {
    // Swallow + log — metric emission must never break the request path.
    console.warn('emitBridgeMetric failed', { name, error: e.message });
  }
}

module.exports = { emitBridgeMetric };
```

Metrics emitted:
- `BridgeRouteFailures` — incremented on AppConfig fetch errors, IAM/StartExecution failures, fall-back-to-legacy events.
- `BridgeRouteSuccesses` — incremented on each successful StartExecution.

`BridgeFailureAlarm` watches `BridgeRouteFailures > 5 in 5min`. `BridgeRouteSuccesses` is informational (CloudWatch dashboard).

**IAM addition**: `BridgeIamUser` policy gets `cloudwatch:PutMetricData` constrained by `Condition: { StringEquals: { 'cloudwatch:namespace': 'CasaCoqui/Bridge' } }` — least privilege, can't pollute other namespaces.

### IAM key rotation runbook (closes Cloud engineer concern on Decision 5)

Firebase Functions secrets are baked at deploy time — there is no native two-key-overlap rotation. Rotation requires zero-downtime workflow:

1. Create new IAM access key for `casa-coqui-firebase-bridge` (old key remains active).
2. Update Firebase secret values: `firebase functions:secrets:set AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
3. Redeploy Cloud Functions: `firebase deploy --only functions:onAirbnbMessageCreated`.
4. Verify: trigger a synthetic message at `mode: aws-sfn`, confirm successful StartExecution.
5. Disable (don't delete yet) old IAM access key.
6. **Wait 24h** for any cached credentials in long-lived Cloud Function instances to fail loud (Firebase Functions instance lifetime can exceed 1h; AWS SDK default credential cache is process-lifetime, not TTL-based — only an instance restart picks up the new secret).
7. Delete old access key.

**Cadence: quarterly, or immediately on suspected compromise.** Track in calendar.

### ASL changes (reply-draft.asl.json)

**Replace** every existing `"Next": "WorkflowFailed"` inside Catch blocks with `"Next": "SendToDLQ"`. Affected states: `LoadConfig`, `AIChainExecution`, `WriteBack` (3 sites; `RAGRetrieve`'s Catch routes to `AIChainExecution` and is non-fatal — leave it).

**Insert** the new `SendToDLQ` state BEFORE the existing `WorkflowFailed` Fail state:

```json
"SendToDLQ": {
  "Type": "Task",
  "Comment": "Send execution context to SQS DLQ for human-loop redrive",
  "Resource": "arn:aws:states:::sqs:sendMessage",
  "Parameters": {
    "QueueUrl": "${ReplyDraftDLQUrl}",
    "MessageBody": {
      "messageId.$": "$.message.id",
      "threadKey.$": "$.message.threadKey",
      "executionArn.$": "$$.Execution.Id",
      "error.$": "$.error"
    }
  },
  "Next": "WorkflowFailed"
}
```

**Also propagate `executionArn` + execution `startDate` into the WriteBack input** (v3.1 — AI engineer caught this; AC #5 requires `_agentRun.executionArn` but the existing ASL doesn't pass it). Modify the `WriteBack` Task's `Parameters.Payload` to inject context:

```json
"Parameters": {
  "FunctionName": "${WriteBackArn}",
  "Payload": {
    "input.$": "$",
    "executionArn.$": "$$.Execution.Id",
    "executionStartTime.$": "$$.Execution.StartTime"
  }
}
```

WriteBack reads `event.executionArn` to stamp `_agentRun.executionArn` and computes `_agentRun.latencyMs` from `event.executionStartTime` (Decision 17).

**Note**: SFN input shape uses `$.message` as a nested object (verified against `samples/full-input.json` and `AIChainExecution` state at line 73 of current ASL). DLQ field paths use `$.message.id` and `$.message.threadKey`, NOT `$.messageId` / `$.threadKey` flat.

**`WorkflowFailed`** stays as the terminal Fail state (so SQS send completes before failure is signaled to the SFN parent).

## Decision log

### Decision 1: Bridge lives in the Cloud Function, not in a relay Lambda
The master plan §1 architecture diagram places the routing decision in the Cloud Function. Alternative: ship a relay Lambda triggered by Firestore-via-EventBridge. Rejected — adds a moving piece, an EventBridge custom relay (Firestore→EventBridge isn't native), and an extra hop with no observability win.

### Decision 2: AppConfig Data API, not the Lambda Extension
The Cloud Function isn't a Lambda — Firebase Functions runtime can't load AWS Lambda extensions. Use `@aws-sdk/client-appconfigdata` directly with `StartConfigurationSession` + `GetLatestConfiguration`. **IAM service prefix is `appconfigdata:`, NOT `appconfig:`** (latent bug in Phase 2 template.yaml fixed in this phase).

### Decision 3: 60-second AppConfig cache TTL with fail-closed degradation
Same TTL as the Lambda Extension default. **On any AppConfig error (5xx, IAM denied, network timeout), `getReplyEngineFlag()` returns `{ mode: 'firebase', rollout_pct: 0 }` and emits a `BridgeRouteFailures` log line.** This makes AppConfig non-blocking for the Cloud Function — the worst-case outage is 100% traffic on legacy chain, identical to today's behavior. Closes reviewer concerns C/D.

### Decision 4: messageId hash, not random sampling
`crypto.createHash('sha256').update(messageId).digest().readUInt32BE(0) % 100`. Deterministic — same message always routes the same way. Random sampling loses the determinism property that makes incident reproduction tractable.

### Decision 5: Long-lived IAM user, NOT OIDC federation
Master plan §6 Q5 offered OIDC. Rejected for Phase 3 — adds ~1.5h, three new failure modes (clock skew, audience mismatch, trust policy errors), and Firebase Functions doesn't natively act as an OIDC IdP. Long-lived user with quarterly Secrets Manager rotation drills the W7 surface. **Mitigation for the rotation gap (Cloud reviewer concern):** the rotation runbook above is canonical and tracked in the spec.

### Decision 6: WriteBack uses `firebase-admin`, not Firestore REST API
`firebase-admin` SDK matches the JS chain's write semantics exactly, handles auth + retries, and reuses the existing `casa-coqui/firebase-service-account` Secrets Manager secret.

### Decision 7 (REVISED): WriteBack idempotency via `editedReply` signal — Option A
**Skip the write if `inbound.editedReply` is set and non-empty.** No new field, no key-based dedup.

Reasoning: SFN Standard guarantees exactly-once state transitions, so WriteBack-double-fire is rare (AWS engineer's correction to v1's executionArn-keyed approach). The actual host-edit-clobber risk Julio cares about is single-operator: host edits a draft, regenerate fires, WriteBack overwrites the edit. The system already tracks edits via `editedReply` (used by the voice-learning loop). WriteBack just respects that signal:

```js
if (inbound.editedReply && inbound.editedReply.length > 0) {
  log('writeback_skipped_host_edit', { messageId });
  return { skipped: 'host_edit' };
}
await ref.update({ draftReply, draftRationale, draftStatus, _agentRun: {...}});
```

**Tradeoff acknowledged**: if regenerate intentionally produces a fresh draft AFTER a host has edited, the new draft won't land. This matches Julio's actual workflow (regenerate is "I don't like this draft, give me a new one" — done before edits, not after).

### Decision 8: DLQ retention 14 days, no redrive policy
Standard SQS retention. No redrive policy because there's no auto-redrive consumer — DLQ is a terminal state. **Server-side encryption enabled (`SqsManagedSseEnabled: true`)** since payloads include error stacks that may contain Firestore IDs / threadKeys.

### Decision 9 (REVISED): "Retry" button in `/admin/messages` for DLQ replay
v1 spec proposed manual Firestore flip; reviewer (Staff) pointed out the regenerate API exists in this same phase, so the button is essentially free. **Implementation:** add a "Retry" button to rows where `draftStatus: failed`. Clicking calls `POST /api/airbnb-messages/{id}/regenerate`. Same execution path as a fresh regenerate. Out-of-band: SNS email still fires for human awareness; the button is the in-app workflow.

### Decision 10: AppConfig Monitor scoped to AppConfig deployments only
Phase 2 shipped two ConfigurationProfiles: `feature-flags` and `system-prompt`. The Monitor lives on `AWS::AppConfig::Environment` (or per-`Deployment`) — NOT on `DeploymentStrategy` (v1 spec error). The Monitor watches CloudWatch alarms during a configuration deployment in this environment; if the alarm enters ALARM state, the deployment auto-rolls back. **Wire `SFNExecutionsFailedAlarm` to the prod environment with `AppConfigMonitorRole.AlarmRoleArn`.** Auto-rollback applies to deployments of EITHER profile (system-prompt or feature-flags) — there's no AppConfig surface for "monitor profile A but not profile B".

### Decision 11: Drop `mode: shadow` from the implemented runtime, constrain prod schema
The Phase 2 AppConfig schema enum is `["firebase", "aws-sfn", "shadow"]`. Phase 3 treats `shadow` as `firebase`. **Defense in depth (v3 update — staff reviewer nit):** tighten the JSON Schema validator on the `feature-flags` ConfigurationProfile so prod deployments cannot select shadow:

```json
"mode": {
  "type": "string",
  "pattern": "^(firebase|aws-sfn)$"
}
```

This means an admin attempting `mode: shadow` gets a validator failure at `CreateHostedConfigurationVersion` time (W7-style validator trap, but desirable). The enum stays in the seed file for a future shadow-mode spec to revive; until then, it's unreachable in prod. `decideRoute` still has a defensive `case 'shadow'` branch that logs `WARN shadow_mode_not_implemented_routing_to_legacy` in case any path bypasses the validator.

### Decision 12 (NEW): `_agentRun.routedBy` for observability segmentation
Every WriteBack writes `_agentRun.routedBy` for downstream analytics (closes Staff reviewer concern #2 — without this, Phase 4 ramp metrics get Simpson's-paradox contaminated). **v3 enum (clarified — Staff nit):**

| Value | Meaning |
|---|---|
| `'rollout-routed'` | `mode: aws-sfn` AND hash < rollout_pct → SFN ran. The "real" SFN traffic. |
| `'rollout-gated'` | `mode: aws-sfn` AND hash >= rollout_pct → JS chain ran. (Legacy run, but Phase 4 ramp data point — we know this guest WOULD have gone to SFN at higher %.) |
| `'firebase-explicit'` | `mode: firebase` → JS chain ran. Default state pre-ramp. |
| `'legacy-fallback'` | AppConfig fetch failed → JS chain ran fail-closed. Indicates infra problem. |
| `'regenerate'` | Host-triggered via the regenerate API. Always SFN. |
| `'shadow-stub'` | `mode: shadow` defensively reached `decideRoute` despite validator → JS chain ran with warn-log. |

Cleanly segments organic ramp data, fail-closed events, and regenerate-driven SFN traffic.

### Decision 13 (NEW): Fail-closed routing on AppConfig errors
The Cloud Function bridge is fail-closed: any error reaching `getReplyEngineFlag()` (AppConfig 5xx, IAM denied, timeout, malformed payload) returns the legacy default `{ mode: 'firebase', rollout_pct: 0 }`. The Function never blocks on AppConfig; AppConfig is never a routing-path SPOF. Reviewer concerns C/D.

### Decision 14 (NEW): AppConfig Monitor watches infrastructure failure, NOT draft quality
`SFNExecutionsFailedAlarm` fires on ASL/Lambda errors only. A bad system-prompt deploy that produces 100% SUCCEEDED executions with regressed replies will NOT trip the alarm and will NOT auto-rollback. **Auto-rollback in Phase 3 is "the workflow is broken," not "the prompt is bad."** Quality-driven rollback requires Evaluator to emit EMF metrics (e.g., `VoiceScoreLow`, `HardBanHit`) wired to a separate alarm — out of scope for Phase 3, deferred to a Phase 3.5 ("Quality monitor"). The spec does NOT advertise quality-driven rollback. (AI reviewer concern #1.)

### Decision 15 (NEW): Deploy ordering — SAM first, then merge CF
CodePipeline auto-deploys Cloud Functions on `git push origin main`. SAM is a manual `cdk deploy`-equivalent (`sam deploy`). **A merge that lands `aws-sfn-bridge.js` before SAM updates ASL/WriteBack ships traffic into a State Machine missing the DLQ Catch and a stub WriteBack.** Spec mandates:

1. PR contains both the CF code changes AND the SAM template changes.
2. Reviewer + Julio confirm SAM is deployed (`sam deploy --stack-name casa-coqui-reply-agent`) BEFORE merging the PR.
3. CodePipeline merge auto-ships the CF changes; first organic message at `rollout_pct > 0` (ramp begins in Phase 4) hits the already-deployed SFN.
4. Phase 3 ships at `rollout_pct: 0` regardless, so even if ordering slips, organic traffic stays on legacy. Regenerate API is the only exception — see Decision 16.

### Decision 18 (NEW v3.1): ESLint guard against client-side bridge import
Staff-engineer team review: if any client code path imports `aws-sfn-bridge.js` (e.g., a tree-shaking miss or accidental top-level require in a Next.js page), the bundler may inline `process.env.AWS_ACCESS_KEY_ID` references via `NEXT_PUBLIC_*` reflexes, leaking AWS keys into the client bundle.

Add an ESLint `no-restricted-imports` rule scoped to `app/` (Next.js client + server) that bans imports of `functions/lib/aws-sfn-bridge` and `functions/lib/bridge-metrics`. The regenerate API route at `app/api/airbnb-messages/[id]/regenerate/route.js` should construct its own minimal SFN client inline (it's a different runtime — Vercel — and uses different env-var injection).

### Decision 19 (NEW v3.1): F3 bridge insertion preserves context build
Original F3 proposal said "skip JS chain context build entirely" for `mode: aws-sfn` paths. AI + Staff engineer review caught the error: `samples/full-input.json` shows the SFN expects `contextJson`, `voicePrompt`, `voiceProfilePrompt`, `relevantConversations` ALL pre-built and passed in. The Reasoner Lambda has no Firestore access.

**Bridge insertion point is BETWEEN context build and the LLM call** (not before context build):
- Lines 240-330 of `functions/index.js` (booking lookup + thread fetch + contextJson + voicePrompt + voiceProfilePrompt + RAG): SHARED. Both paths build these.
- Line ~330: bridge dispatch. For `mode: aws-sfn`, call `startReplyDraftExecution(builtInputs)` and early-exit. For `mode: firebase` or fallback, fall through to `generateReplyChain()`.
- The cost saved on the SFN path is the Anthropic LLM call (the real money — ~$0.03/draft). The shared cost is Firestore reads + RAG embed (~$0.0001) — negligible for cost-comparison purposes.

This avoids: (a) duplicating `buildContextJson()` logic in the bridge, (b) granting the Reasoner Lambda Firestore IAM, (c) breaking the SFN input contract.

### Decision 16 (NEW): Regenerate API rate limiting + observability stamp
Regenerate ALWAYS routes to SFN (existing UX expectation; Cloud reviewer concern accepted by design). Mitigations:

- **Max 3 regenerations per inbound** via `_agentRun.regenerateCount` field on the inbound doc (incremented atomically).
- **30s server-side cooldown** via `_agentRun.lastRegenerateAt` (rejects if recent).
- **`_agentRun.routedBy: 'regenerate'`** for analytics segmentation.
- Client-side button disabled for 30s after click (UX).

This bounds the abuse/cost surface (AI reviewer concern #6) without changing the "regenerate goes to SFN" semantic.

### Decision 17 (NEW v3, REVISED v3.1): WriteBack-side token summation for cost parity
The JS chain persists `_agentRun.inputTokens`, `_agentRun.outputTokens`, `_agentRun.latencyMs` (`functions/lib/reply-ai.js:299-301`). v2 WriteBack omitted these — Phase 4 ramp would have lost per-bucket cost telemetry.

**v3 (initial)** assumed AIChain's terminal `Succeed` state aggregated tokens. **AWS-engineer review caught the error**: `ai-chain.asl.json` has NO top-level aggregation. Per-stage tokens live at `$.reasoner.tokens`, `$.drafter.tokens`, `$.evaluator.tokens`, `$.reviser?.tokens`. The terminal `Succeed` passes the full `$` upward to `reply-draft.asl.json:83-85` which aliases it to `chainResult.output`.

**v3.1 fix:** WriteBack-side summation in JavaScript (NOT an ASL Pass state). Cleaner, testable, single place, no fork across the three terminal paths (`ChainSucceeded`, `UseEvaluatorRevision`, `PromoteReviserResult`):

```js
// in write-back/index.js
const { reasoner, drafter, evaluator, reviser } = chainResult.output;
const inputTokens =
  (reasoner?.tokens?.input ?? 0) +
  (drafter?.tokens?.input ?? 0) +
  (evaluator?.tokens?.input ?? 0) +
  (reviser?.tokens?.input ?? 0);
const outputTokens =
  (reasoner?.tokens?.output ?? 0) +
  (drafter?.tokens?.output ?? 0) +
  (evaluator?.tokens?.output ?? 0) +
  (reviser?.tokens?.output ?? 0);
```

**`latencyMs` deferred to Phase 3.1**: AWS-engineer review confirmed the chain Lambdas don't return `latencyMs` (drafter:207-214 returns `{draft, tokens, appConfigVersion}` only). Either modify all 4 Lambdas or compute from SFN execution metadata. **For Phase 3, use the SFN execution duration as a proxy:** `_agentRun.latencyMs = (Date.now() - new Date(execution.startDate).getTime())` computed inside WriteBack from `$$.Execution.StartTime` and the WriteBack invocation time. Acceptable approximation; tightens to per-Lambda granularity in Phase 3.1.

**`appConfigVersion` precedence**: read from `$.drafter.appConfigVersion` first (always present); fall back to `$.reviser.appConfigVersion` if drafter is missing. Document the precedence in WriteBack header comment.

**Smoke must assert `inputTokens > 0 AND outputTokens > 0`** (one-sided assertion hides selector mistakes — AI engineer's note).

## The W7 Break-It Trap (pedagogical)

**Intentional bug:** Ship the WriteBack Lambda's IAM role missing `secretsmanager:GetSecretValue` on the Firebase service account secret. Lambda crashes at first invocation. SFN catches the error, sends to DLQ via the new `SendToDLQ` Task, SNS email fires. Julio reads CloudWatch logs, sees `AccessDenied` on Secrets Manager, fixes the IAM policy in template.yaml, redeploys.

**Pedagogical value:** Cross-cloud secret access requires explicit IAM grants. The `Secrets Manager:GetSecretValue` permission isn't covered by the broad `AWSLambdaBasicExecutionRole`. Drills runtime IAM debugging.

**Two-commit sequence on a feature branch (not main):** Per Staff reviewer concern #6 v1 trap shipped broken code to main. v2 trap is gated:

- Commit A on `feat/phase-3-sfn-bridge` branch: `feat(sam/reply-agent): wire WriteBack to firebase-admin [INTENTIONAL: missing IAM grant]`
- Commit B on same branch: `fix(sam/reply-agent): add SecretsManager:GetSecretValue grant to WriteBack role`

Branch is squash-merged to main as one commit. Trap is preserved in the branch's commit history (and in the change log) for the lab record, but main never sees the broken state.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AppConfig Data API call latency adds cold-start time | medium | ~200ms first invocation | Pre-fetch on Cloud Function module load; cache 60s; fail-closed to legacy on error |
| Hash distribution skewed (sha256 mod 100) | low | rollout_pct doesn't deliver actual % | sha256 is uniform; OK for sample sizes ≥ 1000 |
| WriteBack at-least-once invocation overwrites a host edit | low | host edit clobbered | Decision 7: skip-on-`editedReply` |
| StateMachine errors at LoadConfig don't reach DLQ | low | error invisible | Per-state Catch on every existing state already routes to `SendToDLQ` (per ASL changes); verified by synthetic injection |
| Long-lived IAM user key leaks via Firebase secrets exposure | low | bounded blast radius (one StartExecution action) | Quarterly rotation runbook; alarm on unusual StartExecution rate |
| IAM key rotation causes brief outage on redeploy | medium | <5min during rotation | Documented runbook; rotation during low-traffic window |
| AppConfig is down → bridge fails → traffic blocks | mitigated | none | Decision 13 fail-closed: bridge falls back to legacy on AppConfig error |
| Bridge-side failures invisible (no SFN alarm catches them) | medium | silent stuck-pending | `BridgeFailureLogMetric` + `BridgeFailureAlarm` on Cloud Function logs |
| SNS email fan-out at 3am | medium | sleep impact | Only `SFNExecutionsFailed` and `BridgeRouteFailures > 5` wired to email |
| AppConfig Monitor flap during canary | medium | cycling rollouts | 2-of-3 datapoints + `TreatMissingData: notBreaching` + 5-min bake on deployment strategy |
| Bad prompt produces good executions, alarm doesn't fire | accepted | Phase 3 doesn't claim quality monitoring | Decision 14: explicit non-goal; quality monitor is Phase 3.5 |
| Regenerate API spam / abuse | low | cost spike | Decision 16: 3-per-message cap + 30s cooldown + admin auth gate |
| Prompt drift between JS chain inline + AppConfig HCV + seed file | high | voice divergence between rollout buckets | `scripts/check-prompt-drift.js` CI check; Phase 4.5 deletes JS chain |
| Shadow mode confusion if operator picks it | low | silent legacy | Decision 11: warn-log on shadow path; spec it as not-implemented |
| Deploy ordering slip (CF before SAM) | low (zero traffic at rollout_pct 0) | none in practice | Decision 15: PR review checklist requires SAM-deployed confirmation |

## Files touched

### Created
```
docs/superpowers/
├── plans/2026-05-08-phase-3-sfn-bridge.md   ← NEW: implementation plan
└── specs/2026-05-08-phase-3-sfn-bridge-design.md  ← THIS FILE

functions/lib/
├── decide-route.js                           ← NEW: pure routing function
├── aws-sfn-bridge.js                         ← NEW: StartExecution wrapper
└── appconfig-client.js                       ← NEW: AppConfig Data API client w/ cache + fail-closed

app/api/airbnb-messages/[id]/regenerate/
└── route.js                                  ← NEW: POST handler with rate limit

scripts/
└── check-prompt-drift.js                     ← NEW: CI hash check across 3 prompt sources

tests/
├── decide-route.test.js                      ← NEW: pure-function unit tests
├── aws-sfn-bridge.test.js                    ← NEW: bridge tests (mocked SFN client)
└── appconfig-client.test.js                  ← NEW: fail-closed contract tests
```

### Modified
```
functions/
└── index.js                                   ← bridge call inserted in onAirbnbMessageCreated

app/admin/messages/
└── page.js                                    ← regenerate button + Retry button

infra/sam/reply-agent/
├── template.yaml                              ← +DLQ, +SNS, +DLQNotifier, +alarms, +Monitor on Environment, +AppConfigMonitorRole, +BridgeIamUser, +IAM fixes (appconfigdata:*)
├── statemachines/reply-draft.asl.json         ← per-state Catch redirects to SendToDLQ
└── functions/write-back/
    ├── index.js                               ← stub → real (firebase-admin + Firestore + skip-on-editedReply)
    └── package.json                           ← +firebase-admin, +@aws-sdk/client-secrets-manager

.github/workflows/ci.yml (or equivalent)       ← +prompt-drift check step
```

### Unchanged (explicit)
```
functions/lib/reply-agent-chain.js             ← serves mode:firebase + legacy-fallback (deleted in Phase 4.5)
functions/lib/reply-ai.js                      ← inlines SYSTEM_PROMPT for legacy path (deleted in Phase 4.5)
infra/sam/reply-agent/functions/{reasoner,drafter,evaluator,reviser}/index.js  ← Phase 2 versions stay
infra/sam/reply-agent/statemachines/ai-chain.asl.json  ← Phase 2 stays
firestore.rules                                ← no schema changes
firestore.indexes.json                         ← no new queries
```

## Acceptance criteria

A successful Phase 3 deploy must satisfy ALL of:

1. **Bridge wiring** — `functions/index.js` calls `appconfigClient.getReplyEngineFlag()` on every invocation; result cached 60s; on error returns legacy default + emits `BridgeRouteFailures` log line (fail-closed).
2. **Pure routing function** — `decideRoute({ messageId, flag })` is a pure function; unit tests cover (a) `mode: firebase` always legacy, (b) `mode: aws-sfn` + hash < rollout_pct → SFN, (c) `mode: aws-sfn` + hash >= rollout_pct → legacy, (d) `mode: shadow` → legacy + warn log, (e) any malformed flag → legacy.
3. **StartExecution permission** — IAM user `casa-coqui-firebase-bridge` can `StartExecution` on the StateMachine ARN; cannot `DescribeExecution` on the same; cannot StartExecution on any other SM (verified via `aws iam simulate-principal-policy`).
4. **`appconfigdata:` IAM** — both new bridge user policies AND Phase 2's Drafter/Reviser policies use `appconfigdata:*`, never `appconfig:*`.
5. **WriteBack persists correctly** — Lambda updates `airbnb_messages/{id}` with `draftReply`, `draftRationale`, `draftStatus: ready|escalated`, `_agentRun.appConfigVersion`, `_agentRun.routedBy`, `_agentRun.executionArn`, `_agentRun.inputTokens`, `_agentRun.outputTokens`, `_agentRun.latencyMs` (Decision 17 — cost parity with JS chain). Skips with `{ skipped: 'host_edit' }` when `inbound.editedReply` is set.
6. **DLQ catches per-state failures** — Synthetic failure injection at LoadConfig, AIChainExecution, and WriteBack each lands a message on the DLQ with correct `messageId` and `threadKey` field paths.
7. **DLQ → SNS email arrives** — `01juliop@gmail.com` receives email with messageId, executionArn, error within ~30s of the failure.
8. **SFN alarm fires + Monitor rolls back** — Inject 3 synthetic failures over 2 min (matching `Threshold:2, EvaluationPeriods:3, DatapointsToAlarm:2, Period:60`); alarm reaches ALARM. **`TreatMissingData: notBreaching` set** so prior 12h of zero-traffic doesn't lock alarm in INSUFFICIENT_DATA. AppConfig auto-rollback fires on the active deployment.
9. **Bridge failure alarm exists** — `BridgeFailureLogMetric` exists; alarm fires when 5+ AppConfig errors land in the Cloud Function logs over 5 min.
10. **Regenerate API works + rate limited** — Authed POST returns `{ executionArn }` and stamps `routedBy: 'regenerate'`. 4th regeneration on same inbound returns 429 (cap of 3). Two regenerations within 30s: second returns 429.
11. **Retry button + Regenerate gating in admin UI** — Failed-status rows show a Retry button; click triggers regenerate API; UI updates within 30s. Regenerate button is disabled (with explanatory tooltip) when `inbound.editedReply` is set + non-empty.
12. **Prompt drift check** — CI script fails build when `system_prompt_text` hashes differ across the 3 sources; passes when all match.
13. **Cross-sync warnings updated** — `lib/reply-ai.js`, `functions/lib/reply-ai.js`, `system-prompt.seed.json` headers note that the CI drift check is the canonical sync enforcement (replacing comment-based warnings).
14. **Rollout starts at 0%, validator constrains mode** — `feature-flags.reply_engine.rollout_pct` deployed at `0`. JSON Schema validator on `feature-flags` profile rejects `mode: shadow` per Decision 11 (`pattern: '^(firebase|aws-sfn)$'`). Verified by attempting `mode: shadow` HCV creation and observing validator failure.

15. **Bridge metrics emitted** — `BridgeRouteSuccesses` and `BridgeRouteFailures` appear in CloudWatch namespace `CasaCoqui/Bridge` after synthetic invocations. `BridgeFailureAlarm` enters ALARM state when 6 synthetic AppConfig errors are induced over 4 min.

16. **Context window parity** — Synthetic comparison: a thread with 25 prior messages produces identical `_agentRun.thread.length` (clipped to 20) on both legacy and SFN paths. If the SFN path's input builder (Reasoner Lambda or its caller) builds its own thread, port `.slice(-20)` to it as part of Phase 3 (not deferred — AI reviewer concern, hard scope).
17. **Synthetic smoke verifies all routing paths**:
    - (a) Synthetic inbound at `rollout_pct: 0, mode: aws-sfn` → JS chain runs (gated out by hash) → `routedBy: 'rollout-gated'`
    - (b) Synthetic inbound at `rollout_pct: 100, mode: aws-sfn` → SFN runs → WriteBack writes `_agentRun.appConfigVersion`, `_agentRun.routedBy: 'rollout-routed'`, `_agentRun.inputTokens`, `_agentRun.outputTokens`, `_agentRun.latencyMs`
    - (c) Synthetic inbound at `mode: firebase` → JS chain runs → `routedBy: 'firebase-explicit'`
    - (d) Synthetic AppConfig 500 → fail-closed → JS chain runs → `routedBy: 'legacy-fallback'` AND `BridgeRouteFailures` metric incremented
    - (e) Synthetic regenerate API call → SFN runs → `routedBy: 'regenerate'`
    - (f) Synthetic SFN failure injection → DLQ message lands with correct `messageId`/`threadKey` paths → SNS email arrives at `01juliop@gmail.com`
    - (g) Synthetic `editedReply` set on inbound → SFN runs → WriteBack returns `{ skipped: 'host_edit' }` → `airbnb_messages/{id}` not modified
    - (h) Synthetic regenerate against an inbound with `editedReply` set → admin UI shows Regenerate disabled (manual UI verification)
    - (i) Synthetic 4th regenerate on the same inbound → API returns 429
    - (j) Synthetic schema-validator trap → attempt to deploy `mode: shadow` AppConfig HCV → validator rejects

## Open issues (non-blocking)

- **Issue #2 from handoff** (thread query orders ascending): Phase 3 doesn't fix this. Both legacy and SFN paths use the same query.
- **Mark-as-Sent UI gate for unmatched messages** (handoff §1C, §2): orthogonal to Phase 3.
- **Phase 3.5 — Quality monitor**: Evaluator EMF metrics + alarm + Monitor wired for prompt-quality auto-rollback. Decision 14. **Prerequisite check (AI reviewer nit):** confirm Evaluator Lambda already emits structured "passed/voiceScore/hardBanHit" outputs that can be converted to EMF; if not, Phase 3.5 absorbs that emitter work as its first step.
- **Phase 4.5 — JS chain decommission**: After Phase 4 hits 100% AWS traffic, delete `functions/lib/reply-agent-chain.js`, the inline `SYSTEM_PROMPT` constants in `lib/reply-ai.js` + `functions/lib/reply-ai.js`, and the `mode: firebase` branch from `decideRoute`. Removes 3 of the 4 prompt sources of truth.
- **OIDC federation as a W7 talking point**: deferred per Decision 5. Could be a Phase 3.6.

## Estimated effort

Master plan §4.3: ~1.5h.
With full TDD + smoke per the established pattern + revisions:
- Spec + plan: ~3h (this document v2 + the plan)
- Implementation (subagent-driven): ~4h
- Smoke + acceptance (15 criteria): ~2h
- Doc agent change log: ~30 min

**Total: ~9.5h end-to-end.**

## Phase 3 → Phase 4 handoff state

After Phase 3 ships:
- Production traffic split: 100% legacy JS chain (`rollout_pct: 0`)
- SFN path is wired, tested via 6 synthetic injection scenarios, alarm/DLQ surface live
- AppConfig Monitor protects deployments against infrastructure failure (NOT quality regression — see Decision 14)
- Regenerate API live and replacing the broken regenerate button + Retry button for failed drafts
- WriteBack Lambda real with Secrets Manager dependency + `editedReply` host-edit protection
- DLQ has 14-day retention; redrive is the in-app Retry button
- CI drift check enforces 3-source prompt sync

**Phase 4** then ramps `rollout_pct` from 0 → 5 → 25 → 50 → 100 over a week. Each step = one AppConfig deployment. AppConfig Monitor catches infra failures; quality regressions require manual review of WriteBack-stamped `_agentRun.routedBy` analytics.

**Phase 4.5** (NEW) deletes the JS chain after 100% bake. Removes:
- `functions/lib/reply-agent-chain.js`
- `functions/lib/reply-ai.js` (inline SYSTEM_PROMPT)
- `lib/reply-ai.js` (inline SYSTEM_PROMPT)
- The `mode: firebase` branch from `decideRoute`
- The `mode: shadow` enum value from `feature-flags.seed.json` (forces a Phase 4.5 AppConfig redeploy)

After Phase 4.5: AppConfig is the SINGLE source of truth for the system prompt. The CI drift check is removed (no other sources to drift from).

---

## Sign-off

**v3 status: 4-of-4 GREEN-LIGHT carried forward + 2 should-fixes (BridgeFailureLogMetric mechanism, token persistence) folded in + 6 nits addressed.** Plan dispatch is the next step.
