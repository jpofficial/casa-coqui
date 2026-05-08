# Casa Coqui — AWS CI/CD Foundation (Phase 1)

CDK Python app that provisions a CodePipeline which builds Casa Coqui
(Next.js 14 + Firebase functions) and deploys it to Vercel + Firebase.

**This does NOT move Casa Coqui off Vercel or Firebase.** The pipeline
treats both as external deploy targets.

## Architecture

Two stacks with an explicit lifecycle boundary:

```
CasaCoquiFoundationStack           CasaCoquiPipelineStack
  (create-once, never-delete)        (rebuildable whenever)
  ────────────────────────           ───────────────────────
  KMS CMK (rotation, RETAIN)         CodeBuild build project
  S3 artifact bucket (RETAIN)        CodeBuild deploy project
  Secret casa-coqui/pipeline         2 × IAM role (no sharing)
  SNS topic (DELETE)                 2 × CloudWatch log group
  SSM codestar-connection-arn        CodePipeline V2 (4 stages)
  CloudWatch log group               EventBridge → SNS rule
```

Foundation constructs are passed directly into the Pipeline stack
constructor, so CDK synthesizes cross-stack `Fn::ImportValue` exports
automatically. Trying to `cdk destroy CasaCoquiFoundationStack` while
the Pipeline stack is still deployed fails with
`Export CasaCoquiFoundation-* cannot be deleted as it is in use by another stack`.

## Pipeline shape

```
Source (GitHub via CodeStarConnection)
   ↓ SourceArtifact
Build (codebuild.PipelineProject, buildspec-build.yml)
   ↓ BuildArtifact
Approval (ManualApproval → SNS → email)
   ↓
Deploy (codebuild.PipelineProject, buildspec-deploy.yml)
   → EventBridge pipeline state rule → SNS
```

## Prerequisites

- AWS account with admin access (personal account is fine for learning)
- `aws` CLI v2, `cdk` CLI v2 (`npm i -g aws-cdk`)
- Python 3.9+
- A Vercel account with Casa Coqui already connected (org id + project id + token)
- A Firebase service account JSON for `casa-coqui` with roles:
  `Firebase Admin`, `Cloud Functions Admin`, `Firebase Rules Admin`

## First-run bootstrap

All steps below run exactly once.

### 1. AWS CLI auth

```bash
aws configure
# access key / secret / region=us-east-1 / output=json
aws sts get-caller-identity
```

### 2. Create the GitHub CodeStar connection (console)

Developer Tools → Settings → Connections → **Create connection** →
GitHub → connection name `casa-coqui-github` → authorize in the GitHub
popup → **copy the ARN** (looks like
`arn:aws:codestar-connections:us-east-1:<acct>:connection/<uuid>`).

### 3. Save the connection ARN to SSM

```bash
export CODESTAR_ARN='arn:aws:codestar-connections:us-east-1:<acct>:connection/<uuid>'

aws ssm put-parameter \
  --name /casa-coqui/pipeline/codestar-connection-arn \
  --value "$CODESTAR_ARN" \
  --type String \
  --overwrite
```

### 4. Save the `NEXT_PUBLIC_APP_URL` SSM parameter

```bash
aws ssm put-parameter \
  --name /casa-coqui/pipeline/next-public-app-url \
  --value "https://casa-coqui.com" \
  --type String \
  --overwrite
```

### 5. Seed the single pipeline secret

The Foundation stack creates `casa-coqui/pipeline` with a placeholder
body the first time it deploys. Overwrite it with the real values:

```bash
cat > /tmp/secret.json <<'JSON'
{
  "NEXT_PUBLIC_FIREBASE_API_KEY": "...",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN": "casa-coqui.firebaseapp.com",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID": "casa-coqui",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET": "casa-coqui.appspot.com",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID": "...",
  "NEXT_PUBLIC_FIREBASE_APP_ID": "...",
  "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID": "...",
  "NEXT_PUBLIC_FIREBASE_VAPID_KEY": "...",
  "NEXT_PUBLIC_ADMIN_EMAIL": "01juliop@gmail.com",
  "FIREBASE_SERVICE_ACCOUNT_KEY": "{...full JSON on one line...}",
  "RESEND_API_KEY": "re_...",
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "VERCEL_TOKEN": "...",
  "VERCEL_ORG_ID": "team_...",
  "VERCEL_PROJECT_ID": "prj_..."
}
JSON

aws secretsmanager put-secret-value \
  --secret-id casa-coqui/pipeline \
  --secret-string file:///tmp/secret.json

# IMPORTANT — don't leave plaintext secrets on disk:
rm -P /tmp/secret.json 2>/dev/null || shred -u /tmp/secret.json
```

Note: run step 5 *after* the Foundation stack is deployed (step 9).
Chicken-and-egg: the secret has to exist before you can put a value,
and the stack creates it.

### 6. Commit the Phase 1 files to a feature branch

Do **not** merge to `main` yet — the webhook will fire before the
pipeline is fully deployed.

```bash
cd /Users/jperez/dev/casa-coqui
git checkout -b phase-1-aws-pipeline
git add infra/ buildspec-build.yml buildspec-deploy.yml \
        firebase.json .gitignore .env.example
git commit -m "Phase 1: AWS CDK pipeline foundation + buildspecs"
git push -u origin phase-1-aws-pipeline
```

### 7. Create a Python virtualenv and install CDK deps

```bash
cd /Users/jperez/dev/casa-coqui/infra
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 8. One-time CDK bootstrap for the account/region

```bash
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1

cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
```

### 9. Synth and deploy Foundation

```bash
cdk synth CasaCoquiFoundationStack > /tmp/foundation.json
# Open /tmp/foundation.json and read it. Identify:
#   * DeletionPolicy on the Bucket, Key, Secret (RETAIN)
#   * DeletionPolicy on the SNS topic (Delete)
#   * Outputs block with Export names
# This is the raw CloudFormation form of what CDK generates — exam
# questions are phrased in these terms.

cdk deploy CasaCoquiFoundationStack
# Review the IAM diff → type `y` to confirm
# Check your inbox for the SNS confirmation email and CLICK THE LINK.
# Email notifications silently drop until confirmed.
```

Now run step **5** (seed the real secret values).

### 10. Deploy the Pipeline stack

```bash
cdk deploy CasaCoquiPipelineStack \
  -c codestar_connection_arn="$CODESTAR_ARN"
```

If you get `ROLLBACK_COMPLETE` on the first deploy (e.g. the CodeStar
connection was left in `PENDING` state), go fix it in the console and
then `cdk destroy CasaCoquiPipelineStack` before retrying. CFN will not
update a stack in `ROLLBACK_COMPLETE` — only destroy + recreate is
allowed.

### 11. Merge to main

```bash
git checkout main
git merge --ff-only phase-1-aws-pipeline
git push origin main
```

The pipeline webhook fires on the merge commit. In the AWS console,
watch the Source → Build → Approval stage boxes turn green. Click
**Review → Approve** when the Approval stage is reached.

## Verification checklist

```bash
# Pipeline exists and has 4 stages
aws codepipeline list-pipelines
aws codepipeline get-pipeline-state --name casa-coqui-pipeline \
  --query 'stageStates[].stageName'

# Build logs streaming
aws logs tail /aws/codebuild/casa-coqui-build --follow

# Deploy logs streaming
aws logs tail /aws/codebuild/casa-coqui-deploy --follow
```

Expected after a full green run:
1. Vercel dashboard shows a new production deployment matching the
   commit SHA.
2. Firebase console → Functions shows a recent deploy timestamp.
3. Admin email received pipeline success notification.
4. Live site loads the change.

## Deliberate exam traps wired into this stack

Walk through these once — they map 1:1 to DevOps Pro questions.

### Trap 1 — `StartBuild` override only works on static vars

```bash
aws codebuild start-build \
  --project-name casa-coqui-build \
  --environment-variables-override \
      name=FIREBASE_SERVICE_ACCOUNT_KEY,value=bogus,type=SECRETS_MANAGER
```

Expect rejection. The `SECRETS_MANAGER` and `PARAMETER_STORE` types are
**not** StartBuild-overridable — they resolve at job start from the
buildspec's `env` block. Only `PLAINTEXT` can be overridden at runtime.

### Trap 2 — Cross-stack Export deletion lock

```bash
cdk destroy CasaCoquiFoundationStack
```

Expect failure: `Export CasaCoquiFoundation-ArtifactBucketName cannot
be deleted as it is in use by CasaCoquiPipelineStack`. Fix order:
destroy Pipeline first, then Foundation.

### Trap 3 — `ROLLBACK_COMPLETE` recovery

Edit `infra/app.py` briefly to pass a bad CodeStar ARN (e.g. flip a
digit in the account id). Run `cdk deploy CasaCoquiPipelineStack`.
Expect the stack to end in `ROLLBACK_COMPLETE`. Now try to deploy
again — expect `Stack ... is in ROLLBACK_COMPLETE state and can not
be updated`. Resolution: `cdk destroy CasaCoquiPipelineStack`, fix
the ARN, redeploy.

### Trap 4 — KMS-encrypted SNS silent email drop

Temporarily comment out
`self.cmk.grant_encrypt_decrypt(iam.ServicePrincipal("sns.amazonaws.com"))`
in `foundation_stack.py`. Redeploy Foundation. Run the pipeline → the
email will not arrive, but `aws sns list-subscriptions-by-topic` still
shows the subscription as `Confirmed`. Uncomment, redeploy → email
works again. This is an exam favorite.

### Trap 5 — Infinite log retention cost trap

Look at the `BuildLogGroup` / `DeployLogGroup` declarations. The
`retention=RetentionDays.ONE_MONTH` line is deliberate — if you omit
the LogGroup construct entirely, CodeBuild auto-creates log groups
with **never-expire** retention. Bill grows forever.

### Trap 6 — DeletionPolicy variants

Destroy the Pipeline stack, then the Foundation stack:

```bash
cdk destroy CasaCoquiPipelineStack
cdk destroy CasaCoquiFoundationStack
```

Expected outcomes:
- Pipeline stack: clean destroy, all resources deleted.
- Foundation stack: `DELETE_COMPLETE` but the Bucket, CMK, and Secret
  remain in the account because their DeletionPolicy is `Retain`.
- The CMK enters a 7-day pending-deletion window. You can cancel
  deletion during that window.
- The Secret enters a 30-day recovery window by default.
- The Bucket stays, versioned, with its artifacts.

Clean them up manually after confirming (`aws s3 rb --force`,
`aws kms schedule-key-deletion`, `aws secretsmanager delete-secret
--force-delete-without-recovery`).

### Trap 7 — Three env var provider types

Open `buildspec-build.yml` and look at the `env:` block:
- `variables:` (literal plaintext)
- `parameter-store:` (SSM pointer, resolved at build start)
- `secrets-manager:` (Secrets Manager pointer with `secret:key` syntax)

Exam questions test whether you recognize the three provider keys.
The `secret:key` syntax is specific to CodeBuild's Secrets Manager
integration and requires the secret body to be JSON.

## Phase 2 hooks (not implemented yet)

The following are intentionally scaffolded but not wired:
- `tests/` directory for CDK assertion tests
- `codebuild:CreateReportGroup` IAM perms on the build role
- SSM parameter naming scheme allows Phase 2 to drop new keys without
  touching IAM policies (wildcard grant on
  `/casa-coqui/pipeline/*`)

## Cost estimate

~$4/month steady state:
- CodePipeline V2: $1/active pipeline
- CodeBuild: ~$0.80 at 20 builds/month × 8 min avg
- KMS CMK: $1
- Secrets Manager (1 secret): $0.40
- S3 + SNS + EventBridge + CloudWatch Logs: < $0.60
