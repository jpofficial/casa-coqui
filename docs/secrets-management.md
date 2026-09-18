# Secrets Management

This document describes where each secret is used and how to rotate it safely.
Never commit API keys, service account JSON, or any other credentials to git.

---

## ANTHROPIC_API_KEY

Used by the AI draft generation code (Reservation & Reply Agent).

### Where it lives

| Environment | Location | Notes |
|-------------|----------|-------|
| Next.js (Vercel) | Vercel project settings > Environment Variables | Server-side only. Do NOT prefix with `NEXT_PUBLIC_`. |
| Cloud Functions | Firebase Functions secrets (`firebase functions:secrets:set ANTHROPIC_API_KEY`) | Injected at deploy time; never stored in source. |

### Rotation procedure

1. Generate a new key at https://console.anthropic.com/settings/keys.
2. Add the new key to Vercel staging environment and run a smoke test against the AI draft endpoint.
3. If staging passes, update the Vercel production environment variable and trigger a redeployment.
4. Update the Firebase Functions secret: `firebase functions:secrets:set ANTHROPIC_API_KEY` and redeploy affected functions.
5. Revoke the old key in the Anthropic console only after both deployments are confirmed healthy.
6. Rotate both the Vercel and Functions copies in the same change window — they must stay in sync.

---

## FIREBASE_SERVICE_ACCOUNT_KEY

A JSON string containing the Firebase Admin SDK service account credentials. Used anywhere the Admin SDK runs outside of the Firebase managed runtime (i.e., not inside a Cloud Function itself).

### Where it lives

| Environment | Location | Notes |
|-------------|----------|-------|
| Next.js (Vercel) | Vercel project settings > Environment Variables | Used by API routes and `lib/firebaseAdmin.js`. |
| Cloud Functions (local dev) | `functions/.env` (gitignored) | Read by `functions/firebaseInit.js` for local emulator runs. |
| AWS Lambda (email parser) | AWS Secrets Manager, secret name `casa-coqui/firebase-service-account` | Lambda retrieves at cold start via `@aws-sdk/client-secrets-manager`. |

### Rotation procedure

1. In the Firebase console, go to Project Settings > Service Accounts > Generate new private key.
2. Download the new JSON file.
3. Update the secret in all three locations:
   - Vercel: paste the entire JSON as a single-line string in the `FIREBASE_SERVICE_ACCOUNT_KEY` environment variable, then trigger a redeployment.
   - `functions/.env`: replace the value locally. Do not commit this file.
   - AWS Secrets Manager: update the secret value via the AWS console or `aws secretsmanager put-secret-value`.
4. Trigger a test Lambda invocation and a Vercel preview deployment to confirm auth works.
5. Revoke the old service account key in the Firebase console under Project Settings > Service Accounts.

---

## General rules

- Never hardcode secrets in source code.
- Never commit `.env.local`, `functions/.env`, or any downloaded service account JSON to git.
- All secret names used as environment variables must appear in `.env.local.example` (with empty values) so developers know what to populate.
- If a secret is ever accidentally committed, treat it as compromised: rotate immediately and audit access logs.
