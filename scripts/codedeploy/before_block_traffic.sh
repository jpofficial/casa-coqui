#!/bin/bash
# Hook 1: BeforeBlockTraffic
# Runs BEFORE CodeDeploy deregisters the instance from the ALB target group.
# Use case: log the event, notify monitoring, set instance to "draining" in your dashboard.
#
# DOP-C02 exam note: This hook only fires when the deployment group has
# a load balancer configured. No LB = no traffic hooks at all.

set -e

HOOK="BeforeBlockTraffic"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DEPLOY_ID="${DEPLOYMENT_ID:-unknown}"

echo "[$TIMESTAMP] [$HOOK] Deployment $DEPLOY_ID — preparing to drain traffic"
echo "[$TIMESTAMP] [$HOOK] Instance $(hostname) will be deregistered from ALB target group"

# In production you might:
# - Set a flag in DynamoDB/SSM so your dashboard shows "deploying"
# - Send a CloudWatch custom metric for deploy tracking
# - Notify a Slack webhook

exit 0
