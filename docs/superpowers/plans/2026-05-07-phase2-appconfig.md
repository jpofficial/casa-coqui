# Phase 2 — AppConfig + W7 Validator Trap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Externalize the host voice prompt to AppConfig and model knobs to SSM Parameter Store. Drill the W7 (AWS DevOps Pro Week 7) AppConfig validator trap by deliberately seeding a config that fails the validator on first deploy, observing the CFN rollback, and fixing.

**Architecture:** The existing `casa-coqui-reply-agent` SAM stack gains 12 new resources (2 SSM Parameters, AppConfig App + Env + 2 ConfigurationProfiles + DeploymentStrategy + 2 HostedConfigurationVersions + 2 Deployments) plus an AWS-published Lambda Extension layer attached to Drafter + Reviser. The host voice content lives in a single shared file `infra/sam/reply-agent/config/system-prompt.seed.json` that BOTH `functions/lib/reply-ai.js` (legacy JS chain) and the SAM HCV (new SFN path) read from — eliminating drift risk during the Phase 2 → Phase 3 transition window. The W7 trap mechanism: the seed file starts deliberately missing the `version` field — the JSON Schema validator on the system-prompt profile rejects it at `CreateHostedConfigurationVersion` time, CFN rolls back the entire stack update, then Commit B adds `version: "1.0.0"` and re-deploys.

**Tech Stack:** AWS SAM, CloudFormation, AppConfig (Application + Environment + ConfigurationProfile + DeploymentStrategy + HostedConfigurationVersion + Deployment), AWS-AppConfig-Extension Lambda Layer, SSM Parameter Store, AWS SDK v3 (`@aws-sdk/client-ssm`), Node.js 24 (arm64). No structural changes to the outer Standard SFN.

**Spec:** `docs/superpowers/specs/2026-05-07-phase2-appconfig-design.md`

---

## File Structure

### Created
```
infra/sam/reply-agent/
├── config/                                  ← NEW directory
│   ├── system-prompt.seed.json              ← shared host voice config (single source of truth)
│   └── feature-flags.seed.json              ← initial feature flag content
└── scripts/
    └── verify-appconfig.sh                  ← post-deploy smoke check
```

### Modified
```
infra/sam/reply-agent/
├── template.yaml                            ← adds 12 new resources + Parameters + IAM
├── functions/
│   ├── load-config/index.js                 ← stub → real (SSM fetch)
│   ├── load-config/package.json             ← adds @aws-sdk/client-ssm
│   ├── drafter/index.js                     ← AppConfig fetch + version capture
│   ├── reviser/index.js                     ← same as drafter
│   ├── reasoner/index.js                    ← prefer event.config.model
│   └── evaluator/index.js                   ← prefer event.config.model
└── statemachines/
    └── ai-chain.asl.json                    ← ResultSelector captures appConfigVersion

functions/lib/
└── reply-ai.js                              ← SYSTEM_PROMPT loads from shared file
```

### Unchanged
- `infra/sam/reply-agent/statemachines/reply-draft.asl.json` (Phase 1.5 Task 8 fix already threads $.config)
- `infra/sam/reply-agent/functions/{rag-retrieve,write-back}/index.js` (Phase 3 work)
- `functions/index.js` (Phase 3 wires the bridge)
- `functions/lib/reply-agent-chain.js` (still serves production)

---

## Task 1: Extract SYSTEM_PROMPT to shared seed file (deliberately broken — missing `version`)

**Why:** Eliminates drift between `reply-ai.js` SYSTEM_PROMPT (still serves prod) and AppConfig content. Two readers, one file. Note: this task creates the file in a state that LACKS the `version` field — this is intentional. The W7 trap will fire on Task 7's deploy. Commit B (Task 8) adds `version`. `reply-ai.js` only reads `system_prompt_text` and is unaffected.

**Files:**
- Create: `infra/sam/reply-agent/config/system-prompt.seed.json`
- Create: `infra/sam/reply-agent/config/feature-flags.seed.json`
- Modify: `functions/lib/reply-ai.js` (read SYSTEM_PROMPT from file)

- [ ] **Step 1: Read the current SYSTEM_PROMPT content from `functions/lib/reply-ai.js`**

```bash
cd /Users/jperez/dev/casa-coqui
awk '/^const SYSTEM_PROMPT = `/,/^`;$/' functions/lib/reply-ai.js | wc -c
# Expected: ~9400 characters
```

The full string is the template literal starting at `const SYSTEM_PROMPT = \`` and ending at the closing `\`;`. You'll need this exact content as the value of the `system_prompt_text` field in the seed file.

- [ ] **Step 2: Create `infra/sam/reply-agent/config/system-prompt.seed.json` (DELIBERATELY missing `version` field)**

This file represents the W7 trap state. Use this exact structure but with the `system_prompt_text` value being the FULL SYSTEM_PROMPT content from Step 1 (~9400 chars):

```json
{
  "language_distribution": {
    "en": 0.86,
    "es": 0.13
  },
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
  "system_prompt_text": "<paste the entire SYSTEM_PROMPT content from reply-ai.js here, preserving newlines as \\n>"
}
```

The `language_distribution` numbers come from the SYSTEM_PROMPT itself ("86% English, 13% Spanish"). The `hard_bans` come from the EVALUATOR_PROMPT's banned phrases list.

**CRITICAL:** Do NOT add a `version` field. The missing field is the W7 trap mechanism — Task 8 fixes it.

To convert the template literal content to JSON-safe format, use a Node script:
```bash
cd /Users/jperez/dev/casa-coqui
node -e "
  const fs = require('fs');
  const src = fs.readFileSync('functions/lib/reply-ai.js', 'utf-8');
  const match = src.match(/const SYSTEM_PROMPT = \`([\s\S]*?)\`;/);
  if (!match) { console.error('SYSTEM_PROMPT not found'); process.exit(1); }
  const seed = {
    language_distribution: { en: 0.86, es: 0.13 },
    hard_bans: [
      'I hope this message finds you well',
      'I\\'d be more than happy to',
      'Please don\\'t hesitate',
      'Absolutely!',
      'Certainly!',
      'Kindly',
      'Let me help you get these sorted',
      'Looking forward to getting this fixed'
    ],
    system_prompt_text: match[1]
  };
  fs.mkdirSync('infra/sam/reply-agent/config', { recursive: true });
  fs.writeFileSync('infra/sam/reply-agent/config/system-prompt.seed.json', JSON.stringify(seed, null, 2));
  console.log('Wrote system-prompt.seed.json (' + (JSON.stringify(seed).length / 1024).toFixed(1) + ' KB)');
"
```

Verify:
```bash
jq 'keys' infra/sam/reply-agent/config/system-prompt.seed.json
# Expected: ["hard_bans", "language_distribution", "system_prompt_text"]
# (NO "version" key — that's the trap)
jq '.system_prompt_text | length' infra/sam/reply-agent/config/system-prompt.seed.json
# Expected: ~9400
```

- [ ] **Step 3: Create `infra/sam/reply-agent/config/feature-flags.seed.json`**

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

(`version: "1"` here is the AppConfig FeatureFlags schema version, not our SemVer. FeatureFlags content is auto-validated by AppConfig — no separate validator needed.)

- [ ] **Step 4: Modify `functions/lib/reply-ai.js` to read SYSTEM_PROMPT from the shared file**

Find lines around line 25 where `const SYSTEM_PROMPT = \`...\`;` lives. The closing backtick of the template literal is approximately at line 290-something. Replace the entire `const SYSTEM_PROMPT = \`...\`;` declaration with:

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

Be careful: the existing template literal contains backticks for code, dollar signs, etc. Don't accidentally truncate it — use a sed/awk script or careful manual editing.

Verify the export still works:
```bash
cd /Users/jperez/dev/casa-coqui
node -e "
  const { SYSTEM_PROMPT } = require('./functions/lib/reply-ai');
  console.log('SYSTEM_PROMPT length:', SYSTEM_PROMPT.length);
  console.log('First 100 chars:', SYSTEM_PROMPT.substring(0, 100));
"
```
Expected: length ~9400, first chars start with "You are drafting Airbnb host message replies on behalf of Julio".

- [ ] **Step 5: Run any existing tests that touch reply-ai.js**

```bash
cd /Users/jperez/dev/casa-coqui/functions && npx jest 2>&1 | tail -10
```
Expected: existing tests pass. (The Phase 0 throttle test in `functions/lib/__tests__/anthropic-with-backoff.test.js` doesn't touch SYSTEM_PROMPT but should still pass.)

- [ ] **Step 6: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/config/ functions/lib/reply-ai.js
git commit -m "$(cat <<'EOF'
refactor: extract SYSTEM_PROMPT to shared seed file

Eliminates drift risk between functions/lib/reply-ai.js (legacy JS
chain, still serves production) and the upcoming AppConfig HCV
(Phase 2's new path). Single source of truth at
infra/sam/reply-agent/config/system-prompt.seed.json.

reply-ai.js reads system_prompt_text from the JSON. Same content
that was previously inline as a template literal — production
behavior unchanged.

NOTE: The seed file deliberately LACKS the 'version' field. This is
the W7 validator trap state. Subsequent commit (Phase 2 Task 8) adds
version after the AppConfig deploy fails the validator and rolls
back. reply-ai.js only consumes system_prompt_text; the missing
version field doesn't affect the legacy JS chain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Make LoadConfig real (SSM fetch)

**Why:** Phase 1 LoadConfig was a stub returning hardcoded `model + temperature + maxTokens`. Phase 2 fetches model + temperature from SSM Parameter Store. Result threads through SFN state via `ResultPath: $.config` (already wired in Phase 1.5 Task 8).

**Files:**
- Modify: `infra/sam/reply-agent/functions/load-config/index.js`
- Modify: `infra/sam/reply-agent/functions/load-config/package.json`

- [ ] **Step 1: Modify `infra/sam/reply-agent/functions/load-config/package.json`**

Replace the file with:
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

- [ ] **Step 2: Install the new dep**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent/functions/load-config
npm install
```

- [ ] **Step 3: Replace `index.js` with the real implementation**

Path: `infra/sam/reply-agent/functions/load-config/index.js`

```js
'use strict';

// ---------------------------------------------------------------------------
// load-config — Step 1 of the workflow.
//
// Fetches model + temperature from SSM Parameter Store at workflow start.
// Result threads through SFN state via ResultPath: $.config and is read by
// every chain Lambda via event.config.{model, temperature}.
//
// Contract:
//   Input:  any (passed through from StartExecution input)
//   Output: { model: string, temperature: number, loadedAt: string }
//   Errors: throws if SSM fetch fails or parameters are missing
//
// Parameters expected:
//   /casa-coqui/reply-agent/model        e.g. claude-haiku-4-5-20251001
//   /casa-coqui/reply-agent/temperature  e.g. "1.0"
// ---------------------------------------------------------------------------

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

module.exports.handler = exports.handler;
```

- [ ] **Step 4: Quick smoke test (local require, doesn't actually call SSM)**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent/functions/load-config
node -e "
  const { handler } = require('./index');
  console.log('handler is function:', typeof handler === 'function');
  console.log('handler.length (param count):', handler.length);
"
```
Expected: `handler is function: true`, `handler.length (param count): 1`.

- [ ] **Step 5: Run all SAM tests (existing throttle test should still pass; LoadConfig has no test)**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
npm test 2>&1 | tail -5
```
Expected: 1 passed (the Reasoner throttle-name test from Phase 1.5).

- [ ] **Step 6: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/functions/load-config/
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): make LoadConfig real (SSM fetch)

Replaces Phase 1 stub. Fetches model + temperature from SSM
Parameter Store at workflow start. Throws on missing params.
Result threads through SFN state via ResultPath: \$.config and
is consumed by every chain Lambda.

Parameters expected (created in Task 3):
  /casa-coqui/reply-agent/model
  /casa-coqui/reply-agent/temperature

Adds @aws-sdk/client-ssm to function package.json. NOT deployed yet —
the SSM Parameters don't exist until Task 3's template adds them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add SSM Parameters + AppConfig static resources to template

**Why:** Add the SSM Parameters that LoadConfig will read, plus the AppConfig resources that DON'T involve content yet (Application, Environment, ConfigurationProfiles with validator schema, DeploymentStrategy). HostedConfigurationVersions and Deployments come in Task 7 (the W7 trap commit).

**Files:**
- Modify: `infra/sam/reply-agent/template.yaml`

- [ ] **Step 1: Open `infra/sam/reply-agent/template.yaml` and add the new Parameters**

Find the existing `Parameters:` block. Add these new parameters at the end of the block (before the `Globals:` block):

```yaml
  AppConfigExtensionLayerArn:
    Type: AWS::SSM::Parameter::Value<String>
    Default: /aws/service/appconfig/extension/arm64/2.0.183
    Description: |
      AWS-published AppConfig Extension Lambda Layer ARN, resolved at deploy
      time from SSM public parameters. Pinned to a known-good version.
      Update by changing the path version suffix (e.g. /2.0.184).
      ARN list: https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions.html

  ModelDefault:
    Type: String
    Default: claude-haiku-4-5-20251001
    Description: Initial value for /casa-coqui/reply-agent/model SSM parameter

  TemperatureDefault:
    Type: String
    Default: "1.0"
    Description: Initial value for /casa-coqui/reply-agent/temperature SSM parameter
```

- [ ] **Step 2: Add SSM Parameters as resources**

In the `Resources:` block, add after the existing Lambda functions but before the SFN state machines:

```yaml
  # -------------------------------------------------------------------------
  # SSM Parameters — non-secret hot-tunable model knobs.
  # Read by LoadConfig at workflow start; result threaded through SFN state.
  # -------------------------------------------------------------------------

  ModelParameter:
    Type: AWS::SSM::Parameter
    Properties:
      Name: /casa-coqui/reply-agent/model
      Type: String
      Value: !Ref ModelDefault
      Description: Anthropic model id used by the reply agent chain Lambdas

  TemperatureParameter:
    Type: AWS::SSM::Parameter
    Properties:
      Name: /casa-coqui/reply-agent/temperature
      Type: String
      Value: !Ref TemperatureDefault
      Description: Sampling temperature for Anthropic calls (parsed as float)
```

- [ ] **Step 3: Grant LoadConfig IAM permission to read the SSM parameters**

Find the existing `LoadConfigFunction` resource in the template. It currently has a Policies block with secretsmanager perms. ADD a new statement (don't replace existing):

```yaml
  LoadConfigFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: casa-coqui-reply-load-config
      CodeUri: functions/load-config/
      Handler: index.handler
      Description: Fetches model + temperature from SSM at workflow start
      Policies:
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: ssm:GetParameters
              Resource:
                - !Sub arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/casa-coqui/reply-agent/*
```

(If the existing template has a different Policies structure for LoadConfig, REPLACE it with the above. Phase 1 LoadConfig had a secretsmanager policy that's no longer relevant since LoadConfig only reads SSM now.)

- [ ] **Step 4: Add AppConfig Application + Environment + DeploymentStrategy + 2 ConfigurationProfiles (with validator) — but NO HCVs/Deployments**

In the `Resources:` block, add after the SSM Parameter resources:

```yaml
  # -------------------------------------------------------------------------
  # AppConfig — static resources (no HostedConfigurationVersions yet).
  # HCVs + Deployments land in Task 7 (Commit A) with deliberately broken
  # seed content to trigger the W7 validator trap. Task 8 (Commit B) fixes
  # the seed.
  # -------------------------------------------------------------------------

  ReplyAgentApplication:
    Type: AWS::AppConfig::Application
    Properties:
      Name: casa-coqui-reply-agent
      Description: Casa Coqui Airbnb reply-agent configuration

  ReplyAgentProdEnvironment:
    Type: AWS::AppConfig::Environment
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      Name: prod
      Description: Production environment

  SystemPromptProfile:
    Type: AWS::AppConfig::ConfigurationProfile
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      Name: system-prompt
      Description: |
        Host voice prompt + voice rules. Validated against a JSON Schema
        that requires version, language_distribution, hard_bans, system_prompt_text.
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

  FeatureFlagsProfile:
    Type: AWS::AppConfig::ConfigurationProfile
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      Name: feature-flags
      Description: |
        Feature flags for the reply agent. Phase 2 ships flag reply_engine
        with no consumer; Phase 3 wires the Cloud Function to read it.
      Type: AWS.AppConfig.FeatureFlags
      LocationUri: hosted

  LinearDeploymentStrategy:
    Type: AWS::AppConfig::DeploymentStrategy
    Properties:
      Name: casa-coqui-linear-10pct
      Description: |
        Linear rollout, 10% step every 1 minute, 5 minute bake at 100%.
        Pedagogical (Plan §4.2). At our 10 msg/day volume, the bake
        window observes zero traffic — the strategy is the lesson, not
        the optimization.
      DeploymentDurationInMinutes: 10
      FinalBakeTimeInMinutes: 5
      GrowthFactor: 10.0
      GrowthType: LINEAR
      ReplicateTo: NONE
```

- [ ] **Step 5: Validate the template syntax**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam validate 2>&1
```
Expected: `<path>/template.yaml is a valid SAM Template`. If it fails, fix the YAML before continuing.

- [ ] **Step 6: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/template.yaml
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): add SSM Parameters + AppConfig static resources

Adds:
- 3 new template Parameters (Extension layer ARN via SSM public param,
  Model + Temperature defaults)
- 2 SSM Parameters (model + temperature)
- LoadConfig IAM grant for ssm:GetParameters scoped to /casa-coqui/reply-agent/*
- AppConfig Application + Environment + 2 ConfigurationProfiles
- JSON Schema validator on system-prompt profile (required: version,
  language_distribution, hard_bans, system_prompt_text)
- Linear DeploymentStrategy (10%/min, 5min bake) per plan §4.2

NOT included yet:
- HostedConfigurationVersions and Deployments (Task 7 / Commit A
  with deliberately broken seed for the W7 validator trap)
- Lambda Extension layer attachment (Task 4)
- Drafter/Reviser AppConfig fetch code (Task 5)
- Reasoner/Evaluator model knob lookup (Task 6)

NOT deployed yet — waiting until Task 7's full Commit A.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add Lambda Extension layer + IAM grants for Drafter+Reviser

**Why:** The AppConfig Lambda Extension is what makes "fetch config from AppConfig" cheap (HTTP localhost:2772 instead of SDK call). Drafter+Reviser need it attached. Plus IAM perms to call AppConfig directly (for the Extension to make the underlying API calls).

**Files:**
- Modify: `infra/sam/reply-agent/template.yaml`

- [ ] **Step 1: Add Extension layer + AppConfig IAM grants to Drafter**

Find the existing `DrafterFunction` resource. ADD `Layers` and EXTEND `Policies`:

```yaml
  DrafterFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: casa-coqui-reply-drafter
      CodeUri: functions/drafter/
      Handler: index.handler
      Description: Step 2 of AI chain — drafts the actual reply
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

(Globals already provide MODEL_NAME etc. The `Environment.Variables` block here ADDS to globals.)

- [ ] **Step 2: Apply the same changes to Reviser**

Find the existing `ReviserFunction` resource. Apply the SAME `Layers`, `Environment.Variables`, and Policies additions:

```yaml
  ReviserFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: casa-coqui-reply-reviser
      CodeUri: functions/reviser/
      Handler: index.handler
      Description: Step 4 of AI chain — rewrites draft if Evaluator failed it
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

- [ ] **Step 3: Validate the template**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam validate
```
Expected: valid template.

- [ ] **Step 4: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/template.yaml
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): attach AppConfig Lambda Extension to Drafter+Reviser

Adds:
- AWS-AppConfig-Extension Layer (resolved via SSM public param) attached
  to Drafter + Reviser only
- Per-function env vars: APPCONFIG_APPLICATION, APPCONFIG_ENVIRONMENT,
  APPCONFIG_PROFILE, and AWS_APPCONFIG_EXTENSION_PRELOAD_LIST (so the
  Extension fetches at Lambda init, not first request — saves 150-300ms
  off cold-start latency)
- IAM grants: appconfig:StartConfigurationSession + GetLatestConfiguration
  scoped via Sub interpolation to the specific config ARN

Reasoner + Evaluator unchanged — they keep inline algorithm prompts and
don't need AppConfig.

NOT deployed yet — waiting for Task 7 Commit A.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Modify Drafter + Reviser to fetch AppConfig + capture version

**Why:** Drafter+Reviser stop reading `voicePrompt` from SFN input. They fetch `system_prompt_text` from AppConfig via the Extension's localhost:2772 endpoint, and capture the `Configuration-Version` response header so we have a forensic trail (which prompt version produced this draft).

**Files:**
- Modify: `infra/sam/reply-agent/functions/drafter/index.js`
- Modify: `infra/sam/reply-agent/functions/reviser/index.js`

- [ ] **Step 1: Modify `infra/sam/reply-agent/functions/drafter/index.js`**

Open the file. The wrapper section (`THROTTLE_ERROR_NAME` through `throw lastErr;`) MUST stay byte-identical to Reasoner. The cached-client section must also stay byte-identical.

The CHANGES are:
1. Add a new module-level `fetchSystemPromptConfig()` function below the cached-client section
2. Modify `exports.handler` to use AppConfig instead of `event.voicePrompt`
3. Extend the return value with `appConfigVersion`

After the `getAnthropicClient()` function block (which ends with `return _anthropicClient;\n}`), ADD a new section:

```js
// --- AppConfig fetch (via Lambda Extension at localhost:2772) -------------
// Module-cached. AWS_APPCONFIG_EXTENSION_PRELOAD_LIST env var ensures the
// Extension fetches at Lambda init, so the first invocation already has
// the config in cache.
//
// Returns: { systemPromptText, appConfigVersion }
//   appConfigVersion is the Configuration-Version response header value,
//   threaded through the SFN result for forensic tracing.

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

Then REPLACE the entire `exports.handler` function with:

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

module.exports = { handler: exports.handler, callWithBackoff, fetchSystemPromptConfig };
```

Note: `voicePrompt` is no longer read from input. The handler validation no longer checks for it. Replaced with `systemPromptText` from AppConfig.

- [ ] **Step 2: Apply the SAME changes to `infra/sam/reply-agent/functions/reviser/index.js`**

Reviser's structure mirrors Drafter. Apply the same:

1. Add `fetchSystemPromptConfig()` after `getAnthropicClient()` (byte-identical to Drafter's version — copy verbatim)
2. Replace `exports.handler` with this version (note: Reviser reads `evaluator.evaluation` and the prior `drafter.draft` for the revise input):

```js
exports.handler = async (event) => {
  const refId = event?.message?.id || null;
  const originalDraft = event?.drafter?.draft;
  const evaluation = event?.evaluator?.evaluation;
  const contextJson = event?.contextJson;
  const voiceProfilePrompt = event?.voiceProfilePrompt || '';
  const strategy = event?.reasoner?.strategy;
  const modelFromConfig = event?.config?.model || process.env.MODEL_NAME;

  if (!originalDraft) throw new Error('reviser: missing drafter.draft in input');
  if (!evaluation) throw new Error('reviser: missing evaluator.evaluation in input');
  if (!contextJson) throw new Error('reviser: missing contextJson in input');
  if (!strategy) throw new Error('reviser: missing reasoner.strategy in input');
  if (!modelFromConfig) throw new Error('reviser: model not available (event.config.model and MODEL_NAME both missing)');

  const [client, { systemPromptText, appConfigVersion }] = await Promise.all([
    getAnthropicClient(),
    fetchSystemPromptConfig(),
  ]);

  const reviseInput = `ORIGINAL DRAFT: ${originalDraft.reply}\n\nEVALUATOR FEEDBACK:\n- Voice score: ${evaluation.voiceScore}/10\n- Voice feedback: ${evaluation.voiceFeedback}\n- Hard rule failures: ${(evaluation.hardRuleFailures || []).join(', ') || 'none'}\n- RAG consistent: ${evaluation.ragConsistent}\n- RAG feedback: ${evaluation.ragFeedback}\n\nSTRATEGY:\n${JSON.stringify(strategy, null, 2)}\n\nCONTEXT:\n${contextJson}\n\nRewrite the reply addressing ALL the feedback above.`;

  const response = await callWithBackoff(client, {
    model: modelFromConfig,
    max_tokens: 512,
    system: buildDrafterPrompt(systemPromptText, voiceProfilePrompt),
    tools: [DRAFTER_TOOL],
    tool_choice: { type: 'tool', name: 'guest_reply' },
    messages: [{ role: 'user', content: reviseInput }],
  }, { label: 'reviser', refId });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('reviser: no tool_use block in response');

  return {
    draft: block.input,
    tokens: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    },
    appConfigVersion,
  };
};

module.exports = { handler: exports.handler, callWithBackoff, fetchSystemPromptConfig };
```

- [ ] **Step 3: Verify wrapper byte-identity is preserved**

```bash
cd /Users/jperez/dev/casa-coqui
diff <(awk '/^const THROTTLE_ERROR_NAME/,/^throw lastErr;$/' infra/sam/reply-agent/functions/reasoner/index.js) \
     <(awk '/^const THROTTLE_ERROR_NAME/,/^throw lastErr;$/' infra/sam/reply-agent/functions/drafter/index.js)
diff <(awk '/^const THROTTLE_ERROR_NAME/,/^throw lastErr;$/' infra/sam/reply-agent/functions/reasoner/index.js) \
     <(awk '/^const THROTTLE_ERROR_NAME/,/^throw lastErr;$/' infra/sam/reply-agent/functions/reviser/index.js)
```
Expected: both diffs empty. (We didn't touch the wrapper section.)

- [ ] **Step 4: Verify cached-client byte-identity**

```bash
cd /Users/jperez/dev/casa-coqui
diff <(awk '/^const sm = new SecretsManagerClient/,/^  return _anthropicClient;\n}$/' infra/sam/reply-agent/functions/reasoner/index.js) \
     <(awk '/^const sm = new SecretsManagerClient/,/^  return _anthropicClient;\n}$/' infra/sam/reply-agent/functions/drafter/index.js)
```
Expected: empty.

- [ ] **Step 5: Run tests (existing throttle test still passes; new code paths aren't tested locally — they need real AppConfig)**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
npm test
```
Expected: 1 passing test.

- [ ] **Step 6: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/functions/drafter/index.js infra/sam/reply-agent/functions/reviser/index.js
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): Drafter+Reviser fetch system prompt from AppConfig

Replaces event.voicePrompt with AppConfig fetch via Lambda Extension at
http://localhost:2772/.../configurations/system-prompt. Module-cached
fetch + AWS_APPCONFIG_EXTENSION_PRELOAD_LIST means cold-start cost is
paid at Lambda init, not first request.

Captures Configuration-Version response header → appConfigVersion in
return value. Propagates through ASL ResultSelector (Task 6) so future
WriteBack (Phase 3) can persist _agentRun.appConfigVersion for
forensic tracing.

Wrapper + cached-client sections remain byte-identical to Reasoner
(verified by diff). MODEL_NAME guard now reads event.config.model with
env-var fallback.

NOT deployed yet — waiting for Task 7 Commit A. Lambdas will fail at
runtime if invoked before AppConfig HCV exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Reasoner+Evaluator minor model lookup + ASL ResultSelector update

**Why:** Reasoner and Evaluator don't need AppConfig integration, but they should prefer `event.config.model` (now coming from real LoadConfig) over the env var. Plus the ASL needs to capture `appConfigVersion` from Drafter and Reviser results.

**Files:**
- Modify: `infra/sam/reply-agent/functions/reasoner/index.js`
- Modify: `infra/sam/reply-agent/functions/evaluator/index.js`
- Modify: `infra/sam/reply-agent/statemachines/ai-chain.asl.json`

- [ ] **Step 1: Modify Reasoner handler — prefer event.config.model**

Open `infra/sam/reply-agent/functions/reasoner/index.js`. Find the `exports.handler = async (event) => {` block. Find the line:
```js
  if (!process.env.MODEL_NAME) throw new Error('reasoner: MODEL_NAME env var not set');
```

REPLACE it with:
```js
  const modelFromConfig = event?.config?.model || process.env.MODEL_NAME;
  if (!modelFromConfig) throw new Error('reasoner: model not available (event.config.model and MODEL_NAME both missing)');
```

Then find the `model: process.env.MODEL_NAME,` line in the `callWithBackoff` call and replace it with:
```js
    model: modelFromConfig,
```

- [ ] **Step 2: Apply identical changes to Evaluator**

Open `infra/sam/reply-agent/functions/evaluator/index.js`. Apply the same two changes:
1. Replace the `MODEL_NAME env var not set` throw with the modelFromConfig version (s/reasoner/evaluator/)
2. Replace `model: process.env.MODEL_NAME` in callWithBackoff with `model: modelFromConfig`

- [ ] **Step 3: Modify `infra/sam/reply-agent/statemachines/ai-chain.asl.json` — capture appConfigVersion from Drafter and Reviser**

Find the Drafter state. Its `ResultSelector` currently looks like:
```json
"ResultSelector": {
  "draft.$": "$.Payload.draft",
  "tokens.$": "$.Payload.tokens"
},
```

REPLACE with:
```json
"ResultSelector": {
  "draft.$": "$.Payload.draft",
  "tokens.$": "$.Payload.tokens",
  "appConfigVersion.$": "$.Payload.appConfigVersion"
},
```

Find the Reviser state and apply the same change to its ResultSelector.

(Reasoner and Evaluator ResultSelectors stay unchanged — they don't return appConfigVersion.)

- [ ] **Step 4: Verify the ASL JSON is still valid**

```bash
cd /Users/jperez/dev/casa-coqui
jq . infra/sam/reply-agent/statemachines/ai-chain.asl.json > /dev/null && echo "Valid JSON" || echo "INVALID"
```
Expected: `Valid JSON`.

- [ ] **Step 5: Validate the full SAM template (reads ai-chain.asl.json)**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam validate
```
Expected: valid template.

- [ ] **Step 6: Run tests**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
npm test
```
Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/functions/reasoner/index.js infra/sam/reply-agent/functions/evaluator/index.js infra/sam/reply-agent/statemachines/ai-chain.asl.json
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): Reasoner+Evaluator prefer event.config.model + ASL captures appConfigVersion

Minor changes:
- Reasoner + Evaluator now prefer event.config.model (set by real
  LoadConfig from SSM) over process.env.MODEL_NAME. Env var stays as
  fallback for direct Lambda invocations.
- ai-chain.asl.json Drafter + Reviser ResultSelectors extended to
  capture Payload.appConfigVersion. Propagates through chain output
  for forensic tracing once Phase 3 WriteBack persists it.

Reasoner + Evaluator do NOT use AppConfig — they keep their inline
algorithm prompts (REASONER_PROMPT, EVALUATOR_PROMPT) which are
algorithm contracts, not config.

NOT deployed yet — waiting for Task 7 Commit A.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: COMMIT A — Add HostedConfigurationVersions + Deployments (BROKEN seed) → DEPLOY → expect FAILURE

**Why:** This is the W7 break-it trap. Add the HCV + Deployment resources to the template. The seed JSON file (created in Task 1) deliberately lacks the `version` field. AppConfig validator rejects on `CreateHostedConfigurationVersion` API call. CFN rolls back the entire stack update.

**Files:**
- Modify: `infra/sam/reply-agent/template.yaml`

- [ ] **Step 1: Add HCV + Deployment resources to the template**

In `infra/sam/reply-agent/template.yaml`, in the `Resources:` block, add after the `LinearDeploymentStrategy` resource:

```yaml
  # -------------------------------------------------------------------------
  # AppConfig content + Deployments — THE W7 TRAP
  #
  # The system-prompt seed is read from infra/sam/reply-agent/config/system-prompt.seed.json.
  # That file deliberately LACKS the 'version' field — see Task 1 commit.
  # Validator on SystemPromptProfile (Task 3) rejects → CFN rolls back the
  # entire stack update on first deploy.
  #
  # Task 8 (Commit B) adds the version field and re-deploys.
  # -------------------------------------------------------------------------

  SystemPromptVersion:
    Type: AWS::AppConfig::HostedConfigurationVersion
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      ConfigurationProfileId: !Ref SystemPromptProfile
      ContentType: application/json
      Description: Initial host voice config seed (Phase 2)
      Content:
        Fn::Transform:
          Name: AWS::Include
          Parameters:
            Location: config/system-prompt.seed.json

  FeatureFlagsVersion:
    Type: AWS::AppConfig::HostedConfigurationVersion
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      ConfigurationProfileId: !Ref FeatureFlagsProfile
      ContentType: application/json
      Description: Initial feature flag content (Phase 2 — flag has no consumer until Phase 3)
      Content:
        Fn::Transform:
          Name: AWS::Include
          Parameters:
            Location: config/feature-flags.seed.json

  SystemPromptDeployment:
    Type: AWS::AppConfig::Deployment
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      EnvironmentId: !Ref ReplyAgentProdEnvironment
      ConfigurationProfileId: !Ref SystemPromptProfile
      ConfigurationVersion: !Ref SystemPromptVersion
      DeploymentStrategyId: !Ref LinearDeploymentStrategy
      Description: Initial deployment of host voice config

  FeatureFlagsDeployment:
    Type: AWS::AppConfig::Deployment
    Properties:
      ApplicationId: !Ref ReplyAgentApplication
      EnvironmentId: !Ref ReplyAgentProdEnvironment
      ConfigurationProfileId: !Ref FeatureFlagsProfile
      ConfigurationVersion: !Ref FeatureFlagsVersion
      DeploymentStrategyId: !Ref LinearDeploymentStrategy
      Description: Initial deployment of feature flags
```

**NOTE on `Fn::Transform: AWS::Include`**: This is a CFN macro that reads an external file at deploy time and inlines its content. It requires the file to be present in the SAM build context. SAM `sam build` packages the `config/` directory as part of the template upload to S3, then the `AWS::Include` transform resolves at change-set creation time. If `Fn::Transform: AWS::Include` doesn't work for HCV Content (it expects inline strings), an alternative is to use `Fn::Sub` with a literal embedded content. **Test approach below.**

Alternative if `AWS::Include` doesn't work: replace `Content:` with the inline content using `!Sub`:

```yaml
      Content: |
        {
          "language_distribution": { "en": 0.86, "es": 0.13 },
          "hard_bans": [...],
          "system_prompt_text": "..."
        }
```

This is much harder to maintain (the SYSTEM_PROMPT is 9.4KB embedded inline). Try `AWS::Include` first.

- [ ] **Step 2: Validate template**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam validate
```
Expected: valid. If `AWS::Include` causes validation issues, fall back to inline content.

- [ ] **Step 3: Run `sam build` (this will resolve AWS::Include or copy config/ to build artifacts)**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam build 2>&1 | tail -10
```
Expected: `Build Succeeded`. Build will copy `config/` directory.

- [ ] **Step 4: Deploy — EXPECT FAILURE**

This is the moment. Run:
```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam deploy --no-confirm-changeset 2>&1 | tee /tmp/deploy-broken.txt
```

Expected outcomes (one of):
- **Best case (the W7 lesson)**: CFN starts UPDATE_IN_PROGRESS, creates several resources, then `AWS::AppConfig::HostedConfigurationVersion SystemPromptVersion` fails with a validator error mentioning the missing `version` field. Stack enters UPDATE_ROLLBACK_IN_PROGRESS, then UPDATE_ROLLBACK_COMPLETE. SAM CLI exits non-zero.
- **Possible alternate**: deploy succeeds (validator wasn't triggered as expected). This would invalidate the W7 lesson — investigate why.

If deploy succeeded unexpectedly: stop and investigate. The validator schema syntax might be wrong, or AppConfig may not validate at create time as expected. Don't proceed to Task 8 — fix the schema first.

If deploy failed (expected): proceed to Step 5.

- [ ] **Step 5: Read the CFN events to confirm the failure mode**

```bash
aws cloudformation describe-stack-events --stack-name casa-coqui-reply-agent \
  --max-items 30 \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].{Time:Timestamp,Resource:LogicalResourceId,Status:ResourceStatus,Reason:ResourceStatusReason}' \
  --output table
```

Expected: A row showing `SystemPromptVersion` failed with a reason mentioning JSON Schema validation, missing `version` property, or similar. SCREENSHOT this output and add the reason text to the commit message body for posterity.

- [ ] **Step 6: Verify Phase 1.5 chain Lambdas are still intact**

```bash
aws cloudformation describe-stacks --stack-name casa-coqui-reply-agent \
  --query 'Stacks[0].StackStatus' --output text
```
Expected: `UPDATE_ROLLBACK_COMPLETE` (not `ROLLBACK_FAILED`). This means CFN successfully rolled back to the Phase 1.5 state.

```bash
for FN in casa-coqui-reply-reasoner casa-coqui-reply-drafter casa-coqui-reply-evaluator casa-coqui-reply-reviser; do
  echo -n "$FN: "
  aws lambda get-function --function-name "$FN" --query 'Configuration.LastModified' --output text
done
```
Expected: timestamps are unchanged from the last Phase 1.5 deploy (the chain Lambda updates rolled back).

- [ ] **Step 7: Commit (the broken state, intentional)**

This commit documents the failed deploy. The repo state is "broken seed + all Phase 2 changes staged" — a snapshot of what was attempted. Commit B (Task 8) fixes it.

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/template.yaml
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): COMMIT A — add HostedConfigVersion + Deployment resources

W7 validator trap activated. Adds:
- AWS::AppConfig::HostedConfigurationVersion x 2 (system-prompt + feature-flags)
- AWS::AppConfig::Deployment x 2

Deploy attempt FAILED as designed — system-prompt seed
(infra/sam/reply-agent/config/system-prompt.seed.json) lacks the
'version' field required by the validator schema. CFN rolled back
the entire stack update; Phase 1.5 chain Lambdas remain at
UPDATE_COMPLETE state.

CFN failure event recorded:
  Resource: SystemPromptVersion
  Status:   CREATE_FAILED
  Reason:   <paste the actual error reason from describe-stack-events>

Lesson banked: AppConfig JSON Schema validators run at
CreateHostedConfigurationVersion API time. CFN's HCV resource creation
calls that API directly, so validator failures fail the resource. CFN
treats the stack as a unit and rolls back.

Next commit (Task 8) fixes the seed and re-deploys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace `<paste the actual error reason from describe-stack-events>` with the real reason text from Step 5.)

---

## Task 8: COMMIT B — Fix seed (add `version`) → DEPLOY → expect SUCCESS

**Why:** The fix that completes the W7 lesson. Add `"version": "1.0.0"` to the seed JSON. Re-deploy. Validator accepts. Linear rollout begins.

**Files:**
- Modify: `infra/sam/reply-agent/config/system-prompt.seed.json`

- [ ] **Step 1: Add `version` field to the seed**

```bash
cd /Users/jperez/dev/casa-coqui
node -e "
  const fs = require('fs');
  const path = 'infra/sam/reply-agent/config/system-prompt.seed.json';
  const seed = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const fixed = { version: '1.0.0', ...seed };
  fs.writeFileSync(path, JSON.stringify(fixed, null, 2));
  console.log('Added version. Keys:', Object.keys(fixed).join(', '));
"
```

Verify:
```bash
jq 'keys' infra/sam/reply-agent/config/system-prompt.seed.json
```
Expected: `["hard_bans", "language_distribution", "system_prompt_text", "version"]`.

- [ ] **Step 2: Sanity-check that reply-ai.js still works (it should — we didn't touch system_prompt_text)**

```bash
cd /Users/jperez/dev/casa-coqui
node -e "
  const { SYSTEM_PROMPT } = require('./functions/lib/reply-ai');
  console.log('SYSTEM_PROMPT length:', SYSTEM_PROMPT.length);
"
```
Expected: same length as before (~9400 chars).

- [ ] **Step 3: Build + deploy — expect SUCCESS this time**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam build 2>&1 | tail -5
sam deploy --no-confirm-changeset 2>&1 | tee /tmp/deploy-fixed.txt | tail -40
```

Expected: `Successfully created/updated stack - casa-coqui-reply-agent`. ~3-5 min for stack update; AppConfig deployments continue rolling out asynchronously after CFN reports complete.

- [ ] **Step 4: Verify stack status**

```bash
aws cloudformation describe-stacks --stack-name casa-coqui-reply-agent \
  --query 'Stacks[0].StackStatus' --output text
```
Expected: `UPDATE_COMPLETE`.

- [ ] **Step 5: Watch the AppConfig deployments roll out**

```bash
APP_ID=$(aws appconfig list-applications --query "Items[?Name=='casa-coqui-reply-agent'].Id" --output text)
ENV_ID=$(aws appconfig list-environments --application-id "$APP_ID" --query "Items[?Name=='prod'].Id" --output text)
echo "Application: $APP_ID  Environment: $ENV_ID"

# Watch deployments — expect 2 in progress, becoming COMPLETE
aws appconfig list-deployments --application-id "$APP_ID" --environment-id "$ENV_ID" \
  --query 'Items[].{State:State,ConfigVersion:ConfigurationVersion,Profile:ConfigurationProfileId,Pct:PercentageComplete}' \
  --output table
```

Expected: 2 deployments. Will progress through `DEPLOYING` → `BAKING` → `COMPLETE` over ~10-15 minutes (10 min linear + 5 min bake).

- [ ] **Step 6: Verify Lambda code freshness (Drafter+Reviser updates landed)**

```bash
for FN in casa-coqui-reply-drafter casa-coqui-reply-reviser casa-coqui-reply-load-config casa-coqui-reply-reasoner casa-coqui-reply-evaluator; do
  echo -n "$FN: "
  aws lambda get-function --function-name "$FN" \
    --query 'Configuration.LastModified' --output text
done
```
Expected: All timestamps within the last few minutes.

Verify Drafter has the Extension layer attached:
```bash
aws lambda get-function-configuration --function-name casa-coqui-reply-drafter \
  --query 'Layers' --output json
```
Expected: shows the AWS-AppConfig-Extension-Arm64 layer ARN.

- [ ] **Step 7: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/config/system-prompt.seed.json
git commit -m "$(cat <<'EOF'
fix(sam/reply-agent): COMMIT B — add version field to system-prompt seed

W7 trap fix. The validator on the system-prompt ConfigurationProfile
required four fields (version, language_distribution, hard_bans,
system_prompt_text). Commit A's seed had three of them; CFN rolled
back the stack update on HCV creation.

Adding version: "1.0.0" satisfies the validator. sam deploy succeeds.
AppConfig deployments begin Linear 10%/min/5min-bake rollout
(~15 min total to COMPLETE state — observable in
\`aws appconfig list-deployments\`).

Phase 2 W7 lesson banked:
  - Validators run at CreateHostedConfigurationVersion (deploy-time, not
    deployment-time)
  - CFN failure on a leaf resource cascades to a full stack rollback
  - Recovery is just "fix the input and re-deploy" — no manual stack
    state cleanup required

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Add post-deploy smoke check + run end-to-end verification

**Why:** Catch the schema-syntax-typo edge case (where validator JSON itself is malformed and validates nothing). Verify the SFN actually works end-to-end with the new AppConfig path.

**Files:**
- Create: `infra/sam/reply-agent/scripts/verify-appconfig.sh`

- [ ] **Step 1: Create the smoke check script**

Path: `infra/sam/reply-agent/scripts/verify-appconfig.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# verify-appconfig.sh — post-deploy smoke check.
#
# Catches the schema-syntax-typo edge case: if the validator JSON itself
# is malformed, AppConfig may accept it without validating anything,
# letting a bad seed land in the profile. This script fetches the
# deployed config and asserts the required fields are present.
# ---------------------------------------------------------------------------

APP_NAME="casa-coqui-reply-agent"
ENV_NAME="prod"
PROFILE_NAME="system-prompt"

APP_ID=$(aws appconfig list-applications --query "Items[?Name=='$APP_NAME'].Id" --output text)
[ -z "$APP_ID" ] && { echo "ERROR: AppConfig Application '$APP_NAME' not found"; exit 1; }

ENV_ID=$(aws appconfig list-environments --application-id "$APP_ID" --query "Items[?Name=='$ENV_NAME'].Id" --output text)
[ -z "$ENV_ID" ] && { echo "ERROR: AppConfig Environment '$ENV_NAME' not found"; exit 1; }

PROFILE_ID=$(aws appconfig list-configuration-profiles --application-id "$APP_ID" --query "Items[?Name=='$PROFILE_NAME'].Id" --output text)
[ -z "$PROFILE_ID" ] && { echo "ERROR: AppConfig ConfigurationProfile '$PROFILE_NAME' not found"; exit 1; }

# Fetch latest config (legacy GetConfiguration API for simplicity)
CONTENT=$(aws appconfig get-configuration \
  --application "$APP_NAME" \
  --environment "$ENV_NAME" \
  --configuration "$PROFILE_NAME" \
  --client-id "verify-appconfig-smoke-test" \
  /tmp/appconfig-content.bin >/dev/null 2>&1 && cat /tmp/appconfig-content.bin)

if [ -z "$CONTENT" ]; then
  echo "ERROR: failed to fetch deployed config"
  exit 1
fi

# Assert required fields present
for FIELD in version language_distribution hard_bans system_prompt_text; do
  VAL=$(echo "$CONTENT" | jq -r ".$FIELD // \"MISSING\"")
  if [ "$VAL" = "MISSING" ] || [ -z "$VAL" ] || [ "$VAL" = "null" ]; then
    echo "❌ FAIL: required field '$FIELD' is missing or empty in deployed config"
    exit 1
  fi
  echo "✅ Field present: $FIELD"
done

VERSION=$(echo "$CONTENT" | jq -r '.version')
echo
echo "✅ All required fields present. Deployed system-prompt version: $VERSION"
```

- [ ] **Step 2: Make executable and run**

```bash
cd /Users/jperez/dev/casa-coqui
chmod +x infra/sam/reply-agent/scripts/verify-appconfig.sh
./infra/sam/reply-agent/scripts/verify-appconfig.sh
```

Expected: 4 ✅ lines (one per required field) followed by "All required fields present. Deployed system-prompt version: 1.0.0".

If any field is missing or `null`, the validator schema is malformed — fix template.yaml `Validators.Content` and re-deploy.

- [ ] **Step 3: Run end-to-end SFN test (Phase 1.5 script)**

```bash
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
./scripts/test-sfn.sh 2>&1 | tee /tmp/phase2-e2e.txt
```

Expected:
- Status: `SUCCEEDED`
- Total time < 30s
- Output JSON contains `chainResult.output.drafter.appConfigVersion` (the new field) — should be a non-empty string like `"1"`
- Real reply text in `chainResult.output.drafter.draft.reply` (or in the final draft if Reviser ran)

- [ ] **Step 4: Confirm `appConfigVersion` plumbing works**

```bash
EXEC_ARN=$(aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft \
  --max-results 1 --query 'executions[0].executionArn' --output text)

aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" \
  --query 'output' --output text | jq '.chainResult.output.drafter | {appConfigVersion, tokens}'
```
Expected: `appConfigVersion` field present and non-empty.

- [ ] **Step 5: Confirm Extension preload works (CloudWatch logs show one fetch per cold start, not per invocation)**

```bash
aws logs tail /aws/lambda/casa-coqui-reply-drafter --since 10m --filter-pattern "AppConfig" 2>&1 | head -20
```
Expected: log lines mentioning AppConfig Extension initialization. Frequency should be one per cold container, not per invocation.

- [ ] **Step 6: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add infra/sam/reply-agent/scripts/verify-appconfig.sh
git commit -m "$(cat <<'EOF'
feat(sam/reply-agent): add verify-appconfig.sh post-deploy smoke check

Catches the schema-syntax-typo edge case: if the validator JSON itself
is malformed, AppConfig may accept it silently, letting a bad seed
land. This script fetches the deployed config and asserts version,
language_distribution, hard_bans, and system_prompt_text are all
present.

Run after sam deploy:
  ./infra/sam/reply-agent/scripts/verify-appconfig.sh

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update hand-off doc

**Why:** Future-you (or another session) needs to know Phase 2 is done.

**Files:**
- Modify: `explantion/hand-off.md`

- [ ] **Step 1: Replace the Phase 2 pending section with completion status**

Open `explantion/hand-off.md`. Find the section heading `### Phase 2 — AppConfig + prompt config + validators`. Replace that section (and its body bullets) with:

```markdown
### ~~Phase 2 — AppConfig + prompt config + validators~~ ✅ DONE 2026-05-07

The host voice prompt now lives in AWS AppConfig (Linear 10%/min/5min-bake rollout). Model knobs live in SSM Parameter Store. LoadConfig fetches them at workflow start. Drafter + Reviser fetch system_prompt_text from AppConfig via the Lambda Extension (localhost:2772) and capture the Configuration-Version response header → propagated through SFN result as `appConfigVersion` for forensic tracing.

W7 break-it trap fired and resolved as designed: Commit A shipped seed JSON missing `version` field → CFN rolled back stack update on `CreateHostedConfigurationVersion` validator failure → Commit B added version field → deploy succeeded.

Single source of truth: `infra/sam/reply-agent/config/system-prompt.seed.json` is read by both `functions/lib/reply-ai.js` (legacy JS chain) and the SAM HostedConfigurationVersion. No drift window.

Spec: `docs/superpowers/specs/2026-05-07-phase2-appconfig-design.md`
Plan: `docs/superpowers/plans/2026-05-07-phase2-appconfig.md`

**Next**: Phase 3 (bridge from Cloud Function → StartExecution + DLQ + alarms + auto-rollback). The `feature-flags` profile's `reply_engine` flag has no consumer until Phase 3 wires the Cloud Function to read it.
```

Also update the production status table. Find:
```markdown
| **AWS SAM stack `casa-coqui-reply-agent`** | `sam deploy` | ✅ Phase 1.5: 4 chain Lambdas with real Anthropic logic; LoadConfig/RAGRetrieve/WriteBack still stubs |
```

Replace with:
```markdown
| **AWS SAM stack `casa-coqui-reply-agent`** | `sam deploy` | ✅ Phase 2: AppConfig + SSM, real LoadConfig + AppConfig-fetching Drafter/Reviser; RAGRetrieve/WriteBack still stubs |
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jperez/dev/casa-coqui
git add explantion/hand-off.md
git commit -m "$(cat <<'EOF'
docs: mark Phase 2 complete in hand-off

AppConfig + SSM Parameter Store are live. W7 break-it trap fired
and resolved. Drafter+Reviser fetch host voice from AppConfig.
LoadConfig fetches model+temperature from SSM.

Phase 3 (bridge + DLQ + alarms) is next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| 1 | Commit A `sam deploy` FAILS with CFN HCV validator error | Task 7 step 4 + 5 |
| 2 | CFN rolls back to UPDATE_COMPLETE; Phase 1.5 Lambdas intact | Task 7 step 6 |
| 3 | Commit B `sam deploy` succeeds | Task 8 step 3 + 4 |
| 4 | AppConfig deployments visible and progressing through linear rollout | Task 8 step 5 |
| 5 | `verify-appconfig.sh` confirms all 4 required fields present | Task 9 step 2 |
| 6 | `test-sfn.sh` produces real reply with `appConfigVersion` set | Task 9 step 3 + 4 |
| 7 | CloudWatch logs show Extension preload (init-time fetch) | Task 9 step 5 |
| 8 | Hand-off doc updated | Task 10 |
| 9 | `npm test` still passes (1 throttle-name test from Phase 1.5) | Tasks 2, 3, 5, 6 |
| 10 | `functions/lib/reply-ai.js` reads SYSTEM_PROMPT from shared file; existing JS chain behavior unchanged | Task 1 step 4 |

---

## Estimated effort

~2.5 hours total:
- 30 min — Task 1 (SYSTEM_PROMPT extract + reply-ai.js refactor)
- 15 min — Task 2 (LoadConfig real)
- 20 min — Task 3 (SSM + AppConfig static template resources)
- 15 min — Task 4 (Lambda Extension + IAM)
- 20 min — Task 5 (Drafter + Reviser AppConfig fetch)
- 10 min — Task 6 (Reasoner + Evaluator minor + ASL update)
- 20 min — Task 7 Commit A (template + sam deploy failure + CFN events review)
- 15 min — Task 8 Commit B (seed fix + sam deploy success + watch rollout)
- 15 min — Task 9 (smoke check + e2e test)
- 10 min — Task 10 (hand-off update)
- buffer for first-deploy debugging (especially Task 7 since the failure mode is intentional but the EXACT error from CFN may vary)

---

## Self-review notes

**Spec coverage:**
- Decision 1 (same stack): Tasks 3, 4, 7 add resources to existing template ✓
- Decision 2 (LoadConfig SSM): Task 2 ✓
- Decision 3 (Drafter+Reviser only): Tasks 4, 5 ✓
- Decision 4 (single source of truth seed file): Task 1 ✓
- Decision 5 (AppConfig version stamping): Task 5 (return value), Task 6 (ASL ResultSelector) ✓
- Decision 6 (Extension ARN via SSM public param): Task 3 (Parameters block) ✓
- Decision 7 (Linear 10%/1min/5min-bake): Task 3 (LinearDeploymentStrategy resource) ✓
- Decision 8 (Two-commit break-it): Tasks 7 + 8 ✓
- Decision 9 (feature-flags ships without consumer): Task 1 (seed) + Task 7 (deployment) ✓
- Acceptance criterion #6 (CloudWatch logs Extension preload): Task 9 step 5 ✓

**Type consistency:**
- `appConfigVersion` field name used consistently in Tasks 5, 6, 9 ✓
- `systemPromptText` (camelCase) used as variable in Tasks 5, 6 ✓
- AppConfig path interpolation (`!Sub` with `${ReplyAgentApplication}` etc.) consistent across Tasks 3, 4, 7 ✓
- SSM parameter names `/casa-coqui/reply-agent/{model,temperature}` consistent across Tasks 2, 3 ✓

**Placeholders:** None. All code blocks complete. The only `<paste here>` placeholder is in Task 7 step 7's commit message body — that's where the implementer pastes the actual CFN error reason text from Step 5, which we can't predict ahead of time.
