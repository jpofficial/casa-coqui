# Mi Itinerario — Plan 2: Eventbrite Events Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live events layer to Mi Itinerario by integrating the Eventbrite public API. Hourly Lambda fetches San Juan events, writes to `events_cache` DynamoDB table with TTL. The `itinerary-generate` and `itinerary-refine` Lambdas pull date-relevant events and inject them into the Bedrock prompt so generated itineraries can include real-time happenings (Bad Bunny watch parties, La Placita Thursday salsa, Bomba en la Terraza outdoor concerts).

**Architecture:** EventBridge Scheduler (hourly) → `events-fetch` Lambda → Eventbrite API → Bedrock parser (optional cleanup) → DDB `events_cache` (PK=date_iso, SK=event_id, TTL=event_end_date+1day). Generate/refine Lambdas Query events_cache by date range, inject top 5-10 matching events into the AI prompt context. UI shows a small "happening today" badge on activities that correspond to events.

**Tech Stack:** Same as Plan 1 — adds `aws_scheduler` CDK construct + Secrets Manager for Eventbrite API key + a third Lambda. Eventbrite API is free (https://www.eventbrite.com/platform/api).

**Spec reference:** `docs/superpowers/specs/2026-05-11-pr-itinerary-app-design.md` §7.1, §5.3

**Dependencies:** Plan 1 must be ✅ — needs the `MiItinerarioStack`, `itinerary-generate` Lambda, and `itineraries` table already deployed.

**Estimated duration:** 1 week of focused work (8 tasks).

---

## Prerequisites

Before starting Task 1, you need:

1. **Eventbrite API key.** Create a free account at https://www.eventbrite.com/platform/. Get a Private Token from https://www.eventbrite.com/platform/api-keys/. Save it — you'll put it in AWS Secrets Manager in Task 2.

2. **Plan 1 verified working end-to-end.** Specifically:
   - `mi-itinerario-activities` (75 items) live
   - `mi-itinerario-itineraries` (TTL=ttl_epoch) live
   - `itinerary-generate` Lambda live, Bedrock access UNBLOCKED, smoke test returns real days
   - API Gateway at `https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com` working

---

## File Structure (Plan 2 deltas)

```
casa-coqui/
├── infra/
│   ├── lambdas/
│   │   └── events_fetch/
│   │       ├── index.mjs                    [NEW] Hourly Eventbrite fetcher
│   │       ├── package.json                 [NEW]
│   │       └── .gitignore                   [NEW]
│   └── stacks/
│       └── itinerary_stack.py               [MODIFY] events_cache + events-fetch + EventBridge
├── infra/lambdas/itinerary_generate/
│   └── index.mjs                            [MODIFY] inject events into prompt
├── infra/lambdas/itinerary_refine/
│   └── index.mjs                            [MODIFY] inject events into prompt
├── app/puerto-rico-itinerary/components/
│   └── ActivityCard.js                      [MODIFY] show "happening today" badge
└── docs/superpowers/specs/
    └── 2026-05-11-pr-itinerary-app-design.md [no change — Plan 2 is implementing existing §7.1]
```

---

## Task 1: Add `events_cache` DDB table to CDK stack

**Files:**
- Modify: `infra/stacks/itinerary_stack.py`

- [ ] **Step 1: Add table after itineraries_table block**

```python
# Events cache — Eventbrite results, auto-expire 1 day after event end
self.events_cache_table = ddb.Table(
    self,
    "EventsCacheTable",
    table_name="mi-itinerario-events-cache",
    partition_key=ddb.Attribute(name="date_iso", type=ddb.AttributeType.STRING),
    sort_key=ddb.Attribute(name="event_id", type=ddb.AttributeType.STRING),
    billing_mode=ddb.BillingMode.PAY_PER_REQUEST,
    encryption=ddb.TableEncryption.AWS_MANAGED,
    point_in_time_recovery=False,  # events are ephemeral, no need
    time_to_live_attribute="ttl_epoch",
    removal_policy=RemovalPolicy.RETAIN,
)

cdk.CfnOutput(
    self,
    "EventsCacheTableName",
    value=self.events_cache_table.table_name,
    export_name="MiItinerarioEventsCacheTable",
)
```

- [ ] **Step 2: Deploy + verify TTL**

```bash
cd infra && source .venv/bin/activate && cdk deploy MiItinerarioStack --require-approval never
aws dynamodb describe-time-to-live --table-name mi-itinerario-events-cache
```

Expected: TTL ENABLED on `ttl_epoch`.

- [ ] **Step 3: Commit**

```bash
git add infra/stacks/itinerary_stack.py
git commit -m "infra(itinerary): add events_cache table with TTL"
```

---

## Task 2: Store Eventbrite API key in Secrets Manager

**Files:**
- Modify: `infra/stacks/itinerary_stack.py`

- [ ] **Step 1: Create the secret (one-time, AWS CLI)**

```bash
aws secretsmanager create-secret \
  --name mi-itinerario/eventbrite-token \
  --description "Eventbrite Private Token for events-fetch Lambda" \
  --secret-string "$EVENTBRITE_TOKEN"
```

(Set `EVENTBRITE_TOKEN` env var to the token you got from Eventbrite first.)

- [ ] **Step 2: Reference the secret in CDK**

Add this import at the top of `itinerary_stack.py` if not already present:

```python
from aws_cdk import aws_secretsmanager as secrets
```

Then in `__init__` after the events_cache_table block:

```python
self.eventbrite_secret = secrets.Secret.from_secret_name_v2(
    self,
    "EventbriteToken",
    "mi-itinerario/eventbrite-token",
)
```

- [ ] **Step 3: Commit**

```bash
git add infra/stacks/itinerary_stack.py
git commit -m "infra(itinerary): reference Eventbrite Secrets Manager secret"
```

---

## Task 3: events-fetch Lambda (Eventbrite scraper)

**Files:**
- Create: `infra/lambdas/events_fetch/index.mjs`
- Create: `infra/lambdas/events_fetch/package.json`
- Create: `infra/lambdas/events_fetch/.gitignore`

- [ ] **Step 1: package.json**

```json
{
  "name": "events-fetch",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.700.0",
    "@aws-sdk/client-secrets-manager": "^3.700.0",
    "@aws-sdk/lib-dynamodb": "^3.700.0"
  }
}
```

- [ ] **Step 2: .gitignore**

```
node_modules/
```

- [ ] **Step 3: index.mjs**

```javascript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE = process.env.EVENTS_CACHE_TABLE;
const SECRET_NAME = process.env.EVENTBRITE_SECRET_NAME;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const secrets = new SecretsManagerClient({ region: REGION });

let cachedToken = null;
async function getToken() {
  if (cachedToken) return cachedToken;
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  cachedToken = res.SecretString;
  return cachedToken;
}

const SAN_JUAN_VENUE_QUERY = 'San+Juan+Puerto+Rico';

export const handler = async () => {
  try {
    const token = await getToken();
    const items = await fetchEventbriteEvents(token);
    const transformed = items.map(toCacheItem);
    await batchWrite(transformed);

    console.log(JSON.stringify({
      metric_type: 'events_fetch',
      total_fetched: items.length,
      written: transformed.length,
      ts: new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ count: transformed.length }) };
  } catch (err) {
    console.error('events-fetch failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function fetchEventbriteEvents(token) {
  // Eventbrite v3 search API
  const url = new URL('https://www.eventbriteapi.com/v3/events/search/');
  url.searchParams.set('q', 'puerto rico');
  url.searchParams.set('location.address', 'San Juan, Puerto Rico');
  url.searchParams.set('location.within', '25km');
  url.searchParams.set('start_date.range_start', new Date().toISOString());
  url.searchParams.set('start_date.range_end',
    new Date(Date.now() + 90 * 86400_000).toISOString());
  url.searchParams.set('expand', 'venue,category');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`eventbrite ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.events || [];
}

function toCacheItem(ev) {
  const startTime = ev.start?.utc || ev.start?.local;
  const endTime = ev.end?.utc || ev.end?.local;
  const dateIso = startTime ? startTime.slice(0, 10) : 'unknown';
  const endEpoch = endTime
    ? Math.floor(new Date(endTime).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 86400;

  return {
    date_iso: dateIso,
    event_id: ev.id,
    name: ev.name?.text || 'Untitled event',
    venue: ev.venue?.name || null,
    neighborhood: extractNeighborhood(ev.venue),
    category: ev.category?.short_name || null,
    start_time: startTime,
    end_time: endTime,
    price_tier: ev.is_free ? 'FREE' : 'paid',
    url: ev.url || null,
    source: 'eventbrite',
    geo: ev.venue?.latitude ? {
      lat: parseFloat(ev.venue.latitude),
      lng: parseFloat(ev.venue.longitude),
    } : null,
    ttl_epoch: endEpoch + 86400, // expire 1 day after event ends
  };
}

function extractNeighborhood(venue) {
  if (!venue?.address) return null;
  const city = venue.address.city || '';
  const addr1 = venue.address.address_1 || '';
  const combined = `${addr1} ${city}`.toLowerCase();
  if (combined.includes('old san juan') || combined.includes('viejo san juan')) return 'Old San Juan';
  if (combined.includes('condado')) return 'Condado';
  if (combined.includes('santurce')) return 'Santurce';
  if (combined.includes('isla verde')) return 'Isla Verde';
  if (combined.includes('miramar')) return 'Miramar';
  return 'San Juan';
}

async function batchWrite(items) {
  // BatchWrite limit: 25 items per request
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: batch.map(Item => ({ PutRequest: { Item } })) },
    }));
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/lambdas/events_fetch
git commit -m "feat(itinerary): events-fetch Lambda source"
```

---

## Task 4: Wire events-fetch into CDK + EventBridge schedule (hourly)

**Files:**
- Modify: `infra/stacks/itinerary_stack.py`

- [ ] **Step 1: Add imports**

At the top of `itinerary_stack.py`, ensure these are present:

```python
from aws_cdk import (
    # ...existing...
    aws_scheduler as scheduler,
    aws_scheduler_targets as scheduler_targets,
)
```

If `aws_scheduler` modules aren't available in the installed CDK version, use the legacy `aws_events.Rule` + `aws_events_targets.LambdaFunction` instead — note this is acceptable, just slightly less precise scheduling.

- [ ] **Step 2: Add events-fetch Lambda + scheduler**

In `__init__` after the existing Lambdas:

```python
# events-fetch Lambda — hourly Eventbrite poller
events_fetch_fn = _lambda.Function(
    self,
    "EventsFetchFn",
    runtime=_lambda.Runtime.NODEJS_20_X,
    handler="index.handler",
    code=_lambda.Code.from_asset(
        "lambdas/events_fetch",
        bundling=cdk.BundlingOptions(
            image=_lambda.Runtime.NODEJS_20_X.bundling_image,
            command=["bash", "-c", "npm install --omit=dev --cache /tmp/.npm && cp -r . /asset-output"],
        ),
    ),
    timeout=Duration.seconds(60),
    memory_size=256,
    environment={
        "EVENTS_CACHE_TABLE": self.events_cache_table.table_name,
        "EVENTBRITE_SECRET_NAME": "mi-itinerario/eventbrite-token",
    },
)
self.events_cache_table.grant_write_data(events_fetch_fn)
self.eventbrite_secret.grant_read(events_fetch_fn)

# EventBridge Scheduler — every hour
scheduler.CfnSchedule(
    self,
    "EventsFetchSchedule",
    schedule_expression="rate(1 hour)",
    flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(mode="OFF"),
    target=scheduler.CfnSchedule.TargetProperty(
        arn=events_fetch_fn.function_arn,
        role_arn=self._make_scheduler_role(events_fetch_fn).role_arn,
    ),
)
```

Add the helper method to the class (at the end of `__init__`, define as a method outside `__init__`):

```python
def _make_scheduler_role(self, target_fn):
    role = iam.Role(
        self,
        "EventsFetchSchedulerRole",
        assumed_by=iam.ServicePrincipal("scheduler.amazonaws.com"),
    )
    target_fn.grant_invoke(role)
    return role
```

- [ ] **Step 3: Deploy**

```bash
cd infra && source .venv/bin/activate && cdk deploy MiItinerarioStack --require-approval never
```

- [ ] **Step 4: Manually trigger to verify**

```bash
aws lambda invoke \
  --function-name $(aws cloudformation describe-stacks --stack-name MiItinerarioStack --query "Stacks[0].Outputs[?starts_with(OutputKey,'EventsFetchFn')].OutputValue | [0]" --output text) \
  --payload '{}' /tmp/events.json && cat /tmp/events.json
aws dynamodb scan --table-name mi-itinerario-events-cache --select COUNT
```

Expected: `count >= 5` in the response; DDB scan shows real events seeded.

- [ ] **Step 5: Commit**

```bash
git add infra/stacks/itinerary_stack.py
git commit -m "infra(itinerary): events-fetch Lambda + hourly EventBridge schedule"
```

---

## Task 5: Inject events into itinerary-generate prompt

**Files:**
- Modify: `infra/lambdas/itinerary_generate/index.mjs`
- Modify: `infra/stacks/itinerary_stack.py` (grant Read on events_cache_table)

- [ ] **Step 1: Add events_cache read helper to index.mjs**

In `infra/lambdas/itinerary_generate/index.mjs`, add a new helper after `loadActivities`:

```javascript
async function loadEventsForDateRange(start_date, num_days, interests) {
  if (!start_date) return [];
  const start = new Date(start_date);
  const end = new Date(start.getTime() + num_days * 86400_000);

  const dates = [];
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  // Parallel queries for each date
  const results = await Promise.all(dates.map(async (date_iso) => {
    const { Items = [] } = await ddb.send(new QueryCommand({
      TableName: process.env.EVENTS_CACHE_TABLE,
      KeyConditionExpression: 'date_iso = :d',
      ExpressionAttributeValues: { ':d': date_iso },
      Limit: 20,
    }));
    return Items;
  }));

  return results.flat().filter(ev =>
    matchesInterests(ev, interests)
  ).slice(0, num_days * 3);  // cap at ~3 events per day
}

function matchesInterests(ev, interests) {
  const cat = (ev.category || '').toLowerCase();
  // Map Eventbrite categories to our persona tags
  if (interests.includes('foodie') && (cat.includes('food') || cat.includes('drink'))) return true;
  if (interests.includes('nightlife') && (cat.includes('music') || cat.includes('nightlife'))) return true;
  if (interests.includes('art') && (cat.includes('art') || cat.includes('film'))) return true;
  if (interests.includes('history') && cat.includes('history')) return true;
  if (interests.includes('outdoor') && (cat.includes('outdoor') || cat.includes('sport'))) return true;
  // Default: include free or family-friendly events
  return ev.price_tier === 'FREE';
}
```

Add `QueryCommand` to the imports at top:

```javascript
import { DynamoDBDocumentClient, ScanCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
```

- [ ] **Step 2: Call it from the handler + inject into prompt**

In the handler, after `loadActivities`:

```javascript
    const events = await loadEventsForDateRange(body.start_date, num_days, interests);
```

Update `buildPrompt` signature to accept events, and modify the prompt:

```javascript
function buildPrompt({ interests, num_days, traveler_type, pace, activities, events }) {
  const compact = activities.map((a) => ({
    id: a.activity_id,
    name: a.name,
    /* ...existing fields... */
  }));

  const eventsCompact = (events || []).map(e => ({
    id: e.event_id,
    date: e.date_iso,
    name: e.name,
    venue: e.venue,
    neighborhood: e.neighborhood,
    category: e.category,
    price: e.price_tier,
  }));

  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `You are a local San Juan friend helping a first-time visitor build a vacation itinerary.

CONSTRAINTS:
- Recommend ONLY activities from ACTIVITIES_DB below.
- For each day, propose 3-5 items balancing geographic clustering, energy variation, persona match, time-of-day.
- When EVENTS_TODAY contains an event matching the user's interests + the day's date, MENTION it in the note field of an activity on that day (e.g., "Bad Bunny watch party at La Placita tonight 9pm — short walk").
- DO NOT replace activities with events. Events ENHANCE the day's notes, they aren't standalone items.
- All other Plan 1 constraints apply (Old San Juan Day 1, El Yunque Day 2-3, no La Perla neighborhood, etc.).

USER PROFILE:
- interests: ${JSON.stringify(interests)}
- num_days: ${num_days}
- traveler_type: ${traveler_type}
- pace: ${pace}

OUTPUT: Strict JSON array of days. Schema:
[{"day_num": 1, "theme": "string", "items":[{"activity_id":"string","time":"morning|afternoon|evening","duration_min":number,"note":"string","event_ref":"event_id_or_null"}]}]

ACTIVITIES_DB:
${JSON.stringify(compact)}

EVENTS_TODAY (real-time events you may reference in notes):
${JSON.stringify(eventsCompact)}`,
        },
      ],
    },
  ];
}
```

- [ ] **Step 3: Grant the Lambda Read on events_cache_table**

In `infra/stacks/itinerary_stack.py`, after the existing `self.activities_table.grant_read_data(generate_fn)` line, add:

```python
self.events_cache_table.grant_read_data(generate_fn)
generate_fn.add_environment("EVENTS_CACHE_TABLE", self.events_cache_table.table_name)
```

Note: `add_environment` may not exist on `_lambda.Function`. If not, refactor the original `environment={...}` dict to include the new key, OR re-define the Lambda's environment property.

- [ ] **Step 4: Deploy + smoke test**

```bash
cd infra && cdk deploy MiItinerarioStack --require-approval never
curl -X POST "https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com/generate" \
  -H "content-type: application/json" \
  -d '{"interests":["foodie","nightlife"],"num_days":3,"traveler_type":"couple","pace":"balanced","start_date":"2026-06-01"}' | python3 -m json.tool
```

Expected: days include `note` fields that reference real upcoming Eventbrite events (when matching events exist in the cache).

- [ ] **Step 5: Commit**

```bash
git add infra/lambdas/itinerary_generate/index.mjs infra/stacks/itinerary_stack.py
git commit -m "feat(itinerary): inject events_cache into generate prompt"
```

---

## Task 6: Same injection for itinerary-refine

**Files:**
- Modify: `infra/lambdas/itinerary_refine/index.mjs`
- Modify: `infra/stacks/itinerary_stack.py` (grant Read on events_cache to refine_fn)

- [ ] **Step 1: Mirror the events-load helper in refine**

Add the same `loadEventsForDateRange` + `matchesInterests` helpers to `index.mjs` of refine (you may want to factor out into a shared file, but for now duplicate — refactor is YAGNI until Plan 3).

In refine's handler, derive the date range from the existing itinerary's `start_date` (or use the existing `days[].date_iso` if present). For now, pass an empty events list if the existing itinerary lacks a start_date.

- [ ] **Step 2: Update regenerateDay() to include events in prompt**

Same pattern — include events in the prompt context with the same constraint ("events ENHANCE notes, don't replace activities").

- [ ] **Step 3: Grant Read on events_cache_table to refine_fn**

In stack: `self.events_cache_table.grant_read_data(refine_fn)` + env var.

- [ ] **Step 4: Deploy + smoke test**

```bash
cd infra && cdk deploy MiItinerarioStack --require-approval never
# Build a plan first via /generate, then refine a day:
curl -X POST "https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com/refine" \
  -H "content-type: application/json" \
  -d '{"plan_id":"PLAN_ID","day_num":2,"user_request":"More nightlife"}'
```

- [ ] **Step 5: Commit**

```bash
git add infra/lambdas/itinerary_refine/index.mjs infra/stacks/itinerary_stack.py
git commit -m "feat(itinerary): inject events_cache into refine prompt"
```

---

## Task 7: Show "Happening today" badge in ActivityCard

**Files:**
- Modify: `app/puerto-rico-itinerary/components/ActivityCard.js`

- [ ] **Step 1: Add event badge rendering**

The Lambda now includes `event_ref` on items when an event was woven in. Render a small badge on the card when `item.event_ref` is set:

```javascript
{item.event_ref && (
  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-atardecer-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-atardecer-700">
    🎶 Happening tonight
  </span>
)}
```

Place this next to the activity name or in the meta row — wherever feels natural in the existing component.

- [ ] **Step 2: Build verification**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add app/puerto-rico-itinerary/components/ActivityCard.js
git commit -m "feat(plan): show event badge on activities with event_ref"
```

---

## Task 8: Verify hourly schedule + end-to-end + monitor

**Files:** (no code changes)

- [ ] **Step 1: Wait an hour, verify the scheduler fired**

```bash
aws logs tail /aws/lambda/$(aws lambda list-functions --query "Functions[?starts_with(FunctionName, 'MiItinerarioStack-EventsFetchFn')].FunctionName | [0]" --output text) --since 2h --format short
```

Expected: at least 1 successful invocation log line with `metric_type: 'events_fetch'`, `total_fetched: N`.

- [ ] **Step 2: Verify events_cache populated and TTL respecting old events**

```bash
aws dynamodb scan --table-name mi-itinerario-events-cache --select COUNT
# Then check a sample item for ttl_epoch in the future:
aws dynamodb scan --table-name mi-itinerario-events-cache --max-items 1
```

- [ ] **Step 3: Generate a plan with `start_date` set to a near-future date, verify events appear in notes**

```bash
curl -X POST "https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com/generate" \
  -H "content-type: application/json" \
  -d '{"interests":["foodie","nightlife","music"],"num_days":3,"traveler_type":"couple","pace":"balanced","start_date":"2026-06-08"}' | python3 -m json.tool
```

Check the response — at least one day's `items` should have an `event_ref` or note mentioning an Eventbrite event.

- [ ] **Step 4: Confirm CloudWatch alarms still in valid state**

```bash
aws cloudwatch describe-alarms --alarm-name-prefix MiItinerario
```

No alarms in ALARM state (errors stayed within threshold).

- [ ] **Step 5: PR + merge to integration branch**

Push the branch (if not already), open a PR titled "Plan 2: Eventbrite Events Layer", merge after smoke test.

---

## Self-Review

**Spec coverage:**
- §7.1 (Eventbrite hourly fetch, events_cache TTL, prompt injection) → Tasks 1-7 ✅
- §5.3 (events_cache table schema) → Task 1 ✅
- §11 (error handling — events fallback to empty if Eventbrite down) → Built into events-fetch Lambda's try/catch ✅
- §14 (monitoring) → Reuses existing CloudWatch alarms from Plan 1; adds structured `events_fetch` logs ✅

**Placeholder scan:** None.

**Type consistency:**
- `date_iso` = string `YYYY-MM-DD` (used in events_cache PK + loadEventsForDateRange)
- `event_id` = string (Eventbrite event ID, used as SK)
- `event_ref` = string or null (passed through from prompt to UI)
- `ttl_epoch` = number (Unix epoch seconds)

**Scope check:** Single subsystem (events). Independently testable: hourly Lambda + DDB populated, generate Lambda enriches prompt. ✅

---

## Execution Handoff

Plan 2 ready. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch one subagent per task, review between.

**2. Inline Execution** — execute in this session with checkpoints.

**Plans 3-5 (Casa Coqui Funnel, Polish+Deploy, Blog System) will be written after Plan 2 is in motion.**
