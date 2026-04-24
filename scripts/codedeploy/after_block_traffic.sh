#!/bin/bash
# Hook 2: AfterBlockTraffic
# Runs AFTER CodeDeploy has deregistered the instance from ALB.
# No new requests are arriving. Safe to stop the application.
#
# DOP-C02 exam note: The ALB draining delay (deregistration_delay) is
# configured on the target group, NOT in appspec.yml. Default is 300s.
# CodeDeploy waits for deregistration to complete before firing this hook.

set -e

HOOK="AfterBlockTraffic"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
APP_DIR="/home/ec2-user/casa-coqui"

echo "[$TIMESTAMP] [$HOOK] Traffic blocked — stopping Casa Coqui"

# Stop PM2-managed Next.js process
if command -v pm2 &>/dev/null && pm2 describe casa-coqui &>/dev/null; then
    echo "[$TIMESTAMP] [$HOOK] Stopping PM2 process: casa-coqui"
    pm2 stop casa-coqui || true
    pm2 delete casa-coqui || true
    echo "[$TIMESTAMP] [$HOOK] PM2 process stopped"
else
    echo "[$TIMESTAMP] [$HOOK] No running PM2 process found (first deploy or already stopped)"
fi

exit 0
