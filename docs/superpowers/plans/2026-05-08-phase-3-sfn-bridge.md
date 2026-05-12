# Phase 3 — SFN Bridge + DLQ + Alarms + Auto-Rollback Implementation Plan (v3.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **All deploy steps and `git push` steps are gated on Julio's explicit approval — DO NOT auto-execute them.**

**Goal:** Wire the Cloud Function `onAirbnbMessageCreated` to the SAM Step Functions chain (`casa-coqui-reply-agent`) via a fail-closed bridge governed by AppConfig's `feature-flags.reply_engine` flag. Ship at `rollout_pct: 0` (zero organic traffic, regenerate API exercises SFN). DLQ + SNS + CloudWatch alarms + AppConfig Monitor auto-rollback (infra failure only — see Decision 14) close the operational seam. WriteBack Lambda becomes real, persisting `_agentRun.appConfigVersion`, `_agentRun.routedBy`, `_agentRun.executionArn`, and **WriteBack-side summed token/latency telemetry (Decision 17 v3.1)** to Firestore. Two-commit W7 trap on a feature branch teaches cross-cloud IAM debugging without polluting `main`.

**Architecture summary:** The bridge is a small fan-in inside `onAirbnbMessageCreated`, inserted **between context build and the LLM call** (Decision 19 v3.1 — the SFN expects `contextJson`/`voicePrompt`/`voiceProfilePrompt`/`relevantConversations` pre-built). Three new pure modules under `functions/lib/` (`decide-route.js`, `appconfig-client.js`, `bridge-metrics.js`, `aws-sfn-bridge.js`) handle flag fetch, hash-based gating, IAM-signed `StartExecution`, and CloudWatch EMF emission. AppConfig errors fail closed to the legacy JS chain. WriteBack Lambda gains `firebase-admin` + Secrets Manager. ASL gets per-state `Catch → SendToDLQ → WorkflowFailed` AND propagates `$$.Execution.Id` + `$$.Execution.StartTime` into WriteBack input. Cloud Functions ship via CodePipeline; SAM ships via `sam deploy` — **SAM first, then merge CF** (Decision 15). A new CI script (`scripts/check-prompt-drift.js`) hashes the three `system_prompt_text` sources and fails the build on drift. An ESLint `no-restricted-imports` rule (Decision 18 v3.1) blocks accidental client-side imports of the bridge modules.

**Tech stack:** Node 20 (Cloud Functions) / Node 24 arm64 (SAM Lambdas), Firebase Functions v2 with `defineSecret`/`defineString` (NOT `functions.config()`), AWS SDK v3 (`@aws-sdk/client-sfn`, `@aws-sdk/client-appconfigdata`, `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-secrets-manager`), `firebase-admin`, Jest. No structural changes to `ai-chain.asl.json` (Phase 2 stays — per-stage tokens at `$.reasoner.tokens`/`$.drafter.tokens`/`$.evaluator.tokens`/`$.reviser?.tokens` are read by WriteBack JS, NOT aggregated in ASL).

**Spec:** [docs/superpowers/specs/2026-05-08-phase-3-sfn-bridge-design.md](../specs/2026-05-08-phase-3-sfn-bridge-design.md) (v3.1 — incorporates F1–F15 team-vetted fixes).

**Predecessor plan (template):** [docs/superpowers/plans/2026-05-07-phase2-appconfig.md](./2026-05-07-phase2-appconfig.md).

**Estimated total effort:** ~10.5 hours end-to-end (per spec, with v3.1 additions). Per-step minutes inline.

---

## v3.1 Fix Summary (applied below)

| # | Fix | Where applied |
|---|---|---|
| F1 | Token aggregation = WriteBack-side JS sum, NOT ASL Pass; latencyMs = `Date.now() - executionStartTime` proxy | Step 5.0 (NEW), Step 5 implementation, Step 17(b) smoke |
| F2 | v2 secrets: `defineSecret`/`defineString`; mirror AWS keys to Vercel env | Step 7.2, Step 16.2 + 16.2.1 (NEW) |
| F3 | Bridge insertion BETWEEN context build and LLM call (NOT before) | Step 7.2 (concrete diff) |
| F4 | Transcribe rotation runbook + 1Password + quarterly calendar | Step 15.3.1 + 15.3.2 (NEW) |
| F5 | Smoke (b): assert `draftReply_present` + `draftReply_length_gt_20` | Step 17 scenario b |
| F6 | `--no-execute-changeset` + explicit `execute-change-set` | Steps 11.2, 12.4, 15.2 |
| F7 | Scenario (f) IAM deny on `lambda:InvokeFunction` of Reasoner | Step 17 scenario f |
| F8 | Move feature branch delete to AFTER smoke | Step 17.7 (was 16.7) |
| F9/F15 | Voice-parity = automated regex booleans (new scenario k) | Step 17 scenario k (NEW) |
| F10 | Cap+cooldown interleaved sequence | Step 17 scenario i |
| F11 | WriteBack header comment block | Step 5.3 |
| F12 | Phase 3.5 prerequisite added to Open Issues | Bottom of plan |
| F13 | ASL passes `$$.Execution.Id` + `$$.Execution.StartTime` to WriteBack | Step 9.1 |
| F14 | ESLint `no-restricted-imports` rule | Step 8.0 (NEW) |

---

## File Structure

### Created
```
docs/superpowers/plans/
└── 2026-05-08-phase-3-sfn-bridge.md            ← THIS FILE (v3.1)

functions/lib/
├── decide-route.js                              ← pure routing function
├── decide-route.test.js                         ← 7 unit-test cases
├── appconfig-client.js                          ← AppConfig Data API client + 60s cache + fail-closed
├── appconfig-client.test.js                    ← fail-closed contract tests
├── bridge-metrics.js                            ← EMF helper: PutMetricData → CasaCoqui/Bridge
├── bridge-metrics.test.js                       ← swallow-errors test
├── aws-sfn-bridge.js                            ← StartExecution wrapper
└── aws-sfn-bridge.test.js                       ← bridge tests (mocked SFN client)

app/api/airbnb-messages/[id]/regenerate/
└── route.js                                     ← POST handler with rate limit + 30s cooldown
                                                   (constructs its OWN inline SFN client — F14 ESLint rule
                                                    bans imports of functions/lib/aws-sfn-bridge from app/)

scripts/
└── check-prompt-drift.js                        ← CI hash-drift check across 3 prompt sources

infra/sam/reply-agent/functions/write-back/
└── __tests__/
    └── write-back.test.js                       ← editedReply skip-path test + token-sum test (F1)

tasks/changes/phase-3/
├── 2026-05-08-phase-3-sfn-bridge-changes.md     ← change log (doc agent maintains)
└── smoke-logs/
    ├── synth-routing-a-rollout-gated.json
    ├── synth-routing-b-rollout-routed.json
    ├── synth-routing-c-firebase-explicit.json
    ├── synth-routing-d-legacy-fallback.json
    ├── synth-routing-e-regenerate.json
    ├── synth-routing-f-dlq-failure.json
    ├── synth-routing-g-edited-reply-skip.json
    ├── synth-routing-h-regenerate-disabled-ui.png
    ├── synth-routing-i-rate-limit.json
    ├── synth-routing-j-shadow-validator.txt
    ├── synth-routing-k-voice-parity.json        ← NEW per F9/F15
    ├── verify-bridge.js                          ← smoke verifier (booleans)
    └── cleanup-bridge.js                         ← purges synthetic Firestore docs + SQS
```

### Modified
```
functions/
└── index.js                                      ← bridge call inserted in onAirbnbMessageCreated
                                                    BETWEEN context build and generateReplyChain() (F3)
                                                    Uses defineSecret + defineString (F2)

app/admin/messages/
└── page.js                                       ← Regenerate (existing button) wired to API; Retry on failed; gated when editedReply set

infra/sam/reply-agent/
├── template.yaml                                 ← +DLQ, +SNS, +DLQNotifier, +alarms, +Monitor on Environment, +AppConfigMonitorRole, +BridgeIamUser; appconfig:* → appconfigdata:* fix on Drafter+Reviser; WriteBack gets Firebase secret grant
├── statemachines/reply-draft.asl.json            ← per-state Catch redirects to SendToDLQ; new SendToDLQ Task before WorkflowFailed; WriteBack Payload gains executionArn + executionStartTime (F13)
└── functions/write-back/
    ├── index.js                                  ← stub → real (firebase-admin + Firestore + skip-on-editedReply + WriteBack-side token summation per F1 + executionStartTime-derived latencyMs)
    └── package.json                              ← +firebase-admin, +@aws-sdk/client-secrets-manager

infra/sam/reply-agent/config/
├── feature-flags.seed.json                       ← validator regex: mode pattern ^(firebase|aws-sfn)$; rollout_pct: 0
└── system-prompt.seed.json                       ← header note pointing to CI drift check

functions/lib/reply-ai.js                          ← header comment updated: CI drift check is canonical sync (not these comments)
lib/reply-ai.js                                    ← same header update

.eslintrc.json                                     ← +no-restricted-imports rule (F14) banning client imports of bridge modules

buildspec-build.yml                                ← +`node scripts/check-prompt-drift.js` step
```

### Unchanged (explicit)
```
functions/lib/reply-agent-chain.js                 ← still serves mode:firebase + legacy-fallback (Phase 4.5 deletes)
infra/sam/reply-agent/functions/{reasoner,drafter,evaluator,reviser,load-config,rag-retrieve}/index.js
infra/sam/reply-agent/statemachines/ai-chain.asl.json   ← per-stage tokens stay where they are; no top-level aggregation needed
firestore.rules                                    ← no schema changes
firestore.indexes.json                             ← no new queries
```

---

## Workflow per task

1. **Implementer subagent** drives end-to-end: read current state, apply diffs, run tests, commit locally.
2. **Doc agent** (run in background after each task) appends to `tasks/changes/phase-3/2026-05-08-phase-3-sfn-bridge-changes.md`.
3. **Pause for Julio approval** before any of: `git push`, `sam deploy` (changeset execute), `firebase deploy`, deletes against AWS or Firebase.
4. Subagent dispatch hint: **Tasks 2 (decide-route) + 3 (bridge-metrics) + 5 (WriteBack Lambda) are independent and can run in parallel.** Task 4 (`appconfig-client`) depends on Task 3 (`bridge-metrics`). Task 6 (`aws-sfn-bridge`) depends on Tasks 3 and 4.

**Branch decision: feature branch.** Per spec Decision 14 W7 trap, work happens on `feat/phase-3-sfn-bridge` and is squash-merged to `main` so the main commit history never sees the broken IAM state.

---

## Step 1 — Cut feature branch + scaffolding (15 min)

**Files:** none modified yet.

- [ ] **Step 1.1: Confirm clean working tree, then cut the branch**

```bash
cd /Users/jperez/dev/casa-coqui
git status -s
# Expected: empty (or only the unstaged graphify/agent-memory files we already know about — those don't ride along)
git checkout -b feat/phase-3-sfn-bridge
git rev-parse --abbrev-ref HEAD
```
Expected: `feat/phase-3-sfn-bridge`.

- [ ] **Step 1.2: Pre-flight production sanity (handoff §5 mandate)**

```bash
firebase functions:log --lines 5 --only onAirbnbMessageCreated 2>&1 | head -20
aws lambda get-function-configuration --function-name casa-coqui-parse-airbnb-email --region us-east-1 --query 'LastModified' --output text
```
Expected: Cloud Function revision is post-2026-05-08 04:30 UTC; Lambda LastModified is post-2026-05-08. **If either looks stale, STOP and investigate before adding bridge code.**

- [ ] **Step 1.3: Pre-flight chain Lambda baseline test still passes**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent && npm test 2>&1 | tail -5
```
Expected: 1 throttle-name test passes (Phase 1.5 baseline).

- [ ] **Step 1.4: Create the change log skeleton**

Path: `tasks/changes/phase-3/2026-05-08-phase-3-sfn-bridge-changes.md`. Body:

```markdown
# Phase 3 — SFN Bridge Change Log

Spec: `docs/superpowers/specs/2026-05-08-phase-3-sfn-bridge-design.md` (v3.1)
Plan: `docs/superpowers/plans/2026-05-08-phase-3-sfn-bridge.md` (v3.1)
Branch: `feat/phase-3-sfn-bridge` (squash-merged to main)

## Tasks (filled in by doc agent)
- [ ] Step 1 — Branch + scaffolding
- [ ] Step 2 — decideRoute pure function (TDD)
- [ ] Step 3 — bridge-metrics.js (EMF emitter)
- [ ] Step 4 — appconfig-client.js (TDD, fail-closed contract)
- [ ] Step 5.0 — Read ai-chain.asl.json, confirm per-stage token shape (F1)
- [ ] Step 5 — WriteBack Lambda real (WriteBack-side token sum + executionStartTime latency proxy)
- [ ] Step 6 — aws-sfn-bridge.js (TDD)
- [ ] Step 7 — Wire bridge into onAirbnbMessageCreated (BETWEEN context build and LLM call)
- [ ] Step 8.0 — ESLint no-restricted-imports rule (F14)
- [ ] Step 8 — Regenerate API + UI (rate limit + editedReply gating; inline SFN client)
- [ ] Step 9 — ASL Catch redirects + SendToDLQ + executionArn/StartTime to WriteBack (F13)
- [ ] Step 10 — SAM template (DLQ + SNS + alarms + IAM user + Monitor)
- [ ] Step 11 — INTENTIONAL BREAK: WriteBack ships without Secrets Manager grant (--no-execute-changeset)
- [ ] Step 12 — FIX: Add SecretsManager:GetSecretValue grant
- [ ] Step 13 — Prompt drift CI check
- [ ] Step 14 — feature-flags validator regex (mode pattern)
- [ ] Step 15 — Final SAM deploy + IAM key capture + 1Password store + quarterly calendar (F4)
- [ ] Step 16 — Set Firebase secrets, mirror AWS keys to Vercel env (F2), squash-merge to main
- [ ] Step 17 — Smoke (a-k per AC #17 + F9/F15 voice parity)
- [ ] Step 17.7 — Delete feature branch (moved here per F8)
- [ ] Step 18 — Update handoff doc
```

- [ ] **Step 1.5: Commit the scaffolding**

```bash
cd /Users/jperez/dev/casa-coqui
git add tasks/changes/phase-3/2026-05-08-phase-3-sfn-bridge-changes.md
git commit -m "$(cat <<'EOF'
docs(phase-3): scaffolding for SFN bridge change log (v3.1)

Empty checkbox skeleton; doc agent fills in per task. Tracks the
two-commit W7 trap (Steps 11+12) explicitly. Includes v3.1 fix
items: ESLint rule (F14), Vercel env mirror (F2), token-sum
WriteBack (F1), ASL execution context propagation (F13).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 2 — `decideRoute` pure function with TDD (40 min)

**Why:** Spec Decision F (testability) — extract the routing decision into a pure function. Five enumerated test cases cover the spec's AC #2.

**Files:**
- Create: [functions/lib/decide-route.js](../../../functions/lib/decide-route.js)
- Create: [functions/lib/decide-route.test.js](../../../functions/lib/decide-route.test.js)

**Subagent dispatch:** independent of Step 3.

- [ ] **Step 2.1: Write failing tests first**

Path: `functions/lib/decide-route.test.js`

```js
'use strict';

const { decideRoute, hashMessageId } = require('./decide-route');

describe('hashMessageId', () => {
  test('deterministic — same input always yields same bucket', () => {
    expect(hashMessageId('abc123')).toBe(hashMessageId('abc123'));
  });

  test('produces a value in [0, 99]', () => {
    for (const id of ['a', 'longer-message-id', '12345', '🦊']) {
      const v = hashMessageId(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });
});

describe('decideRoute', () => {
  // Spec AC #2 enumerates these five cases.

  test('(a) mode: firebase always returns engine: firebase + reason: firebase-explicit', () => {
    expect(decideRoute({ messageId: 'any', flag: { mode: 'firebase', rollout_pct: 50 } }))
      .toEqual({ engine: 'firebase', reason: 'firebase-explicit' });
  });

  test('(b) mode: aws-sfn AND hash < rollout_pct → engine: aws-sfn + reason: rollout-routed', () => {
    const mid = 'msg-routed-fixture';
    const bucket = hashMessageId(mid);
    const flag = { mode: 'aws-sfn', rollout_pct: bucket + 1 };
    expect(decideRoute({ messageId: mid, flag }))
      .toEqual({ engine: 'aws-sfn', reason: 'rollout-routed' });
  });

  test('(c) mode: aws-sfn AND hash >= rollout_pct → engine: firebase + reason: rollout-gated', () => {
    const mid = 'msg-gated-fixture';
    const bucket = hashMessageId(mid);
    const flag = { mode: 'aws-sfn', rollout_pct: bucket };
    expect(decideRoute({ messageId: mid, flag }))
      .toEqual({ engine: 'firebase', reason: 'rollout-gated' });
  });

  test('(d) mode: shadow → engine: firebase + reason: shadow-stub (warn-log expected by caller)', () => {
    expect(decideRoute({ messageId: 'any', flag: { mode: 'shadow', rollout_pct: 100 } }))
      .toEqual({ engine: 'firebase', reason: 'shadow-stub' });
  });

  test('(e) malformed flag (missing mode) → engine: firebase + reason: legacy-fallback', () => {
    expect(decideRoute({ messageId: 'any', flag: {} }))
      .toEqual({ engine: 'firebase', reason: 'legacy-fallback' });
    expect(decideRoute({ messageId: 'any', flag: null }))
      .toEqual({ engine: 'firebase', reason: 'legacy-fallback' });
    expect(decideRoute({ messageId: 'any', flag: undefined }))
      .toEqual({ engine: 'firebase', reason: 'legacy-fallback' });
  });

  test('rollout_pct: 0 → never routes to SFN even at mode: aws-sfn', () => {
    for (const mid of ['a', 'b', 'c', 'long-id-4567']) {
      expect(decideRoute({ messageId: mid, flag: { mode: 'aws-sfn', rollout_pct: 0 } }))
        .toEqual({ engine: 'firebase', reason: 'rollout-gated' });
    }
  });

  test('rollout_pct: 100 → routes all messages to SFN at mode: aws-sfn', () => {
    for (const mid of ['a', 'b', 'c', 'long-id-4567']) {
      expect(decideRoute({ messageId: mid, flag: { mode: 'aws-sfn', rollout_pct: 100 } }))
        .toEqual({ engine: 'aws-sfn', reason: 'rollout-routed' });
    }
  });
});
```

Run tests, expect failure:
```bash
cd /Users/jperez/dev/casa-coqui/functions && npx jest lib/decide-route.test.js 2>&1 | tail -10
```
Expected: `Cannot find module './decide-route'`.

- [ ] **Step 2.2: Implement `decide-route.js`**

Path: `functions/lib/decide-route.js`

```js
'use strict';

// ---------------------------------------------------------------------------
// decideRoute — pure function. No side effects, no I/O.
//
// Given a messageId and the resolved feature-flag payload, returns the engine
// to use ('firebase' | 'aws-sfn') and a reason string for observability.
//
// Reason enum (mirrored in spec Decision 12 / WriteBack `_agentRun.routedBy`):
//   'rollout-routed'     — mode: aws-sfn AND hash < rollout_pct (SFN runs)
//   'rollout-gated'      — mode: aws-sfn AND hash >= rollout_pct (legacy runs)
//   'firebase-explicit'  — mode: firebase (legacy runs)
//   'legacy-fallback'    — flag missing or malformed (legacy runs)
//   'shadow-stub'        — mode: shadow (legacy runs; caller warn-logs)
//
// Hash is sha256(messageId).readUInt32BE(0) % 100 — deterministic so the same
// message always routes the same way (Decision 4).
// ---------------------------------------------------------------------------

const crypto = require('crypto');

function hashMessageId(messageId) {
  const h = crypto.createHash('sha256').update(String(messageId)).digest();
  return h.readUInt32BE(0) % 100;
}

function decideRoute({ messageId, flag }) {
  if (!flag || typeof flag !== 'object' || !flag.mode) {
    return { engine: 'firebase', reason: 'legacy-fallback' };
  }
  const mode = flag.mode;
  const rolloutPct = Number.isFinite(flag.rollout_pct) ? flag.rollout_pct : 0;

  if (mode === 'firebase') {
    return { engine: 'firebase', reason: 'firebase-explicit' };
  }
  if (mode === 'shadow') {
    return { engine: 'firebase', reason: 'shadow-stub' };
  }
  if (mode === 'aws-sfn') {
    const bucket = hashMessageId(messageId);
    if (bucket < rolloutPct) {
      return { engine: 'aws-sfn', reason: 'rollout-routed' };
    }
    return { engine: 'firebase', reason: 'rollout-gated' };
  }
  // Unknown mode — fail closed.
  return { engine: 'firebase', reason: 'legacy-fallback' };
}

module.exports = { decideRoute, hashMessageId };
```

- [ ] **Step 2.3: Run tests, expect pass**

```bash
cd /Users/jperez/dev/casa-coqui/functions && npx jest lib/decide-route.test.js 2>&1 | tail -10
```
Expected: 7 passing tests.

- [ ] **Step 2.4: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add functions/lib/decide-route.js functions/lib/decide-route.test.js
git commit -m "$(cat <<'EOF'
feat(phase-3): pure decideRoute function with full unit-test coverage

Pure function — no side effects, no I/O. Given messageId + flag,
returns { engine, reason } for the bridge to dispatch on.

Reasons map directly to WriteBack's _agentRun.routedBy enum
(spec Decision 12).

7 tests cover spec AC #2 cases:
  (a) mode: firebase           → firebase-explicit
  (b) hash < rollout_pct       → rollout-routed (SFN)
  (c) hash >= rollout_pct      → rollout-gated
  (d) mode: shadow             → shadow-stub (caller warn-logs)
  (e) malformed/missing flag   → legacy-fallback
  + rollout_pct: 0  → all gated
  + rollout_pct: 100 → all routed

No call sites touch this module yet — wiring lands in Step 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 3 — `bridge-metrics.js` EMF helper (25 min)

**Why:** Spec "Bridge metrics (Stackdriver-vs-CloudWatch correction)". Cloud Function logs land in GCP Stackdriver — a `Logs::MetricFilter` won't see them. The fix is to call `PutMetricData` directly from the Cloud Function. This module is best-effort: failures are swallowed so metric emission never breaks the request path.

**Files:**
- Create: [functions/lib/bridge-metrics.js](../../../functions/lib/bridge-metrics.js)
- Create: [functions/lib/bridge-metrics.test.js](../../../functions/lib/bridge-metrics.test.js)

**Subagent dispatch:** independent of Step 2; can parallelize.

- [ ] **Step 3.1: Write the test (light coverage — best-effort module)**

Path: `functions/lib/bridge-metrics.test.js`

```js
'use strict';

jest.mock('@aws-sdk/client-cloudwatch', () => {
  const send = jest.fn();
  return {
    CloudWatchClient: jest.fn(() => ({ send })),
    PutMetricDataCommand: jest.fn((input) => ({ __type: 'PutMetricDataCommand', input })),
    __mockSend: send,
  };
});

const { __mockSend } = require('@aws-sdk/client-cloudwatch');
const { emitBridgeMetric } = require('./bridge-metrics');

describe('emitBridgeMetric', () => {
  beforeEach(() => __mockSend.mockReset());

  test('sends a PutMetricDataCommand with the right namespace + metric name', async () => {
    __mockSend.mockResolvedValueOnce({});
    await emitBridgeMetric('BridgeRouteSuccesses');
    expect(__mockSend).toHaveBeenCalledTimes(1);
    const call = __mockSend.mock.calls[0][0];
    expect(call.input.Namespace).toBe('CasaCoqui/Bridge');
    expect(call.input.MetricData[0].MetricName).toBe('BridgeRouteSuccesses');
    expect(call.input.MetricData[0].Value).toBe(1);
    expect(call.input.MetricData[0].Unit).toBe('Count');
  });

  test('swallows errors — never throws', async () => {
    __mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(emitBridgeMetric('BridgeRouteFailures')).resolves.toBeUndefined();
  });

  test('accepts an explicit value', async () => {
    __mockSend.mockResolvedValueOnce({});
    await emitBridgeMetric('BridgeRouteFailures', 5);
    const call = __mockSend.mock.calls[0][0];
    expect(call.input.MetricData[0].Value).toBe(5);
  });
});
```

- [ ] **Step 3.2: Implement `bridge-metrics.js`**

Path: `functions/lib/bridge-metrics.js`

```js
'use strict';

// ---------------------------------------------------------------------------
// bridge-metrics — best-effort EMF emitter for the Firebase Cloud Function.
//
// Cloud Function logs land in GCP Stackdriver, NOT CloudWatch — so we cannot
// use a CloudWatch Logs MetricFilter. Instead we PutMetricData directly via
// the AWS SDK using the same BridgeIamUser access key already provisioned
// for StartExecution. The IAM policy constrains this user's PutMetricData
// to namespace 'CasaCoqui/Bridge' (spec "Bridge metrics" + IAM model).
//
// CRITICAL: failures are swallowed + logged. Metric emission must NEVER break
// the request path.
// ---------------------------------------------------------------------------

const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

let _cw = null;
function getClient() {
  if (_cw) return _cw;
  _cw = new CloudWatchClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _cw;
}

async function emitBridgeMetric(name, value = 1) {
  try {
    const cw = getClient();
    await cw.send(new PutMetricDataCommand({
      Namespace: 'CasaCoqui/Bridge',
      MetricData: [{
        MetricName: name,
        Value: value,
        Unit: 'Count',
        Timestamp: new Date(),
      }],
    }));
  } catch (e) {
    // Swallow + log. Metric emission must never break the request path.
    console.warn('emitBridgeMetric failed', { name, value, error: e?.message });
  }
}

module.exports = { emitBridgeMetric };
```

- [ ] **Step 3.3: Run tests**

```bash
cd /Users/jperez/dev/casa-coqui/functions && npx jest lib/bridge-metrics.test.js 2>&1 | tail -10
```
Expected: 3 passing tests.

- [ ] **Step 3.4: Add `@aws-sdk/client-cloudwatch` to functions deps**

```bash
cd /Users/jperez/dev/casa-coqui/functions
npm install --save @aws-sdk/client-cloudwatch
```
Verify `package.json` has the new dep.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add functions/lib/bridge-metrics.js functions/lib/bridge-metrics.test.js functions/package.json functions/package-lock.json
git commit -m "$(cat <<'EOF'
feat(phase-3): bridge-metrics EMF emitter (Stackdriver-vs-CloudWatch fix)

Cloud Function logs land in GCP Stackdriver, so a Logs::MetricFilter
cannot see them. emitBridgeMetric calls PutMetricData directly via the
AWS SDK using the BridgeIamUser access key (Step 10's IAM policy
constrains it to namespace CasaCoqui/Bridge).

Best-effort: failures are swallowed + logged. Metric emission must
NEVER break the request path.

Adds @aws-sdk/client-cloudwatch to functions/package.json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 4 — `appconfig-client.js` with fail-closed contract (50 min)

**Why:** Spec Decisions 2, 3, 13. Cloud Function fetches `feature-flags.reply_engine` from AppConfig **Data API** (`appconfigdata:*`). 60s in-memory cache. **Any error returns the legacy default `{ mode: 'firebase', rollout_pct: 0 }` and emits `BridgeRouteFailures`** — the bridge is fail-closed and never blocks on AppConfig.

**v3.1 addition:** the returned flag also carries an opaque `version` string (read from AppConfig's `ConfigurationVersion`) so the bridge can pass `appConfigVersion` into the SFN input. Decoupled from drafter's own `appConfigVersion` (which is the SSM-side prompt version).

**Files:**
- Create: [functions/lib/appconfig-client.js](../../../functions/lib/appconfig-client.js)
- Create: [functions/lib/appconfig-client.test.js](../../../functions/lib/appconfig-client.test.js)

**Depends on:** Step 3 (`bridge-metrics.js`). Must run AFTER Step 3.

- [ ] **Step 4.1: Write tests for the fail-closed contract**

Path: `functions/lib/appconfig-client.test.js`

```js
'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-appconfigdata', () => ({
  AppConfigDataClient: jest.fn(() => ({ send: mockSend })),
  StartConfigurationSessionCommand: jest.fn((input) => ({ __type: 'Start', input })),
  GetLatestConfigurationCommand: jest.fn((input) => ({ __type: 'Get', input })),
}));

const mockEmit = jest.fn();
jest.mock('./bridge-metrics', () => ({ emitBridgeMetric: mockEmit }));

const { fetchReplyEngineFlag, _resetCacheForTests } = require('./appconfig-client');

const okFlagPayload = JSON.stringify({
  flags: { reply_engine: { enabled: true } },
  values: { reply_engine: { mode: 'aws-sfn', rollout_pct: 0, enabled: true } },
});

function bytesOf(s) {
  return new TextEncoder().encode(s);
}

describe('fetchReplyEngineFlag', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockEmit.mockReset();
    _resetCacheForTests();
    process.env.APPCONFIG_APPLICATION = 'casa-coqui-reply-agent';
    process.env.APPCONFIG_ENVIRONMENT = 'prod';
    process.env.APPCONFIG_FLAGS_PROFILE = 'feature-flags';
  });

  test('happy path — returns mode + rollout_pct + version from AppConfig', async () => {
    mockSend
      .mockResolvedValueOnce({ InitialConfigurationToken: 'tok1' })
      .mockResolvedValueOnce({
        Configuration: bytesOf(okFlagPayload),
        NextPollConfigurationToken: 'tok2',
        VersionLabel: 'v3',
      });
    const flag = await fetchReplyEngineFlag();
    expect(flag.mode).toBe('aws-sfn');
    expect(flag.rollout_pct).toBe(0);
    expect(flag.version).toBe('v3');
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('cache hit within 60s — does not call AppConfig twice', async () => {
    mockSend
      .mockResolvedValueOnce({ InitialConfigurationToken: 'tok1' })
      .mockResolvedValueOnce({ Configuration: bytesOf(okFlagPayload) });
    await fetchReplyEngineFlag();
    await fetchReplyEngineFlag();
    expect(mockSend).toHaveBeenCalledTimes(2); // Start + Get; second call hits cache
  });

  test('fail-closed: AppConfig 5xx → returns legacy default + emits failure metric', async () => {
    mockSend.mockRejectedValueOnce(new Error('5xx'));
    const flag = await fetchReplyEngineFlag();
    expect(flag.mode).toBe('firebase');
    expect(flag.rollout_pct).toBe(0);
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteFailures');
  });

  test('fail-closed: malformed payload → returns legacy default + emits failure metric', async () => {
    mockSend
      .mockResolvedValueOnce({ InitialConfigurationToken: 'tok1' })
      .mockResolvedValueOnce({ Configuration: bytesOf('{not json') });
    const flag = await fetchReplyEngineFlag();
    expect(flag.mode).toBe('firebase');
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteFailures');
  });

  test('fail-closed: env vars missing → returns legacy default', async () => {
    delete process.env.APPCONFIG_APPLICATION;
    const flag = await fetchReplyEngineFlag();
    expect(flag.mode).toBe('firebase');
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteFailures');
  });
});
```

- [ ] **Step 4.2: Implement `appconfig-client.js`**

Path: `functions/lib/appconfig-client.js`

```js
'use strict';

// ---------------------------------------------------------------------------
// appconfig-client — Cloud Function side AppConfig Data API client.
//
// Why this exists:
//   The Firebase Cloud Function isn't a Lambda, so it cannot use the AWS
//   AppConfig Lambda Extension sidecar. It must call the Data API directly
//   (StartConfigurationSession + GetLatestConfiguration). Spec Decision 2.
//
// IAM service prefix: appconfigdata:* (NOT appconfig:*) — Decision 2.
//
// Fail-closed contract (Decision 13):
//   On ANY error — IAM denied, 5xx, network timeout, malformed payload, env
//   vars missing — return { mode: 'firebase', rollout_pct: 0 } and emit a
//   BridgeRouteFailures metric. The bridge is never blocked on AppConfig.
//
// Cache TTL: 60 seconds (matches the Lambda Extension default).
//
// v3.1: returns `version` (opaque AppConfig VersionLabel) so the bridge can
// stamp it on the SFN input as `appConfigVersion`. This is the AppConfig
// flag version, distinct from the drafter's prompt-side appConfigVersion.
// ---------------------------------------------------------------------------

const {
  AppConfigDataClient,
  StartConfigurationSessionCommand,
  GetLatestConfigurationCommand,
} = require('@aws-sdk/client-appconfigdata');
const { emitBridgeMetric } = require('./bridge-metrics');

const LEGACY_DEFAULT = Object.freeze({ mode: 'firebase', rollout_pct: 0, version: 'unknown' });
const CACHE_TTL_MS = 60_000;

let _client = null;
let _sessionToken = null;
let _cache = null; // { value: { mode, rollout_pct, version }, expiresAt: number }

function getClient() {
  if (_client) return _client;
  _client = new AppConfigDataClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

async function fetchSession() {
  const app = process.env.APPCONFIG_APPLICATION;
  const env = process.env.APPCONFIG_ENVIRONMENT;
  const profile = process.env.APPCONFIG_FLAGS_PROFILE;
  if (!app || !env || !profile) {
    throw new Error(
      `appconfig-client: missing env: APPCONFIG_APPLICATION=${app}, APPCONFIG_ENVIRONMENT=${env}, APPCONFIG_FLAGS_PROFILE=${profile}`
    );
  }
  const cw = getClient();
  const out = await cw.send(new StartConfigurationSessionCommand({
    ApplicationIdentifier: app,
    EnvironmentIdentifier: env,
    ConfigurationProfileIdentifier: profile,
  }));
  return out.InitialConfigurationToken;
}

async function fetchReplyEngineFlag() {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.value;

  try {
    if (!_sessionToken) _sessionToken = await fetchSession();
    const cw = getClient();
    const out = await cw.send(new GetLatestConfigurationCommand({
      ConfigurationToken: _sessionToken,
    }));
    if (out.NextPollConfigurationToken) _sessionToken = out.NextPollConfigurationToken;

    const text = new TextDecoder().decode(out.Configuration);
    const parsed = JSON.parse(text);
    const v = parsed?.values?.reply_engine || {};
    const flag = {
      mode: typeof v.mode === 'string' ? v.mode : 'firebase',
      rollout_pct: Number.isFinite(v.rollout_pct) ? v.rollout_pct : 0,
      version: out.VersionLabel || 'unknown',
    };
    _cache = { value: flag, expiresAt: now + CACHE_TTL_MS };
    return flag;
  } catch (e) {
    console.warn('appconfig-client: fail-closed', { error: e?.message });
    await emitBridgeMetric('BridgeRouteFailures');
    return LEGACY_DEFAULT;
  }
}

function _resetCacheForTests() {
  _cache = null;
  _sessionToken = null;
  _client = null;
}

module.exports = { fetchReplyEngineFlag, _resetCacheForTests };
```

- [ ] **Step 4.3: Add `@aws-sdk/client-appconfigdata` to functions deps**

```bash
cd /Users/jperez/dev/casa-coqui/functions
npm install --save @aws-sdk/client-appconfigdata
```

- [ ] **Step 4.4: Run tests**

```bash
cd /Users/jperez/dev/casa-coqui/functions && npx jest lib/appconfig-client.test.js 2>&1 | tail -10
```
Expected: 5 passing tests.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add functions/lib/appconfig-client.js functions/lib/appconfig-client.test.js functions/package.json functions/package-lock.json
git commit -m "$(cat <<'EOF'
feat(phase-3): appconfig-client with fail-closed contract

Reads feature-flags.reply_engine from AppConfig Data API (appconfigdata:*
service prefix per Decision 2). 60s in-memory cache.

Fail-closed (Decision 13): on ANY error — IAM denied, 5xx, network,
malformed payload, env vars missing — returns the legacy default
{ mode: 'firebase', rollout_pct: 0, version: 'unknown' } and emits
BridgeRouteFailures. The bridge is never blocked on AppConfig.

Returns `version` (AppConfig VersionLabel) for SFN input stamping
(v3.1).

5 unit tests cover happy path, cache hit, 5xx, malformed JSON,
env-vars missing.

Adds @aws-sdk/client-appconfigdata to functions deps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Step 5.0 — Confirm per-stage token shape in ai-chain.asl.json (10 min) [F1]

**Why (F1):** v3 plan assumed top-level `chainResult.output.tokens` aggregation. AWS-engineer review caught the error — there is NO top-level aggregation. Per-stage tokens live at `$.reasoner.tokens`, `$.drafter.tokens`, `$.evaluator.tokens`, `$.reviser?.tokens`. WriteBack must sum them in JS.

**Files:** none modified — verification only.

- [ ] **Step 5.0.1: Read the ASL and confirm token shape**

```bash
cd /Users/jperez/dev/casa-coqui
grep -n '"tokens"' infra/sam/reply-agent/statemachines/ai-chain.asl.json | head -20
grep -n 'ResultPath\|OutputPath' infra/sam/reply-agent/statemachines/ai-chain.asl.json | head -40
```

Expected: per-stage `ResultPath: "$.reasoner"` / `"$.drafter"` / `"$.evaluator"` / `"$.reviser"` patterns. NO state with a Pass-type token aggregation.

- [ ] **Step 5.0.2: Read drafter return shape**

```bash
grep -n 'return\|tokens' infra/sam/reply-agent/functions/drafter/index.js | head -10
```

Expected: drafter returns `{ draft, tokens: { input, output }, appConfigVersion }`. Confirms per-stage token shape.

- [ ] **Step 5.0.3: Document findings in change log**

Doc agent appends to change log: "Confirmed ai-chain.asl.json has NO top-level token aggregation. Per-stage tokens at $.reasoner.tokens, $.drafter.tokens, $.evaluator.tokens, $.reviser?.tokens. WriteBack sums them in JS (Decision 17 v3.1)."

No commit; verification step.

---

## Step 5 — WriteBack Lambda becomes real (50 min) [F1, F11, F13]

**Why:** Spec scope WriteBack section + Decisions 6, 7, 17 (v3.1). Reads Firebase service account from Secrets Manager, initializes `firebase-admin`, updates `airbnb_messages/{id}` with draft + `_agentRun.{appConfigVersion, routedBy, executionArn, inputTokens, outputTokens, latencyMs}`. **Skip-on-`editedReply` idempotency** (Decision 7). **Token sum done in JS, NOT ASL** (F1). **`latencyMs = Date.now() - executionStartTime`** (F1 proxy until Phase 3.1). **`event.executionArn` and `event.executionStartTime` come from ASL Payload (F13)** — `event.input` is the wrapped chain payload.

**Files:**
- Modify: [infra/sam/reply-agent/functions/write-back/index.js](../../../infra/sam/reply-agent/functions/write-back/index.js)
- Modify: [infra/sam/reply-agent/functions/write-back/package.json](../../../infra/sam/reply-agent/functions/write-back/package.json)
- Create: `infra/sam/reply-agent/functions/write-back/__tests__/write-back.test.js`

**Subagent dispatch:** independent of Steps 2/3/4 — can parallelize alongside them.

- [ ] **Step 5.1: Update `package.json` with new deps**

Path: `infra/sam/reply-agent/functions/write-back/package.json`

```json
{
  "name": "casa-coqui-reply-write-back",
  "version": "1.0.0",
  "private": true,
  "description": "WriteBack — persists final draft + telemetry to Firestore via firebase-admin",
  "main": "index.js",
  "engines": { "node": "24" },
  "scripts": {
    "test": "jest"
  },
  "dependencies": {
    "@aws-sdk/client-secrets-manager": "^3.700.0",
    "firebase-admin": "^12.0.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent/functions/write-back && npm install
```

- [ ] **Step 5.2: Write failing tests for `editedReply` skip path + token sum**

Path: `infra/sam/reply-agent/functions/write-back/__tests__/write-back.test.js`

```js
'use strict';

// Mock firebase-admin and secrets-manager BEFORE requiring index.
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('firebase-admin', () => ({
  apps: [{}], // pretend already initialized
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  firestore: () => ({ collection: mockCollection }),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: '{"project_id":"x"}' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

const { handler } = require('../index');

// F13: ASL passes event.input (wrapped chain payload) + event.executionArn + event.executionStartTime.
function makeEvent(overrides = {}) {
  return {
    executionArn: overrides.executionArn || 'arn:aws:states:...:execution:foo',
    executionStartTime: overrides.executionStartTime || new Date(Date.now() - 5000).toISOString(),
    input: {
      message: { id: overrides.messageId || 'msg-abc' },
      _routedBy: overrides._routedBy || 'rollout-routed',
      chainResult: {
        output: {
          reasoner: { tokens: { input: 50, output: 20 } },
          drafter: { draft: { reply: 'AI draft', rationale: 'r' }, appConfigVersion: '7', tokens: { input: 100, output: 40 } },
          evaluator: { tokens: { input: 30, output: 10 } },
          reviser: overrides.reviser, // optional
          ...(overrides.outputExtra || {}),
        },
      },
      ...(overrides.inputExtra || {}),
    },
  };
}

describe('WriteBack handler', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockDoc.mockClear();
    mockCollection.mockClear();
  });

  test('skips when inbound.editedReply is set + non-empty (Decision 7)', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ editedReply: 'Host wrote this manually.', draftStatus: 'ready' }),
    });
    const out = await handler(makeEvent());
    expect(out).toEqual({ skipped: 'host_edit', messageId: 'msg-abc' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('writes when editedReply is empty string (treated as unset)', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ editedReply: '' }) });
    mockUpdate.mockResolvedValueOnce();
    const out = await handler(makeEvent());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(out.skipped).toBeUndefined();
  });

  test('F1: sums per-stage tokens (reasoner + drafter + evaluator + reviser?)', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    await handler(makeEvent({
      reviser: { tokens: { input: 25, output: 15 } },
    }));
    const fields = mockUpdate.mock.calls[0][0];
    // Sum: 50 + 100 + 30 + 25 = 205
    expect(fields['_agentRun.inputTokens']).toBe(205);
    // Sum: 20 + 40 + 10 + 15 = 85
    expect(fields['_agentRun.outputTokens']).toBe(85);
  });

  test('F1: handles missing reviser (optional stage) — sums to 180/70', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    await handler(makeEvent());
    const fields = mockUpdate.mock.calls[0][0];
    // Sum without reviser: 50 + 100 + 30 = 180
    expect(fields['_agentRun.inputTokens']).toBe(180);
    expect(fields['_agentRun.outputTokens']).toBe(70);
  });

  test('F1: latencyMs = Date.now() - executionStartTime (proxy)', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    const startedAt = new Date(Date.now() - 4321).toISOString();
    await handler(makeEvent({ executionStartTime: startedAt }));
    const fields = mockUpdate.mock.calls[0][0];
    expect(fields['_agentRun.latencyMs']).toBeGreaterThanOrEqual(4321);
    expect(fields['_agentRun.latencyMs']).toBeLessThan(4321 + 1000);
  });

  test('persists _agentRun.{appConfigVersion, routedBy, executionArn} per Decision 17 v3.1', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    await handler(makeEvent());
    const fields = mockUpdate.mock.calls[0][0];
    expect(fields.draftReply).toBe('AI draft');
    expect(fields['_agentRun.appConfigVersion']).toBe('7');
    expect(fields['_agentRun.routedBy']).toBe('rollout-routed');
    expect(fields['_agentRun.executionArn']).toBe('arn:aws:states:...:execution:foo');
  });

  test('appConfigVersion precedence: drafter first, reviser fallback', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    // Drafter has no appConfigVersion; reviser has '9'
    await handler(makeEvent({
      outputExtra: {
        drafter: { draft: { reply: 'r' }, tokens: { input: 100, output: 40 } }, // no appConfigVersion
        reviser: { tokens: { input: 0, output: 0 }, appConfigVersion: '9' },
      },
    }));
    const fields = mockUpdate.mock.calls[0][0];
    expect(fields['_agentRun.appConfigVersion']).toBe('9');
  });
});
```

- [ ] **Step 5.3: Replace `index.js` with the real implementation (with F11 header block)**

Path: `infra/sam/reply-agent/functions/write-back/index.js`

```js
'use strict';

/**
 * WriteBack — persists SFN-generated draft to airbnb_messages/{id}.
 *
 * NON-DETERMINISM NOTE:
 * Two runs of the same inbound through this Lambda are NOT expected to produce
 * identical draftReply text — Anthropic LLM sampling is non-deterministic by design.
 * Idempotency here means "don't clobber host edits," NOT "produce the same output."
 *
 * The `editedReply` signal is the load-bearing invariant: if a host has edited the
 * draft, this Lambda MUST skip the write (returns { skipped: 'host_edit' }).
 * SFN Standard exactly-once guarantees the WriteBack state itself runs once per
 * execution, but a host-triggered regenerate creates a NEW execution whose
 * WriteBack would otherwise overwrite the human-curated text. See Decision 7.
 *
 * APPCONFIG_VERSION PRECEDENCE (Decision 17 v3.1):
 *   $.drafter.appConfigVersion (always present) → $.reviser.appConfigVersion (fallback)
 *
 * TOKENS (Decision 17 v3.1): Per-stage tokens summed in this Lambda, NOT in ASL.
 *   ai-chain.asl.json has NO top-level aggregation. Per-stage tokens live at
 *   $.reasoner.tokens, $.drafter.tokens, $.evaluator.tokens, $.reviser?.tokens.
 *
 *   inputTokens  = sum of $.reasoner.tokens.input + drafter + evaluator + (reviser ?? 0)
 *   outputTokens = same shape
 *   latencyMs    = Date.now() - event.executionStartTime  (proxy until Phase 3.1)
 *
 * EVENT SHAPE (F13 — ASL Payload):
 *   event.input               — the wrapped chain payload ($. from ASL)
 *   event.executionArn        — from $$.Execution.Id
 *   event.executionStartTime  — from $$.Execution.StartTime (ISO 8601)
 */

const admin = require('firebase-admin');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const SECRET_NAME = process.env.FIREBASE_SECRET_NAME || 'casa-coqui/firebase-service-account';

let _initialized = false;
async function initOnce() {
  if (_initialized) return;
  if (admin.apps && admin.apps.length > 0) {
    _initialized = true;
    return;
  }
  const sm = new SecretsManagerClient({ region: 'us-east-1' });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  const creds = JSON.parse(out.SecretString);
  admin.initializeApp({ credential: admin.credential.cert(creds) });
  _initialized = true;
}

function sumStageTokens(output) {
  const { reasoner, drafter, evaluator, reviser } = output || {};
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
  return { inputTokens, outputTokens };
}

function resolveAppConfigVersion(output) {
  // Decision 17 v3.1: drafter first, reviser fallback.
  return String(
    output?.drafter?.appConfigVersion ??
    output?.reviser?.appConfigVersion ??
    'unknown'
  );
}

exports.handler = async (event) => {
  await initOnce();

  // F13: event.input is the wrapped chain payload; event.executionArn /
  // event.executionStartTime come from ASL $$.Execution.Id / $$.Execution.StartTime.
  const input = event?.input || event;
  const messageId = input?.message?.id;
  if (!messageId) throw new Error('write-back: missing input.message.id');

  const chainOutput = input?.chainResult?.output || {};
  const draft = chainOutput?.drafter?.draft || chainOutput?.final?.finalDraft || {};
  const reply = draft.reply || draft;
  const rationale = draft.rationale || null;

  const appConfigVersion = resolveAppConfigVersion(chainOutput);
  const { inputTokens, outputTokens } = sumStageTokens(chainOutput);

  // F1: latencyMs = wall clock between execution start and WriteBack invocation.
  const startedMs = event?.executionStartTime
    ? new Date(event.executionStartTime).getTime()
    : Date.now();
  const latencyMs = Math.max(0, Date.now() - startedMs);

  const routedBy = input?._routedBy || 'rollout-routed';
  const executionArn = event?.executionArn || null;

  const ref = admin.firestore().collection('airbnb_messages').doc(messageId);
  const snap = await ref.get();
  if (snap.exists) {
    const cur = snap.data();
    if (cur.editedReply && String(cur.editedReply).length > 0) {
      console.log('writeback_skipped_host_edit', { messageId });
      return { skipped: 'host_edit', messageId };
    }
  }

  const draftStatus = (chainOutput?.evaluation?.escalated) ? 'escalated' : 'ready';

  await ref.update({
    draftReply: typeof reply === 'string' ? reply : JSON.stringify(reply),
    draftRationale: rationale,
    draftStatus,
    draftedAt: new Date(),
    '_agentRun.appConfigVersion': appConfigVersion,
    '_agentRun.routedBy': routedBy,
    '_agentRun.executionArn': executionArn,
    '_agentRun.inputTokens': inputTokens,
    '_agentRun.outputTokens': outputTokens,
    '_agentRun.latencyMs': latencyMs,
  });

  return { messageId, draftStatus, inputTokens, outputTokens, latencyMs };
};

module.exports.handler = exports.handler;
```

- [ ] **Step 5.4: Run tests**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent/functions/write-back && npx jest 2>&1 | tail -10
```
Expected: 7 passing tests (F1 token-sum + reviser-optional + latencyMs + appConfigVersion precedence + 3 originals).

- [ ] **Step 5.5: Commit (this is the FIRST commit of the W7 trap pair — keep IAM grant OUT of template until Step 11)**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/functions/write-back/
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): WriteBack stub → real (firebase-admin + Firestore)

Phase 3 v3.1 makes WriteBack real. Reads Firebase service account from
Secrets Manager (casa-coqui/firebase-service-account), initializes
firebase-admin once per warm container, then updates the inbound
airbnb_messages doc with the final draft + _agentRun telemetry.

F1 — Tokens summed in JS (ai-chain.asl.json has no top-level
aggregation): sums $.reasoner.tokens + $.drafter.tokens +
$.evaluator.tokens + $.reviser?.tokens. F1 — latencyMs = wall clock
between executionStartTime and Date.now() (proxy until Phase 3.1).

F11 — Header comment block documents non-determinism, idempotency
contract, appConfigVersion precedence (drafter → reviser fallback),
token-sum source paths, and event shape (input + executionArn +
executionStartTime injected by ASL Payload).

F13 — Reads event.executionArn + event.executionStartTime from the ASL
Payload wrapper; event.input is the wrapped chain payload.

Idempotency (Decision 7 — Option A): skip write entirely if
inbound.editedReply is set + non-empty.

7 unit tests cover the editedReply skip path, token sum (with +
without reviser), latencyMs proxy, appConfigVersion precedence,
dot-notation field updates.

NOTE: Lambda IAM still lacks SecretsManager:GetSecretValue. That's
the W7 trap — Step 11 ships the broken template, Step 12 fixes it.
This branch is squash-merged so main never sees the broken state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 6 — `aws-sfn-bridge.js` (40 min)

**Why:** The actual `StartExecution` wrapper. Builds SFN input matching the existing `samples/full-input.json` shape. Emits `BridgeRouteSuccesses` on success, `BridgeRouteFailures` on error. Caller (Step 7) handles the catch-and-fall-back-to-legacy.

**Files:**
- Create: [functions/lib/aws-sfn-bridge.js](../../../functions/lib/aws-sfn-bridge.js)
- Create: [functions/lib/aws-sfn-bridge.test.js](../../../functions/lib/aws-sfn-bridge.test.js)

**Depends on:** Steps 3 + 4.

- [ ] **Step 6.1: Write tests**

Path: `functions/lib/aws-sfn-bridge.test.js`

```js
'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSend })),
  StartExecutionCommand: jest.fn((input) => ({ __type: 'Start', input })),
}));

const mockEmit = jest.fn();
jest.mock('./bridge-metrics', () => ({ emitBridgeMetric: mockEmit }));

const { startReplyDraftExecution } = require('./aws-sfn-bridge');

describe('startReplyDraftExecution', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockEmit.mockReset();
    process.env.REPLY_DRAFT_STATE_MACHINE_ARN =
      'arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft';
  });

  test('happy path — calls StartExecution + emits BridgeRouteSuccesses', async () => {
    mockSend.mockResolvedValueOnce({ executionArn: 'arn:aws:states:...:execution:abc' });
    const out = await startReplyDraftExecution({
      message: { id: 'msg-1', body: 'hi', guestName: 'A', threadKey: 'tk' },
      contextJson: '{}',
      voicePrompt: 'v',
      voiceProfilePrompt: 'vp',
      relevantConversations: [],
      thread: [],
      routedBy: 'rollout-routed',
      appConfigVersion: 'v3',
    });
    expect(out.executionArn).toBe('arn:aws:states:...:execution:abc');
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteSuccesses');
    const call = mockSend.mock.calls[0][0];
    expect(call.input.stateMachineArn).toMatch(/casa-coqui-reply-draft$/);
    const inputObj = JSON.parse(call.input.input);
    expect(inputObj.message.id).toBe('msg-1');
    expect(inputObj.message.threadKey).toBe('tk');
    expect(inputObj._routedBy).toBe('rollout-routed');
    expect(inputObj._appConfigVersion).toBe('v3');
  });

  test('error path — throws AND emits BridgeRouteFailures (caller falls back to legacy)', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(
      startReplyDraftExecution({
        message: { id: 'msg-2', body: 'b', guestName: 'B', threadKey: 'tk2' },
        contextJson: '{}',
        voicePrompt: '',
        voiceProfilePrompt: '',
        relevantConversations: [],
        thread: [],
        routedBy: 'rollout-routed',
      })
    ).rejects.toThrow('AccessDenied');
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteFailures');
  });

  test('thread context window — ports .slice(-20) per AC #16', async () => {
    mockSend.mockResolvedValueOnce({ executionArn: 'a' });
    const thread = Array.from({ length: 30 }, (_, i) => ({ body: `m${i}` }));
    await startReplyDraftExecution({
      message: { id: 'm', body: 'b', guestName: 'g', threadKey: 't' },
      contextJson: '{}',
      voicePrompt: '',
      voiceProfilePrompt: '',
      relevantConversations: [],
      thread,
      routedBy: 'rollout-routed',
    });
    const call = mockSend.mock.calls[0][0];
    const inputObj = JSON.parse(call.input.input);
    expect(inputObj.thread).toHaveLength(20);
    expect(inputObj.thread[0].body).toBe('m10');
    expect(inputObj.thread[19].body).toBe('m29');
  });
});
```

- [ ] **Step 6.2: Implement `aws-sfn-bridge.js`**

Path: `functions/lib/aws-sfn-bridge.js`

```js
'use strict';

// ---------------------------------------------------------------------------
// aws-sfn-bridge — wraps StartExecution against the casa-coqui-reply-draft SM.
//
// Builds SFN input matching the shape consumed by reply-draft.asl.json's
// AIChainExecution state ($.message, $.contextJson, $.voicePrompt, etc. —
// see infra/sam/reply-agent/samples/full-input.json).
//
// AC #16: thread is sliced to last 20 (parity with JS chain's .slice(-20)).
//
// Emits BridgeRouteSuccesses / BridgeRouteFailures.
// On error: emits failure metric AND re-throws — caller (functions/index.js)
// catches and falls back to legacy chain.
//
// SECURITY (Decision 18 / F14):
// This module is for the Cloud Function runtime ONLY. The ESLint
// no-restricted-imports rule blocks app/ imports. The Vercel-side
// regenerate API constructs its own inline SFNClient — see
// app/api/airbnb-messages/[id]/regenerate/route.js.
// ---------------------------------------------------------------------------

const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
const { emitBridgeMetric } = require('./bridge-metrics');

let _client = null;
function getClient() {
  if (_client) return _client;
  _client = new SFNClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

async function startReplyDraftExecution({
  message,
  contextJson,
  voicePrompt,
  voiceProfilePrompt,
  relevantConversations,
  thread,
  routedBy,
  appConfigVersion,
}) {
  const stateMachineArn = process.env.REPLY_DRAFT_STATE_MACHINE_ARN;
  if (!stateMachineArn) throw new Error('aws-sfn-bridge: REPLY_DRAFT_STATE_MACHINE_ARN not set');

  // Spec AC #16 — context window parity (.slice(-20)).
  const trimmedThread = Array.isArray(thread) ? thread.slice(-20) : [];

  const input = {
    message: {
      id: message.id,
      body: message.body,
      guestName: message.guestName || null,
      threadKey: message.threadKey || null,
    },
    contextJson,
    voicePrompt: voicePrompt || '',
    voiceProfilePrompt: voiceProfilePrompt || '',
    relevantConversations: relevantConversations || [],
    thread: trimmedThread,
    _routedBy: routedBy,
    _appConfigVersion: appConfigVersion || 'unknown',
  };

  try {
    const out = await getClient().send(new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify(input),
    }));
    await emitBridgeMetric('BridgeRouteSuccesses');
    return { executionArn: out.executionArn, startDate: out.startDate };
  } catch (e) {
    await emitBridgeMetric('BridgeRouteFailures');
    throw e;
  }
}

module.exports = { startReplyDraftExecution };
```

- [ ] **Step 6.3: Add `@aws-sdk/client-sfn` to functions deps**

```bash
cd /Users/jperez/dev/casa-coqui/functions
npm install --save @aws-sdk/client-sfn
```

- [ ] **Step 6.4: Run tests**

```bash
cd /Users/jperez/dev/casa-coqui/functions && npx jest lib/aws-sfn-bridge.test.js 2>&1 | tail -10
```
Expected: 3 passing tests.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add functions/lib/aws-sfn-bridge.js functions/lib/aws-sfn-bridge.test.js functions/package.json functions/package-lock.json
git commit -m "$(cat <<'EOF'
feat(phase-3): aws-sfn-bridge StartExecution wrapper

Builds SFN input matching reply-draft.asl.json's expected shape
($.message, $.contextJson, $.voicePrompt, etc.). Slices thread to
last 20 messages per AC #16 (context-window parity with JS chain).

Stamps _appConfigVersion (AppConfig flag VersionLabel) on the SFN
input so WriteBack can persist it (v3.1 — distinguished from
drafter's prompt-side appConfigVersion).

Emits BridgeRouteSuccesses on success, BridgeRouteFailures on error.
On error: re-throws so caller falls back to legacy chain.

3 unit tests: happy path, error path, thread .slice(-20).

Adds @aws-sdk/client-sfn to functions deps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Step 7 — Wire bridge into `onAirbnbMessageCreated` (60 min) [F2, F3]

**Why:** The integration point. **F3:** Insert the bridge BETWEEN context build and the LLM call — NOT before context build. The SFN expects `contextJson`, `voicePrompt`, `voiceProfilePrompt`, `relevantConversations` ALL pre-built and passed in (`samples/full-input.json` is the canonical shape; the Reasoner Lambda has no Firestore access). The cost saved on the SFN path is the Anthropic LLM call (~$0.03/draft), not the context build (~$0.0001).

**F2:** Use Firebase Functions v2 `defineSecret` / `defineString` for AWS keys + state machine ARN + AppConfig env vars. v2 functions don't read `functions.config()`.

**Files:**
- Modify: [functions/index.js](../../../functions/index.js)

- [ ] **Step 7.1: Read the current insertion point**

```bash
grep -n 'Generating reply\|generateReplyChain\|messageWithId\|contextJson\|voicePrompt\|voiceProfilePrompt\|relevantConversations\|onDocumentCreated' /Users/jperez/dev/casa-coqui/functions/index.js | head -40
```

Identify (a) the line where `messageWithId` / `contextJson` / `voicePrompt` / `voiceProfilePrompt` / `relevantConversations` / `thread` are all built, (b) the `generateReplyChain()` invocation. The bridge dispatch sits between these two.

- [ ] **Step 7.2: Add v2 secret/param defines + bridge dispatch**

At the top of `functions/index.js`, alongside other `defineSecret` calls:

```js
const { defineSecret, defineString } = require('firebase-functions/params');

// ── Phase 3 v3.1 — F2: v2 secrets/params, NOT functions.config() ─────────
const AWS_ACCESS_KEY_ID = defineSecret('AWS_ACCESS_KEY_ID');
const AWS_SECRET_ACCESS_KEY = defineSecret('AWS_SECRET_ACCESS_KEY');
const REPLY_DRAFT_STATE_MACHINE_ARN = defineString('REPLY_DRAFT_STATE_MACHINE_ARN', {
  default: 'arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft',
});
const APPCONFIG_APPLICATION = defineString('APPCONFIG_APPLICATION', { default: 'casa-coqui-reply-agent' });
const APPCONFIG_ENVIRONMENT = defineString('APPCONFIG_ENVIRONMENT', { default: 'prod' });
const APPCONFIG_FLAGS_PROFILE = defineString('APPCONFIG_FLAGS_PROFILE', { default: 'feature-flags' });
```

In the `onDocumentCreated` definition for `onAirbnbMessageCreated`, ensure the secrets are wired:

```js
exports.onAirbnbMessageCreated = onDocumentCreated(
  {
    document: 'airbnb_messages/{messageId}',
    region: 'us-east1',
    secrets: [ANTHROPIC_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY],
  },
  async (event) => {
    // ... existing body ...
  }
);
```

(Append `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` to the existing `secrets` array. v2 secrets are exposed at `process.env.<NAME>` automatically — `appconfig-client.js`, `bridge-metrics.js`, and `aws-sfn-bridge.js` read `process.env.AWS_ACCESS_KEY_ID` directly.)

Also add the requires:

```js
const { decideRoute } = require('./lib/decide-route');
const { fetchReplyEngineFlag } = require('./lib/appconfig-client');
const { startReplyDraftExecution } = require('./lib/aws-sfn-bridge');
const { emitBridgeMetric } = require('./lib/bridge-metrics');
```

**F3 — Bridge insertion diff (concrete pattern):**

```js
// ─── BRIDGE DISPATCH (Phase 3 v3.1) ───────────────────────────────────────
// Insertion point: AFTER messageWithId build, AFTER booking + thread fetch,
// AFTER contextJson + voicePrompt + voiceProfilePrompt + RAG retrieval —
// BUT BEFORE the generateReplyChain() call.
//
// Decision 19 v3.1: shared cost is Firestore reads + RAG embed (~$0.0001).
// The SFN saves the Anthropic LLM call (the real money — ~$0.03/draft).
//
// All of contextJson, voicePrompt, voiceProfilePrompt, relevantConversations,
// thread MUST already be built above. The Reasoner Lambda has no Firestore
// access — passing pre-built inputs is the SFN contract.
// ─────────────────────────────────────────────────────────────────────────

const flag = await fetchReplyEngineFlag();
const { engine, reason } = decideRoute({ messageId, flag });
logger.info('[bridge] route', { messageId, engine, reason, flagVersion: flag.version });

let routedByOverride = null;
if (engine === 'aws-sfn') {
  try {
    await startReplyDraftExecution({
      message: messageWithId,
      contextJson,
      voicePrompt,
      voiceProfilePrompt,
      relevantConversations,
      thread,
      routedBy: reason,                       // 'rollout-routed'
      appConfigVersion: flag.version,         // AppConfig VersionLabel
    });
    await emitBridgeMetric('BridgeRouteSuccesses');
    return; // SFN owns WriteBack; legacy chain doesn't run
  } catch (err) {
    logger.error('[bridge] StartExecution failed, falling back to legacy', err);
    await emitBridgeMetric('BridgeRouteFailures');
    routedByOverride = 'legacy-fallback';
  }
}

if (reason === 'shadow-stub') {
  logger.warn('[bridge] shadow_mode_not_implemented_routing_to_legacy', { messageId });
}

// ── LEGACY JS CHAIN — falls through here for mode:firebase OR fallback ──
// Stamp _agentRun.routedBy = routedByOverride || reason on the legacy
// chain's existing Firestore write. The legacy generateReplyChain() call
// continues below unchanged.
const _legacyRoutedBy = routedByOverride || reason;
// ... existing generateReplyChain() invocation; pass _legacyRoutedBy through
//     to whatever currently writes _agentRun on the JS-chain success path.
```

**Note:** the variable names `messageWithId`, `contextJson`, `voicePrompt`, `voiceProfilePrompt`, `relevantConversations`, `thread` MUST match what the existing legacy chain code computes. If any names differ in the actual file, alias them at the top of the bridge block (do NOT rebuild — Decision 19's whole point is sharing the build).

- [ ] **Step 7.3: Stamp `_agentRun.routedBy` on the legacy chain's existing Firestore write**

Find the legacy-chain Firestore write site (search for `_agentRun` in `functions/index.js`) and add `routedBy: _legacyRoutedBy` to the persisted object. Most likely shape is `{ ..., routedBy: _legacyRoutedBy }` in a Firestore `set`/`update`.

- [ ] **Step 7.4: Local module-load smoke**

```bash
cd /Users/jperez/dev/casa-coqui/functions
node -e "require('./index.js'); console.log('module loads OK');"
```
Expected: `module loads OK`.

- [ ] **Step 7.5: Run all functions tests**

```bash
cd /Users/jperez/dev/casa-coqui/functions && npx jest 2>&1 | tail -15
```
Expected: all prior tests pass + new tests from Steps 2/3/4/6.

- [ ] **Step 7.6: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add functions/index.js
git commit -m "$(cat <<'EOF'
feat(phase-3): wire bridge into onAirbnbMessageCreated (v3.1)

F2 — Uses defineSecret('AWS_ACCESS_KEY_ID')/('AWS_SECRET_ACCESS_KEY')
+ defineString for REPLY_DRAFT_STATE_MACHINE_ARN and APPCONFIG_*
env vars. v2 functions don't read functions.config().

F3 — Bridge inserted BETWEEN context build and the LLM call (NOT
before context build). All of contextJson, voicePrompt,
voiceProfilePrompt, relevantConversations, thread are already
built; bridge dispatches with them. Decision 19 v3.1: shared cost
is Firestore reads + RAG embed (~$0.0001); the SFN saves the
Anthropic LLM call (~$0.03/draft).

Four-step bridge dispatch:
  1. fetchReplyEngineFlag() — fail-closed AppConfig fetch with version
  2. decideRoute({ messageId, flag })
  3. If engine: aws-sfn → startReplyDraftExecution(); on error fall
     back to legacy + log + emitBridgeMetric('BridgeRouteFailures')
  4. Else legacy chain runs with _legacyRoutedBy stamped on
     _agentRun.routedBy

Behavior at rollout_pct: 0:
  - mode: aws-sfn with hash >= 0 (all messages) → 'rollout-gated'
  - mode: firebase                              → 'firebase-explicit'

NOT deployed yet — Cloud Function only ships via CodePipeline after
SAM is verified (Decision 15).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 8.0 — ESLint no-restricted-imports rule (15 min) [F14]

**Why (F14, Decision 18):** If any client code path imports `aws-sfn-bridge.js` (e.g., a tree-shaking miss or accidental top-level require in a Next.js page), the bundler may inline `process.env.AWS_ACCESS_KEY_ID` references via `NEXT_PUBLIC_*` reflexes, leaking AWS keys into the client bundle. Add an ESLint rule scoped to `app/` that bans imports of `functions/lib/aws-sfn-bridge` and `functions/lib/bridge-metrics`. The regenerate API route at `app/api/airbnb-messages/[id]/regenerate/route.js` constructs its own inline SFN client (different runtime — Vercel — different env-var injection).

**Files:**
- Modify: `.eslintrc.json`

- [ ] **Step 8.0.1: Update `.eslintrc.json` with the rule**

Path: `.eslintrc.json`

```json
{
  "extends": "next/core-web-vitals",
  "overrides": [
    {
      "files": ["app/**/*.{js,ts,jsx,tsx}"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "paths": [
              {
                "name": "functions/lib/aws-sfn-bridge",
                "message": "Cloud Function bridge module — not for client/Vercel routes. Construct an inline SFN client in the regenerate API route instead (see app/api/airbnb-messages/[id]/regenerate/route.js)."
              },
              {
                "name": "functions/lib/bridge-metrics",
                "message": "Cloud Function metrics — not for client/Vercel routes."
              }
            ],
            "patterns": [
              "../../functions/lib/aws-sfn-bridge",
              "../../functions/lib/bridge-metrics",
              "../../../functions/lib/aws-sfn-bridge",
              "../../../functions/lib/bridge-metrics"
            ]
          }
        ]
      }
    }
  ]
}
```

- [ ] **Step 8.0.2: Verify lint passes (no current violations)**

```bash
cd /Users/jperez/dev/casa-coqui
npm run lint --silent 2>&1 | tail -10
```
Expected: no errors. (No file under `app/` should currently import bridge modules; this rule is a forward guard.)

- [ ] **Step 8.0.3: Verify rule actually fires (sanity check)**

Create a temporary test file that violates the rule, lint it, expect failure, then delete:

```bash
cat > /tmp/eslint-rule-test.js <<'EOF'
// This should fail under the override pattern.
const x = require('../../functions/lib/aws-sfn-bridge');
console.log(x);
EOF
mkdir -p /Users/jperez/dev/casa-coqui/app/__lint_probe__
cp /tmp/eslint-rule-test.js /Users/jperez/dev/casa-coqui/app/__lint_probe__/probe.js
cd /Users/jperez/dev/casa-coqui
npm run lint -- app/__lint_probe__/probe.js 2>&1 | tail -10
# Expected: error mentioning no-restricted-imports
rm -rf /Users/jperez/dev/casa-coqui/app/__lint_probe__/
```

- [ ] **Step 8.0.4: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add .eslintrc.json
git commit -m "$(cat <<'EOF'
feat(phase-3): ESLint no-restricted-imports rule for bridge modules (F14)

Decision 18 v3.1. Bans app/ imports of functions/lib/aws-sfn-bridge
and functions/lib/bridge-metrics. Prevents accidental client-bundle
leaks of AWS keys via Next.js bundler inlining.

The regenerate API route at app/api/airbnb-messages/[id]/regenerate/
route.js constructs its own inline SFN client (Vercel runtime, not
Cloud Functions runtime — different env-var injection model).

Verified: rule fires on a probe file that requires the banned path;
no current violations in app/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 8 — Regenerate API + admin UI (45 min)

**Why:** Decisions 9 + 16. Replaces the broken regenerate button with a real `POST /api/airbnb-messages/[id]/regenerate` route. Same endpoint powers the new "Retry" button on `draftStatus: failed` rows. Rate limit: 3 per inbound (`_agentRun.regenerateCount`) + 30s cooldown (`_agentRun.lastRegenerateAt`). Disable Regenerate button when `editedReply` is set. **F14:** the route constructs its OWN inline SFN client — does NOT import `functions/lib/aws-sfn-bridge`.

**Files:**
- Create: [app/api/airbnb-messages/[id]/regenerate/route.js](../../../app/api/airbnb-messages/[id]/regenerate/route.js)
- Modify: [app/admin/messages/page.js](../../../app/admin/messages/page.js)

- [ ] **Step 8.1: Create the regenerate API route (inline SFN client per F14)**

Path: `app/api/airbnb-messages/[id]/regenerate/route.js`

```js
import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { requireRole } from '@/lib/api-auth';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

// F14: this route runs on Vercel, NOT Cloud Functions. It constructs its own
// SFN client — does NOT import functions/lib/aws-sfn-bridge (ESLint blocks
// that import; the bridge module reads Firebase secrets, not Vercel env).

const COOLDOWN_MS = 30_000;
const MAX_REGEN = 3;

let _sfn = null;
function getSfn() {
  if (_sfn) return _sfn;
  _sfn = new SFNClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _sfn;
}

export async function POST(req, { params }) {
  const auth = await requireRole(req, ['admin', 'cohost']);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const messageId = params.id;
  const db = getFirestore();
  const ref = db.collection('airbnb_messages').doc(messageId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });

  const cur = snap.data();
  const agentRun = cur._agentRun || {};
  if ((agentRun.regenerateCount || 0) >= MAX_REGEN) {
    return NextResponse.json({ success: false, error: 'rate_limit_count' }, { status: 429 });
  }
  if (agentRun.lastRegenerateAt) {
    const last = agentRun.lastRegenerateAt.toMillis ? agentRun.lastRegenerateAt.toMillis() : new Date(agentRun.lastRegenerateAt).getTime();
    if (Date.now() - last < COOLDOWN_MS) {
      return NextResponse.json({ success: false, error: 'rate_limit_cooldown' }, { status: 429 });
    }
  }

  const stateMachineArn = process.env.REPLY_DRAFT_STATE_MACHINE_ARN;
  if (!stateMachineArn) {
    return NextResponse.json({ success: false, error: 'missing_sfn_arn' }, { status: 500 });
  }

  const input = {
    message: {
      id: messageId,
      body: cur.body,
      guestName: cur.guestName,
      threadKey: cur.threadKey,
    },
    _routedBy: 'regenerate',
  };

  let executionArn = null;
  try {
    const out = await getSfn().send(new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify(input),
    }));
    executionArn = out.executionArn;
  } catch (e) {
    return NextResponse.json({ success: false, error: 'sfn_start_failed', message: e.message }, { status: 502 });
  }

  await ref.update({
    '_agentRun.regenerateCount': (agentRun.regenerateCount || 0) + 1,
    '_agentRun.lastRegenerateAt': new Date(),
    '_agentRun.routedBy': 'regenerate',
    draftStatus: 'pending',
  });

  return NextResponse.json({ success: true, data: { executionArn } });
}
```

- [ ] **Step 8.2: Wire admin UI Regenerate + Retry + editedReply gating**

In `app/admin/messages/page.js`:

1. Find the existing Regenerate button. Replace its handler with a `POST /api/airbnb-messages/${msg.id}/regenerate` fetch.
2. Disable the Regenerate button when `msg.editedReply && msg.editedReply.length > 0`. Add a tooltip via `title=`: `"Regenerate is disabled because this draft has been manually edited (host edits are sticky)."`
3. Add a "Retry" button on rows where `msg.draftStatus === 'failed'` that calls the same endpoint.

```jsx
<button
  onClick={() => handleRegenerate(msg.id)}
  disabled={!!(msg.editedReply && msg.editedReply.length > 0)}
  title={msg.editedReply ? "Regenerate is disabled — host edits are sticky and won't be clobbered." : ""}
  className="..."
>
  Regenerate
</button>
{msg.draftStatus === 'failed' && (
  <button onClick={() => handleRegenerate(msg.id)} className="...">Retry</button>
)}
```

```js
async function handleRegenerate(id) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/airbnb-messages/${id}/regenerate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.success) {
    alert(`Regenerate failed: ${json.error}`);
    return;
  }
  // optimistic UI update — rely on Firestore real-time for final state
}
```

- [ ] **Step 8.3: Smoke compile + lint**

```bash
cd /Users/jperez/dev/casa-coqui
npm run lint --silent 2>&1 | tail -10
```
Expected: no new lint errors. **Critically:** the new route must NOT trigger the F14 no-restricted-imports rule because it does not import `functions/lib/aws-sfn-bridge` — it constructs its own SFNClient inline.

- [ ] **Step 8.4: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add app/api/airbnb-messages/\[id\]/regenerate/route.js app/admin/messages/page.js
git commit -m "$(cat <<'EOF'
feat(phase-3): regenerate API + admin UI Retry button + editedReply gating

POST /api/airbnb-messages/[id]/regenerate — auth-gated (admin/cohost).
Always routes to SFN with _routedBy: 'regenerate' (Decision 9 + 16).

F14: constructs an inline SFNClient (does NOT import
functions/lib/aws-sfn-bridge — Vercel runtime, not Cloud Functions).

Rate limits (Decision 16):
  - 3 regenerations per inbound (_agentRun.regenerateCount), 429 on 4th
  - 30s cooldown (_agentRun.lastRegenerateAt), 429 within window

Admin UI:
  - Regenerate button now calls the new API (replacing broken legacy)
  - Disabled when inbound.editedReply is set + non-empty (tooltip
    explains: host edits are sticky, surfacing Decision 7 in UX)
  - New Retry button on draftStatus: failed rows — calls same endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 9 — ASL: per-state Catch + SendToDLQ + Execution context to WriteBack (30 min) [F13]

**Why:** Spec ASL changes section. Replace `Next: WorkflowFailed` inside per-state Catch blocks with `Next: SendToDLQ`. Insert new `SendToDLQ` Task state BEFORE existing `WorkflowFailed`. **F13:** propagate `$$.Execution.Id` + `$$.Execution.StartTime` into the WriteBack Payload so WriteBack can stamp `_agentRun.executionArn` and compute `_agentRun.latencyMs` (Decision 17 v3.1).

**Files:**
- Modify: [infra/sam/reply-agent/statemachines/reply-draft.asl.json](../../../infra/sam/reply-agent/statemachines/reply-draft.asl.json)

- [ ] **Step 9.1: Update ASL — Catch redirects + WriteBack Payload context (F13)**

Edit `infra/sam/reply-agent/statemachines/reply-draft.asl.json`.

For each of `LoadConfig`, `AIChainExecution`, `WriteBack`, change the existing Catch block:

```json
"Catch": [
  {
    "ErrorEquals": ["States.ALL"],
    "ResultPath": "$.error",
    "Next": "WorkflowFailed"
  }
]
```

to:

```json
"Catch": [
  {
    "ErrorEquals": ["States.ALL"],
    "ResultPath": "$.error",
    "Next": "SendToDLQ"
  }
]
```

**Leave `RAGRetrieve`'s Catch unchanged** — it routes to `AIChainExecution` (non-fatal) per the existing comment.

**F13 — Modify the WriteBack Task's Parameters.Payload to inject execution context:**

```json
"WriteBack": {
  "Type": "Task",
  "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": {
    "FunctionName": "${WriteBackArn}",
    "Payload": {
      "input.$": "$",
      "executionArn.$": "$$.Execution.Id",
      "executionStartTime.$": "$$.Execution.StartTime"
    }
  },
  "ResultPath": "$.writeBack",
  "Catch": [
    {
      "ErrorEquals": ["States.ALL"],
      "ResultPath": "$.error",
      "Next": "SendToDLQ"
    }
  ],
  "End": true
}
```

WriteBack's handler reads `event.executionArn`, `event.executionStartTime`, and `event.input` (the wrapped chain payload) — NOT `event.message.id` directly. See Step 5.3.

**Insert** the `SendToDLQ` state before `WorkflowFailed`:

```json
"SendToDLQ": {
  "Type": "Task",
  "Comment": "Send execution context to SQS DLQ for human-loop redrive (Phase 3)",
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

`WorkflowFailed` stays unchanged.

- [ ] **Step 9.2: Validate JSON**

```bash
cd /Users/jperez/dev/casa-coqui
jq . infra/sam/reply-agent/statemachines/reply-draft.asl.json > /dev/null && echo "Valid JSON"
```

- [ ] **Step 9.3: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/statemachines/reply-draft.asl.json
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): per-state Catch redirects + WriteBack execution context (F13)

ASL doesn't support top-level Catch (AWS engineer concern #1) —
must be per-state. Updates LoadConfig + AIChainExecution + WriteBack
Catch blocks to redirect to a new SendToDLQ Task state.

F13 — WriteBack Task's Parameters.Payload now includes
executionArn.$: $$.Execution.Id and executionStartTime.$:
$$.Execution.StartTime. WriteBack reads these to stamp
_agentRun.executionArn and compute _agentRun.latencyMs as
(Date.now() - executionStartTime). Decision 17 v3.1 proxy until
Phase 3.1 brings per-Lambda granularity.

SendToDLQ uses arn:aws:states:::sqs:sendMessage. MessageBody field
paths use $.message.id and $.message.threadKey (NOT flat
$.messageId/$.threadKey — verified against samples/full-input.json).

RAGRetrieve's Catch is unchanged (routes to AIChainExecution; non-fatal).

WorkflowFailed remains the terminal Fail state — DLQ send completes
before failure is signaled.

DLQ URL is interpolated via SAM DefinitionSubstitutions
(ReplyDraftDLQUrl) — Step 10 wires that.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Step 10 — SAM template: DLQ + SNS + alarms + IAM user + Monitor (90 min)

**Why:** Spec scope table. Adds 9 new resources. Fixes the latent `appconfig:*` → `appconfigdata:*` bug on Drafter+Reviser (AWS engineer concern #5). Adds DLQNotifier Lambda. Wires SystemPromptMonitor on the Environment (NOT DeploymentStrategy — v1 spec error fixed in v2).

**Files:**
- Modify: [infra/sam/reply-agent/template.yaml](../../../infra/sam/reply-agent/template.yaml)
- Create: `infra/sam/reply-agent/functions/dlq-notifier/index.js`
- Create: `infra/sam/reply-agent/functions/dlq-notifier/package.json`

- [ ] **Step 10.1: Create the DLQ notifier Lambda**

Path: `infra/sam/reply-agent/functions/dlq-notifier/package.json`

```json
{
  "name": "casa-coqui-reply-dlq-notifier",
  "version": "1.0.0",
  "private": true,
  "description": "Reads SQS DLQ messages and publishes formatted alerts to SNS",
  "main": "index.js",
  "engines": { "node": "24" },
  "dependencies": {
    "@aws-sdk/client-sns": "^3.700.0"
  }
}
```

Path: `infra/sam/reply-agent/functions/dlq-notifier/index.js`

```js
'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const sns = new SNSClient({});
const TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async (event) => {
  for (const record of event.Records || []) {
    let body;
    try { body = JSON.parse(record.body); } catch { body = { raw: record.body }; }
    const msgId = body.messageId || 'unknown';
    const exec = body.executionArn || 'unknown';
    const threadKey = body.threadKey || 'unknown';
    const error = body.error?.Cause || body.error?.Error || JSON.stringify(body.error);

    await sns.send(new PublishCommand({
      TopicArn: TOPIC_ARN,
      Subject: `[casa-coqui] reply-draft DLQ: ${msgId}`,
      Message: `Reply draft execution failed.\n\nmessageId: ${msgId}\nthreadKey: ${threadKey}\nexecutionArn: ${exec}\n\nerror:\n${error}\n\nRetry from /admin/messages.`,
    }));
  }
  return { processed: (event.Records || []).length };
};
```

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent/functions/dlq-notifier && npm install
```

- [ ] **Step 10.2: Add new resources to `template.yaml`**

Open `infra/sam/reply-agent/template.yaml`. Add a new Parameter for the alert email:

```yaml
  AlertEmail:
    Type: String
    Default: 01juliop@gmail.com
    Description: Email subscriber for SNS DLQ + bridge alarms
```

Add these resources to the `Resources:` block. **Place them after the existing `WriteBackFunction` and before the SSM/AppConfig blocks.**

```yaml
  # -------------------------------------------------------------------------
  # Phase 3 — DLQ + SNS + DLQ Notifier
  # -------------------------------------------------------------------------

  ReplyDraftDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: casa-coqui-reply-draft-dlq
      MessageRetentionPeriod: 1209600  # 14 days
      SqsManagedSseEnabled: true        # SSE — payloads contain Firestore ids / threadKeys

  ReplyDraftFailureTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: casa-coqui-reply-draft-failures
      Subscription:
        - Endpoint: !Ref AlertEmail
          Protocol: email

  DLQNotifierFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: casa-coqui-reply-dlq-notifier
      CodeUri: functions/dlq-notifier/
      Handler: index.handler
      Description: Formats SQS DLQ messages and publishes to SNS
      Environment:
        Variables:
          SNS_TOPIC_ARN: !Ref ReplyDraftFailureTopic
      Events:
        DLQTrigger:
          Type: SQS
          Properties:
            Queue: !GetAtt ReplyDraftDLQ.Arn
            BatchSize: 10
      Policies:
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: sns:Publish
              Resource: !Ref ReplyDraftFailureTopic

  # -------------------------------------------------------------------------
  # Phase 3 — CloudWatch Alarms
  # -------------------------------------------------------------------------

  SFNExecutionsFailedAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: casa-coqui-reply-draft-executions-failed
      AlarmDescription: SFN executions failing — wired to AppConfig Monitor for auto-rollback
      MetricName: ExecutionsFailed
      Namespace: AWS/States
      Statistic: Sum
      Period: 60
      EvaluationPeriods: 3
      DatapointsToAlarm: 2
      Threshold: 2
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: notBreaching   # CRITICAL — low-volume app
      Dimensions:
        - Name: StateMachineArn
          Value: !Ref ReplyDraftStateMachine
      AlarmActions:
        - !Ref ReplyDraftFailureTopic

  BridgeFailureAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: casa-coqui-bridge-route-failures
      AlarmDescription: Bridge BridgeRouteFailures > 5 in 5 min — Cloud Function path may be unhealthy
      MetricName: BridgeRouteFailures
      Namespace: CasaCoqui/Bridge
      Statistic: Sum
      Period: 60
      EvaluationPeriods: 5
      DatapointsToAlarm: 5
      Threshold: 5
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: notBreaching
      AlarmActions:
        - !Ref ReplyDraftFailureTopic

  AnthropicThrottlesAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: casa-coqui-anthropic-throttles
      MetricName: AnthropicThrottles
      Namespace: CasaCoqui/Chain
      Statistic: Sum
      Period: 60
      EvaluationPeriods: 1
      Threshold: 20
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: notBreaching
      AlarmActions:
        - !Ref ReplyDraftFailureTopic

  LatencyP95Alarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: casa-coqui-reply-draft-latency-p95
      MetricName: ExecutionTime
      Namespace: AWS/States
      ExtendedStatistic: p95
      Period: 300
      EvaluationPeriods: 1
      Threshold: 30000
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
      Dimensions:
        - Name: StateMachineArn
          Value: !Ref ReplyDraftStateMachine
      AlarmActions:
        - !Ref ReplyDraftFailureTopic

  # -------------------------------------------------------------------------
  # Phase 3 — AppConfig Monitor on the prod Environment (Decision 10 + 14)
  # -------------------------------------------------------------------------

  AppConfigMonitorRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: casa-coqui-appconfig-monitor
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: appconfig.amazonaws.com }
            Action: sts:AssumeRole
      Policies:
        - PolicyName: DescribeAlarms
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: cloudwatch:DescribeAlarms
                Resource: !GetAtt SFNExecutionsFailedAlarm.Arn
```

Now find the existing `ReplyAgentProdEnvironment` resource (added in Phase 2) and **replace** it with:

```yaml
  ReplyAgentProdEnvironment:
    Type: AWS::AppConfig::Environment
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      Name: prod
      Description: Production environment (Phase 3 wires SFNExecutionsFailedAlarm Monitor)
      Monitors:
        - AlarmArn: !GetAtt SFNExecutionsFailedAlarm.Arn
          AlarmRoleArn: !GetAtt AppConfigMonitorRole.Arn
```

Add the Bridge IAM user (after AppConfigMonitorRole):

```yaml
  # -------------------------------------------------------------------------
  # Phase 3 — Bridge IAM user (Firebase Cloud Function → AWS)
  # Long-lived access key per Decision 5 + rotation runbook (Step 15.3.1).
  # Stored in Firebase Functions secrets (defineSecret) AND mirrored into
  # Vercel env (regenerate API runtime — Step 16.2.1).
  # -------------------------------------------------------------------------

  BridgeIamUser:
    Type: AWS::IAM::User
    Properties:
      UserName: casa-coqui-firebase-bridge
      Policies:
        - PolicyName: SfnStartExecutionScoped
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: states:StartExecution
                Resource: !Ref ReplyDraftStateMachine
              - Effect: Allow
                Action:
                  - appconfigdata:StartConfigurationSession
                  - appconfigdata:GetLatestConfiguration
                Resource: !Sub arn:aws:appconfig:${AWS::Region}:${AWS::AccountId}:application/${ReplyAgentApplication}/environment/${ReplyAgentProdEnvironment}/configuration/${FeatureFlagsProfile}
              - Effect: Allow
                Action: cloudwatch:PutMetricData
                Resource: '*'
                Condition:
                  StringEquals:
                    cloudwatch:namespace: CasaCoqui/Bridge
```

- [ ] **Step 10.3: Fix the latent `appconfig:*` → `appconfigdata:*` bug on Drafter + Reviser**

In Drafter's existing Policies (line ~166 and ~210), change:

```yaml
            - Effect: Allow
              Action:
                - appconfig:StartConfigurationSession
                - appconfig:GetLatestConfiguration
```

to:

```yaml
            - Effect: Allow
              Action:
                - appconfigdata:StartConfigurationSession
                - appconfigdata:GetLatestConfiguration
```

Apply identically to Reviser. (Spec AC #4.)

- [ ] **Step 10.4: Add WriteBack Lambda env vars + DLQ ARN substitution to ReplyDraftStateMachine**

Find `ReplyDraftStateMachine.Properties.DefinitionSubstitutions`. Add:

```yaml
        ReplyDraftDLQUrl: !Ref ReplyDraftDLQ
```

Find `ReplyDraftStateMachine.Policies` and add SQS perm:

```yaml
        - SQSSendMessagePolicy:
            QueueName: !GetAtt ReplyDraftDLQ.QueueName
```

- [ ] **Step 10.5: Validate template**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam validate 2>&1
```
Expected: `is a valid SAM Template`.

- [ ] **Step 10.6: Commit (template part of W7 trap pair — INTENTIONALLY missing the WriteBack Firebase grant)**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/template.yaml infra/sam/reply-agent/functions/dlq-notifier/
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): wire WriteBack to firebase-admin [INTENTIONAL: missing IAM grant]

W7 break-it trap (Commit A on feature branch). Adds Phase 3 resources:
  - ReplyDraftDLQ (SQS, 14d retention, SSE)
  - ReplyDraftFailureTopic (SNS) + email subscription to 01juliop@gmail.com
  - DLQNotifierFunction (SQS-triggered, formats DLQ → SNS)
  - SFNExecutionsFailedAlarm (Threshold:2, EvaluationPeriods:3,
    DatapointsToAlarm:2, Period:60, TreatMissingData:notBreaching)
  - BridgeFailureAlarm (CasaCoqui/Bridge.BridgeRouteFailures > 5/5min)
  - AnthropicThrottlesAlarm + LatencyP95Alarm (informational)
  - AppConfigMonitorRole + Monitors block on ReplyAgentProdEnvironment
  - BridgeIamUser (StartExecution + appconfigdata:* + PutMetricData
    constrained to namespace CasaCoqui/Bridge)
  - SQS DefinitionSubstitution + SFN policy for SendMessage

Bug fixes:
  - Drafter + Reviser: appconfig:* → appconfigdata:* (AWS eng concern #5)

INTENTIONAL TRAP: WriteBackFunction's IAM does NOT include
secretsmanager:GetSecretValue on FirebaseSecretName-*. Lambda will
crash at first invocation with AccessDenied. SFN catches via the
new SendToDLQ state, SNS email fires.

Step 12 fixes the IAM. Branch is squash-merged so main never sees
this state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 11 — INTENTIONAL BREAK: deploy SAM, observe trap fire (35 min) [F6]

**Why:** Decision 14. The two-commit W7 trap teaches cross-cloud IAM debugging. **F6:** Use `--no-execute-changeset` so Julio reviews the diff BEFORE execute.

- [ ] **Step 11.1: Pause for Julio approval to deploy SAM (intentional break)**

> "Julio — about to `sam deploy --no-execute-changeset` the broken WriteBack IAM (W7 trap step). I'll show you the changeset before executing it. Stack will succeed, but the first synthetic SFN invocation will fail at WriteBack with AccessDenied → DLQ → SNS email. OK to proceed with the changeset preview?"

Wait for explicit OK.

- [ ] **Step 11.2: Build + create changeset (no execute) [F6]**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam build 2>&1 | tail -5
sam deploy --stack-name casa-coqui-reply-agent --no-execute-changeset --capabilities CAPABILITY_IAM 2>&1 | tee /tmp/phase3-deploy-broken.txt | tail -60
```

The output will print the changeset ARN and the resource diff. **Show the changeset summary to Julio.**

- [ ] **Step 11.3: Pause for explicit Julio approval to execute the changeset**

> "Julio — changeset prepared. Resources added/modified per output above. OK to execute?"

Wait for OK, then:

```bash
CHANGESET_ARN=$(grep -oE 'arn:aws:cloudformation:[^[:space:]]+changeSet/[^[:space:]]+' /tmp/phase3-deploy-broken.txt | head -1)
echo "Executing changeset: $CHANGESET_ARN"
aws cloudformation execute-change-set --change-set-name "$CHANGESET_ARN" --stack-name casa-coqui-reply-agent
aws cloudformation wait stack-update-complete --stack-name casa-coqui-reply-agent
```

- [ ] **Step 11.4: Verify stack status + new resources exist**

```bash
aws cloudformation describe-stacks --stack-name casa-coqui-reply-agent \
  --query 'Stacks[0].StackStatus' --output text
# Expected: UPDATE_COMPLETE

aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name casa-coqui-reply-draft-dlq --query 'QueueUrl' --output text) \
  --attribute-names QueueArn,MessageRetentionPeriod
# Expected: ARN + 1209600

aws sns list-subscriptions-by-topic --topic-arn $(aws sns list-topics --query "Topics[?ends_with(TopicArn,':casa-coqui-reply-draft-failures')].TopicArn" --output text) \
  --query 'Subscriptions[].{Email:Endpoint,Status:SubscriptionArn}' --output table
# Expected: 01juliop@gmail.com row. Confirm via the AWS email subscription email; one-time.
```

- [ ] **Step 11.5: Trigger a synthetic SFN execution and watch it fail at WriteBack**

```bash
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --input file://infra/sam/reply-agent/samples/full-input.json \
  --name "phase3-w7-trap-$(date +%s)"
```

Wait ~60s. Then check execution status:

```bash
EXEC=$(aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --max-results 1 --query 'executions[0].executionArn' --output text)
aws stepfunctions describe-execution --execution-arn "$EXEC" \
  --query '{Status:status,Error:error,Cause:cause}' --output table
# Expected: Status FAILED, Cause references AccessDenied / secretsmanager
```

- [ ] **Step 11.6: Read WriteBack CloudWatch logs to confirm AccessDenied**

```bash
aws logs tail /aws/lambda/casa-coqui-reply-write-back --since 5m --filter-pattern "AccessDenied" 2>&1 | tail -20
```
Expected: log line referencing `AccessDeniedException` and `secretsmanager:GetSecretValue` against `casa-coqui/firebase-service-account-*`.

- [ ] **Step 11.7: Confirm DLQ message landed**

```bash
aws sqs receive-message \
  --queue-url $(aws sqs get-queue-url --queue-name casa-coqui-reply-draft-dlq --query 'QueueUrl' --output text) \
  --max-number-of-messages 1 \
  --visibility-timeout 0
# Expected: 1 message body with messageId, threadKey, executionArn, error
```

- [ ] **Step 11.8: Confirm SNS email landed in Julio's inbox**

Julio checks `01juliop@gmail.com` for the `[casa-coqui] reply-draft DLQ:` email.

- [ ] **Step 11.9: No commit needed — operational step. Capture findings in change log via doc agent.**

---

## Step 12 — FIX: add SecretsManager grant to WriteBack role (20 min) [F6]

**Why:** Closes the W7 trap.

- [ ] **Step 12.1: Add SecretsManager grant to WriteBack**

In `template.yaml`, find the `WriteBackFunction` resource. **Replace** with:

```yaml
  WriteBackFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: casa-coqui-reply-write-back
      CodeUri: functions/write-back/
      Handler: index.handler
      Description: Final step — writes draftReply to Firestore via Firebase Admin
      Timeout: 60
      Environment:
        Variables:
          FIREBASE_SECRET_NAME: !Ref FirebaseSecretName
      Policies:
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: secretsmanager:GetSecretValue
              Resource:
                - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${FirebaseSecretName}-*
```

- [ ] **Step 12.2: Validate template**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent && sam validate
```

- [ ] **Step 12.3: Pause for Julio approval to redeploy**

> "Julio — fix is one-line IAM grant for SecretsManager:GetSecretValue. About to `sam deploy --no-execute-changeset`; I'll show the changeset before execute. OK?"

Wait for OK.

- [ ] **Step 12.4: Build + create changeset + execute (F6 split)**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam build 2>&1 | tail -5
sam deploy --stack-name casa-coqui-reply-agent --no-execute-changeset --capabilities CAPABILITY_IAM 2>&1 | tee /tmp/phase3-deploy-fixed.txt | tail -60
```

Show changeset to Julio. After approval:

```bash
CHANGESET_ARN=$(grep -oE 'arn:aws:cloudformation:[^[:space:]]+changeSet/[^[:space:]]+' /tmp/phase3-deploy-fixed.txt | head -1)
aws cloudformation execute-change-set --change-set-name "$CHANGESET_ARN" --stack-name casa-coqui-reply-agent
aws cloudformation wait stack-update-complete --stack-name casa-coqui-reply-agent
```

Expected: stack `UPDATE_COMPLETE`.

- [ ] **Step 12.5: Re-trigger synthetic execution — expect SUCCESS**

```bash
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --input file://infra/sam/reply-agent/samples/full-input.json \
  --name "phase3-w7-fixed-$(date +%s)"
sleep 60
EXEC=$(aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --max-results 1 --query 'executions[0].executionArn' --output text)
aws stepfunctions describe-execution --execution-arn "$EXEC" --query 'status' --output text
# Expected: SUCCEEDED
```

- [ ] **Step 12.6: Commit the fix**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/template.yaml
git commit -m "$(cat <<'EOF'
fix(sam/reply-agent): add SecretsManager:GetSecretValue grant to WriteBack role

W7 trap closed. Step 11's deploy let the WriteBack Lambda exist but
without secretsmanager:GetSecretValue on FirebaseSecretName-*.
First invocation crashed; SFN's SendToDLQ caught the error; SNS email
fired. CloudWatch logs showed the AccessDenied exception.

This commit adds the grant. Re-deploy succeeded; synthetic execution
now reaches SUCCEEDED.

Lessons banked (W7):
  - AWSLambdaBasicExecutionRole does NOT cover Secrets Manager reads
  - Cross-cloud secret access requires explicit IAM grants
  - Per-state Catch + DLQ + SNS made the failure visible within seconds
    of deployment, NOT silent

Branch will be squash-merged to main; main commit history shows
neither the broken IAM nor this fix as standalone — only the
combined Phase 3 work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 13 — Prompt drift CI check (30 min)

**Why:** Decision A in spec. CI script is the durable fix per AC #12 + #13.

**Files:**
- Create: [scripts/check-prompt-drift.js](../../../scripts/check-prompt-drift.js)
- Modify: [buildspec-build.yml](../../../buildspec-build.yml)
- Modify: [functions/lib/reply-ai.js](../../../functions/lib/reply-ai.js) (header comment)
- Modify: [lib/reply-ai.js](../../../lib/reply-ai.js) (header comment)
- Modify: [infra/sam/reply-agent/config/system-prompt.seed.json](../../../infra/sam/reply-agent/config/system-prompt.seed.json)

- [ ] **Step 13.1: Create the drift-check script**

Path: `scripts/check-prompt-drift.js`

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function extractInlinePrompt(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const m = src.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (!m) {
    console.error(`ERROR: SYSTEM_PROMPT template literal not found in ${filePath}`);
    process.exit(2);
  }
  return m[1];
}

function extractSeedPrompt(filePath) {
  const j = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (typeof j.system_prompt_text !== 'string') {
    console.error(`ERROR: system_prompt_text missing or not a string in ${filePath}`);
    process.exit(2);
  }
  return j.system_prompt_text;
}

const root = path.resolve(__dirname, '..');
const sources = [
  { name: 'seed.json',          text: extractSeedPrompt(path.join(root, 'infra/sam/reply-agent/config/system-prompt.seed.json')) },
  { name: 'lib/reply-ai.js',    text: extractInlinePrompt(path.join(root, 'lib/reply-ai.js')) },
  { name: 'functions/lib/reply-ai.js', text: extractInlinePrompt(path.join(root, 'functions/lib/reply-ai.js')) },
];

const hashes = sources.map((s) => ({ name: s.name, sha: sha(s.text), len: s.text.length }));
console.log('SYSTEM_PROMPT hashes:');
for (const h of hashes) console.log(`  ${h.sha.slice(0, 12)}  len=${h.len}  ${h.name}`);

const distinct = new Set(hashes.map((h) => h.sha));
if (distinct.size === 1) {
  console.log('OK — all three sources match.');
  process.exit(0);
}
console.error('FAIL — system_prompt_text differs across sources. Re-sync before merging.');
process.exit(1);
```

```bash
chmod +x /Users/jperez/dev/casa-coqui/scripts/check-prompt-drift.js
node /Users/jperez/dev/casa-coqui/scripts/check-prompt-drift.js
```
Expected: `OK — all three sources match.`

- [ ] **Step 13.2: Wire into CodeBuild buildspec**

Open `buildspec-build.yml`. Add to `pre_build` or `build`:

```yaml
  build:
    commands:
      - echo "=== prompt-drift check ==="
      - node scripts/check-prompt-drift.js
      # ... existing build commands continue
```

(Insert before `next build`.)

- [ ] **Step 13.3: Update header comments to point at CI as canonical (AC #13)**

`functions/lib/reply-ai.js` header:

```js
// CROSS-SYNC: system_prompt_text is duplicated across THREE files until
// Phase 4.5 deletes the JS chain:
//   1. infra/sam/reply-agent/config/system-prompt.seed.json
//   2. lib/reply-ai.js (Next.js admin)
//   3. functions/lib/reply-ai.js (Cloud Functions)
//
// CI enforcement: scripts/check-prompt-drift.js (run by buildspec-build.yml).
// The script hashes all three sources and fails the build on mismatch.
// Comment-based warnings alone failed once (Issue #1, c49adf3) — the CI
// check is the durable fix.
```

Mirror at the top of `lib/reply-ai.js`.

For `system-prompt.seed.json`, add a `_comment` field:

```json
{
  "_comment": "Drift enforcement: scripts/check-prompt-drift.js (CI). See lib/reply-ai.js header for context.",
  "version": "1.0.0",
  ...
}
```

- [ ] **Step 13.4: Run drift check + functions tests**

```bash
cd /Users/jperez/dev/casa-coqui
node scripts/check-prompt-drift.js
cd functions && npx jest 2>&1 | tail -10
```

- [ ] **Step 13.5: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add scripts/check-prompt-drift.js buildspec-build.yml functions/lib/reply-ai.js lib/reply-ai.js infra/sam/reply-agent/config/system-prompt.seed.json
git commit -m "$(cat <<'EOF'
feat(phase-3): CI prompt-drift check across 3 sources of truth

Hashes system_prompt_text from seed.json + lib/reply-ai.js +
functions/lib/reply-ai.js, fails the build if any pair differs.

Wired into buildspec-build.yml at the top of the build phase. Headers
in all 3 source files now point at this script as the canonical
enforcement (AC #13) — replaces comment-based warnings that already
failed once (Issue #1).

Phase 4.5 deletes 2 of the 3 sources; the drift check disappears
with them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Step 14 — feature-flags validator regex (mode constraint) (10 min)

**Why:** Decision 11 v3.

**Files:**
- Modify: [infra/sam/reply-agent/template.yaml](../../../infra/sam/reply-agent/template.yaml)

- [ ] **Step 14.1: Add Validators block to FeatureFlagsProfile**

In template.yaml:

```yaml
  FeatureFlagsProfile:
    Type: AWS::AppConfig::ConfigurationProfile
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      Name: feature-flags
      Description: Feature flags for the reply agent.
      Type: AWS.AppConfig.FeatureFlags
      LocationUri: hosted
      Validators:
        - Type: JSON_SCHEMA
          Content: |
            {
              "$schema": "http://json-schema.org/draft-04/schema#",
              "type": "object",
              "properties": {
                "values": {
                  "type": "object",
                  "properties": {
                    "reply_engine": {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "pattern": "^(firebase|aws-sfn)$"
                        },
                        "rollout_pct": {
                          "type": "number",
                          "minimum": 0,
                          "maximum": 100
                        }
                      }
                    }
                  }
                }
              }
            }
```

- [ ] **Step 14.2: Confirm seed file currently has `mode: firebase, rollout_pct: 0`**

```bash
cat /Users/jperez/dev/casa-coqui/infra/sam/reply-agent/config/feature-flags.seed.json
```

- [ ] **Step 14.3: Validate template**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent && sam validate
```

- [ ] **Step 14.4: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/template.yaml
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): tighten feature-flags validator — reject mode: shadow in prod

Decision 11 v3 defense-in-depth. AppConfig validator on FeatureFlagsProfile
now constrains reply_engine.mode to ^(firebase|aws-sfn)$.

If an admin attempts mode: shadow via CreateHostedConfigurationVersion,
the API rejects at validator-time. decideRoute still has a defensive
shadow-stub branch — belt and suspenders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Step 15 — Final SAM deploy + IAM key capture + 1Password + quarterly calendar (40 min) [F4, F6]

**Why:** Decision 15 — SAM deploys MUST land before CodePipeline auto-ships the Cloud Function code. **F4:** also captures the access keys into 1Password and books the quarterly rotation calendar entry. **F6:** uses the `--no-execute-changeset` + explicit execute pattern.

**Files:** none modified — operational step.

- [ ] **Step 15.1: Pause for Julio approval**

> "Julio — final SAM deploy of Phase 3. Resources changed since the W7 trap deploy: feature-flags validator constraint. WriteBack is already real on AWS. Synthetic SUCCEEDED execution earlier proves it works. Will use --no-execute-changeset and pause for your changeset review. OK?"

Wait for OK.

- [ ] **Step 15.2: Build + create changeset + execute (F6) [Julio reviews changeset]**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam build && sam deploy --stack-name casa-coqui-reply-agent --no-execute-changeset --capabilities CAPABILITY_IAM 2>&1 | tee /tmp/phase3-deploy-final.txt | tail -50
# Show changeset to Julio.
```

After Julio's OK:

```bash
CHANGESET_ARN=$(grep -oE 'arn:aws:cloudformation:[^[:space:]]+changeSet/[^[:space:]]+' /tmp/phase3-deploy-final.txt | head -1)
aws cloudformation execute-change-set --change-set-name "$CHANGESET_ARN" --stack-name casa-coqui-reply-agent
aws cloudformation wait stack-update-complete --stack-name casa-coqui-reply-agent
```

Expected: `UPDATE_COMPLETE`.

- [ ] **Step 15.3: Capture the BridgeIamUser access key**

```bash
aws iam create-access-key --user-name casa-coqui-firebase-bridge \
  --query 'AccessKey.{Id:AccessKeyId,Secret:SecretAccessKey}' --output table
```
**Copy the AccessKeyId + SecretAccessKey to a secure note. DO NOT commit them.**

- [ ] **Step 15.3.1: Transcribe the rotation runbook (F4)**

Quarterly cadence, or immediately on suspected compromise. The runbook MUST be transcribed verbatim into the change log AND linked from the Phase 3 closure doc:

```markdown
## IAM Key Rotation Runbook — casa-coqui-firebase-bridge

Cadence: quarterly (Mar/Jun/Sep/Dec, first Tuesday). Calendar entry
required. Trigger immediately on suspected compromise.

Steps (zero-downtime — Firebase Functions secrets bake at deploy
time; no native two-key-overlap):

1. Create a SECOND access key for casa-coqui-firebase-bridge:
   aws iam create-access-key --user-name casa-coqui-firebase-bridge

2. Update Firebase Functions secrets (BOTH must update in one window):
   echo -n "<new_id>" | firebase functions:secrets:set AWS_ACCESS_KEY_ID --data-file -
   echo -n "<new_secret>" | firebase functions:secrets:set AWS_SECRET_ACCESS_KEY --data-file -

3. Update Vercel env (regenerate API runtime — F2 + F4 mandate
   BOTH Firebase AND Vercel update in the same window):
   vercel env rm AWS_ACCESS_KEY_ID production
   vercel env rm AWS_ACCESS_KEY_ID preview
   vercel env rm AWS_ACCESS_KEY_ID development
   vercel env add AWS_ACCESS_KEY_ID production    # paste new id
   vercel env add AWS_ACCESS_KEY_ID preview
   vercel env add AWS_ACCESS_KEY_ID development
   # Same for AWS_SECRET_ACCESS_KEY.

4. Redeploy:
   firebase deploy --only functions:onAirbnbMessageCreated
   vercel --prod   # or trigger Vercel deploy via dashboard

5. Verify: trigger a synthetic SFN execution (Cloud Function path)
   AND a regenerate API call (Vercel path). Both must succeed.

6. Disable (DO NOT delete yet) the OLD access key:
   aws iam update-access-key --user-name casa-coqui-firebase-bridge \
     --access-key-id <OLD_ID> --status Inactive

7. Wait 24h for any cached credentials in long-lived Cloud Function
   instances OR Vercel serverless containers to fail loud, then
   delete the old access key:
   aws iam delete-access-key --user-name casa-coqui-firebase-bridge \
     --access-key-id <OLD_ID>

KEY STORAGE (F4): Both AccessKeyId and SecretAccessKey saved in
1Password personal vault item titled "casa-coqui-firebase-bridge IAM"
(NOT in any shared vault, NOT in any repo, NOT in any agent memory).
The 1Password item has fields:
  - access_key_id
  - secret_access_key
  - created_at  (ISO 8601)
  - rotation_due_at  (created_at + 90 days)
  - linked_user_arn  (arn:aws:iam::524140443248:user/casa-coqui-firebase-bridge)
```

- [ ] **Step 15.3.2: Add quarterly rotation calendar entry (F4)**

Add a recurring calendar event titled `Rotate casa-coqui-firebase-bridge IAM key` for the first Tuesday of Mar/Jun/Sep/Dec, 9am Atlantic. Body should reference the runbook above.

```bash
# Manual step for Julio: add to Google Calendar (or equivalent).
# Title: Rotate casa-coqui-firebase-bridge IAM key
# Recurrence: First Tue of Mar/Jun/Sep/Dec, 09:00 Atlantic
# Notes: See tasks/changes/phase-3/2026-05-08-phase-3-sfn-bridge-changes.md "IAM Key Rotation Runbook"
#        Update BOTH Firebase secrets AND Vercel env in same window.
#        24h soak before old key deletion.
```

- [ ] **Step 15.4: Confirm IAM permissions via simulator (AC #3)**

```bash
USER_ARN="arn:aws:iam::524140443248:user/casa-coqui-firebase-bridge"
SM_ARN="arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft"

# Should ALLOW StartExecution on this SM
aws iam simulate-principal-policy \
  --policy-source-arn "$USER_ARN" \
  --action-names states:StartExecution \
  --resource-arns "$SM_ARN" \
  --query 'EvaluationResults[0].EvalDecision' --output text
# Expected: allowed

# Should DENY DescribeExecution
aws iam simulate-principal-policy \
  --policy-source-arn "$USER_ARN" \
  --action-names states:DescribeExecution \
  --resource-arns "$SM_ARN" \
  --query 'EvaluationResults[0].EvalDecision' --output text
# Expected: implicitDeny
```

- [ ] **Step 15.5: Confirm AC #14 — validator rejects `mode: shadow`**

```bash
APP_ID=$(aws appconfig list-applications --query "Items[?Name=='casa-coqui-reply-agent'].Id" --output text)
PROFILE_ID=$(aws appconfig list-configuration-profiles --application-id "$APP_ID" --query "Items[?Name=='feature-flags'].Id" --output text)

cat > /tmp/bad-flags.json <<'EOF'
{
  "version": "1",
  "flags": { "reply_engine": { "name": "reply_engine", "attributes": {} } },
  "values": { "reply_engine": { "enabled": true, "mode": "shadow", "rollout_pct": 0 } }
}
EOF

aws appconfig create-hosted-configuration-version \
  --application-id "$APP_ID" \
  --configuration-profile-id "$PROFILE_ID" \
  --content fileb:///tmp/bad-flags.json \
  --content-type 'application/json' \
  /tmp/hcv-out.json 2>&1 | tee /tmp/shadow-attempt.txt
```

Save output to `tasks/changes/phase-3/smoke-logs/synth-routing-j-shadow-validator.txt`.

- [ ] **Step 15.6: No commit needed — operational. Doc agent records the access-key-id (NOT the secret) and validator output, transcribes runbook into change log.**

---

## Step 16 — Set Firebase secrets + mirror to Vercel env + push CF (40 min) [F2]

**Why:** CF code is in the branch but not deployed.

**Files:** none modified — operational step.

- [ ] **Step 16.1: Set Firebase secrets [F2]**

```bash
cd /Users/jperez/dev/casa-coqui
echo -n "<access_key_id_from_step_15_3>" | firebase functions:secrets:set AWS_ACCESS_KEY_ID --data-file -
echo -n "<secret_access_key_from_step_15_3>" | firebase functions:secrets:set AWS_SECRET_ACCESS_KEY --data-file -
```

- [ ] **Step 16.2: Confirm v2 secrets/params already declared in `functions/index.js` [F2]**

The trigger declaration (set in Step 7.2) must already include:

```js
const { defineSecret, defineString } = require('firebase-functions/params');

const AWS_ACCESS_KEY_ID = defineSecret('AWS_ACCESS_KEY_ID');
const AWS_SECRET_ACCESS_KEY = defineSecret('AWS_SECRET_ACCESS_KEY');
const REPLY_DRAFT_STATE_MACHINE_ARN = defineString('REPLY_DRAFT_STATE_MACHINE_ARN', { default: '...' });
const APPCONFIG_APPLICATION = defineString('APPCONFIG_APPLICATION', { default: 'casa-coqui-reply-agent' });
const APPCONFIG_ENVIRONMENT = defineString('APPCONFIG_ENVIRONMENT', { default: 'prod' });
const APPCONFIG_FLAGS_PROFILE = defineString('APPCONFIG_FLAGS_PROFILE', { default: 'feature-flags' });
```

And:

```js
exports.onAirbnbMessageCreated = onDocumentCreated(
  {
    document: 'airbnb_messages/{messageId}',
    region: 'us-east1',
    secrets: [ANTHROPIC_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY],
  },
  async (event) => { ... }
);
```

**v2 secrets are exposed at `process.env.<NAME>` automatically** — `appconfig-client.js`, `bridge-metrics.js`, `aws-sfn-bridge.js` read `process.env.AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `REPLY_DRAFT_STATE_MACHINE_ARN` / `APPCONFIG_*` directly. **DO NOT use `firebase functions:config:set`** (v2 ignores it).

- [ ] **Step 16.2.1: Mirror AWS keys + state machine ARN to Vercel env [F2]**

The regenerate API route at `app/api/airbnb-messages/[id]/regenerate/route.js` runs on **Vercel**, not Cloud Functions. Cloud Functions secrets DO NOT cross to Vercel. The regenerate API needs its own copy of the credentials and the state machine ARN.

```bash
cd /Users/jperez/dev/casa-coqui

# AWS_ACCESS_KEY_ID
vercel env add AWS_ACCESS_KEY_ID production
# Paste the same access_key_id from Step 15.3 when prompted
vercel env add AWS_ACCESS_KEY_ID preview
vercel env add AWS_ACCESS_KEY_ID development

# AWS_SECRET_ACCESS_KEY
vercel env add AWS_SECRET_ACCESS_KEY production
vercel env add AWS_SECRET_ACCESS_KEY preview
vercel env add AWS_SECRET_ACCESS_KEY development

# REPLY_DRAFT_STATE_MACHINE_ARN (used by route.js)
vercel env add REPLY_DRAFT_STATE_MACHINE_ARN production
# Value: arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft
vercel env add REPLY_DRAFT_STATE_MACHINE_ARN preview
vercel env add REPLY_DRAFT_STATE_MACHINE_ARN development
```

Verify all six env entries exist:

```bash
vercel env ls | grep -E 'AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|REPLY_DRAFT_STATE_MACHINE_ARN'
# Expected: 9 lines (3 vars × 3 envs)
```

**Important:** any subsequent IAM key rotation MUST update BOTH Firebase secrets AND Vercel env in the same window (see Step 15.3.1 runbook).

- [ ] **Step 16.3: Pause for Julio approval to push to main**

> "Julio — about to squash-merge `feat/phase-3-sfn-bridge` → `main` and push. CodePipeline will build + deploy CF. Manual approval gate will fire — you'll get an SNS email. SAM is already at the final state (Step 15). Vercel env mirrored. OK to merge?"

Wait for OK.

- [ ] **Step 16.4: Squash-merge to main**

```bash
cd /Users/jperez/dev/casa-coqui
git checkout main
git merge --squash feat/phase-3-sfn-bridge
git status
git commit -m "$(cat <<'EOF'
feat(phase-3): SFN bridge + DLQ + alarms + auto-rollback (v3.1)

Wires onAirbnbMessageCreated to the casa-coqui-reply-agent SAM stack
via a fail-closed AppConfig-driven bridge. Ships at rollout_pct: 0
(zero organic traffic; regenerate API exercises SFN).

Highlights:
  - functions/lib/decide-route.js — pure routing function (7 unit tests)
  - functions/lib/appconfig-client.js — fail-closed AppConfig Data API
    (returns mode + rollout_pct + version)
  - functions/lib/bridge-metrics.js — EMF emitter (PutMetricData)
  - functions/lib/aws-sfn-bridge.js — StartExecution wrapper
  - functions/index.js — bridge dispatch BETWEEN context build and
    LLM call (Decision 19 v3.1); v2 defineSecret + defineString
    (NOT functions.config())
  - app/api/airbnb-messages/[id]/regenerate/route.js — auth-gated
    POST with 3-per-message + 30s cooldown rate limit; inline SFN
    client (Vercel runtime — separate from Cloud Functions bridge)
  - app/admin/messages/page.js — Regenerate wired to API; Retry button
    on failed rows; Regenerate disabled when editedReply is set
  - .eslintrc.json — no-restricted-imports rule blocks app/ imports
    of functions/lib/aws-sfn-bridge + bridge-metrics (Decision 18 v3.1)
  - infra/sam/reply-agent/template.yaml — DLQ + SNS + 4 alarms +
    AppConfigMonitorRole + Monitors on Environment + BridgeIamUser;
    appconfig:* → appconfigdata:* fix on Drafter+Reviser
  - infra/sam/reply-agent/statemachines/reply-draft.asl.json — per-state
    Catch redirects to new SendToDLQ Task; WriteBack Payload now
    includes executionArn + executionStartTime (F13)
  - infra/sam/reply-agent/functions/write-back/ — stub → real
    (firebase-admin + Secrets Manager + editedReply skip +
    WriteBack-side per-stage token summation per Decision 17 v3.1 +
    latencyMs proxy from executionStartTime)
  - infra/sam/reply-agent/functions/dlq-notifier/ — SQS → SNS formatter
  - scripts/check-prompt-drift.js + buildspec-build.yml — CI drift check

Decisions baked in (per spec v3.1):
  Decision 7 (editedReply skip), 12 (routedBy enum), 13 (fail-closed),
  14 (Monitor watches infra not quality), 15 (SAM-first ordering),
  16 (regenerate rate limits), 17 v3.1 (WriteBack-side token sum +
  executionStartTime latency proxy), 18 v3.1 (ESLint guard),
  19 v3.1 (bridge BETWEEN context build and LLM).

Phase 3 → Phase 4: rollout_pct ramps 0 → 5 → 25 → 50 → 100 over a week
(separate plan).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 16.5: Push to main**

```bash
git push origin main
```

- [ ] **Step 16.6: CodePipeline approval gate**

Julio receives SNS email → approves in CodePipeline UI. Build runs (drift check fires; should pass; lint runs F14 rule passes). Deploy stage ships Cloud Functions.

```bash
firebase functions:log --lines 10 --only onAirbnbMessageCreated 2>&1 | head -20
```
Expected: new revision booted, no errors at module load.

**Note (F8):** Feature branch deletion has been moved to **Step 17.7** (after smoke completes). The branch must remain available during smoke so that any forensic check or revert remains trivial.

---


## Step 17 — Smoke testing (a–k per spec AC #17 + F9/F15) (120 min) [F5, F7, F9, F10, F15]

**Why:** Spec AC #17 enumerates 10 synthetic scenarios. **v3.1 adds scenario (k)** — automated voice-parity regex booleans (F9/F15). Each scenario follows the established pattern: synthetic input → injection → verify booleans → cleanup.

**Files:**
- Create: `tasks/changes/phase-3/smoke-logs/verify-bridge.js`
- Create: `tasks/changes/phase-3/smoke-logs/cleanup-bridge.js`
- Create: per-scenario JSON output files

- [ ] **Step 17.1: Create the verify script (with F5 + F9/F15 voice-parity checks)**

Path: `tasks/changes/phase-3/smoke-logs/verify-bridge.js`

```js
'use strict';

// Reads the synthetic doc and asserts the expected fields. Prints booleans
// in the same shape as Item 3's api-smoke.js. Pass scenario letter as argv[2].

const path = require('path');
const admin = require('firebase-admin');
const SVC = require(path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json'));
admin.initializeApp({ credential: admin.credential.cert(SVC) });
const db = admin.firestore();

const scenario = process.argv[2];
const docId = process.argv[3];
const docId2 = process.argv[4]; // for scenario k (two docs)
if (!scenario || !docId) { console.error('usage: verify-bridge.js <scenario> <docId> [<docId2>]'); process.exit(2); }

// F9/F15 — automated voice-parity regex booleans
const HARD_BANS = [
  'hope this message finds you',
  'more than happy',
  "don't hesitate",
  'Kindly',
  'Absolutely!',
  'Certainly!',
];
const OPENER_RE = /^(Hi|Hey|Hola) [A-Z]\w+,/;

function voiceChecks(prefix, draft) {
  const txt = draft || '';
  return {
    [`${prefix}_draft_present`]: !!txt,
    [`${prefix}_no_emdash`]: !txt.includes('—'),
    [`${prefix}_opener_ok`]: OPENER_RE.test(txt),
    [`${prefix}_no_hardbans`]: !HARD_BANS.some(p => txt.toLowerCase().includes(p.toLowerCase())),
    [`${prefix}_length_reasonable`]: txt.length >= 20 && txt.length <= 800,
  };
}

(async () => {
  const snap = await db.collection('airbnb_messages').doc(docId).get();
  if (!snap.exists) { console.error('doc not found:', docId); process.exit(2); }
  const d = snap.data();
  const ar = d._agentRun || {};

  let snap2 = null, d2 = null, ar2 = null;
  if (docId2) {
    snap2 = await db.collection('airbnb_messages').doc(docId2).get();
    if (!snap2.exists) { console.error('doc2 not found:', docId2); process.exit(2); }
    d2 = snap2.data();
    ar2 = d2._agentRun || {};
  }

  const checks = {
    a_rollout_gated: () => ({
      routedBy_eq_rollout_gated: ar.routedBy === 'rollout-gated',
      draftReply_present: !!d.draftReply,
    }),
    // F5 — assert draftReply present + length > 20 (NOT > 5; JS chain median ~130 chars)
    b_rollout_routed: () => ({
      routedBy_eq_rollout_routed: ar.routedBy === 'rollout-routed',
      appConfigVersion_present: !!ar.appConfigVersion && ar.appConfigVersion !== 'unknown',
      // F1 — assert BOTH inputTokens and outputTokens > 0 (one-sided hides selector mistakes)
      inputTokens_gt_0: Number.isFinite(ar.inputTokens) && ar.inputTokens > 0,
      outputTokens_gt_0: Number.isFinite(ar.outputTokens) && ar.outputTokens > 0,
      latency_persisted: Number.isFinite(ar.latencyMs) && ar.latencyMs > 0,
      executionArn_present: !!ar.executionArn,
      // F5
      draftReply_present: !!d.draftReply,
      draftReply_length_gt_20: (d.draftReply || '').length > 20,
    }),
    c_firebase_explicit: () => ({ routedBy_eq_firebase_explicit: ar.routedBy === 'firebase-explicit' }),
    d_legacy_fallback: () => ({ routedBy_eq_legacy_fallback: ar.routedBy === 'legacy-fallback' }),
    e_regenerate: () => ({ routedBy_eq_regenerate: ar.routedBy === 'regenerate' }),
    g_edited_reply_skip: () => ({
      editedReply_unchanged: d.editedReply === 'HOST EDIT — DO NOT CLOBBER',
      no_new_draftReply_overwrite: !d._agentRun?.executionArn || d.draftReply !== d.editedReply,
    }),
    // F9/F15 — voice parity: same input through both engines, automated regex booleans
    k_voice_parity: () => {
      if (!d2) throw new Error('scenario k requires two docIds: js-chain and sfn');
      const jsChecks = voiceChecks('jsChain', d.draftReply);
      const sfnChecks = voiceChecks('sfn', d2.draftReply);
      return {
        ...jsChecks,
        ...sfnChecks,
        both_tokens_emitted:
          (ar.inputTokens || 0) > 0 && (ar2.inputTokens || 0) > 0,
        jsChain_routedBy_eq_firebase_explicit: ar.routedBy === 'firebase-explicit',
        sfn_routedBy_eq_rollout_routed: ar2.routedBy === 'rollout-routed',
      };
    },
  };

  const fn = checks[scenario];
  if (!fn) { console.error('unknown scenario:', scenario); process.exit(2); }
  const result = fn();
  const allPass = Object.values(result).every(Boolean);
  console.log(JSON.stringify({ scenario, docId, docId2, result, allPass }, null, 2));
  process.exit(allPass ? 0 : 1);
})();
```

- [ ] **Step 17.2: Create the cleanup script**

Path: `tasks/changes/phase-3/smoke-logs/cleanup-bridge.js`

```js
'use strict';

const path = require('path');
const admin = require('firebase-admin');
const SVC = require(path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json'));
admin.initializeApp({ credential: admin.credential.cert(SVC) });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('airbnb_messages').where('source', '==', 'phase3-smoke').get();
  let n = 0;
  for (const doc of snap.docs) { await doc.ref.delete(); n++; }
  console.log(`deleted ${n} synthetic airbnb_messages docs`);
})();
```

- [ ] **Step 17.3: Run scenarios a–k**

Each scenario follows the same shape: create synthetic doc → wait for trigger → verify → save output JSON.

**(a) `rollout_pct: 0, mode: aws-sfn` → `rollout-gated`**

Flip AppConfig to `mode: aws-sfn, rollout_pct: 0`. Wait 60s. Create synthetic doc with `source: 'phase3-smoke'`. Wait 90s. Run `verify-bridge.js a_rollout_gated <docId> > tasks/changes/phase-3/smoke-logs/synth-routing-a-rollout-gated.json`. Expected: `allPass: true`.

**(b) `rollout_pct: 100, mode: aws-sfn` → `rollout-routed` [F1, F5]**

Flip to `mode: aws-sfn, rollout_pct: 100`. Wait 60s. Create synthetic. Wait 90s. Verify. Asserts:
- `routedBy === 'rollout-routed'`
- `appConfigVersion` present and not `'unknown'`
- `inputTokens > 0` AND `outputTokens > 0` (F1 — both, NOT either)
- `latencyMs > 0`
- `executionArn` present
- `draftReply` present AND length > 20 (F5)

**(c) `mode: firebase` → `firebase-explicit`**

Flip back to `mode: firebase`. Verify `c_firebase_explicit`.

**(d) AppConfig fail → `legacy-fallback`**

Inject by temporarily denying `appconfigdata:*` on the BridgeIamUser:

```bash
aws iam put-user-policy --user-name casa-coqui-firebase-bridge --policy-name TempDenyAppConfig \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"appconfigdata:*","Resource":"*"}]}'
```

Wait 60s. Create synthetic. Verify. Cleanup:
```bash
aws iam delete-user-policy --user-name casa-coqui-firebase-bridge --policy-name TempDenyAppConfig
```

Confirm `BridgeRouteFailures` metric:
```bash
aws cloudwatch get-metric-statistics --namespace CasaCoqui/Bridge --metric-name BridgeRouteFailures \
  --start-time $(date -u -v-10M +%FT%TZ) --end-time $(date -u +%FT%TZ) --period 60 --statistics Sum
```

**(e) Regenerate API → `regenerate`**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" https://www.casa-coqui.cc/api/airbnb-messages/<docId>/regenerate
```

Wait 60s. Verify `e_regenerate`.

**(f) SFN failure → DLQ + SNS [F7]**

**F7 — IAM deny target:** `lambda:InvokeFunction` on the Reasoner from the State Machine role (NOT SQS — that would defeat the DLQ assertion).

```bash
SM_ROLE_NAME=$(aws stepfunctions describe-state-machine \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --query 'roleArn' --output text | awk -F/ '{print $NF}')

aws iam put-role-policy \
  --role-name "$SM_ROLE_NAME" \
  --policy-name TempDenyReasonerInvokeForSmoke \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:us-east-1:524140443248:function:casa-coqui-reply-reasoner"}]}'
```

Flip AppConfig `mode: aws-sfn, rollout_pct: 100`, wait 60s, create synthetic doc → CF dispatches to SFN → AIChainExecution / Reasoner step fails → SFN's per-state Catch routes to SendToDLQ → DLQ message → DLQNotifier publishes to SNS.

Verify DLQ:
```bash
aws sqs receive-message --queue-url $(aws sqs get-queue-url --queue-name casa-coqui-reply-draft-dlq --query 'QueueUrl' --output text) \
  --max-number-of-messages 1 --visibility-timeout 0 \
  | jq '.Messages[0].Body | fromjson'
```

Confirm SNS email arrives at `01juliop@gmail.com`.

**Cleanup:**
```bash
aws iam delete-role-policy --role-name "$SM_ROLE_NAME" --policy-name TempDenyReasonerInvokeForSmoke
```

**(g) `editedReply` set → WriteBack skips**

Create synthetic with `editedReply: 'HOST EDIT — DO NOT CLOBBER'` and existing `draftReply: 'OLD DRAFT'`. Trigger SFN execution directly (bypasses bridge). Wait for SUCCEEDED. Verify `g_edited_reply_skip`. Inspect WriteBack logs for `writeback_skipped_host_edit`.

**(h) Admin UI: Regenerate disabled when `editedReply` set**

Manual UI verification. Save screenshot to `tasks/changes/phase-3/smoke-logs/synth-routing-h-regenerate-disabled-ui.png`.

**(i) Rate limit interleaved sequence [F10]**

F10 — interleaved sequence proves BOTH gates without flakiness:

```bash
TOKEN=...  # admin id token
URL="https://www.casa-coqui.cc/api/airbnb-messages/<docId>/regenerate"

# regen #1 → 200 (count = 1)
echo "regen #1:"; curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" "$URL"

# immediate regen #2 → 429 (cooldown)
echo "regen #2 (immediate, expect 429 cooldown):"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" "$URL"

# wait 31s, regen #3 → 200 (count = 2)
sleep 31
echo "regen #3 (after 31s, expect 200, count=2):"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" "$URL"

# wait 31s, regen #4 → 200 (count = 3)
sleep 31
echo "regen #4 (after 31s, expect 200, count=3):"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" "$URL"

# wait 31s, regen #5 → 429 (cap)
sleep 31
echo "regen #5 (after 31s, expect 429 cap):"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" "$URL"
```

Expected sequence: `200, 429, 200, 200, 429`. Save to `synth-routing-i-rate-limit.json` with shape:

```json
{
  "scenario": "i_rate_limit",
  "sequence": [
    { "n": 1, "expected": 200, "got": 200, "reason": "first call, count=1" },
    { "n": 2, "expected": 429, "got": 429, "reason": "rate_limit_cooldown (immediate)" },
    { "n": 3, "expected": 200, "got": 200, "reason": "after 31s, count=2" },
    { "n": 4, "expected": 200, "got": 200, "reason": "after 31s, count=3" },
    { "n": 5, "expected": 429, "got": 429, "reason": "rate_limit_count (cap=3)" }
  ],
  "allPass": true
}
```

**(j) Schema validator rejects `mode: shadow`**

Already executed in Step 15.5. Confirm output saved at `synth-routing-j-shadow-validator.txt`.

**(k) Voice-parity automated regex booleans [F9, F15]**

F9/F15 — Send the SAME realistic input ("Hi, what time is checkout?") through both engines:
1. Force `mode: firebase` → AppConfig flip, wait 60s, create synth doc #1, wait 90s.
2. Force `mode: aws-sfn, rollout_pct: 100` → AppConfig flip, wait 60s, create synth doc #2 (same body), wait 90s.
3. Persist both drafts, run verify with both docIds:

```bash
node tasks/changes/phase-3/smoke-logs/verify-bridge.js k_voice_parity <jsChainDocId> <sfnDocId> \
  > tasks/changes/phase-3/smoke-logs/synth-routing-k-voice-parity.json
```

Expected: `allPass: true`. Asserts on both drafts:
- `_draft_present` — non-empty
- `_no_emdash` — no em dashes (—) in output
- `_opener_ok` — opener matches `/^(Hi|Hey|Hola) [A-Z]\w+,/`
- `_no_hardbans` — none of the hard-banned phrases appear (case-insensitive)
- `_length_reasonable` — 20 ≤ length ≤ 800

Plus:
- `both_tokens_emitted` — both engines emitted token telemetry
- `jsChain_routedBy_eq_firebase_explicit`
- `sfn_routedBy_eq_rollout_routed`

**Manual voice-parity review** is reserved for Phase 4 ramp gates, NOT smoke. Smoke uses booleans only — sample size is too small for human review to add signal.

- [ ] **Step 17.4: Cleanup**

```bash
node tasks/changes/phase-3/smoke-logs/cleanup-bridge.js
# Reset AppConfig to mode: firebase, rollout_pct: 0 (Phase 4 starts the ramp)
APP_ID=$(aws appconfig list-applications --query "Items[?Name=='casa-coqui-reply-agent'].Id" --output text)
ENV_ID=$(aws appconfig list-environments --application-id "$APP_ID" --query "Items[?Name=='prod'].Id" --output text)
PROFILE_ID=$(aws appconfig list-configuration-profiles --application-id "$APP_ID" --query "Items[?Name=='feature-flags'].Id" --output text)
# Use existing seed file content; deploy via aws appconfig start-deployment
```

- [ ] **Step 17.5: Confirm AC #15 (`BridgeFailureAlarm`) — induce 6 AppConfig errors over 4 min**

```bash
aws iam put-user-policy --user-name casa-coqui-firebase-bridge --policy-name TempDenyAppConfig \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"appconfigdata:*","Resource":"*"}]}'
# Send 6 synthetic docs spaced ~40s apart
sleep 240
aws cloudwatch describe-alarms --alarm-names casa-coqui-bridge-route-failures \
  --query 'MetricAlarms[0].StateValue' --output text
# Expected: ALARM
aws iam delete-user-policy --user-name casa-coqui-firebase-bridge --policy-name TempDenyAppConfig
```

- [ ] **Step 17.6: Commit smoke artifacts**

```bash
cd /Users/jperez/dev/casa-coqui
git add tasks/changes/phase-3/smoke-logs/
git commit -m "$(cat <<'EOF'
docs(phase-3): smoke verification artifacts (a-k per spec AC #17 + F9/F15)

11 synthetic scenarios verified end-to-end:
  a. rollout-gated  — mode:aws-sfn, pct:0          → JS chain runs
  b. rollout-routed — mode:aws-sfn, pct:100        → SFN runs; F1
     (inputTokens>0 AND outputTokens>0); F5 (draftReply length>20)
  c. firebase-explicit                             → JS chain runs
  d. AppConfig denied → legacy-fallback + BridgeRouteFailures incremented
  e. regenerate API → SFN, _routedBy: regenerate
  f. SFN failure (F7: lambda:InvokeFunction deny on Reasoner) →
     DLQ message with correct paths + SNS email
  g. editedReply set → WriteBack returns { skipped: 'host_edit' }
  h. Admin UI: Regenerate disabled when editedReply set (screenshot)
  i. F10 rate limit interleaved sequence: 200, 429, 200, 200, 429
     (proves cooldown + cap)
  j. mode: shadow HCV creation → validator rejects
  k. F9/F15 voice parity: same input through both engines; automated
     regex booleans — opener pattern, no em dash, no hard-bans, length
     reasonable, both engines emit tokens

BridgeFailureAlarm verified ALARM after 6 induced failures over 4 min.

All synthetic data cleaned up; AppConfig restored to mode: firebase,
rollout_pct: 0 ahead of Phase 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

(`git push` requires Julio approval per the safety protocol.)

- [ ] **Step 17.7: Delete the feature branch [F8 — moved here from old Step 16.7]**

Smoke is complete. The branch can now be removed.

```bash
cd /Users/jperez/dev/casa-coqui
git branch -d feat/phase-3-sfn-bridge
git push origin --delete feat/phase-3-sfn-bridge 2>&1 || echo "branch wasn't pushed remotely — local-only, OK"
```

---

## Step 18 — Update handoff + change log closure (15 min)

**Files:**
- Modify: `explantion/2026-05-08-phase-3-handoff.md` (or create new `2026-05-09-post-phase-3-handoff.md`)
- Modify: `tasks/changes/phase-3/2026-05-08-phase-3-sfn-bridge-changes.md`

- [ ] **Step 18.1: Doc agent finalizes the change log**

All checkboxes from Step 1.4 should be `[x]`. Add closing summary:

```markdown
## Closure (2026-05-XX)

Phase 3 v3.1 production-verified. All 11 synthetic scenarios passed
(AC #17 a-k, including F9/F15 voice parity). Production state:
mode: firebase, rollout_pct: 0 (zero organic traffic on SFN).
SFN exercised by regenerate API only. SAM stack at UPDATE_COMPLETE.
Cloud Function on revision <revision-id>. Vercel env mirrored
(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, REPLY_DRAFT_STATE_MACHINE_ARN).

W7 trap fired and resolved on feature branch — squash-merged to main
as one commit. IAM key stored in 1Password "casa-coqui-firebase-bridge
IAM" item; quarterly rotation calendar entry in place.

Phase 4 (rollout ramp 0 → 100) is the next plan.
```

- [ ] **Step 18.2: Mark Phase 3 done in the rolling handoff**

Edit `explantion/2026-05-08-phase-3-handoff.md` §5 to a closing note:

```markdown
## 5. ~~What's next — Phase 3~~ DONE 2026-05-XX

Phase 3 v3.1 shipped. SFN bridge live at rollout_pct: 0. DLQ + SNS +
alarms + auto-rollback in place. Regenerate API live (Vercel runtime;
inline SFN client; ESLint guard against client-side bridge import).
WriteBack persists to Firestore with WriteBack-side per-stage token
sum + executionStartTime-derived latencyMs proxy + appConfigVersion
(drafter→reviser precedence). CI drift check enforces 3-source
prompt sync.

W7 trap (Decision 14): missing SecretsManager:GetSecretValue → caught
by SFN SendToDLQ → SNS email → CloudWatch logs identified the missing
grant → fixed in Step 12. Two-commit sequence on
feat/phase-3-sfn-bridge, squash-merged.

Phase 4 (ramp): docs/superpowers/plans/2026-05-XX-phase-4-rollout-ramp.md (TBD).
```

- [ ] **Step 18.3: Commit + push**

```bash
cd /Users/jperez/dev/casa-coqui
git add explantion/2026-05-08-phase-3-handoff.md tasks/changes/phase-3/
git commit -m "docs(phase-3): close handoff + change log; Phase 3 v3.1 complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main  # requires Julio approval
```

---

## Commit messages (summary list, in branch order)

1. `docs(phase-3): scaffolding for SFN bridge change log (v3.1)` (Step 1)
2. `feat(phase-3): pure decideRoute function with full unit-test coverage` (Step 2)
3. `feat(phase-3): bridge-metrics EMF emitter (Stackdriver-vs-CloudWatch fix)` (Step 3)
4. `feat(phase-3): appconfig-client with fail-closed contract` (Step 4)
5. (verification — no commit) (Step 5.0 — confirm per-stage token shape)
6. `feat(sam/reply-agent): WriteBack stub → real (firebase-admin + Firestore)` (Step 5)
7. `feat(phase-3): aws-sfn-bridge StartExecution wrapper` (Step 6)
8. `feat(phase-3): wire bridge into onAirbnbMessageCreated (v3.1)` (Step 7)
9. `feat(phase-3): ESLint no-restricted-imports rule for bridge modules (F14)` (Step 8.0)
10. `feat(phase-3): regenerate API + admin UI Retry button + editedReply gating` (Step 8)
11. `feat(sam/reply-agent): per-state Catch redirects + WriteBack execution context (F13)` (Step 9)
12. `feat(sam/reply-agent): wire WriteBack to firebase-admin [INTENTIONAL: missing IAM grant]` (Step 10 — Commit A of W7 pair)
13. (operational — no commit) (Step 11 — observe trap fire)
14. `fix(sam/reply-agent): add SecretsManager:GetSecretValue grant to WriteBack role` (Step 12 — Commit B of W7 pair)
15. `feat(phase-3): CI prompt-drift check across 3 sources of truth` (Step 13)
16. `feat(sam/reply-agent): tighten feature-flags validator — reject mode: shadow in prod` (Step 14)
17. (operational — no commit) (Step 15 — final SAM deploy + 1Password + calendar)
18. **Squash-merge to main** with message `feat(phase-3): SFN bridge + DLQ + alarms + auto-rollback (v3.1)` (Step 16)
19. `docs(phase-3): smoke verification artifacts (a-k per spec AC #17 + F9/F15)` (Step 17)
20. `docs(phase-3): close handoff + change log; Phase 3 v3.1 complete` (Step 18)

---

## Acceptance criteria recap (one-to-one with spec AC #1–17)

| # | Criterion | Verified by |
|---|---|---|
| 1 | Bridge wiring: fetchReplyEngineFlag + 60s cache + fail-closed log | Step 7 + Step 4 tests |
| 2 | Pure decideRoute with 5 enumerated test cases | Step 2 (7 tests) |
| 3 | StartExecution permission scoped (allow on SM, deny DescribeExecution) | Step 15.4 |
| 4 | All policies use appconfigdata:* (not appconfig:*) | Step 10.3 |
| 5 | WriteBack persists `_agentRun.{appConfigVersion,routedBy,executionArn,inputTokens,outputTokens,latencyMs}` + skip on editedReply | Step 5 (7 tests) + Step 17 scenarios b, g |
| 6 | DLQ catches per-state failures with correct `messageId`/`threadKey` paths | Step 17 scenario f |
| 7 | DLQ → SNS email at 01juliop@gmail.com | Step 17 scenario f |
| 8 | SFN alarm fires at threshold AND auto-rollback on AppConfig deployment | Step 11 / Step 17 scenario f + induced failures |
| 9 | BridgeFailureAlarm exists and fires on >5 errors in 5 min | Step 17.5 |
| 10 | Regenerate API rate-limited (3 per inbound + 30s cooldown) | Step 17 scenario i (F10 interleaved) |
| 11 | Retry button on failed rows + Regenerate disabled when editedReply set | Step 17 scenario h (UI) + Step 8 |
| 12 | CI prompt-drift check fails build on hash mismatch | Step 13.4 + buildspec |
| 13 | Cross-sync warnings updated to point at CI drift script | Step 13.3 |
| 14 | rollout_pct: 0 deployed; validator rejects mode: shadow | Step 14 + Step 17 scenario j |
| 15 | Bridge metrics emitted (BridgeRouteSuccesses/Failures); BridgeFailureAlarm ALARM after 6 errors / 4 min | Step 17.5 |
| 16 | Context-window parity (.slice(-20)) | Step 6 (test) + Step 6.2 implementation |
| 17 | All 10+1 synthetic smoke scenarios pass (a–k) | Step 17 |

---

## Deploy steps (gated; Julio approves each)

| When | What | Command | Approval |
|---|---|---|---|
| After Step 10 | First SAM deploy (W7 trap — broken IAM); F6 split | `sam deploy ... --no-execute-changeset` then `aws cloudformation execute-change-set` | **Pause + ask Julio** (Step 11.1 + 11.3) |
| After Step 12 | Second SAM deploy (fix); F6 split | same pattern | **Pause + ask Julio** (Step 12.3) |
| After Step 14 | Final SAM deploy (validator + last touches); F6 split | same pattern | **Pause + ask Julio** (Step 15.1) |
| Step 15.3 | `aws iam create-access-key`; transcribe to 1Password | (commands inline) | Julio's session |
| Step 16 | `firebase functions:secrets:set` + `vercel env add` (F2) | (commands inline) | Julio's session |
| Step 16 | `git push origin main` (triggers CodePipeline) | `git push origin main` | **Pause + ask Julio** (Step 16.3) |
| Step 17 — scenario d | `aws iam put-user-policy ... TempDenyAppConfig` | (induce failure) | Auto — short-lived, immediate cleanup |
| Step 17 — scenario f | F7: deny `lambda:InvokeFunction` on Reasoner from SM role | (induce failure) | **Pause + ask Julio** (touches SM role) |
| Step 17.4 | Reset AppConfig to `mode: firebase, rollout_pct: 0` | `aws appconfig start-deployment` | Auto |
| Step 17.6 | `git push origin main` (smoke artifacts) | `git push origin main` | **Pause + ask Julio** |
| Step 17.7 | Delete feature branch (F8 — AFTER smoke) | `git branch -d ...` | Auto — local-only |
| Step 18.3 | `git push origin main` (handoff close) | `git push origin main` | **Pause + ask Julio** |

---

## Subagent dispatch plan

**Parallel-safe groups** (per `superpowers:dispatching-parallel-agents`):

- **Group A (parallelize):** Steps 2, 3, 5 — independent files, no shared state.
- Step 4 depends on Step 3 (imports `bridge-metrics`).
- Step 5.0 (verification) is independent, can run anytime before Step 5.
- Step 6 depends on Steps 3 + 4.
- Step 7 depends on Steps 2 + 4 + 6.
- Step 8.0 (ESLint) is independent of Step 7 — can parallelize.
- Steps 8 + 9 are independent of each other and of Step 7 — can parallelize after Step 6.
- Step 10 depends on Step 9 (template references `ReplyDraftDLQUrl` in ASL).
- Steps 11 → 14 are sequential (deploy ordering).
- Step 17's smoke scenarios within their AppConfig state can run in 3 parallel groups (a/b/c sequential; d/e/g/i in parallel; f/h/j/k sequential due to operational steps — k requires AppConfig flips like a/b/c).

**Doc agent:** runs in background after each step, appends to change log. Use `run_in_background: true`.

---

## Smoke testing — synthetic-injection pattern reuse

Reuses the pattern documented in `tasks/changes/option-a/item-4-logs/`:

1. **Synthetic input** — Firestore doc with `source: 'phase3-smoke'` field for cleanup discrimination.
2. **Injection** — direct Firestore write triggers Cloud Function via `onDocumentCreated`. For DLQ scenario, direct `aws stepfunctions start-execution` bypasses the bridge. For UI scenario h, manual browser screenshot.
3. **Verify booleans** — `verify-bridge.js` reads the doc post-execution, asserts the expected `_agentRun` shape AND (for scenario k) voice-parity regex booleans, prints `{ scenario, docId[, docId2], result, allPass }`.
4. **Cleanup** — `cleanup-bridge.js` deletes all docs where `source: 'phase3-smoke'`. AppConfig deployment restores `mode: firebase, rollout_pct: 0`. Any IAM `put-*-policy` is paired with a delete in the same step.

Zero real guest data touched. Zero residue.

---

## Estimated effort

| Step | Title | Minutes |
|---|---|---|
| 1 | Branch + scaffolding | 15 |
| 2 | decideRoute pure function (TDD) | 40 |
| 3 | bridge-metrics EMF emitter | 25 |
| 4 | appconfig-client (TDD, fail-closed) | 50 |
| 5.0 | Verify per-stage token shape (F1) | 10 |
| 5 | WriteBack Lambda real (token sum + latency proxy) | 50 |
| 6 | aws-sfn-bridge (TDD) | 40 |
| 7 | Wire bridge into onAirbnbMessageCreated (F2 + F3) | 60 |
| 8.0 | ESLint no-restricted-imports rule (F14) | 15 |
| 8 | Regenerate API + UI | 45 |
| 9 | ASL Catch + SendToDLQ + executionArn/StartTime (F13) | 30 |
| 10 | SAM template (DLQ/SNS/alarms/IAM/Monitor) | 90 |
| 11 | INTENTIONAL BREAK: deploy + observe (F6 split) | 35 |
| 12 | FIX: SecretsManager grant + redeploy (F6 split) | 20 |
| 13 | Prompt drift CI check | 30 |
| 14 | feature-flags validator regex | 10 |
| 15 | Final SAM deploy + 1Password + calendar (F4) | 40 |
| 16 | Firebase secrets + Vercel mirror (F2) + squash-merge | 40 |
| 17 | Smoke (a–k + alarm; F5/F7/F9/F10/F15) | 120 |
| 17.7 | Delete feature branch (F8) | 5 |
| 18 | Handoff close | 15 |
| **Total** | | **~785 min ≈ 13 h** |

(Spec budgets ~9.5h baseline; v3.1 fixes add ~3.5h: F4 rotation runbook + 1Password + calendar (40m), F2 Vercel env mirror (25m), F6 changeset-split workflow across 3 deploys (45m), F9/F15 voice-parity scenario k (30m), F10 interleaved rate-limit timing (15m), Step 5.0 verification (10m), Step 8.0 ESLint rule (15m). Acceptable per spec's "with full TDD + smoke + v3.1 fixes" budget.)

---

## Open issues

### Phase 3.5 prerequisite (F12)

**Phase 3.5 (Quality monitor) prerequisite:** confirm Evaluator Lambda emits structured `passed` / `voiceScore` / `hardBanHit` outputs. If not, Phase 3.5 absorbs the emitter work as its first step.

- **Owner:** Julio
- **Due:** before Phase 4 ramp >5%

Phase 3 explicitly does NOT claim quality-driven rollback (Decision 14). The AppConfig Monitor watches `SFNExecutionsFailedAlarm` only — infra failure, not draft quality. A bad system-prompt deploy that produces 100% SUCCEEDED executions with regressed replies will NOT trip the alarm and will NOT auto-rollback. Phase 3.5 closes that seam by wiring `EvaluatorVoiceScoreLow` / `EvaluatorHardBanHit` EMF metrics from Evaluator → CloudWatch alarm → AppConfig Monitor.

If Evaluator does NOT currently emit these structured outputs, Phase 3.5's first step is the emitter Lambda change. Verify before Phase 4 ramps past 5%.

### latencyMs proxy

Currently approximated as `Date.now() - executionStartTime`. Tightens to per-Lambda granularity in Phase 3.1 either by (a) modifying all 4 chain Lambdas to return `latencyMs`, or (b) computing from SFN execution metadata via `GetExecutionHistory`. Acceptable approximation for Phase 3.

---

## Self-review

1. **Spec coverage** — all 17 acceptance criteria mapped to a verifying step (table above).
2. **Decision coverage** — Decisions 1–19 (including v3.1's 17 revised + 18 + 19) each cited at least once in the relevant step.
3. **F1–F15 coverage** — all 15 v3.1 fixes applied; see top of plan for traceability table.
4. **W7 trap on feature branch** — Steps 10 (Commit A: broken IAM), 11 (observe), 12 (Commit B: fix). Squash-merge in Step 16 means main never sees the broken state.
5. **SAM-first deploy ordering** — Steps 11, 12, 15 all `sam deploy` (with F6 changeset split) BEFORE Step 16's `git push origin main` triggers CodePipeline. Decision 15 baked in.
6. **TDD where it earns** — `decide-route` (7 cases AC #2), `appconfig-client` (5 cases for fail-closed contract + version), `aws-sfn-bridge` (3 cases including AC #16 thread slice), WriteBack (7 cases including AC #5 skip + F1 token sum + latency proxy + appConfigVersion precedence), `bridge-metrics` (3 light cases). End-to-end smokes in Step 17 (a–k).
7. **Subagent dispatch hints** — explicit parallel-safe groups documented.
8. **CI drift check** — Step 13 + buildspec; AC #12 + #13 covered.
9. **Each prod-touching action gated** — deploy table makes the approval points explicit; F6 splits each deploy into changeset-create + Julio review + execute.
10. **No emojis, imperative voice, code blocks for bash/yaml/json/javascript** — passes style guide.
11. **No placeholders** — every code block is concrete.
12. **Cross-cloud parity** — F2 ensures AWS keys live in BOTH Firebase secrets AND Vercel env; F4 rotation runbook updates BOTH in one window.

**End of plan.**
