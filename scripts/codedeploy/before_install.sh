#!/bin/bash
# Hook 3: BeforeInstall
# Runs BEFORE CodeDeploy copies the new revision files to the destination.
# Use case: clean up old artifacts from the PREVIOUS deployment.
#
# DOP-C02 exam note: CodeDeploy copies files as ROOT during the Install
# phase. This means files from a previous deployment are root-owned.
# BeforeInstall runs as ec2-user, so we need sudo to remove them.
# This is a common gotcha with CodeDeploy on EC2 — cleanup scripts
# must handle root-owned files from prior deployments.

set -e

HOOK="BeforeInstall"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
APP_DIR="/home/ec2-user/casa-coqui"

echo "[$TIMESTAMP] [$HOOK] Cleaning up previous deployment artifacts"

# Remove old .next build output — uses sudo because CodeDeploy
# copied these as root during the previous deployment's Install phase.
if [ -d "$APP_DIR/.next" ]; then
    echo "[$TIMESTAMP] [$HOOK] Removing old .next/ (root-owned from previous deploy)"
    sudo rm -rf "$APP_DIR/.next"
fi

# Remove old node_modules — same root ownership issue.
if [ -d "$APP_DIR/node_modules" ]; then
    echo "[$TIMESTAMP] [$HOOK] Removing old node_modules/ (root-owned from previous deploy)"
    sudo rm -rf "$APP_DIR/node_modules"
fi

# Fix ownership on the app directory for the current deployment.
# This ensures after_install.sh (running as ec2-user) can write .env.local.
if [ -d "$APP_DIR" ]; then
    sudo chown -R ec2-user:ec2-user "$APP_DIR"
fi

echo "[$TIMESTAMP] [$HOOK] Cleanup complete — ready for Install phase"

exit 0
