#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# verify-appconfig.sh — post-deploy smoke check.
#
# Catches the schema-syntax-typo edge case: if the validator JSON itself
# is malformed, AppConfig may accept it without validating anything,
# letting a bad seed land in the profile. This script fetches the
# deployed config and asserts the required fields are present.
# ---------------------------------------------------------------------------

APP_NAME="casa-coqui-reply-agent"
ENV_NAME="prod"
PROFILE_NAME="system-prompt"

APP_ID=$(aws appconfig list-applications --query "Items[?Name=='$APP_NAME'].Id" --output text)
[ -z "$APP_ID" ] && { echo "ERROR: AppConfig Application '$APP_NAME' not found"; exit 1; }

ENV_ID=$(aws appconfig list-environments --application-id "$APP_ID" --query "Items[?Name=='$ENV_NAME'].Id" --output text)
[ -z "$ENV_ID" ] && { echo "ERROR: AppConfig Environment '$ENV_NAME' not found"; exit 1; }

PROFILE_ID=$(aws appconfig list-configuration-profiles --application-id "$APP_ID" --query "Items[?Name=='$PROFILE_NAME'].Id" --output text)
[ -z "$PROFILE_ID" ] && { echo "ERROR: AppConfig ConfigurationProfile '$PROFILE_NAME' not found"; exit 1; }

# Fetch latest config (legacy GetConfiguration API for simplicity)
aws appconfig get-configuration \
  --application "$APP_NAME" \
  --environment "$ENV_NAME" \
  --configuration "$PROFILE_NAME" \
  --client-id "verify-appconfig-smoke-test" \
  /tmp/appconfig-content.bin >/dev/null 2>&1

if [ ! -s /tmp/appconfig-content.bin ]; then
  echo "ERROR: failed to fetch deployed config"
  exit 1
fi

CONTENT=$(cat /tmp/appconfig-content.bin)

# Assert required fields present
for FIELD in version language_distribution hard_bans system_prompt_text; do
  VAL=$(echo "$CONTENT" | jq -r ".$FIELD // \"MISSING\"")
  if [ "$VAL" = "MISSING" ] || [ -z "$VAL" ] || [ "$VAL" = "null" ]; then
    echo "❌ FAIL: required field '$FIELD' is missing or empty in deployed config"
    exit 1
  fi
  echo "✅ Field present: $FIELD"
done

VERSION=$(echo "$CONTENT" | jq -r '.version')
echo
echo "✅ All required fields present. Deployed system-prompt version: $VERSION"
