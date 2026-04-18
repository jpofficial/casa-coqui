# CodePipeline → CodeBuild → CodeDeploy to EC2

**Date**: 2026-04-18
**Status**: Design — awaiting approval
**Goal**: Deploy Casa Coqui to EC2 the production-correct way for DOP-C02 exam practice
**Sandbox branch**: `ec2-deploy` on the real `casa-coqui` GitHub repo

## Problem

Building Casa Coqui (`npm ci` + `next build`) on a t3.micro (1GB RAM) fails — the build needs 1.2-1.5GB peak RAM. Instead of hacking the app to fit, we separate build from runtime, which is the production-correct pattern.

## Architecture

```
GitHub (ec2-deploy branch)
  │
  ▼
CodePipeline
  │
  ├─ Stage 1: Source
  │    └─ CodeStarSourceConnection (casa-coqui-github)
  │       repo: jpofficial/casa-coqui, branch: ec2-deploy
  │
  ├─ Stage 2: Build
  │    └─ CodeBuild (general1.small — 3GB RAM, free tier)
  │       ├─ npm ci
  │       ├─ npm run build (next build)
  │       └─ Output artifact: .next/ + node_modules/ + public/ + package.json
  │          + appspec.yml + scripts/codedeploy/
  │
  └─ Stage 3: Deploy
       └─ CodeDeploy (in-place, EC2)
          └─ Pulls artifact from S3 → fires lifecycle hooks
             1. BeforeBlockTraffic  → log drain prep
             2. BlockTraffic        → (managed: deregister from ALB)
             3. AfterBlockTraffic   → pm2 stop
             4. BeforeInstall       → clean old deployment
             5. Install             → (managed: copy files)
             6. AfterInstall        → pull secrets from Secrets Manager → .env.local
             7. ApplicationStart    → pm2 start
             8. ValidateService     → curl localhost:3000
             9. BeforeAllowTraffic  → warm ISR cache
            10. AllowTraffic        → (managed: register with ALB)
            11. AfterAllowTraffic   → smoke test
```

## Key Design Decision

**EC2 does NOT build.** The `after_install.sh` hook only pulls secrets from Secrets Manager and writes `.env.local`. No `npm ci`, no `next build`. The app arrives pre-built from CodeBuild.

## Files to Create/Modify

### 1. `buildspec.yml` (NEW)

```yaml
version: 0.2

# Casa Coqui — CodeBuild build phase
# Runs on general1.small (3GB RAM) — free tier: 100 min/month
# Outputs pre-built artifact for CodeDeploy to ship to EC2

env:
  variables:
    NODE_ENV: "production"
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
  secrets-manager:
    NEXT_PUBLIC_FIREBASE_API_KEY: "casa-coqui/pipeline:NEXT_PUBLIC_FIREBASE_API_KEY"
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "casa-coqui/pipeline:NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "casa-coqui/pipeline:NEXT_PUBLIC_FIREBASE_PROJECT_ID"
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "casa-coqui/pipeline:NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "casa-coqui/pipeline:NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
    NEXT_PUBLIC_FIREBASE_APP_ID: "casa-coqui/pipeline:NEXT_PUBLIC_FIREBASE_APP_ID"
    NEXT_PUBLIC_FIREBASE_VAPID_KEY: "casa-coqui/pipeline:NEXT_PUBLIC_FIREBASE_VAPID_KEY"
    NEXT_PUBLIC_ADMIN_EMAIL: "casa-coqui/pipeline:NEXT_PUBLIC_ADMIN_EMAIL"

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - echo "Node $(node --version) | npm $(npm --version)"

  pre_build:
    commands:
      - echo "=== pre_build ==="
      - npm ci
      - echo "node_modules installed. Size:"
      - du -sh node_modules || true

  build:
    commands:
      - echo "=== build ==="
      - npm run build
      - echo "Build complete. .next size:"
      - du -sh .next || true

  post_build:
    commands:
      - echo "=== post_build ==="
      # Prune devDependencies — EC2 doesn't need tailwind/postcss/eslint
      - npm prune --omit=dev
      - echo "Pruned node_modules size:"
      - du -sh node_modules || true

artifacts:
  files:
    - "**/*"
  base-directory: "."
  # Includes: .next/, node_modules/ (prod only), public/, package.json,
  # appspec.yml, scripts/codedeploy/
  # Excludes are handled by .codebuild-ignore or default exclusions

cache:
  paths:
    - "node_modules/**/*"
```

**DOP-C02 exam concepts in this buildspec:**
- `secrets-manager` env type — pulls secrets at build time (exam tests PLAINTEXT vs PARAMETER_STORE vs SECRETS_MANAGER)
- `runtime-versions` — managed image runtime selection
- `artifacts` — output goes to S3, consumed by CodeDeploy
- `cache.paths` — CodeBuild caching reduces subsequent build times
- `npm prune --omit=dev` — ship only production deps to EC2

### 2. `scripts/codedeploy/after_install.sh` (MODIFIED)

Old version (wrong — builds on EC2):
```bash
npm ci --include=dev
npm run build
```

New version (right — secrets pull only):
```bash
#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/home/ec2-user/casa-coqui"
REGION="us-east-1"
SECRET_ID="casa-coqui/pipeline"

echo "[after_install] Pulling secrets from Secrets Manager..."
SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query 'SecretString' \
  --output text)

echo "[after_install] Writing .env.local..."
echo "$SECRET_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for k, v in d.items():
    print(f'{k}={v}')
" > "$DEPLOY_DIR/.env.local"

ENV_COUNT=$(wc -l < "$DEPLOY_DIR/.env.local")
echo "[after_install] Wrote $ENV_COUNT env vars to .env.local"
echo "[after_install] Done."
```

### 3. Other hook scripts (UNCHANGED)

All other hooks remain as-is:
- `before_block_traffic.sh` — log drain prep
- `after_block_traffic.sh` — `pm2 stop all`
- `before_install.sh` — clean old `.next/` (still needed to remove previous deploy)
- `application_start.sh` — `pm2 start npm --name casa-coqui -- start`
- `validate_service.sh` — `curl -f http://localhost:3000` (exits 0 now, not intentional failure)
- `before_allow_traffic.sh` — warm ISR cache
- `after_allow_traffic.sh` — ALB smoke test

### 4. `appspec.yml` (UNCHANGED)

The existing appspec.yml already has all 8 hooks wired. The only change is that `after_install.sh` does less work (secrets only, no build). Timeout can be reduced from 600s to 60s.

### 5. CDK Hosting Stack updates

The existing `hosting_stack.py` in the sandbox needs a CodePipeline added. Three stages:

1. **Source**: `CodeStarConnectionsSourceAction` pointing to `jpofficial/casa-coqui`, branch `ec2-deploy`
2. **Build**: `CodeBuildAction` using the `buildspec.yml` above
3. **Deploy**: `CodeDeployServerDeployAction` targeting the existing deployment group

IAM additions:
- CodeBuild role needs: Secrets Manager read, S3 artifact write, CloudWatch Logs write
- The existing EC2 role and CodeDeploy role stay as-is

## Branch Strategy

```
main (production — Vercel deploys this)
  │
  └─ ec2-deploy (exam lab — CodePipeline deploys this to EC2)
       Added files:
       ├── appspec.yml
       ├── buildspec.yml (NEW)
       └── scripts/codedeploy/
            ├── before_block_traffic.sh
            ├── after_block_traffic.sh
            ├── before_install.sh
            ├── after_install.sh (simplified)
            ├── application_start.sh
            ├── validate_service.sh
            ├── before_allow_traffic.sh
            └── after_allow_traffic.sh
```

Vercel ignores `ec2-deploy` — it only deploys `main`. Safe separation.

## DOP-C02 Exam Concepts Covered

| Concept | Where You'll See It |
|---|---|
| CodePipeline stages (Source → Build → Deploy) | Pipeline setup |
| CodeBuild buildspec.yml phases | buildspec.yml |
| Secrets Manager in CodeBuild env | buildspec.yml `secrets-manager` |
| CodeBuild cache | buildspec.yml `cache.paths` |
| CodeBuild artifact output → S3 | Pipeline artifact bucket |
| CodeDeploy appspec.yml (EC2) | appspec.yml |
| All 8 scriptable lifecycle hooks | scripts/codedeploy/ |
| 3 CodeDeploy-managed hooks | BlockTraffic, Install, AllowTraffic |
| ALB-dependent hooks | BeforeBlockTraffic, AfterBlockTraffic, Before/AfterAllowTraffic |
| Hook failure → deployment failure → rollback | validate_service.sh |
| Build/runtime separation | CodeBuild builds, EC2 just runs |
| CodeStar Connections (GitHub auth) | Source stage |
| S3 + KMS artifact encryption | Foundation stack artifact bucket |

## What's NOT Changing

- EC2 instance (t3.micro stays — it only runs the app now, doesn't build)
- ALB + Target Group
- Route53 `dev.casa-coqui.cc`
- ACM certificate
- CodeDeploy application + deployment group
- Security groups
- Secrets Manager secret

## Implementation Order

1. Create `ec2-deploy` branch from `main` on real repo
2. Copy deployment files from sandbox (appspec.yml, scripts/codedeploy/)
3. Create `buildspec.yml`
4. Simplify `after_install.sh` (secrets-only)
5. Reduce AfterInstall timeout in appspec.yml (600s → 60s)
6. Update CDK hosting stack to add CodePipeline
7. `cdk deploy` the updated stack
8. Push to `ec2-deploy` branch → CodePipeline triggers → full lifecycle fires
9. Verify via SSM: app running, health check passing, ALB serving traffic
