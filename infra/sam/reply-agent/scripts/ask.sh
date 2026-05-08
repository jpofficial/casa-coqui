#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# ask.sh — interactive single-question test of the deployed reply-draft SFN.
#
# Usage:
#   ./scripts/ask.sh "Hi Julio, what time is checkout?"
#   ./scripts/ask.sh "Hola, hay estacionamiento para dos carros?"
#   GUEST_NAME=Maria ./scripts/ask.sh "what time is checkin"
#
# Reads the existing samples/full-input.json as a template, swaps in
# your question + guest name, calls start-execution, waits, and prints
# just the reply (plus token/voice score summary).
#
# ENV overrides:
#   SM_ARN       — state machine ARN (default: prod casa-coqui-reply-draft)
#   GUEST_NAME   — guest first name (default: Tester)
#   MESSAGE_ID   — message id (default: ask-<timestamp>)
# ---------------------------------------------------------------------------

if [ $# -lt 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  echo "Usage: $0 \"<question>\""
  echo ""
  echo "Example:"
  echo "  $0 \"Hi Julio, what time is checkout?\""
  echo "  GUEST_NAME=Maria $0 \"is there a pool?\""
  exit 1
fi

QUESTION="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/../samples/full-input.json"
SM_ARN="${SM_ARN:-arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft}"
GUEST_NAME="${GUEST_NAME:-Tester}"
MESSAGE_ID="${MESSAGE_ID:-ask-$(date +%s)}"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: $TEMPLATE not found. Run build-sfn-sample.js or use the existing sample." >&2
  exit 1
fi

# Build SFN input by patching the template:
#   - message.body / guestName / id  → new question
#   - contextJson.inboundMessage.body / .from  → match (chain Lambdas read this)
#     The contextJson is a JSON-encoded STRING, so we parse it, mutate, re-stringify.
INPUT_FILE=$(mktemp /tmp/ask-input.XXXXXX)
mv "$INPUT_FILE" "${INPUT_FILE}.json"
INPUT_FILE="${INPUT_FILE}.json"
jq --arg q "$QUESTION" --arg name "$GUEST_NAME" --arg id "$MESSAGE_ID" '
  .message.body = $q
  | .message.guestName = $name
  | .message.id = $id
  | .contextJson = (
      .contextJson
      | fromjson
      | .inboundMessage.body = $q
      | .inboundMessage.from = $name
      | .inboundMessage.receivedAt = (now | todate)
      | tojson
    )
' "$TEMPLATE" > "$INPUT_FILE"

echo "──────────────────────────────────────────────"
echo "  ❓  Question: $QUESTION"
echo "  👤  Guest:    $GUEST_NAME"
echo "──────────────────────────────────────────────"
echo

EXEC_ARN=$(aws stepfunctions start-execution \
  --state-machine-arn "$SM_ARN" \
  --input "file://$INPUT_FILE" \
  --query executionArn --output text)

START_TIME=$(date +%s)
echo -n "  ⏳  Running..."
while true; do
  STATUS=$(aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" --query status --output text)
  ELAPSED=$(( $(date +%s) - START_TIME ))
  [ "$STATUS" != "RUNNING" ] && break
  echo -n "."
  if [ "$ELAPSED" -gt 120 ]; then
    echo
    echo "  ❌ Timed out after 120s"
    rm -f "$INPUT_FILE"
    exit 1
  fi
  sleep 1
done
echo " ${ELAPSED}s, $STATUS"
echo

if [ "$STATUS" != "SUCCEEDED" ]; then
  echo "  ❌ Execution failed."
  echo "  Inspect with:"
  echo "    aws stepfunctions describe-execution --execution-arn $EXEC_ARN"
  rm -f "$INPUT_FILE"
  exit 1
fi

OUTPUT_JSON=$(aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" \
  --query 'output' --output text)

# Extract reply. The chain has 3 success paths:
#   1. Evaluator passed first try → no .final field; reply at .drafter.draft.reply
#   2. Evaluator inline-revised → .final.finalDraft is a STRING (the revised text)
#   3. Reviser ran → .final.finalDraft is an OBJECT with .reply
FINAL_SRC=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.final.source // "drafter_passed"')
case "$FINAL_SRC" in
  evaluator_inline)
    REPLY=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.final.finalDraft')
    ;;
  reviser)
    REPLY=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.final.finalDraft.reply')
    ;;
  *)  # drafter_passed (no .final field — Evaluator passed first try)
    REPLY=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.drafter.draft.reply // "(no reply found)"')
    ;;
esac
LANG=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.drafter.draft.language // "?"')
SHOULD_ESCALATE=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.drafter.draft.shouldEscalate // false')
APP_CONFIG_VERSION=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.drafter.appConfigVersion // "?"')
SITUATION=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.reasoner.strategy.situationType // "?"')
EMOTION=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.reasoner.strategy.guestEmotion // "?"')
VOICE_SCORE=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.evaluator.evaluation.voiceScore // "?"')
PASSED=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.evaluator.evaluation.passed // false')

REASONER_IN=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.reasoner.tokens.input // 0')
REASONER_OUT=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.reasoner.tokens.output // 0')
DRAFTER_IN=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.drafter.tokens.input // 0')
DRAFTER_OUT=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.drafter.tokens.output // 0')
EVALUATOR_IN=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.evaluator.tokens.input // 0')
EVALUATOR_OUT=$(echo "$OUTPUT_JSON" | jq -r '.chainResult.output.evaluator.tokens.output // 0')
TOTAL_IN=$(( REASONER_IN + DRAFTER_IN + EVALUATOR_IN ))
TOTAL_OUT=$(( REASONER_OUT + DRAFTER_OUT + EVALUATOR_OUT ))

# Haiku 4.5 pricing (approx): $1/MTok input, $5/MTok output
COST=$(awk "BEGIN { printf \"%.4f\", ($TOTAL_IN * 1.0 + $TOTAL_OUT * 5.0) / 1000000 }")

echo "  ✉️   Reply:"
echo "──────────────────────────────────────────────"
echo "$REPLY" | fold -s -w 60 | sed 's/^/  /'
echo "──────────────────────────────────────────────"
echo
echo "  Strategy:        $SITUATION ($EMOTION)"
echo "  Final source:    $FINAL_SRC  (drafter_passed = clean first try; evaluator_inline = evaluator rewrote; reviser = full re-draft)"
echo "  Voice score:     $VOICE_SCORE/10  (passed: $PASSED)"
echo "  Language:        $LANG"
echo "  Should escalate: $SHOULD_ESCALATE"
echo "  AppConfig v:     $APP_CONFIG_VERSION"
echo "  Tokens:          $TOTAL_IN in / $TOTAL_OUT out  (Reasoner $REASONER_IN+$REASONER_OUT, Drafter $DRAFTER_IN+$DRAFTER_OUT, Evaluator $EVALUATOR_IN+$EVALUATOR_OUT)"
echo "  Est. cost:       \$$COST"
echo "  Execution:       $EXEC_ARN"

rm -f "$INPUT_FILE"
