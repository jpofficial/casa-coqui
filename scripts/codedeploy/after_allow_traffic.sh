#!/bin/bash
# Hook 8: AfterAllowTraffic
# Runs AFTER CodeDeploy has registered the instance with the ALB and
# traffic is flowing. This is your post-deploy smoke test.
#
# NOTE: This hook will NOT run in our exercise because ValidateService
# exits 1 earlier in the lifecycle.
#
# DOP-C02 exam note: This is the LAST hook in the lifecycle.
# If this fails, the deployment is marked failed and rollback triggers
# (if enabled). At this point traffic IS already flowing to the new version,
# so a failure here means users saw the new code briefly before rollback.
#
# AIP-C01 crossover: For Lambda deployments, AfterAllowTraffic is the
# PRIMARY validation hook (there's no ValidateService for Lambda).
# You'd invoke the function, send a test prompt to Bedrock, and verify
# the response matches expected output. If it fails, CodeDeploy shifts
# 100% of traffic back to the original Lambda version — no redeploy needed.

set -e

HOOK="AfterAllowTraffic"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ALB_DNS="casa-coqui-alb-1845864504.us-east-1.elb.amazonaws.com"

echo "[$TIMESTAMP] [$HOOK] Running post-deploy smoke test via ALB"

# Test through the ALB (HTTPS) to confirm end-to-end routing.
# -s = silent, -k = allow self-signed/ACM certs from inside VPC,
# -o /dev/null = discard body, -w "%{http_code}" = output HTTP status.
HTTP_STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "https://${ALB_DNS}/" --max-time 10 2>/dev/null || echo "000")

echo "[$TIMESTAMP] [$HOOK] ALB smoke test: HTTP $HTTP_STATUS"

if [ "$HTTP_STATUS" -ne 200 ]; then
    echo "[$TIMESTAMP] [$HOOK] SMOKE TEST FAILED — traffic is already flowing!"
    echo "[$TIMESTAMP] [$HOOK] Rollback will pull instance from ALB and redeploy last good version"
    exit 1
fi

echo "[$TIMESTAMP] [$HOOK] Deployment complete and verified through ALB"
echo "[$TIMESTAMP] [$HOOK] Casa Coqui is live on EC2!"

exit 0
