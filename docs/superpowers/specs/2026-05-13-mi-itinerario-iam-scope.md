# Mi Itinerario — Vercel IAM scope reference

The Vercel-side AWS access keys (`MI_ITINERARIO_AWS_ACCESS_KEY_ID` / `MI_ITINERARIO_AWS_SECRET_ACCESS_KEY`) are used by the Next.js routes that talk to DynamoDB directly:

- `app/puerto-rico-itinerary/[plan_id]/page.js` — server-component reads (hydration)
- `app/api/plan/[plan_id]/route.js` — GET hydrated plan
- `app/api/plan/[plan_id]/delete/route.js` — user-initiated DELETE (new in PR #14)

The Lambda functions have their own IAM execution roles (managed in `infra/stacks/itinerary_stack.py`) — those are scoped correctly via CDK and do not need changes.

## Required minimum policy for the Vercel IAM user

Replace `<ACCOUNT>` with `524140443248` (the AWS account ID).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadItineraries",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:BatchGetItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:<ACCOUNT>:table/mi-itinerario-itineraries",
        "arn:aws:dynamodb:us-east-1:<ACCOUNT>:table/mi-itinerario-activities"
      ]
    },
    {
      "Sid": "DeleteOwnItineraryByPlanId",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DeleteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:<ACCOUNT>:table/mi-itinerario-itineraries"
      ]
    }
  ]
}
```

That's it. **Two** action groups: read on both tables (for page hydration), delete on itineraries (for the new /api/plan/[plan_id]/delete route).

## What this IAM user should NOT have

- `dynamodb:PutItem` / `UpdateItem` — itinerary writes go through the Lambda, which has its own role with explicit `grant_write_data` in the CDK stack. The Vercel layer never writes new itineraries.
- `dynamodb:DeleteItem` on the activities table — only generate-pipeline (Lambda) and the manual seed script touch activities.
- Any action on `mi-itinerario-events-cache` — Vercel doesn't read events directly.
- Any `bedrock:*` — Vercel never invokes Bedrock; that's all server-side via API Gateway → Lambda.
- Any cross-region or cross-account access.
- Console access (`iam:CreateAccessKey`, etc.).

## To apply

1. AWS Console → IAM → Users → pick the user backing `MI_ITINERARIO_AWS_ACCESS_KEY_ID`.
2. Permissions → Add inline policy.
3. Paste the JSON above with `<ACCOUNT>` replaced.
4. Name: `MiItinerarioVercelMinimum`.
5. Save.
6. If you find the user has BROADER permissions attached (e.g. `AmazonDynamoDBFullAccess` or `AdministratorAccess`), DETACH them — those broad grants are what S3's review flagged as the "unknown / likely overscoped" concern.

## Verify after applying

```bash
# Should succeed (read):
aws dynamodb get-item \
  --table-name mi-itinerario-itineraries \
  --key '{"plan_id":{"S":"test"}}' \
  --profile vercel-mi-itinerario  # whatever local profile mirrors the Vercel creds

# Should succeed (read activities):
aws dynamodb batch-get-item \
  --request-items '{"mi-itinerario-activities":{"Keys":[{"activity_id":{"S":"x"}}]}}' \
  --profile vercel-mi-itinerario

# Should FAIL with AccessDenied — writes go through Lambda:
aws dynamodb put-item \
  --table-name mi-itinerario-itineraries \
  --item '{"plan_id":{"S":"unauthorized-write"}}' \
  --profile vercel-mi-itinerario
```

## Future hardening

When ready, migrate from static access keys to **Vercel OIDC**:
- Vercel issues short-lived OIDC tokens to your Vercel functions
- AWS IAM Role with a trust policy that accepts Vercel's OIDC issuer
- No static access keys in env vars to rotate or leak

This is documented at https://vercel.com/docs/security/secure-backend-access — recommended path once you have time. Estimated 2-3 hours of work, removes the static-key blast radius entirely.
