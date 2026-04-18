#!/bin/bash
# Hook 5: ApplicationStart
# Start the new version of Casa Coqui via PM2.
#
# DOP-C02 exam note: There is NO "ApplicationStop" hook in the in-place
# lifecycle when using load balancer hooks. AfterBlockTraffic handles stopping.
# Without an LB, you'd use ApplicationStop instead.

set -e

HOOK="ApplicationStart"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
APP_DIR="/home/ec2-user/casa-coqui"

echo "[$TIMESTAMP] [$HOOK] Starting Casa Coqui via PM2"

cd "$APP_DIR"

# Start Next.js in production mode on port 3000
pm2 start npm --name "casa-coqui" -- start

# Wait for the process to be online
sleep 3

# Verify PM2 reports it as online
PM2_STATUS=$(pm2 jlist 2>/dev/null | grep -o '"status":"[^"]*"' | head -1)
echo "[$TIMESTAMP] [$HOOK] PM2 status: $PM2_STATUS"

# Save PM2 process list so it auto-restarts on reboot
pm2 save

echo "[$TIMESTAMP] [$HOOK] Casa Coqui started on port 3000"

exit 0
