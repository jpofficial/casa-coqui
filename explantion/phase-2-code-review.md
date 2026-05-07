# Phase 2 — Code Walkthrough

**Date**: 2026-05-07
**Status**: Phase 2 deployed and verified end-to-end
**Purpose**: Walk through every file Phase 2 created or modified. Read top-to-bottom, no need to bounce around — each section is self-contained.

If you want the higher-level "what we did and why" summary, see `tasks/2026-05-07-session-status.md`. This doc is the line-by-line code review.

---

## Files at a glance

### Created (4 source files)
1. `infra/sam/reply-agent/config/system-prompt.seed.json` — host voice config (single source of truth)
2. `infra/sam/reply-agent/config/feature-flags.seed.json` — feature flag definitions
3. `infra/sam/reply-agent/scripts/build-template.js` — inlines seed JSON into the SAM template at build time
4. `infra/sam/reply-agent/scripts/verify-appconfig.sh` — post-deploy smoke check

### Modified
5. `infra/sam/reply-agent/template.yaml` — adds 12 AWS resources + 3 parameters + IAM grants
6. `infra/sam/reply-agent/functions/load-config/index.js` — stub → real (SSM fetch)
7. `infra/sam/reply-agent/functions/load-config/package.json` — adds `@aws-sdk/client-ssm`
8. `infra/sam/reply-agent/functions/drafter/index.js` — AppConfig fetch + version capture
9. `infra/sam/reply-agent/functions/reviser/index.js` — mirror of Drafter
10. `infra/sam/reply-agent/functions/reasoner/index.js` — minor: prefer `event.config.model`
11. `infra/sam/reply-agent/functions/evaluator/index.js` — minor: prefer `event.config.model`
12. `infra/sam/reply-agent/statemachines/ai-chain.asl.json` — `ResultSelector` captures `appConfigVersion`
13. `functions/lib/reply-ai.js` — load `SYSTEM_PROMPT` from shared seed

---

## Part 1 — The Single Source of Truth pattern

### Why it matters

Before Phase 2, `SYSTEM_PROMPT` was a 9.4KB template literal inline in `functions/lib/reply-ai.js`. Phase 2 introduces AppConfig as a second consumer of the same content. If we left both inline, they'd drift — anyone editing the JS chain's prompt would forget to update the AppConfig HCV (and vice versa).

### The fix

**One file. Two readers.**

- `infra/sam/reply-agent/config/system-prompt.seed.json` is the canonical source.
- `functions/lib/reply-ai.js` reads it at module load via `fs.readFileSync`.
- The SAM template embeds it via `scripts/build-template.js` at `sam build` time.

### File 1: `config/system-prompt.seed.json`

Validator-shaped JSON. The keys map 1:1 to the JSON Schema validator on the AppConfig profile:

```json
{
  "version": "1.0.0",
  "language_distribution": { "en": 0.86, "es": 0.13 },
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
  "system_prompt_text": "You are drafting Airbnb host message replies on behalf of Julio... <full 9.4KB content>"
}
```

`reply-ai.js` only consumes `system_prompt_text`. The other three fields (`version`, `language_distribution`, `hard_bans`) exist purely for AppConfig validation. This is intentional: when a future engineer wants to A/B different host voices via AppConfig, they have the metadata fields ready without touching `reply-ai.js`.

**Note about Commit A → Commit B**: in Commit A (`6cde186`), the `version` field was deliberately absent. This was the W7 trap setup. The reasoning: we expected the AppConfig validator to reject on `CreateHostedConfigurationVersion`. **It didn't** — Freeform validators run at *retrieval*, not creation. The deploy still failed (different reason — see Part 3 / Deployments) but the `version` field was still added in Commit B (`fbcb9f7`) because the validator would have failed Drafter/Reviser at runtime when they fetch the config.

### File 13: `functions/lib/reply-ai.js` (the change)

Old (~131 lines):
```js
const SYSTEM_PROMPT = `You are drafting Airbnb host message replies...
[long template literal]
`;
```

New (4 lines + comment):
```js
// SYSTEM_PROMPT is loaded from the shared seed file used by both the
// legacy JS chain (this file) and AppConfig (Phase 2). Single source
// of truth eliminates drift during the Phase 2 → Phase 3 transition.
// We only consume system_prompt_text — the other fields (version,
// hard_bans, language_distribution) are AppConfig validator concerns.

const fs = require('fs');
const path = require('path');
const _seedPath = path.resolve(__dirname, '../../infra/sam/reply-agent/config/system-prompt.seed.json');
const SYSTEM_PROMPT = JSON.parse(fs.readFileSync(_seedPath, 'utf-8')).system_prompt_text;
```

Module-level read = paid once at Cloud Function cold start. Zero per-invocation cost. Same `module.exports = { generateReply, buildReplyInput, SYSTEM_PROMPT }` line at the bottom — downstream consumers (`generateReplyChain`, `onAirbnbMessageCreated`) don't change.

### File 3: `scripts/build-template.js` (the SAM-side reader)

Why this script exists: SAM has `Fn::Transform: AWS::Include` which we hoped would inline the seed file into `AWS::AppConfig::HostedConfigurationVersion.Content`. **It doesn't work** — `Content` is typed `String`, but `AWS::Include` substitutes a parsed object. CloudFormation's early validation rejects the type mismatch.

Workaround: a Node script that reads `template.yaml` + the two seed JSONs, replaces the `Fn::Transform: AWS::Include` blocks with literal YAML pipe-quoted content, and writes `template.built.yaml`. We deploy with `--template-file template.built.yaml`.

```js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const templateSrc = fs.readFileSync(path.join(root, 'template.yaml'), 'utf-8');
const sysPrompt = fs.readFileSync(path.join(root, 'config/system-prompt.seed.json'), 'utf-8');
const featureFlags = fs.readFileSync(path.join(root, 'config/feature-flags.seed.json'), 'utf-8');

function indent(content) {
  return content.split('\n').map(l => '          ' + l).join('\n');
}

const built = templateSrc
  .replace(/Content:\s*\n\s*Fn::Transform:.../, `Content: |\n${indent(sysPrompt)}`)
  .replace(/Content:\s*\n\s*Fn::Transform:.../, `Content: |\n${indent(featureFlags)}`);

fs.writeFileSync(path.join(root, 'template.built.yaml'), built);
```

`template.built.yaml` is gitignored. The script is checked in. Deploy sequence:

```bash
node scripts/build-template.js
sam build --template-file template.built.yaml
sam deploy --template-file template.built.yaml --no-confirm-changeset
```

Trade-off: extra build step. The benefit: the seed JSON stays a single source of truth, hand-editable.

---

## Part 2 — LoadConfig becomes real

### Why

Phase 1 LoadConfig was a stub returning hardcoded `{model, temperature, maxTokens}`. Phase 2 promises hot-tunable model knobs without redeploys. SSM Parameter Store is the right level of abstraction (simple key-value, IAM-scoped, cheaper than AppConfig, no validator schema needed).

### File 7: `functions/load-config/package.json`

```json
{
  "name": "casa-coqui-reply-load-config",
  "version": "1.0.0",
  "private": true,
  "description": "SFN orchestration Lambda — fetches model knobs from SSM at workflow start",
  "main": "index.js",
  "engines": {
    "node": "24"
  },
  "dependencies": {
    "@aws-sdk/client-ssm": "^3.700.0"
  }
}
```

The new dep is `@aws-sdk/client-ssm`. Phase 1.5's chain Lambdas already declare `@aws-sdk/client-secrets-manager` for the Anthropic key fetch — same pattern.

### File 6: `functions/load-config/index.js`

```js
const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');

const ssm = new SSMClient({});

const PARAM_MODEL = '/casa-coqui/reply-agent/model';
const PARAM_TEMPERATURE = '/casa-coqui/reply-agent/temperature';

exports.handler = async (event) => {
  console.log('[load-config] event keys:', Object.keys(event || {}));

  const out = await ssm.send(new GetParametersCommand({
    Names: [PARAM_MODEL, PARAM_TEMPERATURE],
  }));

  if (out.InvalidParameters && out.InvalidParameters.length > 0) {
    throw new Error('load-config: missing SSM parameters: ' + out.InvalidParameters.join(', '));
  }

  const params = Object.fromEntries(out.Parameters.map((p) => [p.Name, p.Value]));

  const model = params[PARAM_MODEL];
  const temperatureRaw = params[PARAM_TEMPERATURE];
  if (!model) throw new Error('load-config: model parameter missing');
  if (!temperatureRaw) throw new Error('load-config: temperature parameter missing');

  const temperature = parseFloat(temperatureRaw);
  if (isNaN(temperature)) throw new Error('load-config: temperature is not a number: ' + temperatureRaw);

  return {
    model,
    temperature,
    loadedAt: new Date().toISOString(),
  };
};
```

Worth calling out:
- **Module-level `SSMClient` construction**: cheap (lazy HTTP init in AWS SDK v3), survives warm invocations.
- **`GetParametersCommand` is plural** — fetches both params in one API call. `GetParameter` (singular) would need two round trips.
- **`InvalidParameters` check**: SSM doesn't throw on missing parameters; it returns the names in `out.InvalidParameters`. Easy to miss.
- **`parseFloat` + `isNaN` guard**: SSM `String` type means `temperature` could be `"0..7"` typo and we'd silently pass `NaN` to Anthropic. Validation catches it.
- **Output shape `{model, temperature, loadedAt}`** — `loadedAt` is for debugging; `model` and `temperature` are what chain Lambdas read.

The result threads through SFN state via the existing `ResultPath: $.config` (set in Phase 1's `reply-draft.asl.json` and Phase 1.5 Task 8 fix). Chain Lambdas read `event.config.model` (with env-var fallback).

---

## Part 3 — AppConfig template resources (`template.yaml` additions)

### What got added (12 resources + 3 parameters)

**3 Parameters** at the top of the template:
```yaml
  AppConfigExtensionLayerArn:
    Type: AWS::SSM::Parameter::Value<String>
    Default: /aws/service/appconfig/extension/arm64/2.0.183
    Description: AWS-published AppConfig Extension Lambda Layer ARN

  ModelDefault:
    Type: String
    Default: claude-haiku-4-5-20251001

  TemperatureDefault:
    Type: String
    Default: "1.0"
```

The first one is interesting: `AWS::SSM::Parameter::Value<String>`. Type is a **special CFN parameter type** that resolves an SSM public parameter at deploy time. So `AppConfigExtensionLayerArn` becomes the ARN string of the latest known-good AppConfig Extension layer (AWS publishes them as SSM public parameters). Pinning by version path means we explicitly opt into upgrades.

### The 12 resources

**SSM Parameters (2)**:
```yaml
  ModelParameter:
    Type: AWS::SSM::Parameter
    Properties:
      Name: /casa-coqui/reply-agent/model
      Type: String
      Value: !Ref ModelDefault

  TemperatureParameter:
    Type: AWS::SSM::Parameter
    Properties:
      Name: /casa-coqui/reply-agent/temperature
      Type: String
      Value: !Ref TemperatureDefault
```

These are the parameters LoadConfig (Part 2) reads.

**AppConfig Application + Environment + 2 ConfigurationProfiles + DeploymentStrategy (5)**:
```yaml
  ReplyAgentApplication:
    Type: AWS::AppConfig::Application
    Properties:
      Name: casa-coqui-reply-agent

  ReplyAgentProdEnvironment:
    Type: AWS::AppConfig::Environment
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      Name: prod

  SystemPromptProfile:
    Type: AWS::AppConfig::ConfigurationProfile
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      Name: system-prompt
      Type: AWS.Freeform
      LocationUri: hosted
      Validators:
        - Type: JSON_SCHEMA
          Content: |
            {
              "$schema": "http://json-schema.org/draft-04/schema#",
              "type": "object",
              "required": ["version", "language_distribution", "hard_bans", "system_prompt_text"],
              "properties": {
                "version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
                "language_distribution": { "type": "object", "additionalProperties": { "type": "number" } },
                "hard_bans": { "type": "array", "items": { "type": "string" } },
                "system_prompt_text": { "type": "string", "minLength": 100 }
              }
            }

  FeatureFlagsProfile:
    Type: AWS::AppConfig::ConfigurationProfile
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      Name: feature-flags
      Type: AWS.AppConfig.FeatureFlags
      LocationUri: hosted

  LinearDeploymentStrategy:
    Type: AWS::AppConfig::DeploymentStrategy
    Properties:
      Name: casa-coqui-linear-10pct
      DeploymentDurationInMinutes: 10
      FinalBakeTimeInMinutes: 5
      GrowthFactor: 10.0
      GrowthType: LINEAR
      ReplicateTo: NONE
```

Read this from inside out:
- **`ReplyAgentApplication`** is a logical container.
- **`ReplyAgentProdEnvironment`** is a deployment scope (we have just one — `prod`).
- **`SystemPromptProfile`** holds the host voice config. The validator schema requires four fields; if any are missing, the validator rejects at *retrieval* (this is the W7 trap refinement we learned from Commit A).
- **`FeatureFlagsProfile`** holds the `reply_engine` flag. **No consumer in Phase 2** — Phase 3 wires the Cloud Function to read it.
- **`LinearDeploymentStrategy`** is the rollout policy. 10%/min growth, 5min final bake. At 10 msg/day this is theatre — the bake window observes zero traffic — but it's the AppConfig deployment-strategy concept the W7 lesson is built around.

**HostedConfigurationVersions + Deployments (4)**:
```yaml
  SystemPromptVersion:
    Type: AWS::AppConfig::HostedConfigurationVersion
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      ConfigurationProfileId: !Ref SystemPromptProfile
      ContentType: application/json
      Content: |
        <inlined by build-template.js from config/system-prompt.seed.json>

  FeatureFlagsVersion:
    Type: AWS::AppConfig::HostedConfigurationVersion
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      ConfigurationProfileId: !Ref FeatureFlagsProfile
      ContentType: application/json
      Content: |
        <inlined by build-template.js from config/feature-flags.seed.json>

  SystemPromptDeployment:
    Type: AWS::AppConfig::Deployment
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      EnvironmentId: !Ref ReplyAgentProdEnvironment
      ConfigurationProfileId: !Ref SystemPromptProfile
      ConfigurationVersion: !Ref SystemPromptVersion
      DeploymentStrategyId: !Ref LinearDeploymentStrategy

  FeatureFlagsDeployment:
    Type: AWS::AppConfig::Deployment
    DependsOn: SystemPromptDeployment    # ← Critical: serializes the two Deployments
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      EnvironmentId: !Ref ReplyAgentProdEnvironment
      ConfigurationProfileId: !Ref FeatureFlagsProfile
      ConfigurationVersion: !Ref FeatureFlagsVersion
      DeploymentStrategyId: !Ref LinearDeploymentStrategy
```

The `DependsOn: SystemPromptDeployment` line on `FeatureFlagsDeployment` is the second non-obvious lesson from Phase 2:

**AppConfig only allows one active deployment per Environment.** If CFN creates the two `Deployment` resources in parallel, the second one gets a 409 conflict from the AppConfig API. CFN then rolls back the entire stack update.

This bit us on Commit A. The fix is `DependsOn`, which is CFN's mechanism for declaring "create this resource AFTER that one finishes." With `DependsOn: SystemPromptDeployment` on the second Deployment, CFN waits for the first to reach `CREATE_COMPLETE` before starting the second.

### IAM grants on Drafter and Reviser

Drafter and Reviser get a new IAM statement alongside their existing Anthropic Secrets Manager grant:

```yaml
  DrafterFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: casa-coqui-reply-drafter
      ...
      Layers:
        - !Ref AppConfigExtensionLayerArn
      Environment:
        Variables:
          APPCONFIG_APPLICATION: !Ref ReplyAgentApplication
          APPCONFIG_ENVIRONMENT: !Ref ReplyAgentProdEnvironment
          APPCONFIG_PROFILE: !Ref SystemPromptProfile
          AWS_APPCONFIG_EXTENSION_PRELOAD_LIST: !Sub applications/${ReplyAgentApplication}/environments/${ReplyAgentProdEnvironment}/configurations/${SystemPromptProfile}
      Policies:
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: secretsmanager:GetSecretValue
              Resource:
                - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${AnthropicSecretName}-*
            - Effect: Allow
              Action:
                - appconfig:StartConfigurationSession
                - appconfig:GetLatestConfiguration
              Resource:
                - !Sub arn:aws:appconfig:${AWS::Region}:${AWS::AccountId}:application/${ReplyAgentApplication}/environment/${ReplyAgentProdEnvironment}/configuration/${SystemPromptProfile}
```

Worth highlighting:
- **`Layers: [!Ref AppConfigExtensionLayerArn]`** — attaches the Extension. The `!Ref` resolves the SSM public parameter we declared at the top.
- **`AWS_APPCONFIG_EXTENSION_PRELOAD_LIST`** — preload at Lambda init. Without this, the first invocation pays the fetch latency.
- **`!Sub` interpolation in the IAM Resource** — scopes `appconfig:GetLatestConfiguration` to ONE specific configuration ARN. Not `appconfig:*`. Not even all configs in the application. Just this one. Least privilege.

The same block (with `ReviserFunction:` substituted) exists for Reviser. Reasoner and Evaluator don't get the layer or the AppConfig perms — they keep their inline algorithm prompts.

### IAM grant on LoadConfig

LoadConfig got its policy entirely replaced (was Anthropic Secrets Manager — that grant was a leftover from Phase 1's stub design):

```yaml
  LoadConfigFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: casa-coqui-reply-load-config
      ...
      Policies:
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: ssm:GetParameters
              Resource:
                - !Sub arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/casa-coqui/reply-agent/*
```

Wildcard at the end (`/casa-coqui/reply-agent/*`) is fine — it scopes to our parameter prefix, not all of SSM. If you wanted maximum strictness, you'd list `model` and `temperature` explicitly, but the prefix scoping is industry-standard for hierarchical parameters.

---

## Part 4 — Drafter + Reviser AppConfig fetch (the biggest Lambda change)

### What changed in each handler

Both Drafter and Reviser used to read `voicePrompt` from the SFN input (the Cloud Function builds it from `reply-ai.js` and passes via fat input). Now they fetch `system_prompt_text` from AppConfig at runtime.

### File 8: `functions/drafter/index.js` (the new code)

Three additions:

**(1) `fetchSystemPromptConfig()` — module-cached AppConfig fetch**:

```js
let _appConfigCache = null;

async function fetchSystemPromptConfig() {
  if (_appConfigCache) return _appConfigCache;

  const app = process.env.APPCONFIG_APPLICATION;
  const env = process.env.APPCONFIG_ENVIRONMENT;
  const profile = process.env.APPCONFIG_PROFILE;
  if (!app || !env || !profile) {
    throw new Error('drafter: APPCONFIG_{APPLICATION,ENVIRONMENT,PROFILE} env vars not set');
  }

  const url = `http://localhost:2772/applications/${app}/environments/${env}/configurations/${profile}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`drafter: AppConfig fetch failed: ${res.status} ${res.statusText}`);
  }

  const appConfigVersion = res.headers.get('Configuration-Version') || 'unknown';
  const config = await res.json();

  if (!config.system_prompt_text) {
    throw new Error('drafter: AppConfig response missing system_prompt_text');
  }

  _appConfigCache = {
    systemPromptText: config.system_prompt_text,
    appConfigVersion,
  };
  return _appConfigCache;
}
```

How this works:
- The AppConfig Lambda Extension layer (attached via template) starts a sidecar HTTP server on `localhost:2772` inside the Lambda container.
- We hit `http://localhost:2772/applications/.../environments/.../configurations/...` — a localhost HTTP call, sub-millisecond.
- The Extension handles the actual API call to AppConfig + caching (45s TTL by default) + fetching new versions.
- We capture the `Configuration-Version` HTTP response header. AppConfig sets this on every response — it's the version ID of the active deployment.
- Module-cached at the Lambda level too: once we get a config, we don't re-fetch on warm invocations. Trade-off: prompt changes don't propagate until the container recycles (Phase 3 may switch to per-invocation reads if this matters).

**(2) Updated handler** — removes `voicePrompt` validation, uses AppConfig:

```js
exports.handler = async (event) => {
  const refId = event?.message?.id || null;
  const contextJson = event?.contextJson;
  const voiceProfilePrompt = event?.voiceProfilePrompt || '';
  const strategy = event?.reasoner?.strategy;
  const modelFromConfig = event?.config?.model || process.env.MODEL_NAME;

  if (!contextJson) throw new Error('drafter: missing contextJson in input');
  if (!strategy) throw new Error('drafter: missing reasoner.strategy in input');
  if (!modelFromConfig) throw new Error('drafter: model not available (event.config.model and MODEL_NAME both missing)');

  const [client, { systemPromptText, appConfigVersion }] = await Promise.all([
    getAnthropicClient(),
    fetchSystemPromptConfig(),
  ]);

  const drafterInput = `STRATEGY FROM REASONER:\n${JSON.stringify(strategy, null, 2)}\n\nCONTEXT:\n${contextJson}`;

  const response = await callWithBackoff(client, {
    model: modelFromConfig,
    max_tokens: 512,
    system: buildDrafterPrompt(systemPromptText, voiceProfilePrompt),
    tools: [DRAFTER_TOOL],
    tool_choice: { type: 'tool', name: 'guest_reply' },
    messages: [{ role: 'user', content: drafterInput }],
  }, { label: 'drafter', refId });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('drafter: no tool_use block in response');

  return {
    draft: block.input,
    tokens: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    },
    appConfigVersion,
  };
};
```

Key changes:
- **Gone**: `if (!voicePrompt) throw new Error(...)`. We don't read voicePrompt from input anymore.
- **Added**: `const modelFromConfig = event?.config?.model || process.env.MODEL_NAME;` and a new error if neither is present. Falls back to env var so direct Lambda invocations (no SFN context) still work.
- **Parallel fetch**: `Promise.all([getAnthropicClient(), fetchSystemPromptConfig()])`. Anthropic client init (Secrets Manager) and AppConfig fetch happen concurrently. Cold-start latency optimization.
- **`buildDrafterPrompt(systemPromptText, voiceProfilePrompt)`** uses the AppConfig-fetched text instead of `voicePrompt`.
- **Returns `appConfigVersion`** in the result.

**(3) Module exports**:

```js
module.exports = { handler: exports.handler, callWithBackoff, fetchSystemPromptConfig };
```

`fetchSystemPromptConfig` exported for future tests (mocking).

### File 9: `functions/reviser/index.js`

Reviser is a structural mirror of Drafter. Same `fetchSystemPromptConfig()` (with `'reviser:'` error prefix), same handler pattern. Reads `event.evaluator.evaluation` and `event.drafter.draft` for the revise input (existing Phase 1.5 behavior — no change).

### What stayed byte-identical

The throttle wrapper (`callWithBackoff`, `isRetryable`, `backoffDelayMs`) and the cached Anthropic client (`getAnthropicClient()` + `_secretValue`/`_anthropicClient` module state) remain byte-identical to Reasoner. Phase 1.5 carefully verified this; Phase 2's review confirmed it didn't drift.

```bash
diff <(awk '/^const THROTTLE_ERROR_NAME/,/^throw lastErr;$/' infra/sam/reply-agent/functions/reasoner/index.js) \
     <(awk '/^const THROTTLE_ERROR_NAME/,/^throw lastErr;$/' infra/sam/reply-agent/functions/drafter/index.js)
# Expected: empty output
```

---

## Part 5 — Reasoner + Evaluator minor changes

### Files 10 + 11: just two-line edits per file

Reasoner and Evaluator don't use AppConfig — they keep their inline algorithm prompts (`REASONER_PROMPT`, `EVALUATOR_PROMPT`). What did change: they now prefer `event.config.model` over the env var, in case LoadConfig's SSM-fetched value differs from the template default.

Inside each handler:

Old:
```js
if (!process.env.MODEL_NAME) throw new Error('reasoner: MODEL_NAME env var not set');
// ...
model: process.env.MODEL_NAME,
```

New:
```js
const modelFromConfig = event?.config?.model || process.env.MODEL_NAME;
if (!modelFromConfig) throw new Error('reasoner: model not available (event.config.model and MODEL_NAME both missing)');
// ...
model: modelFromConfig,
```

Tiny change. Makes the model fully tunable via SSM without redeploys. Lambda env var stays as fallback.

---

## Part 6 — `ai-chain.asl.json` ResultSelector update (File 12)

The inner SFN already returns `Payload.draft` and `Payload.tokens` from Drafter and Reviser. After Phase 2, those Lambdas also return `Payload.appConfigVersion`. The ASL `ResultSelector` needs to capture the new field so it propagates through chain output.

Drafter state (similar for Reviser):

Old:
```json
"ResultSelector": {
  "draft.$": "$.Payload.draft",
  "tokens.$": "$.Payload.tokens"
},
```

New:
```json
"ResultSelector": {
  "draft.$": "$.Payload.draft",
  "tokens.$": "$.Payload.tokens",
  "appConfigVersion.$": "$.Payload.appConfigVersion"
},
```

Reasoner and Evaluator ResultSelectors are unchanged — they don't return appConfigVersion (no AppConfig integration).

The propagation: after the chain finishes, `chainResult.output.drafter.appConfigVersion` is accessible in the outer SFN. Phase 3 WriteBack will read it from there and persist `_agentRun.appConfigVersion` to Firestore. Forensic trail: when a guest gets a bad reply two weeks from now, you can trace which prompt version produced it.

---

## Part 7 — `feature-flags.seed.json` (File 2)

Phase 2 ships this with no consumer. Phase 3 wires the Cloud Function to read it.

```json
{
  "version": "1",
  "flags": {
    "reply_engine": {
      "name": "reply_engine",
      "attributes": {
        "mode": {
          "constraints": {
            "type": "string",
            "enum": ["firebase", "aws-sfn", "shadow"]
          }
        },
        "rollout_pct": {
          "constraints": {
            "type": "number",
            "minimum": 0,
            "maximum": 100
          }
        }
      }
    }
  },
  "values": {
    "reply_engine": {
      "enabled": true,
      "mode": "firebase",
      "rollout_pct": 0
    }
  }
}
```

`version: "1"` here is the AppConfig FeatureFlags schema version (NOT our SemVer for the host voice). FeatureFlags content is validated by AppConfig itself — no separate `Validators` block on the profile.

Default value: `mode: "firebase"`, `rollout_pct: 0`. Status quo. Phase 3 changes this to `shadow` then ramps `aws-sfn`.

---

## Part 8 — `verify-appconfig.sh` (File 4)

Post-deploy smoke check. Catches the schema-syntax-typo edge case — if the JSON Schema validator JSON itself is malformed, AppConfig may accept it but validate nothing, letting a bad seed land.

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_NAME="casa-coqui-reply-agent"
ENV_NAME="prod"
PROFILE_NAME="system-prompt"

APP_ID=$(aws appconfig list-applications --query "Items[?Name=='$APP_NAME'].Id" --output text)
ENV_ID=$(aws appconfig list-environments --application-id "$APP_ID" --query "Items[?Name=='$ENV_NAME'].Id" --output text)

aws appconfig get-configuration \
  --application "$APP_NAME" \
  --environment "$ENV_NAME" \
  --configuration "$PROFILE_NAME" \
  --client-id "verify-appconfig-smoke-test" \
  /tmp/appconfig-content.bin >/dev/null 2>&1

CONTENT=$(cat /tmp/appconfig-content.bin)

for FIELD in version language_distribution hard_bans system_prompt_text; do
  VAL=$(echo "$CONTENT" | jq -r ".$FIELD // \"MISSING\"")
  if [ "$VAL" = "MISSING" ] || [ -z "$VAL" ] || [ "$VAL" = "null" ]; then
    echo "❌ FAIL: required field '$FIELD' is missing or empty"
    exit 1
  fi
  echo "✅ Field present: $FIELD"
done

echo "✅ Deployed system-prompt version: $(echo "$CONTENT" | jq -r '.version')"
```

Note: uses `aws appconfig get-configuration` (deprecated in 2021 in favor of `StartConfigurationSession` + `GetLatestConfiguration`). Still works. For a smoke-check script, the simpler API is acceptable — Phase 3 may upgrade if alarm-triggered rollback uses the newer API too.

Run after `sam deploy`:
```bash
./scripts/verify-appconfig.sh
# ✅ Field present: version
# ✅ Field present: language_distribution
# ✅ Field present: hard_bans
# ✅ Field present: system_prompt_text
# ✅ Deployed system-prompt version: 1.0.0
```

---

## Three minor issues flagged by the final reviewer (non-blocking)

1. **Deprecated `aws appconfig get-configuration` in `verify-appconfig.sh`** — still works, but AWS prefers `StartConfigurationSession` + `GetLatestConfiguration`. Acceptable for a smoke script. File: `infra/sam/reply-agent/scripts/verify-appconfig.sh:27`.

2. **Stale comment in `template.yaml` near the HCV section** — references "deliberately LACKS the 'version' field" from Commit A, even though Commit B fixed the seed. Comment should be cleaned up since git history has the W7 trap context. File: `infra/sam/reply-agent/template.yaml:336`.

3. **`jest-haste-map` collision warning** — `npm test` passes (1/1) but logs a haste collision between `functions/load-config/package.json` and `.aws-sam/build/LoadConfigFunction/package.json`. Should add `.aws-sam` to Jest's `testPathIgnorePatterns`. Cosmetic; not a correctness issue.

None block Phase 3.

---

## What this code unlocks for Phase 3

Phase 3 builds on Phase 2's foundation:

- **Cloud Function bridge** reads the `feature-flags` profile (the `reply_engine` flag we shipped without a consumer). Hashes `messageId mod 100`, compares to `rollout_pct`, calls `StartExecution` if eligible. Same StartExecution call from a new `regenerate` API route — fixes the regenerate button bug.
- **WriteBack Lambda** becomes real: reads `chainResult.output.drafter.appConfigVersion` (the field we plumbed in Part 4 + 6) and persists it to Firestore as `_agentRun.appConfigVersion`. Forensic trail materialized.
- **Alarms wired to AppConfig deployment Monitors**: a bad prompt rollout that causes `SFN-ExecutionsFailed > 5/5min` triggers AppConfig auto-rollback. The DeploymentStrategy we shipped in Phase 2 is the rollback target.
- **DLQ + SNS**: Phase 2 didn't add these. Phase 3 wires `Catch` on the outer SM to SQS + SNS for human-loop failures.

Phase 3 is the unlock for production traffic. Phase 2 was the prep work.
