# Security Review S3 — General Flow / OWASP

**Reviewer:** Security Engineer 3 of 3 (general flow)
**Scope:** Mi Itinerario request path end-to-end. Excludes XSS sanitization (S1) and prompt-injection (S2).
**Date:** 2026-05-12
**Posture:** Anonymous-by-design, public Bedrock-backed endpoint, no caller identity, no rate limiting, no WAF.

---

## Executive summary

The Mi Itinerario stack is functionally correct but is a textbook **cost-amplification target**: an unauthenticated public endpoint that fans out to a paid LLM (Bedrock Haiku 4.5 at ~$0.01/invocation) and DynamoDB on-demand, with **zero throttling at any layer** (no Next.js middleware rate-limit, no API Gateway throttle, no WAF, no Bedrock provisioned-throughput cap). A single attacker with a $5 VPS can burn ~$500/hr of Bedrock spend and saturate the 25s upstream timeout. The top three priorities are (1) put a hard ceiling on Bedrock cost via API Gateway throttling + Vercel middleware IP rate-limit, (2) lock CORS on API Gateway to `https://www.casa-coqui.cc` so the AWS endpoint isn't trivially callable from any browser, and (3) shrink the Vercel-side IAM principal from "AWS access key in env" to read-only + role-assumption for the page hydration path.

Secondary concerns: plan_id entropy (60 bits) is *probably* fine for anonymity but is one ad-funnel scrape away from being too low; PII in free-text has no deletion path; Lambda's 500-error includes `err.message` directly to the caller; the activities table is `Scan`'d on every generation (DoS amplifier).

---

## Critical findings (immediate prod risk)

### #1 — Zero rate limiting on a Bedrock-backed public endpoint
- **File / Layer:**
  - `app/api/plan/generate/route.js` (Next.js edge → Lambda forward, no throttle)
  - `infra/stacks/itinerary_stack.py:266-275` (HttpApi with no `throttle` or `default_route_throttling_burst_limit` configured)
  - `infra/lambdas/itinerary_generate/index.mjs:14-72` (Lambda, no concurrency reservation)
- **Vector:** Anyone scripts `curl -X POST https://www.casa-coqui.cc/api/plan/generate -d '{"interests":["foodie"],"num_days":14}'` in a loop. Each request:
  - Invokes Bedrock Haiku 4.5 → ~$0.01 per call at current pricing
  - Issues a full DDB `Scan` on `mi-itinerario-activities` (see `index.mjs:138-143`)
  - Writes 1 itinerary item to DDB on-demand
  - Lambda timeout = 30s, Vercel route timeout = 60s, Vercel upstream timeout = 25s (`route.js:43`)
  - Per request cost ~$0.012 (Bedrock + DDB on-demand + Lambda). At 100 req/s sustained from a single VPS, that is **~$3,600/hr** of attacker-driven AWS spend.
- **Blast radius:**
  - **Financial:** Bedrock has *no account-level on-demand cap*. The AWS budget alarms (not visible in this repo) are the only backstop. The CloudWatch alarms in `itinerary_stack.py:247-263` trip on **errors** and **duration** — neither catches "everything worked, but you spent $50k overnight."
  - **Service availability:** Bedrock on-demand has per-account TPM/RPM limits for Haiku 4.5. Sustained flooding will hit those limits and start returning `ThrottlingException` — legitimate users get fallback plans (route.js:64) and the value prop is dead.
  - **Cascading:** Each Lambda invocation does a full Scan of the activities table. With ~85 items today that's cheap, but adds RCU consumption that scales linearly with attack volume. On-demand pricing means no ceiling.
- **Fix (priority order):**
  1. **API Gateway HTTP API throttling** — set `default_route_throttling_burst_limit=20` and `default_route_throttling_rate_limit=10` on the `HttpApi` construct. This is a 5-minute infra change and immediately caps absolute spend at ~$36/hr ceiling no matter the attacker.
  2. **Next.js middleware IP-based rate-limit** — Vercel offers `@vercel/kv` + `@upstash/ratelimit` (≤5/min/IP for `/api/plan/generate`). Free tier covers this.
  3. **AWS WAF on the API Gateway stage** — `AWSManagedRulesAmazonIpReputationList` + `AWSManagedRulesAnonymousIpList` + rate-based rule (100 req / 5 min / IP). ~$5/mo per ACL + $1/rule.
  4. Set **reserved concurrency = 5** on `ItineraryGenerateFn`. Caps parallel Bedrock calls regardless of upstream throttling.
  5. **AWS Budgets + budget action** — auto-detach Bedrock invoke permission from the Lambda role if monthly spend exceeds $X. Heavy-handed but a real circuit breaker.

### #2 — API Gateway CORS allows `*` and accepts requests from any origin
- **File / Layer:** `infra/stacks/itinerary_stack.py:270-274`
  ```python
  cors_preflight=apigw.CorsPreflightOptions(
      allow_origins=["*"],  # tighten to casa-coqui.cc domains before prod
      ...
  )
  ```
  Lambda response in `index.mjs:329` also hardcodes `access-control-allow-origin: *`.
- **Vector:** Even though Next.js proxies the request server-side (so browsers normally never hit the API Gateway URL directly), the API Gateway URL **is public** and **anyone** can call it from any origin. CORS is meaningless for server-to-server attackers (curl/script doesn't honor CORS) — but the wildcard means a malicious site (`scam-pr-trip.com`) can put a copy of the wizard on their site and call your API Gateway directly from victim browsers, getting victims' IPs to do the spend on your behalf. This bypasses any rate limit you put on the Vercel layer.
- **Blast radius:** Free distributed Bedrock spend for any clone site. Also: the API Gateway endpoint URL leaks in `MI_ITINERARIO_API_URL` env var on the Vercel server — but it's also discoverable by anyone reading network traces (the browser doesn't see it currently, *because* the Next.js route is the proxy). A motivated attacker would find it via AWS bug-bounty style enumeration or by getting one Vercel env-var leak.
- **Fix:**
  1. Replace `allow_origins=["*"]` with `["https://www.casa-coqui.cc", "https://casa-coqui.cc"]`. Add `https://*.vercel.app` only if previews are needed (better: don't — previews can hit a separate stage).
  2. Remove the hardcoded `access-control-allow-origin: *` from the Lambda response in `index.mjs:329`. API Gateway handles CORS for the HTTP API; the Lambda shouldn't second-guess it.
  3. **More important than CORS**: require a shared secret header (`x-api-key` or HMAC of body+timestamp) between Vercel and API Gateway. CORS protects browsers; a header secret protects against anyone with the URL. Store as a Vercel env var, validate in the Lambda. This is your real "only Vercel can call this" defense.

### #3 — Vercel-side AWS IAM credentials grant more than read-only
- **File / Layer:** `lib/itinerary/dynamodb.js:11-20`. The `MI_ITINERARIO_AWS_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` env vars are used to read DDB from the Next.js server component (`app/puerto-rico-itinerary/[plan_id]/page.js`).
- **Vector:** I cannot read the IAM policy document attached to that user from this repo (it's not in `itinerary_stack.py` — the Lambda role is, but not the human/programmatic IAM user backing those env vars). Two failure modes:
  1. If that IAM user has `AmazonDynamoDBFullAccess` or table-level read+write, then a Vercel env-var leak (compromised Vercel account, leaked `.env.local` commit, malicious npm dep reading env) gives the attacker:
     - Full read of all itineraries (privacy breach — `special_requests` PII)
     - Ability to **overwrite** any itinerary by plan_id → defacement vector (write a malicious itinerary, send the plan_id link to the victim)
     - Ability to **delete** items → user's plans disappear
     - Potentially access to other tables in the account
  2. The credentials are long-lived static keys, with no rotation policy visible.
- **Blast radius:** Total data integrity for `mi-itinerario-itineraries` table, full read of all PII in `special_requests`, lateral movement to any other AWS resource that user has access to.
- **Fix:**
  1. **Verify (and tighten) the IAM user's policy** — should be exactly:
     ```json
     {
       "Effect": "Allow",
       "Action": ["dynamodb:GetItem", "dynamodb:BatchGetItem"],
       "Resource": [
         "arn:aws:dynamodb:us-east-1:ACCT:table/mi-itinerario-itineraries",
         "arn:aws:dynamodb:us-east-1:ACCT:table/mi-itinerario-activities"
       ]
     }
     ```
     Nothing else. No `PutItem`, no `Scan` on other tables, no `*` resource.
  2. **Migrate to Vercel OIDC → AWS role assumption** instead of static keys. Vercel's OIDC integration lets the Vercel function exchange a short-lived OIDC token for an STS-issued temporary credential. No keys in env vars, automatic rotation. Documented at https://vercel.com/docs/security/secure-backend-access. This is the right long-term fix.
  3. **Rotate the current access key now** (independent of #1/#2) so any prior leak is dead.
  4. Add CloudTrail alarms on `mi-itinerario-itineraries` `PutItem` or `DeleteItem` from this IAM principal — should never happen (only Lambda writes).

---

## High findings

### #4 — plan_id entropy is 60 bits, enumerable if scraping persists
- **File / Layer:** `infra/lambdas/itinerary_generate/index.mjs:24` uses `nanoid(10)`. Default nanoid alphabet is 64 chars (URL-safe), so 10 chars = 60 bits.
- **Vector:** 60 bits is fine against random guessing today (2^60 ≈ 1.15e18; at 100 req/s you'd need ~3.6 million years to find one valid plan_id). But:
  - Plan_ids surface on the SHARE buttons (the itinerary URL is the plan_id), in social media posts, in screenshots, in Google Search Console if Google crawls them, in CDN access logs, in user emails (if they email themselves the link).
  - The "anonymous + shareable" design means the URL **is** the access token, and there is **no rate limit on `/api/plan/[plan_id]` or `/puerto-rico-itinerary/[plan_id]`** (server component reads DDB directly with no throttle).
  - If a plan_id is shared, anyone with it can read the entire itinerary including `special_requests` PII (note: I observe in `index.mjs:51-65` that `special_requests` is **stored** in DDB but is **NOT** echoed in the `resp(200, ...)` body — only `plan_id` and `days`. **But** the GET path at `app/api/plan/[plan_id]/route.js:20` returns the entire DDB item: `return Response.json({ ...itinerary, days: hydrated });` — that DOES include `special_requests` if it was written to DDB. See finding #6.)
- **Blast radius:** Privacy violation if PII is in `special_requests` and the plan_id link gets shared further than intended. For random guessing alone, 60 bits is fine.
- **Fix:**
  1. **Don't expose `special_requests` in the GET response.** Filter the field at `app/api/plan/[plan_id]/route.js:20` and at `app/puerto-rico-itinerary/[plan_id]/page.js`. See finding #6.
  2. (Optional) bump to `nanoid(16)` = 96 bits. Costs nothing, makes the share URL slightly uglier.
  3. Add a server-side rate-limit on the GET path (e.g. 60/min/IP) to defeat brute-force enumeration if entropy is ever reduced.

### #5 — Activities table full-Scan on every generation
- **File / Layer:** `infra/lambdas/itinerary_generate/index.mjs:137-143`
  ```js
  async function loadActivities(interests) {
    // Phase-1 simple scan; Phase 2 of this plan adds GSI query
    const out = await ddb.send(new ScanCommand({ TableName: ACTIVITIES_TABLE }));
    return (out.Items || []).filter(...);
  }
  ```
- **Vector:** Each `/generate` call does a full table Scan. With 85 items today, latency is low and RCU consumption is small. But:
  - DDB on-demand charges per RCU consumed. A full Scan = `ceil(table_size_bytes / 4KB)` RCUs.
  - At scale, attacker traffic (finding #1) means N Scans/sec, each scanning all items.
  - The GSI `neighborhood-type-index` exists (`itinerary_stack.py:46-50`) but is unused.
  - This is a known cost-amplification antipattern: every read does O(table_size) work.
- **Blast radius:** Bedrock cost dwarfs DDB cost today (~$0.01 vs ~$0.001/call), so this is a secondary concern. But if the activities table grows to 1000 items, RCU spend per generation grows ~12x.
- **Fix:**
  1. Cache the activities table in Lambda warm memory (module-scope `let activities = null; if (!activities) { activities = scan() }` with a 5-min TTL). The table is essentially static.
  2. Even better: bake activities into the Lambda zip at deploy time (it's seed data) and re-deploy when it changes.
  3. Or: use the existing GSI with `interests`-derived query keys.

### #6 — `special_requests` round-trips back to the client via GET API
- **File / Layer:**
  - `infra/lambdas/itinerary_generate/index.mjs:54-63` writes `special_requests` into the DDB item? **Actually no** — re-reading the `PutCommand`, I see the Item only includes `interests, num_days, traveler_type, pace, days, generated_at, ttl_epoch`. `special_requests` is **NOT** persisted. **Good.**
  - But: `app/api/plan/[plan_id]/route.js:20` does `Response.json({ ...itinerary, days: hydrated })` — spreads the entire DDB record. If a future change adds `special_requests` to the persisted Item, it leaks instantly.
- **Vector:** This is a latent risk, not an active one. The current Lambda code does NOT persist `special_requests`. But:
  - Plan 7 (multi-turn refine) will presumably need to remember `special_requests` to keep conversation continuity.
  - The `itinerary_refine` Lambda already has `grant_read_write_data` on the itineraries table (`itinerary_stack.py:228`) — it might already be persisting it.
  - Any developer adding "show user what they asked for" UX will store + retrieve it.
- **Blast radius:** Whoever has the plan_id can read what the user typed (could be PII: "anniversary March 5 with my husband John who has celiac", "traveling with my 4yo daughter Maria"). plan_id ≈ access token; anyone with the link gets it.
- **Fix:**
  1. **Explicit allowlist** at the GET API instead of spread: `return Response.json({ plan_id, num_days, interests, traveler_type, pace, days: hydrated, ttl_epoch, is_fallback });`. Never leak fields you didn't intend to expose.
  2. If `special_requests` IS persisted in DDB (now or later), encrypt it at rest with a separate KMS key tied to the plan_id, or hash it with HMAC-SHA256(plan_id, server_secret) so the plain text is only reconstructible with the server secret.
  3. Add a DELETE endpoint (`DELETE /api/plan/[plan_id]`) and a "Delete my itinerary" CTA on the share page. GDPR/CCPA compliance gap right now: no way for a user to delete their plan before the 90-day TTL.

### #7 — Lambda 500 response includes raw `err.message`
- **File / Layer:** `infra/lambdas/itinerary_generate/index.mjs:68-71`
  ```js
  } catch (err) {
    console.error('generate failed:', err);
    return resp(500, { error: 'generation_failed', detail: err.message });
  }
  ```
- **Vector:** `err.message` from `@aws-sdk/client-bedrock-runtime` typically includes specific exception names and details: `AccessDeniedException: User: arn:aws:sts::ACCT:assumed-role/MiItinerarioStack-ItineraryGenerateFnServiceRole-XXX/ItineraryGenerateFn-XXX is not authorized to perform: bedrock:InvokeModel on resource: arn:aws:bedrock:us-east-1::foundation-model/...`. That leaks AWS account ID, role name, ARN structure.
- **Blast radius:** Low-to-medium — AWS account IDs aren't exactly secret (visible in some response headers anyway), but they're recon material. Role names confirm the stack structure to an attacker. The Next.js route catches the 500 and falls back to `FALLBACK_PLAN` (`route.js:61-67`), so the user never sees this — **but the Lambda's response IS visible to anyone calling API Gateway directly** (which is unauthenticated public — see finding #2).
- **Fix:**
  1. Return a generic error: `return resp(500, { error: 'generation_failed' });`. Log the detail to CloudWatch only.
  2. Same treatment for the Next.js route's `_fallback_reason: err.message` (`route.js:64`) — this surfaces in the client JSON response. Replace with a coarse enum: `_fallback_reason: 'upstream_unavailable' | 'schema_mismatch' | 'timeout'`.

### #8 — No Vercel deployment protection + production CLI deploy footgun
- **File / Layer:** No code; project configuration concern.
- **Vector:** The prior incident in your memory file (stale-tree `vercel --prod`) confirms that production deploys via CLI are still enabled. Combined with:
  - No PR-required policy
  - No "Production deployments require Git" lock
  - Vercel CLI uses the local working tree, not the Git HEAD
  - Static AWS keys in Vercel env vars (finding #3) mean a compromised local laptop = compromised prod IAM access
- **Blast radius:** Any developer's laptop with `vercel link` + `vercel --prod` overwrites prod. Already happened once per the memory.
- **Fix:**
  1. In Vercel project settings → **Git → Deploy Hooks**: enable "Production deployments via Git only." Disable CLI deploys to production.
  2. Require all prod deploys to come from `main` branch only.
  3. Audit `vercel deployments ls --prod --limit 20` for any unexpected CLI-source deploys post-fix.
  4. Enable Vercel Deployment Protection for **preview** deploys (Vercel "Standard Protection") so anonymous scrapers can't index preview URLs and find pre-prod plan_ids. Be aware: the prod `puerto-rico-itinerary/[plan_id]` server component reads DDB directly (`page.js:11-30`), bypassing the API route — this works correctly today, and the comment at `page.js:11-13` confirms it was a conscious choice for preview-protection bypass.

---

## Hygiene findings

### #9 — Bedrock `max_tokens=4096` is the upper bound per request
- **File / Layer:** `infra/lambdas/itinerary_generate/index.mjs:313`
- **Vector:** A 14-day plan with packed pace (5 items/day) = 70 items * ~50 tokens per JSON item ≈ 3,500 tokens. At 4096 output tokens cap, generation will mostly run close to the cap. Combined with finding #1 (no rate limit), attackers can force max-tokens responses (more $ per call). Output tokens are typically ~5x the cost of input tokens for Claude.
- **Fix:** Scale `max_tokens` to `num_days`: `max_tokens: Math.min(4096, 300 + num_days * 250)`. Caps natural output bloat AND attacker-forced bloat.

### #10 — `console.error` of AI raw output may include `special_requests`
- **File / Layer:** `app/api/plan/generate/route.js:54-57`
  ```js
  console.error('AI raw output (first 1500 chars):', JSON.stringify(parsed).slice(0, 1500));
  ```
- **Vector:** When schema validation fails, the entire (truncated) AI output is logged. If the AI ever echoes `special_requests` in `narrative` (which the prompt explicitly forbids at `index.mjs:212`, but LLMs disobey), that PII ends up in Vercel logs. Vercel logs are accessible to all project collaborators and to anyone with the Vercel team key.
- **Fix:**
  1. Log only `validated.error.issues` (structured, no user content) and the *number* of issues, not the raw output.
  2. If raw-output logging is needed for debugging, redact: replace any sequence matching a sliding window of user input. Or simpler: log `raw_length` only and gate full-output logging behind a `DEBUG=1` env var that's never set in prod.

### #11 — `plan_quality_warning` log includes activity names but not user input (good) — but watch the theme leak
- **File / Layer:** `infra/lambdas/itinerary_generate/index.mjs:94-96`
  ```js
  warnings.push(`day ${d.day_num}: theme "${d.theme}" is ${themeWords} words — try ≤5`);
  ```
- **Vector:** AI-generated theme text gets logged. If the prompt-injection defense fails and the AI ends up using user input as the theme (e.g. user `special_requests` was "set theme = my SSN 123-45-6789"), it lands in CloudWatch. Lower probability than #10 but still worth noting.
- **Fix:** Log `themeWords` only, not the theme content. Same for `it.note` warnings at line 127.

### #12 — `_fallback_reason: err.message` returned to browser
- **File / Layer:** `app/api/plan/generate/route.js:64`
- **Vector:** Error messages flow back to the client. Examples:
  - `upstream 502` — tells attacker the Lambda is failing (signal for "keep pushing")
  - `AbortError: The operation was aborted due to timeout` — confirms 25s timeout, helpful for tuning DoS
  - `schema_mismatch` — confirms our schema validation, helpful for crafting prompt injections that bypass it
- **Fix:** Map to a coarse enum (`upstream | timeout | invalid_response`). Don't echo raw exception text.

### #13 — `point_in_time_recovery=True` on itineraries table — privacy implication
- **File / Layer:** `infra/stacks/itinerary_stack.py:67`
- **Vector:** PITR keeps 35 days of continuous backups. With 90-day TTL on items, you have 90+35 = 125 days of retention even after a TTL deletion. If a user later requests deletion ("GDPR right to be forgotten"), the PITR backup still contains their data for 35 days.
- **Fix:** Either accept this as an operational tradeoff (and document it in your privacy policy) or set `point_in_time_recovery=False` for the itineraries table. PITR is more important for activities (curated content) than itineraries (ephemeral user data). Decision is yours.

### #14 — `RemovalPolicy.RETAIN` on all DDB tables
- **File / Layer:** `itinerary_stack.py:41, 69, 90`
- **Vector:** This is correct for prod, but means a `cdk destroy` leaves the tables behind. A subsequent `cdk deploy` will fail because the table already exists. Not a security issue, just a deployment ergonomics one. Worth noting.

### #15 — No dependency-vuln scanning observed in the repo
- **File / Layer:** General process recommendation.
- **Vector:** Both Lambdas pin to current `@aws-sdk/*` and `nanoid` per their package.json. No `npm audit` CI step. Notable recent CVE space:
  - `nanoid` < 3.3.8 had CVE-2024-55565 (predictable IDs under non-integer `size`). Current Lambda uses `nanoid(10)` (integer), so not affected, but worth pinning to ≥ 3.3.8.
  - `@aws-sdk/*` packages historically have had bundled `axios`/`form-data`/`fast-xml-parser` CVEs.
- **Fix:**
  1. Add `npm audit --production` to CI (GitHub Actions).
  2. Add Dependabot or Renovate weekly PRs.
  3. Pin specific minor versions in Lambda package.json (currently looks like default `^`).

### #16 — `AbortSignal.timeout(25_000)` is good but 60s Vercel `maxDuration` is wasteful
- **File / Layer:** `app/api/plan/generate/route.js:5-6, 43`
- **Vector:** `maxDuration = 60` means a Vercel function runs up to 60s, but the upstream fetch aborts at 25s. The extra 35s is wasted budget. Vercel charges per GB-second of execution time; an attacker forcing 25s+ requests (the upstream timeout, after which fallback executes — a few ms) doesn't waste the full 60s, but the headroom is unused. Minor cost finding.
- **Fix:** Lower `maxDuration` to 30s. Catch any timeout edge case in the fallback handler.

### #17 — Bedrock model ID hardcoded — multi-region drift potential
- **File / Layer:** `index.mjs:9` `MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'`. Stack grants permission to `bedrock:us-east-1`, `us-east-2`, `us-west-2` (cross-region inference profile).
- **Vector:** Low. If the model is deprecated, the Lambda fails closed (returns 500 → fallback). Worth noting for the on-call runbook so the operator knows where to look.

### #18 — `is_fallback` flag never set by Lambda but rendered by page
- **File / Layer:**
  - `app/puerto-rico-itinerary/[plan_id]/page.js:69-73` checks `plan.is_fallback` for a banner.
  - But the DDB write in `index.mjs:54-63` never includes `is_fallback`, and the fallback path is in the Next.js route (returns `FALLBACK_PLAN` directly without writing to DDB).
- **Vector:** A fallback plan has `plan_id: fb-${nanoid(8)}` and is **never persisted**. So if the user reloads the share page, the server component does `getItinerary("fb-xxx")` → returns null → shows the "That itinerary isn't here anymore" message. Confusing UX, no security risk per se, but it means fallback plans are essentially session-only. Worth flagging.
- **Fix:** Either persist fallback plans (with a distinct ttl and `is_fallback: true`) or change the share UX to acknowledge the fallback is in-memory only. Out of scope for security but a correctness bug.

---

## What's handled correctly

- **No Twilio / SMS path** — consistent with the wider project pattern of avoiding paid OOB channels.
- **Server-side Next.js proxy** — browsers don't talk to API Gateway directly, the AWS endpoint isn't disclosed in client-side bundles. This is the right pattern.
- **Direct DDB read in the server component** — `app/puerto-rico-itinerary/[plan_id]/page.js` skips an internal HTTP round-trip and avoids Vercel Deployment Protection 401s on previews. Comment at line 11-13 documents the intent. Good.
- **DDB encryption at rest** with `AWS_MANAGED` keys on all tables (`itinerary_stack.py:39, 66, 86`).
- **TTL on itineraries** — 90-day auto-delete via `ttl_epoch` attribute. Privacy-positive default.
- **PITR enabled** on the production tables (note: this is a tradeoff — see finding #13).
- **IAM separation between Lambdas and tables** — `generate_fn` has `grant_read_data` on activities + `grant_write_data` on itineraries (NOT read). `refine_fn` has read+write on itineraries. Least-privilege at the Lambda role layer is correctly applied.
- **Bedrock IAM scoping** — explicitly limited to the Haiku 4.5 inference profile + 3 regional foundation-model ARNs, NOT a broad `bedrock:*` or `Resource: "*"`. Well done.
- **CloudWatch alarms** on error count and duration (`itinerary_stack.py:247-263`). Coverage is incomplete (no cost alarm — see finding #1) but the bones are there.
- **Bedrock uses Lambda execution role** — no static API keys for Bedrock. Correct.
- **Free-text sanitization** in two places (Next.js route + Lambda backstop). Defense-in-depth principle applied — comment at `index.mjs:163-164` explicitly notes the Lambda independently sanitizes because API Gateway is public. Excellent.
- **Schema validation of AI output** with Zod (`route.js:48`). Forces fallback if model misbehaves.
- **No password / OTP path** — anonymous-by-design means no credential management, no password reset attack surface.
- **DDB on-demand billing** with TTL — operationally simpler and self-cleaning. (The same on-demand pricing is also the cost-amplification target — see finding #1. Tradeoff is fine if rate limits exist.)
- **Secrets via Secrets Manager** for Eventbrite token (`itinerary_stack.py:100-106`) rather than env vars. Apply same pattern to any future secrets the generate Lambda needs.
- **CloudWatch structured JSON logging** for `metric_type: 'bedrock_invocation'` (`index.mjs:29-38`) — sets up nice CloudWatch Logs Insights queries for cost / token tracking. Token counts are logged; user input is not. Correct.
- **The `<user_input>`-delimited prompt framing** explicitly instructs the model not to echo user input back (`index.mjs:211`). Good defense-in-depth even though S2 owns prompt-injection. Combined with sanitization of `</user_input>` closing-tag smuggling (`index.mjs:172`) — solid.

---

## Recommended priority of fixes

1. **Rate-limit `/api/plan/generate`** — API Gateway throttle + Lambda reserved concurrency + Vercel middleware IP cap. ETA: 1-2 hours. Stops cost-amplification attacks. (Finding #1)
2. **Tighten CORS + add shared-secret header between Vercel and API Gateway** — prevents anyone from calling the API Gateway URL directly. ETA: 1 hour. (Finding #2)
3. **Stop spreading the DDB record in the GET API** — explicit allowlist on `app/api/plan/[plan_id]/route.js`. ETA: 15 min. (Finding #6)
4. **Strip `err.message` from `/generate` response** in both the Lambda 500 and the Next.js fallback path. ETA: 15 min. (Findings #7, #12)
5. **Verify the Vercel-side IAM user is read-only**, rotate the key, plan migration to Vercel OIDC. ETA: 1 hour audit + 1 day migration. (Finding #3)
6. **Disable production deploys via CLI** in Vercel project settings. ETA: 5 min. Lock to Git only. (Finding #8)
7. **Cap Bedrock `max_tokens` proportional to `num_days`**. ETA: 5 min. Soft cost guardrail. (Finding #9)
8. **AWS Budgets alarm** at $50/day for the Bedrock service in this account. ETA: 15 min. Last-line-of-defense circuit breaker. (Finding #1 backup)
9. **Cache or pre-bake activities table** in Lambda memory. ETA: 30 min. (Finding #5)
10. **Add `DELETE /api/plan/[plan_id]`** for user-initiated deletion + a "Delete my itinerary" link on the share page. ETA: 2 hours. GDPR/CCPA hygiene. (Finding #6 backup)
11. **Add `npm audit` to CI** + Dependabot. ETA: 30 min. (Finding #15)
12. **Audit Vercel logs for the AI-raw-output log line** — verify no PII has accumulated; if so, redact and purge. (Finding #10)

Items 1-4 are the immediate-prod-risk set. Items 5-8 are high-priority hygiene. Items 9-12 are best-practice cleanup once the bleeding stops.

---

## Notes for Plan 7 (multi-turn refine / auth)

When Plan 7 introduces identity (sign-in to keep itineraries beyond 90 days):

- **plan_id → user_id binding** must be enforced server-side at every GET. Currently anyone-with-the-link can read; once `user_id` exists, the GET handler at `app/api/plan/[plan_id]/route.js` must verify the calling user owns that plan_id (or the plan is explicitly "shared").
- **`refine_fn` already has read+write on itineraries** — once auth lands, it MUST verify the caller owns the plan before writing. Right now there is no caller identity at the Lambda layer.
- **Multi-turn chat will accumulate `special_requests`-like free text** across turns. The retention story (no DELETE today) becomes a bigger liability. Build the DELETE endpoint *before* shipping multi-turn.
- **Anonymous plans created pre-auth should be claimable** by sign-in. Design a `claim` flow: anonymous plan_id + new user_id → bind. Otherwise users will have orphan plans they can't manage.
- **PII handling**: if you plan to store user emails / names in `users/{uid}`, the IAM access policy (finding #3) must NOT have read on that table from the Vercel principal. Use a separate IAM principal for the auth path.

---

## Acknowledgements

The team has clearly thought about security at multiple layers — the bedrock IAM scoping, the prompt-injection delimiter strategy, the dual-sanitization, the schema validation, the TTL, the encryption-at-rest, and the separation between generate (write-only on itineraries) and refine (read+write) are all the right shapes. The gaps above are mostly about **rate limiting / cost containment** and **defensive output filtering** — the controls you need when you flip from "soft launch" to "Meta-ads-funnel scale." Get the rate-limit story in place before you flip the ad spend on.

— Security Engineer 3
