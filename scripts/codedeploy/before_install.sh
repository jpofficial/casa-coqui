#!/bin/bash
# Hook 3: BeforeInstall
# Runs BEFORE CodeDeploy copies the new revision files to the destination.
# Use case: clean up old artifacts, back up config, remove stale build output.
#
# DOP-C02 exam note: The 'Install' phase itself is CodeDeploy-managed —
# it copies files listed in appspec.yml 'files' section. You can't script
# the Install phase, only BeforeInstall and AfterInstall.

set -e

HOOK="BeforeInstall"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
APP_DIR="/home/ec2-user/casa-coqui"

echo "[$TIMESTAMP] [$HOOK] Cleaning up previous deployment artifacts"

# Remove old .next build output (will be rebuilt in AfterInstall)
if [ -d "$APP_DIR/.next" ]; then
    echo "[$TIMESTAMP] [$HOOK] Removing old .next/ build directory"
    rm -rf "$APP_DIR/.next"
fi

# Remove old node_modules (clean install in AfterInstall)
if [ -d "$APP_DIR/node_modules" ]; then
    echo "[$TIMESTAMP] [$HOOK] Removing old node_modules/"
    rm -rf "$APP_DIR/node_modules"
fi

echo "[$TIMESTAMP] [$HOOK] Cleanup complete — ready for Install phase"

exit 0
