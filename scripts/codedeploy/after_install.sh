#!/bin/bash
# Hook 6: AfterInstall
# Runs AFTER CodeDeploy has copied the pre-built revision files to
# /home/ec2-user/casa-coqui. The app is already built by CodeBuild —
# this hook only pulls runtime secrets.
#
# DOP-C02 exam note: In the production-correct pattern, the build
# happens in CodeBuild (3GB RAM), NOT on the EC2 instance. AfterInstall
# should handle post-copy setup like secrets, file permissions, and
# config — NOT compilation. If you see npm ci or npm build in an
# AfterInstall hook on the exam, that's the anti-pattern.
#
# DOP-C02 exam note: Secrets are pulled at DEPLOY TIME via the instance
# role, not baked into the zip or user data. This keeps secrets out of
# S3, out of git, and out of CloudTrail deployment logs.

set -euo pipefail

HOOK="AfterInstall"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
APP_DIR="/home/ec2-user/casa-coqui"
REGION="us-east-1"
SECRET_ID="casa-coqui/pipeline"

echo "[$TIMESTAMP] [$HOOK] Pulling secrets from Secrets Manager..."

cd "$APP_DIR"

# ── Pull secrets from Secrets Manager → .env.local ──
SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query 'SecretString' \
  --output text)

echo "$SECRET_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for k, v in d.items():
    print(f'{k}={v}')
" > "$APP_DIR/.env.local"

# Lock down permissions — only the app user can read secrets.
chmod 600 "$APP_DIR/.env.local"

ENV_COUNT=$(wc -l < "$APP_DIR/.env.local")
echo "[$TIMESTAMP] [$HOOK] Wrote $ENV_COUNT env vars to .env.local"

# NOTE: We do NOT run npm rebuild here. CodeDeploy extracts files as root,
# so ec2-user can't modify node_modules/.bin/. Instead, application_start.sh
# calls `node node_modules/next/dist/bin/next start` directly, bypassing
# the broken .bin symlinks entirely.

echo "[$TIMESTAMP] [$HOOK] Done with secrets. Installing pricing sync..."

# ── Install pricing.db sync service + timer ──
# These pull pricing.db from S3 on a 30-min cadence so the admin
# dashboard at /admin/pricing shows fresh fill-rate recommendations
# whenever CodeBuild produces a new snapshot.
# See: docs/superpowers/specs/2026-04-19-pricing-autopilot-codebuild-migration-design.md

chmod +x "$APP_DIR/scripts/ec2/sync-pricing-db.sh"

sudo cp "$APP_DIR/scripts/ec2/casa-coqui-pricing-sync.service" /etc/systemd/system/
sudo cp "$APP_DIR/scripts/ec2/casa-coqui-pricing-sync.timer"   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable casa-coqui-pricing-sync.timer
sudo systemctl start  casa-coqui-pricing-sync.timer

# Fire an immediate sync so the DB is fresh before ApplicationStart runs
# PM2. Don't fail the deploy if this sync can't complete — the timer
# will retry on the normal cadence.
sudo systemctl start casa-coqui-pricing-sync.service || \
  echo "[$TIMESTAMP] [$HOOK] WARNING: immediate pricing sync failed; timer will retry"

echo "[$TIMESTAMP] [$HOOK] Done. App is pre-built — ready for ApplicationStart."

exit 0
