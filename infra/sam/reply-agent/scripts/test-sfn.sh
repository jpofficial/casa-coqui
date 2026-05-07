#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# test-sfn.sh — end-to-end test of the deployed casa-coqui-reply-draft SFN.
#
# Reads samples/full-input.json (built by build-sfn-sample.js), starts an
# execution, polls describe-execution until terminal, prints the final
# status + output.
#
# Pass: status == SUCCEEDED AND output.chainResult.output.final.finalDraft.reply
# is a non-empty string AND each chain step has tokens > 0.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLE="${SCRIPT_DIR}/../samples/full-input.json"
SM_ARN="${SM_ARN:-arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft}"

if [ ! -f "$SAMPLE" ]; then
  echo "ERROR: $SAMPLE not found. Run build-sfn-sample.js first."
  exit 1
fi

echo "Starting execution against: $SM_ARN"
EXEC_ARN=$(aws stepfunctions start-execution \
  --state-machine-arn "$SM_ARN" \
  --input "file://$SAMPLE" \
  --query executionArn --output text)
echo "Started: $EXEC_ARN"

START_TIME=$(date +%s)
while true; do
  STATUS=$(aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" --query status --output text)
  ELAPSED=$(( $(date +%s) - START_TIME ))
  echo "  [${ELAPSED}s] status=${STATUS}"
  [ "$STATUS" != "RUNNING" ] && break
  if [ "$ELAPSED" -gt 120 ]; then
    echo "ERROR: execution did not terminate within 120s"
    exit 1
  fi
  sleep 2
done

echo
echo "=== Final state ==="
aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" \
  --query '{Status:status,StartDate:startDate,StopDate:stopDate}' --output json

echo
echo "=== Output ==="
aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" \
  --query 'output' --output text | jq .

if [ "$STATUS" != "SUCCEEDED" ]; then
  exit 1
fi
