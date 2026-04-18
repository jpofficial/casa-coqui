#!/bin/bash
# Hook 7: BeforeAllowTraffic
# Runs BEFORE CodeDeploy registers the instance back with the ALB.
# Use case: warm the app (pre-fill caches, hit key pages).
#
# NOTE: This hook will NOT run in our exercise because ValidateService
# exits 1. CodeDeploy stops the lifecycle on first hook failure.
#
# DOP-C02 exam note: Hook execution order is strict. If any hook fails,
# ALL subsequent hooks are skipped. The deployment is marked failed at
# the point of the failing hook.

set -e

HOOK="BeforeAllowTraffic"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[$TIMESTAMP] [$HOOK] Warming Casa Coqui before ALB registration"

# Hit key pages to warm Next.js ISR cache
for path in "/" "/g/demo" "/admin"; do
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${path}" --max-time 5 2>/dev/null || echo "000")
    echo "[$TIMESTAMP] [$HOOK] Warmed $path → HTTP $HTTP_STATUS"
done

echo "[$TIMESTAMP] [$HOOK] Warm-up complete — ready for ALB registration"

exit 0
