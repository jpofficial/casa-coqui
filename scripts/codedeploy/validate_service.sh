#!/bin/bash
# Hook 6: ValidateService
# Health check against the running app BEFORE traffic is allowed back.
#
# *** INTENTIONALLY FAILS (exit 1) ***
#
# DOP-C02 exam note — what happens when ValidateService fails:
#   1. CodeDeploy marks the deployment as FAILED
#   2. IF Automatic Rollback is ENABLED on the deployment group:
#      → CodeDeploy triggers a NEW deployment of the last known good revision
#      → This is NOT a snapshot restore — it's a full redeploy (hooks re-run)
#      → The rollback deployment goes through the ENTIRE lifecycle again
#   3. IF Automatic Rollback is DISABLED:
#      → The bad version STAYS deployed. No traffic is allowed. Manual fix needed.
#   4. CloudWatch Alarm-based rollback is a SEPARATE trigger — it watches
#      metrics AFTER AllowTraffic, not during ValidateService.
#
# AIP-C01 crossover: For a GenAI Lambda, ValidateService is replaced by
# AfterAllowTraffic — you'd call the Lambda alias, send a test prompt to
# Bedrock, and verify the response. If it fails, CodeDeploy shifts traffic
# back to the original version (no full redeploy needed for Lambda).

set -e

HOOK="ValidateService"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[$TIMESTAMP] [$HOOK] Running health check against localhost:3000"

# Attempt to hit the health endpoint
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 10 2>/dev/null || echo "000")

echo "[$TIMESTAMP] [$HOOK] Health check response: HTTP $HTTP_STATUS"

if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "[$TIMESTAMP] [$HOOK] App is healthy!"
else
    echo "[$TIMESTAMP] [$HOOK] App returned $HTTP_STATUS (expected 200)"
fi

# ═══════════════════════════════════════════════════════════
# INTENTIONAL FAILURE — uncomment exit 1 to study rollbacks
# ═══════════════════════════════════════════════════════════
# echo "[$TIMESTAMP] [$HOOK] INTENTIONAL FAILURE — studying rollback behavior"
echo ""
echo "  What happens next (trace it):"
echo "  ┌─────────────────────────────────────────────────────┐"
# echo "  │ 1. CodeDeploy sees exit 1 → marks deploy FAILED    │"
# echo "  │ 2. If auto-rollback ON:                            │"
# echo "  │    → NEW deployment of last good revision starts    │"
# echo "  │    → All hooks run again (full lifecycle)           │"
# echo "  │    → Rollback = redeploy, NOT restore               │"
# echo "  │ 3. If auto-rollback OFF:                            │"
# echo "  │    → Bad version stays. No traffic. You're stuck.  │"
# echo "  │ 4. BeforeAllowTraffic never fires (we failed here) │"
# echo "  │ 5. AllowTraffic never fires (instance stays off LB)│"
# echo "  │ 6. AfterAllowTraffic never fires                   │"
# echo "  └─────────────────────────────────────────────────────┘"
# echo ""
#
# exit 1

exit 0
