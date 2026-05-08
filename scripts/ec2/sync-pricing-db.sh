#!/bin/bash
# Casa Coqui — pricing.db sync from S3 to EC2.
#
# Purpose: keep the admin dashboard's pricing recommendations fresh.
# The pricing autopilot runs in CodeBuild twice weekly and writes
# pricing.db to s3://casa-coqui-pricing-data/pricing.db. This script
# pulls that file to the EC2 filesystem so better-sqlite3 in the
# Next.js API routes at /api/pricing/* reads current data.
#
# Trigger: systemd timer casa-coqui-pricing-sync.timer every 30 min.
# Also fires once on CodeDeploy AfterInstall so the DB is fresh
# before PM2 starts serving requests.
#
# Idempotent: HEAD-object compares ETag with a local cache; only
# downloads on change. The 30-min cadence is safe to run indefinitely.
#
# Atomicity: downloads to pricing.db.incoming, then `mv` to pricing.db.
# The rename is atomic at the filesystem level; any open better-sqlite3
# handles from before the rename read from the old inode (Linux keeps
# the file alive until all descriptors close) and PM2 restart below
# re-opens against the new file.

set -euo pipefail

BUCKET="casa-coqui-pricing-data"
KEY="pricing.db"
APP_DIR="/home/ec2-user/casa-coqui"
LOCAL_DB="$APP_DIR/tools/pricing/pricing.db"
INCOMING="$APP_DIR/tools/pricing/pricing.db.incoming"
ETAG_CACHE="$APP_DIR/tools/pricing/pricing.db.etag"
LOG_TAG="pricing-sync"

log() {
  logger -t "$LOG_TAG" "$@"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

# Ensure target dir exists (fresh deploys might not have tools/pricing
# populated with a pre-existing DB file).
mkdir -p "$APP_DIR/tools/pricing"

# Head-object to get the current ETag without downloading.
REMOTE_ETAG=$(aws s3api head-object \
  --bucket "$BUCKET" \
  --key "$KEY" \
  --query ETag \
  --output text 2>/dev/null || echo "")

if [ -z "$REMOTE_ETAG" ] || [ "$REMOTE_ETAG" = "None" ]; then
  log "No pricing.db in S3 yet — skipping (expected on fresh accounts)"
  exit 0
fi

LOCAL_ETAG=""
if [ -f "$ETAG_CACHE" ]; then
  LOCAL_ETAG=$(cat "$ETAG_CACHE")
fi

if [ "$REMOTE_ETAG" = "$LOCAL_ETAG" ] && [ -f "$LOCAL_DB" ]; then
  log "No change (ETag $REMOTE_ETAG) — skipping"
  exit 0
fi

log "ETag changed ($LOCAL_ETAG -> $REMOTE_ETAG) — syncing"

# Download to incoming, then atomic rename.
aws s3 cp "s3://$BUCKET/$KEY" "$INCOMING" --only-show-errors
mv "$INCOMING" "$LOCAL_DB"
echo "$REMOTE_ETAG" > "$ETAG_CACHE"

BYTES=$(stat -c%s "$LOCAL_DB" 2>/dev/null || stat -f%z "$LOCAL_DB")
log "Downloaded $LOCAL_DB ($BYTES bytes)"

# Restart Next.js so lib/pricing-db.js reopens the file. PM2 restart is
# ~2-3 seconds; the ALB health check handles traffic drain.
if command -v pm2 >/dev/null 2>&1; then
  log "Restarting PM2 app casa-coqui"
  pm2 restart casa-coqui --update-env
else
  log "WARNING: pm2 not found in PATH — skipping restart"
fi

log "Sync complete"
