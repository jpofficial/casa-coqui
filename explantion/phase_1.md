# Phase 1 — SAM + Step Functions Spine

**Date**: 2026-05-06
**Status**: Scaffolded locally. Awaiting `sam validate` and `sam deploy --guided`.
**Plan**: [casa-coqui-sfn-refactor-plan.md](../../JulioOS/01%20-%20Projects/AWS%20DevOps%20Professional/casa-coqui-sfn-refactor-plan.md) Phase 1 (~2 hr).

---

## What we built tonight

A new `infra/sam/reply-agent/` directory containing **a SAM application** that defines the AWS-side reply-agent pipeline. Nothing has been deployed yet — only the source files exist locally. Deploying takes one command (`sam deploy --guided`) once we run `sam validate` to confirm the template is well-formed.

### Directory layout (created)

```
infra/sam/reply-agent/
├── template.yaml                      ← THE SAM template (~200 lines)
├── statemachines/
│   ├── reply-draft.asl.json           ← outer Standard SFN orchestration
│   └── ai-chain.asl.json              ← inner Express SFN AI chain
└── functions/
    ├── load-config/index.js           ← stub (returns hardcoded prompts)
    ├── rag-retrieve/index.js          ← stub (returns empty matches)
    ├── reasoner/index.js              ← stub (returns fixed strategy)
    ├── drafter/index.js               ← stub (returns "Hi <name>!" reply)
    ├── evaluator/index.js             ← stub (passed=true → skips Reviser)
    ├── reviser/index.js               ← stub (alt path, won't fire)
    └── write-back/index.js            ← stub (logs what it would write)
```

The Lambda **stubs** are intentional. They produce well-shaped output so the workflow can execute end-to-end after deploy. We'll port the real Anthropic-call logic in a later commit (Phase 1.5) once we've verified the SFN structure works.

---

## What the SAM template does — block by block

### `Transform: AWS::Serverless-2016-10-31`
Tells CloudFormation to expand SAM macros into native CFN before deploying. SAM = "syntactic sugar over CFN for serverless apps." When you write `AWS::Serverless::Function`, CFN sees it as `AWS::Lambda::Function` + `AWS::IAM::Role` + `AWS::Lambda::Permission` etc.

### `Parameters:`
Values you can override at deploy time via `--parameter-overrides`:
- `ModelName` — Anthropic model id, default `claude-haiku-4-5-20251001`
- `AnthropicSecretName` — name of the Secrets Manager secret holding the API key
- `FirebaseSecretName` — name of the Firebase service-account secret
- `LogRetentionDays` — how long to keep CloudWatch logs (default 7)

### `Globals:`
DRY block. Every `AWS::Serverless::Function` we declare automatically gets these settings unless overridden:
- `Runtime: nodejs20.x` — same as the existing Lambda
- `Architectures: [arm64]` — ARM Graviton processors are ~20% cheaper than x86_64 with no code changes for Node
- `Timeout: 30` — fail-fast for hung Anthropic calls
- `MemorySize: 256` — small, cheap; vector search bumps to 512
- `Tracing: Active` — turns on X-Ray distributed tracing (you'll see the whole chain on one trace map)
- `Environment.Variables` — `MODEL_NAME`, `ANTHROPIC_SECRET_NAME`, `POWERTOOLS_*`

### `Resources:` — what CFN creates

**7 Lambda functions** (`AWS::Serverless::Function`):
| Name | Job |
|---|---|
| `LoadConfigFunction` | Read prompts + model knobs from SSM/Secrets at workflow start |
| `RAGRetrieveFunction` | Vector search over voice corpus |
| `ReasonerFunction` | AI step 1 — produces a response strategy |
| `DrafterFunction` | AI step 2 — drafts the reply |
| `EvaluatorFunction` | AI step 3 — scores the draft against voice + RAG |
| `ReviserFunction` | AI step 4 (conditional) — re-drafts if Evaluator failed it |
| `WriteBackFunction` | Final step — writes draftReply to Firestore |

Each one has its own IAM `Policies:` block declaring the **minimum** secrets it can read. The Anthropic-calling Lambdas can read the Anthropic secret only. The WriteBack Lambda can read the Firebase secret only. **Least privilege** — exam concept.

**2 CloudWatch log groups** (`AWS::Logs::LogGroup`) — one per state machine. Express SFN doesn't keep an execution history, so these logs are the *only* trace of what happened. RetentionInDays caps spend.

**2 State machines** (`AWS::Serverless::StateMachine`):

| | `AIChainStateMachine` (Express) | `ReplyDraftStateMachine` (Standard) |
|---|---|---|
| Type | `EXPRESS` | `STANDARD` |
| Cost | $1 / million transitions | $25 / million |
| History | Logs only | 90-day execution history |
| Use | The hot AI chain (4 steps, < 30s) | The whole workflow (orchestration) |

The `DefinitionUri` points at the ASL JSON file. `DefinitionSubstitutions` injects the deployed Lambda ARNs into the ASL's `${Placeholder}` syntax.

**Logging** is configured to send everything (level: ALL) to the dedicated log group. **Tracing** sends spans to X-Ray.

**Policies** on each state machine — the auto-generated SAM policies for `LambdaInvokePolicy` (so SFN can call the Lambdas) and `StepFunctionsExecutionPolicy` (so the outer SM can start the inner one).

### `Outputs:`
After deploy, CFN exposes:
- `ReplyDraftStateMachineArn` — exported so other stacks (e.g. the Firebase-trigger Lambda in Phase 3) can find it
- `AIChainStateMachineArn` — for testing
- `WriteBackFunctionArn` — for testing

---

## What the state machines do — flow walkthrough

### Outer: `reply-draft.asl.json` (Standard)

```
Start
  ↓
LoadConfig         (Task — Lambda)         — read prompts/model
  ↓
RAGRetrieve        (Task — Lambda)         — vector search
  ↓                (errors here are NON-FATAL — continues with empty rag)
AIChainExecution   (Task — startExecution.sync:2)
  ↓                                         — invokes Express child synchronously
WriteBack          (Task — Lambda)         — write Firestore doc
  ↓
End
```

Errors anywhere except RAGRetrieve route to `WorkflowFailed` (a `Type: Fail` state). Phase 3 will wire that to an SQS DLQ + SNS alert.

The synchronous Express invocation uses `arn:aws:states:::states:startExecution.sync:2` — the `:2` is the **integration version**. v2 returns the Express output as JSON instead of a string blob (cleaner for chaining).

### Inner: `ai-chain.asl.json` (Express)

```
Start
  ↓
Reasoner    (Task)  ─→ strategy
  ↓
Drafter     (Task)  ─→ draft
  ↓
Evaluator   (Task)  ─→ evaluation
  ↓
EvaluationGate  (Choice)
  ├─ passed? ─────────────────────────→ ChainSucceeded
  ├─ revisedReply present? ──────────→ UseEvaluatorRevision (Pass) ─→ ChainSucceeded
  └─ otherwise ───────────────────────→ Reviser (Task) ─→ PromoteReviserResult (Pass) ─→ ChainSucceeded

Any task error ─→ ChainFailed (Type: Fail)
```

Every Task has a **Retry** block:
```json
"Retry": [
  {
    "ErrorEquals": ["AnthropicThrottle", "States.TaskFailed", "Lambda.ServiceException", "Lambda.AWSLambdaException"],
    "IntervalSeconds": 2,
    "MaxAttempts": 5,
    "BackoffRate": 2.0,
    "JitterStrategy": "FULL"
  }
]
```

This is the **same retry semantics** as the [`anthropic-with-backoff.js`](../functions/lib/anthropic-with-backoff.js) wrapper we shipped in Phase 0 — just expressed in ASL instead of JavaScript. Once the chain runs in SFN, we can remove the Phase 0 wrapper from those code paths.

`JitterStrategy: FULL` is a 2024 SFN feature — applies full jitter to the wait. Without this you'd have to compute jitter manually like we did in JS. **Exam point**: SFN supports `FULL` and `NONE` jitter strategies.

---

## Concepts banked for the exam

| Concept | Where you saw it |
|---|---|
| `AWS::Serverless::Function` | SAM macro — expands to Lambda + Role + Permission |
| `AWS::Serverless::StateMachine` | SAM macro for Step Functions |
| Globals block | DRY shared config across resources |
| `!Ref`, `!GetAtt`, `!Sub` | CFN intrinsic functions |
| `DefinitionSubstitutions` | Injects ARNs into ASL placeholders |
| `LambdaInvokePolicy` (SAM) | Auto-generates the IAM grant |
| `StepFunctionsExecutionPolicy` (SAM) | Lets one SM call another |
| `arn:aws:states:::states:startExecution.sync:2` | Synchronous SFN-to-SFN call (v2 integration) |
| `arn:aws:states:::lambda:invoke` | Standard Lambda task integration |
| ASL `Retry` with `JitterStrategy: FULL` | Full jitter retry config |
| ASL `Catch` with `ResultPath` | Error routing without losing state |
| Standard vs Express SFN | Long-running w/ history vs cheap-fast-logs-only |
| `RetentionInDays` on CloudWatch | Cost control on log groups |
| `Architectures: [arm64]` | Cheaper Graviton processors |
| `Tracing: Active` (Lambda) + `Tracing.Enabled: true` (SFN) | X-Ray everywhere |
| Lambda Powertools env vars | Structured logs / metrics convention |

---

## What's NOT in this commit (deferred)

- **Real Anthropic calls inside Lambdas** — they're stubs returning placeholder data. Phase 1.5 ports the existing `reply-ai.js` / `reply-agent-chain.js` logic.
- **Lambda Powertools layer** — env vars are wired but the actual layer ARN reference is left out (Phase 1.5).
- **Firebase Admin SDK in WriteBack** — currently logs instead of writing. Phase 1.5 ports the write logic.
- **AppConfig integration** — Phase 2.
- **Bridge from Firebase Cloud Function → SFN StartExecution** — Phase 3.
- **DLQ + SNS alarms + auto-rollback** — Phase 3.
- **Anthropic 429 detection mapping to `AnthropicThrottle` named error** — currently relies on `States.TaskFailed`. Phase 1.5 will throw a typed error from each Lambda so the Retry block can target it specifically.

---

## How to deploy this (when you're ready)

```bash
# 1. Validate the template syntactically — fast, no AWS calls
cd /Users/jperez/dev/casa-coqui/infra/sam/reply-agent
sam validate

# 2. Build (bundles each Lambda)
sam build

# 3. First-time deploy — interactive prompts to set stack name, region, etc.
sam deploy --guided
# Saves your answers to samconfig.toml so future deploys are: sam deploy
```

Expect the **first deploy** to take ~3-5 min. CloudFormation creates ~20 resources (7 Lambdas + 2 SMs + 2 log groups + IAM roles for each). If anything fails, the entire stack rolls back automatically.

---

## How to test it after deploy

```bash
# Get the state machine ARN from the stack outputs
aws cloudformation describe-stacks \
  --stack-name casa-coqui-reply-agent \
  --query "Stacks[0].Outputs[?OutputKey=='ReplyDraftStateMachineArn'].OutputValue" \
  --output text

# Start an execution with a fixture event
aws stepfunctions start-execution \
  --state-machine-arn <ARN-from-above> \
  --input '{"message":{"id":"test-001","guestName":"Tester","body":"Hello!"}}'

# Watch the execution in the console:
# https://console.aws.amazon.com/states/home → State machines → casa-coqui-reply-draft
```

You should see the workflow execute through Load → RAG → AIChain (which itself runs Reasoner → Drafter → Evaluator → ChainSucceeded) → WriteBack → success. Total time should be sub-second since everything's a stub.

---

## Cost expectation

After deploy with no traffic:
- 7 Lambda functions: $0/mo idle (no invocations)
- 2 SFN state machines: $0/mo idle (definitions are free)
- 2 CloudWatch log groups: $0/mo with 7-day retention and no ingestion
- IAM roles, X-Ray tracing config: $0

**Idle cost: $0/mo.**

When invoked at current Casa Coqui volume (~10 messages/day):
- ~10 Standard executions/day × ~6 transitions = 60 transitions = $0.0015/mo
- ~10 Express executions/day × ~6 transitions = 60 transitions = $0.00006/mo
- ~70 Lambda invocations/day × small mem = pennies
- X-Ray traces: pennies

**Active cost at current volume: under $0.10/mo.** Cheaper than the existing in-process Cloud Function.
