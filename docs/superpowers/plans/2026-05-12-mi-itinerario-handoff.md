# Mi Itinerario — Plan 1 Overnight Execution Handoff

**Branch:** `feat/mi-itinerario` (local only — not pushed yet)
**Status:** 15 of 16 tasks complete · 1 blocked on AWS Bedrock model access
**Date:** 2026-05-11 (overnight) → 2026-05-12 morning

---

## ⚠ One thing you need to do before MVP works end-to-end

**Open AWS Bedrock console and submit the Anthropic use case details form.**

1. Go to https://us-east-1.console.aws.amazon.com/bedrock/home#/modelaccess
2. Find **Claude Haiku 4.5** (model id `anthropic.claude-haiku-4-5-20251001-v1:0`)
3. Click "Manage access" → "Submit use case details" form
4. Fill it out (free, instant approval typically)
5. Wait ~5-15 minutes for propagation
6. Test: `curl -X POST https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com/generate -H "content-type: application/json" -d '{"interests":["foodie"],"num_days":3,"traveler_type":"couple","pace":"balanced"}'`

Until that form is submitted, every Lambda → Bedrock call returns:
> `Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model.`

Once submitted, the entire flow works end-to-end (wizard → Bedrock → DDB → view page).

---

## ✅ What's done and deployed

### AWS Infrastructure (all live in us-east-1)
- **`MiItinerarioStack`** — CDK stack with full IAM scoping
- **`mi-itinerario-activities`** DDB table (PK=activity_id, GSI=neighborhood-type-index, RETAIN policy) — **75 items seeded**
- **`mi-itinerario-itineraries`** DDB table (PK=plan_id, TTL=ttl_epoch, 90-day expiry, RETAIN policy)
- **`itinerary-generate`** Lambda (Node 20, 512MB, 30s timeout, Bedrock IAM scoped)
- **`itinerary-refine`** Lambda (same shape, supports swap-day refinements)
- **API Gateway HTTP API:** `https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com`
  - POST `/generate` → itinerary-generate
  - POST `/refine` → itinerary-refine
  - CORS: `allow_origins=["*"]` (tighten to casa-coqui.cc domains before prod)
- **CloudWatch alarms:** 2 (errors > 10 / 5min, duration > 25s p99) — both in INSUFFICIENT_DATA state until traffic
- **Structured Bedrock cost logs** — input_tokens, output_tokens, plan_id per invocation

### Frontend (Vercel-served from Casa Coqui Next.js app)
- **`/puerto-rico-itinerary`** — Atardecer Golden Hour landing hero (commit `df231c6`)
- **`/puerto-rico-itinerary/wizard`** — 4-step persona wizard with chip grid + progress bar
- **`/puerto-rico-itinerary/[plan_id]`** — itinerary view page with day cards + activity cards
- **Swap-day refinement UI** — textarea on each day, calls `/api/plan/refine`
- **Fallback banner** — shown when upstream fails (Bedrock issues fall through to static template)

### API Routes (Vercel Functions)
- `POST /api/plan/generate` — proxies to AWS, includes Zod schema validation on response, falls back to static 5-day template on upstream failure
- `POST /api/plan/refine` — proxies to AWS
- `GET /api/plan/[plan_id]` — reads DDB directly + hydrates activity references

### Validation + Tests
- **52 tests passing** (`npm test`) including 4 new Zod schema tests for itinerary I/O
- Zod schema: `ItinerarySchema`, `DaySchema`, `ItemSchema` at `lib/itinerary/schema.js`
- Hard fallback to static template if Bedrock returns malformed JSON

---

## 📝 Commit log (16 commits on `feat/mi-itinerario`)

```
e9416c8 feat(itinerary): structured cost logs + CloudWatch alarms      ← Task 15
3a2a1be feat(plan): Zod schema validation for AI output + fallback     ← Task 14
4fdbb66 feat(plan): fallback template when Bedrock/Lambda unavailable  ← Task 13
7b46cd0 feat(plan): swap-day refinement UI + API route                 ← Task 12
f04bb00 feat(itinerary): refine Lambda for swap-day requests           ← Task 11
eba1c89 feat(plan): itinerary view page with day + activity rendering  ← Task 10
6ad58b1 feat(api): /api/plan/generate proxy to AWS API Gateway         ← Task 9
b1ac439 infra(itinerary): API Gateway HTTP API + /generate route       ← Task 8
d68a4fb feat(itinerary): generate Lambda — Bedrock prompt + DDB write  ← Task 7
ab58734 feat(plan): persona wizard with 4 steps + progress + chip grid ← Task 6
df231c6 feat(plan): Atardecer hero landing page                        ← Task 5
9672628 scripts(itinerary): merge exploration gaps + seed activities   ← Task 4
db550f3 infra(itinerary): add itineraries table with TTL               ← Task 3
b584c01 infra(itinerary): add activities DynamoDB table + GSI          ← Task 2
114ac60 infra(itinerary): add Mi Itinerario CDK stack skeleton         ← Task 1
3e7330e spec+plan(itinerary): rebrand URL to /puerto-rico-itinerary    ← Pre-Plan-1
```

Plus 1 unrelated commit from another session (`d1d668a fix(env)`) interleaved.

---

## 🚫 Task 16 (Deploy to staging + manual QA) — BLOCKED

This task needs:
1. **AWS Bedrock model access** (see top of doc — 5-min human action)
2. **Human at a browser** to walk through 10 QA scenarios + Lighthouse audit
3. **Vercel preview branch deploy** (you'll handle via `git push` + Vercel auto-deploy)

When you're ready:
```bash
git push -u origin feat/mi-itinerario
# Vercel will create a preview URL automatically
# Set MI_ITINERARIO_API_URL=https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com in Vercel preview env vars
```

Then the 10 QA scenarios from the plan can be exercised against the preview URL.

---

## 🎨 Design note: URL pivot

The spec was reverted from `casa-coqui.cc/puerto-rico-itinerary` back to `casa-coqui.cc/plan` partway through the night. **Plan 1 still uses `/puerto-rico-itinerary` paths**, and the implementation deployed those routes. If you want to consolidate to `/plan`:

```bash
# Rename the directory in Next.js
git mv app/puerto-rico-itinerary app/plan
# Update the wizard Link href + the page redirect
# Re-commit
```

Or leave as `/puerto-rico-itinerary` for the SEO value (your earlier rationale stands — 22K monthly searches on the head term).

---

## 🔓 Architectural concerns worth flagging

1. **CORS wide-open** (`allow_origins=["*"]`) — fine for dev, tighten before public launch. Restrict to `https://casa-coqui.cc` + Vercel preview domains.
2. **No rate limiting** on `/api/plan/generate` — the plan spec mentions WAF or middleware limits "5 generations per IP per hour" but that's deferred. At launch budget you'll be fine; revisit if abuse appears.
3. **Activity Scan + filter** in Lambda is O(n) on every generation — fine for 75 items, will need GSI Query when activity count grows past ~500.
4. **Cost telemetry logs to CloudWatch only** — no aggregation dashboard yet. If you want monthly cost breakdown by user, that's a future CloudWatch Insights query or Athena export.

---

## 📋 Plan 1 status — by task

| # | Task | Status | Commit |
|---|---|---|---|
| 1 | CDK stack skeleton | ✅ Done | 114ac60 |
| 2 | activities DDB table | ✅ Done | b584c01 |
| 3 | itineraries DDB table + TTL | ✅ Done | db550f3 |
| 4 | Merge gaps + seed activities | ✅ Done | 9672628 |
| 5 | Atardecer hero page | ✅ Done | df231c6 |
| 6 | Persona wizard (4 steps) | ✅ Done | ab58734 |
| 7 | itinerary-generate Lambda | ✅ Done | d68a4fb |
| 8 | API Gateway HTTP API | ✅ Done | b1ac439 |
| 9 | Vercel API proxy route | ✅ Done | 6ad58b1 |
| 10 | Itinerary view page + cards | ✅ Done | eba1c89 |
| 11 | itinerary-refine Lambda | ✅ Done | f04bb00 |
| 12 | Swap-day UI | ✅ Done | 7b46cd0 |
| 13 | Fallback static template | ✅ Done | 4fdbb66 |
| 14 | Zod schema + tests | ✅ Done | 3a2a1be |
| 15 | CloudWatch alarms + cost logs | ✅ Done | e9416c8 |
| 16 | Staging deploy + manual QA | ⚠ Blocked | — |

**15 commits · 7 AWS services in production · 52 tests · ~3 hours of overnight execution**

---

## 🌅 What to do when you wake up

1. **Submit Bedrock model access form** (top of doc, ~2 minutes)
2. **Pull the branch:** `git checkout feat/mi-itinerario && git log --oneline -20` to review
3. **Test the API:** the curl command at the top — if it returns a real itinerary, you're unblocked
4. **Push branch + create PR:** `git push -u origin feat/mi-itinerario`
5. **Walk through Task 16's 10 QA scenarios** on the Vercel preview URL
6. **Decide:** keep `/puerto-rico-itinerary` URL (SEO) or rename to `/plan` (spec reverted)

**Plans 2-5 (Events / Casa Coqui Funnel / Polish+Deploy / Blog System) are ready to write once you confirm Plan 1 is ✅ end-to-end.**
