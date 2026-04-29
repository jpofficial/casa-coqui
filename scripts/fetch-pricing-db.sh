#!/usr/bin/env bash
# Fetch pricing.db from S3 at build time so the Vercel-hosted Next.js app
# can read pricing recommendations + rate-calendar data.
#
# The pricing autopilot writes to s3://casa-coqui-pricing-data/pricing.db
# twice weekly; this script bakes the latest snapshot into the deploy
# bundle. Stale between scrapes by ~3-4 days max (Mon/Thu cadence) — good
# enough for now. For fresher data, switch to runtime /tmp fetch.
#
# Failure modes (all warn-and-continue, never fail the build):
#   - No AWS creds (e.g. local dev without env vars) → skip silently
#   - aws CLI missing → skip with warning
#   - S3 fetch fails → skip with warning
# Build proceeds; calendar renders with whatever DB ships in the source
# tree (or an empty schema if none).

set -uo pipefail

BUCKET="casa-coqui-pricing-data"
KEY="pricing.db"
DEST="tools/pricing/pricing.db"

if ! command -v aws >/dev/null 2>&1; then
  echo "[fetch-pricing-db] aws CLI not found; skipping."
  exit 0
fi

# Probe creds — works for env-var creds (Vercel), profile creds (local
# dev), or instance roles. Any failure → skip the fetch but don't fail
# the build.
if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
  echo "[fetch-pricing-db] No usable AWS creds; skipping S3 fetch."
  exit 0
fi

echo "[fetch-pricing-db] Fetching s3://${BUCKET}/${KEY} → ${DEST}"
mkdir -p "$(dirname "${DEST}")"

if aws s3 cp "s3://${BUCKET}/${KEY}" "${DEST}" --region us-east-1; then
  SIZE=$(stat -c%s "${DEST}" 2>/dev/null || stat -f%z "${DEST}" 2>/dev/null || echo "?")
  echo "[fetch-pricing-db] OK — ${SIZE} bytes."
else
  echo "[fetch-pricing-db] Fetch failed; build will use whatever DB exists locally."
fi
