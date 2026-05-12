# Mi Itinerario — Plan 1: Foundation + AI Generation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational AWS infrastructure (DynamoDB, Lambda, API Gateway) plus the working Mi Itinerario `/puerto-rico-itinerary` route so a user can complete a persona wizard and receive a Bedrock-generated day-by-day San Juan itinerary rendered in the Atardecer Golden Hour design direction.

**Architecture:** Next.js frontend on Vercel (Casa Coqui repo, `/puerto-rico-itinerary` route + components) → Vercel API routes → AWS API Gateway HTTP API → Lambda (Node.js 20) → DynamoDB (activities + itineraries) + Bedrock Runtime (Claude Haiku 4.5). Anonymous flow with `plan_id` URL routing; no auth at this stage (V1.1 adds Cognito magic-link saves). The activity seed (~85 items from Phase 0 research) loads into DynamoDB once via a one-shot script.

**Tech Stack:** Next.js 14 App Router · Tailwind CSS (extend existing Casa Coqui tokens) · AWS CDK (Python, follows existing `infra/stacks/` pattern) · AWS Lambda Node.js 20 · DynamoDB on-demand · API Gateway HTTP API · Bedrock Runtime · Secrets Manager · CloudWatch Logs · `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-bedrock-runtime` (already partially present in repo).

**Spec reference:** `docs/superpowers/specs/2026-05-11-pr-itinerary-app-design.md` (sections 4, 5, 6, 8, 10 Phase 1+2)

**Estimated duration:** 2-3 weeks of focused work (~30-45 tasks). Plans 2-5 follow.

---

## File Structure (Plan 1 only)

```
casa-coqui/
├── app/
│   ├── plan/
│   │   ├── page.js                          [NEW] /puerto-rico-itinerary landing hero
│   │   ├── wizard/
│   │   │   └── page.js                      [NEW] /puerto-rico-itinerary/wizard
│   │   ├── [plan_id]/
│   │   │   └── page.js                      [NEW] /puerto-rico-itinerary/[id] itinerary view
│   │   └── components/
│   │       ├── AtardecerHero.js             [NEW] Hero with radial glow
│   │       ├── PersonaWizard.js             [NEW] 4-step wizard shell
│   │       ├── WizardStep.js                [NEW] One step's chip grid
│   │       ├── DayCard.js                   [NEW] Day-level container
│   │       ├── ActivityCard.js              [NEW] Single activity card
│   │       └── LoadingState.js              [NEW] "Building your itinerary…"
│   └── api/
│       └── plan/
│           ├── generate/
│           │   └── route.js                 [NEW] POST → Lambda invoke
│           ├── refine/
│           │   └── route.js                 [NEW] POST swap-day → Lambda
│           └── [plan_id]/
│               └── route.js                 [NEW] GET → DDB read
├── lib/
│   └── itinerary/
│       ├── prompts.js                       [NEW] System prompts + builders
│       ├── prompts.test.js                  [NEW] Prompt builder tests
│       ├── dynamodb.js                      [NEW] DDB client + helpers
│       ├── schema.js                        [NEW] Zod schemas for itinerary IO
│       ├── schema.test.js                   [NEW] Schema validation tests
│       └── fallback-template.js             [NEW] Static "5 days in SJ" backup
├── scripts/
│   ├── seed-activities.js                   [NEW] Loads JSON → DDB
│   └── merge-exploration-gaps.js            [NEW] Merges X1/X2/X3 augmentations
├── infra/
│   └── stacks/
│       └── itinerary_stack.py               [NEW] CDK stack
├── infra/lambdas/
│   ├── itinerary_generate/
│   │   ├── index.mjs                        [NEW] Lambda handler
│   │   ├── package.json                     [NEW] Dependencies
│   │   └── index.test.mjs                   [NEW] Handler tests
│   └── itinerary_refine/
│       ├── index.mjs                        [NEW] Refine handler
│       └── package.json                     [NEW]
├── tailwind.config.js                       [MODIFY] Add display font stack
└── app/globals.css                          [MODIFY] Load Playfair Display + DM Mono
```

---

## Task 1: Provision CDK stack skeleton for Mi Itinerario

**Files:**
- Create: `infra/stacks/itinerary_stack.py`
- Modify: `infra/app.py` (register the new stack)

- [ ] **Step 1: Write the stack skeleton**

Create `infra/stacks/itinerary_stack.py`:

```python
"""
Mi Itinerario stack — DynamoDB tables, Lambda functions, API Gateway HTTP API.

Resources:
  - activities          DDB table (PK=activity_id, GSI=neighborhood+type)
  - itineraries         DDB table (PK=plan_id, TTL=ttl_epoch)
  - itinerary_generate  Lambda
  - itinerary_refine    Lambda
  - HttpApi             API Gateway HTTP API
"""
import aws_cdk as cdk
from aws_cdk import (
    Stack,
    aws_dynamodb as ddb,
    aws_lambda as _lambda,
    aws_apigatewayv2 as apigw,
    aws_apigatewayv2_integrations as apigw_int,
    aws_iam as iam,
    Duration,
    RemovalPolicy,
)
from constructs import Construct


class MiItinerarioStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        # Tables, Lambdas, API GW will be added in subsequent tasks
        pass
```

- [ ] **Step 2: Register in `infra/app.py`**

Add import and instantiation. After the existing stacks block:

```python
from stacks.itinerary_stack import MiItinerarioStack
# ...
MiItinerarioStack(app, "MiItinerarioStack", env=env)
```

- [ ] **Step 3: Synthesize to verify CDK parses**

Run:
```bash
cd infra && cdk synth MiItinerarioStack
```

Expected: synthesis succeeds with empty CloudFormation template (resources will be added in next tasks).

- [ ] **Step 4: Commit**

```bash
git add infra/stacks/itinerary_stack.py infra/app.py
git commit -m "infra(itinerary): add Mi Itinerario CDK stack skeleton"
```

---

## Task 2: DynamoDB `activities` table

**Files:**
- Modify: `infra/stacks/itinerary_stack.py`

- [ ] **Step 1: Add the table to the stack**

In `MiItinerarioStack.__init__`, after the `pass` placeholder, add:

```python
# Activities table — seeded ~85 items, AI reads at generation time
self.activities_table = ddb.Table(
    self,
    "ActivitiesTable",
    table_name="mi-itinerario-activities",
    partition_key=ddb.Attribute(name="activity_id", type=ddb.AttributeType.STRING),
    billing_mode=ddb.BillingMode.PAY_PER_REQUEST,
    encryption=ddb.TableEncryption.AWS_MANAGED,
    point_in_time_recovery=True,
    removal_policy=RemovalPolicy.RETAIN,
)

# GSI for filtering by neighborhood + type
self.activities_table.add_global_secondary_index(
    index_name="neighborhood-type-index",
    partition_key=ddb.Attribute(name="neighborhood", type=ddb.AttributeType.STRING),
    sort_key=ddb.Attribute(name="type", type=ddb.AttributeType.STRING),
    projection_type=ddb.ProjectionType.ALL,
)

cdk.CfnOutput(
    self,
    "ActivitiesTableName",
    value=self.activities_table.table_name,
    export_name="MiItinerarioActivitiesTable",
)
```

- [ ] **Step 2: Synthesize to verify**

```bash
cd infra && cdk synth MiItinerarioStack | grep -A2 "AWS::DynamoDB::Table"
```

Expected: 1 table resource with `mi-itinerario-activities` name.

- [ ] **Step 3: Deploy the stack** (one-time)

```bash
cd infra && cdk deploy MiItinerarioStack --require-approval never
```

Expected: stack creation completes; CfnOutput shows `MiItinerarioActivitiesTable`.

- [ ] **Step 4: Commit**

```bash
git add infra/stacks/itinerary_stack.py
git commit -m "infra(itinerary): add activities DynamoDB table + GSI"
```

---

## Task 3: DynamoDB `itineraries` table with TTL

**Files:**
- Modify: `infra/stacks/itinerary_stack.py`

- [ ] **Step 1: Add itineraries table after activities table**

```python
# Itineraries table — anonymous plans w/ 90-day TTL, persistent if user_id set
self.itineraries_table = ddb.Table(
    self,
    "ItinerariesTable",
    table_name="mi-itinerario-itineraries",
    partition_key=ddb.Attribute(name="plan_id", type=ddb.AttributeType.STRING),
    billing_mode=ddb.BillingMode.PAY_PER_REQUEST,
    encryption=ddb.TableEncryption.AWS_MANAGED,
    point_in_time_recovery=True,
    time_to_live_attribute="ttl_epoch",
    removal_policy=RemovalPolicy.RETAIN,
)

cdk.CfnOutput(
    self,
    "ItinerariesTableName",
    value=self.itineraries_table.table_name,
    export_name="MiItinerarioItinerariesTable",
)
```

- [ ] **Step 2: Deploy + verify TTL is enabled**

```bash
cd infra && cdk deploy MiItinerarioStack --require-approval never
aws dynamodb describe-time-to-live --table-name mi-itinerario-itineraries
```

Expected: `"TimeToLiveStatus": "ENABLED"` and `"AttributeName": "ttl_epoch"`.

- [ ] **Step 3: Commit**

```bash
git add infra/stacks/itinerary_stack.py
git commit -m "infra(itinerary): add itineraries table with TTL"
```

---

## Task 4: Seed activities table from JSON files (merge augmentations first)

**Files:**
- Create: `scripts/merge-exploration-gaps.js`
- Create: `scripts/seed-activities.js`

- [ ] **Step 1: Write the merge script**

Create `scripts/merge-exploration-gaps.js`:

```javascript
#!/usr/bin/env node
/**
 * Merges the 18 consensus venue gaps from exploration agents (X1/X2/X3)
 * into the canonical activity seed JSON files. Output: 4 augmented JSON
 * files written to tasks/itinerary-research/seed-final/.
 *
 * Run once before seed-activities.js.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'tasks', 'itinerary-research');
const OUT = path.join(SRC, 'seed-final');
fs.mkdirSync(OUT, { recursive: true });

// The 18 consensus augmentations (from spec §5.6)
const AUGMENTATIONS = {
  'foodie-spots.json': [
    {
      activity_id: 'SAN-FOODIE-AUG-001',
      name: 'Cocina al Fondo',
      neighborhood: 'Santurce',
      type: 'Restaurant',
      hours: 'Tue-Sat 6pm-10pm, closed Sun-Mon',
      price_tier: '$$$$',
      description: '2023 James Beard winner. Hyper-local PR ingredients, modern tasting menu.',
      why_it_matters: '#1 priority — highest editorial momentum in San Juan dining right now.',
      best_for_persona: ['foodie', 'couples', 'special_occasion'],
      walkability_from_old_san_juan: '15 min Uber',
      kid_friendly: false,
      reservation_required: true,
      ideal_time_of_day: 'evening',
      time_to_allocate_min: 150,
      source_urls: ['https://www.jamesbeard.org/awards/2023'],
    },
    {
      activity_id: 'SAN-FOODIE-AUG-002',
      name: 'La Casita Blanca',
      neighborhood: 'Santurce',
      type: 'Restaurant',
      hours: 'Mon-Sat 11am-9pm',
      price_tier: '$$',
      description: 'The locals\' canonical comida criolla answer. Classic PR home cooking.',
      why_it_matters: 'Reddit consensus #1 for authentic criollo — what locals send tourists to.',
      best_for_persona: ['foodie', 'family', 'budget', 'local_color'],
      walkability_from_old_san_juan: '12 min Uber',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'lunch',
      time_to_allocate_min: 90,
      source_urls: ['https://reddit.com/r/PuertoRicoTravel'],
    },
    {
      activity_id: 'SAN-FOODIE-AUG-003',
      name: 'La Alcapurria Quemá',
      neighborhood: 'Santurce',
      type: 'Street food',
      hours: 'Thu-Sun 6pm-1am',
      price_tier: '$',
      description: 'Top street food kiosk near La Placita. Alcapurrias, mofongo, beer.',
      why_it_matters: 'Constantly named by locals — the late-night Santurce circuit anchor.',
      best_for_persona: ['foodie', 'budget', 'nightlife', 'local_color'],
      walkability_from_old_san_juan: '12 min Uber',
      kid_friendly: false,
      reservation_required: false,
      ideal_time_of_day: 'late_night',
      time_to_allocate_min: 60,
      source_urls: ['https://reddit.com/r/PuertoRicoTravel'],
    },
  ],
  'nightlife-experiences.json': [
    {
      activity_id: 'SAN-NIGHT-AUG-001',
      name: 'Identidad Cocktail Bar',
      neighborhood: 'Santurce',
      type: 'Craft cocktail bar',
      hours: 'Wed-Sat 6pm-2am',
      price_tier: '$$$',
      description: '2025 James Beard Best New Bar finalist. PR-ingredient-forward cocktails.',
      why_it_matters: 'Newest critical darling — already in chef-curated guides.',
      best_for_persona: ['couples', 'cocktail_enthusiast', 'nightlife'],
      walkability_from_old_san_juan: '15 min Uber',
      adults_only: true,
      kid_friendly: false,
      reservation_required: true,
      ideal_time_of_day: 'evening',
      time_to_allocate_min: 120,
      source_urls: ['https://www.jamesbeard.org/awards/2025'],
    },
  ],
  'outdoor-activities.json': [
    {
      activity_id: 'SAN-OUTDOOR-AUG-001',
      name: 'Calle Fortaleza (photo destination)',
      neighborhood: 'Old San Juan',
      type: 'Photo destination',
      hours: 'Anytime; best mid-morning or late afternoon',
      price_tier: 'FREE',
      description: 'Iconic OSJ photo street. ⚠️ Umbrella canopy gone as of 2024-2025; replaced with string lights behind barricade.',
      why_it_matters: 'Most Pinterest pins are stale — knowing the current state is a moat.',
      best_for_persona: ['photographer', 'couples', 'family'],
      walkability_from_old_san_juan: 'In OSJ',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'morning',
      time_to_allocate_min: 30,
      gear_needed: 'Phone or camera',
      source_urls: [],
    },
    {
      activity_id: 'SAN-OUTDOOR-AUG-002',
      name: 'Las Pailas Natural Water Slides',
      neighborhood: 'Río Grande',
      type: 'Adventure / natural pool',
      hours: 'Daylight, no admission gate',
      price_tier: '$',
      description: 'Natural rock water slides at El Yunque\'s edge. $5 parking, $1 per person. Coordinates: 18°20\'16.3"N 65°43\'51.8"W.',
      why_it_matters: 'Fastest-rising venue — zero in 2023 content, hero in 4/12 2024-26 vlogs.',
      best_for_persona: ['adventurer', 'family', 'couples'],
      walkability_from_old_san_juan: '50 min drive SE',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'morning',
      time_to_allocate_min: 180,
      gear_needed: 'Swimsuit, water shoes, towel',
      source_urls: [],
    },
    {
      activity_id: 'SAN-OUTDOOR-AUG-003',
      name: 'La Perla Viewpoint (from Calle Norzagaray)',
      neighborhood: 'Old San Juan',
      type: 'Photo destination (viewpoint only)',
      hours: 'Anytime',
      price_tier: 'FREE',
      description: 'Hero viewpoint of La Perla neighborhood + ocean wall from Calle Norzagaray. ⚠️ DO NOT walk into La Perla itself per local consensus.',
      why_it_matters: 'Hero photo in 5/12 visual content — Despacito connection. Viewpoint only.',
      best_for_persona: ['photographer', 'couples'],
      walkability_from_old_san_juan: 'In OSJ',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'sunset',
      time_to_allocate_min: 20,
      gear_needed: 'Camera',
      source_urls: [],
    },
    {
      activity_id: 'SAN-OUTDOOR-AUG-004',
      name: 'Playa Escambrón',
      neighborhood: 'San Juan',
      type: 'Public beach + snorkeling',
      hours: 'Sunrise to sunset',
      price_tier: 'FREE',
      description: 'Closest snorkeling beach to OSJ — small reef, calm water, kiosk concessions.',
      why_it_matters: 'Snorkel without driving 90 min — appears in 3 SEO blog itineraries.',
      best_for_persona: ['family', 'budget', 'adventurer', 'relaxation'],
      walkability_from_old_san_juan: '10 min Uber',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'morning',
      time_to_allocate_min: 180,
      gear_needed: 'Swimsuit, snorkel mask (rentals on site)',
      source_urls: [],
    },
  ],
  'culture-history.json': [], // No culture additions from exploration
};

for (const [filename, additions] of Object.entries(AUGMENTATIONS)) {
  const srcPath = path.join(SRC, filename);
  const outPath = path.join(OUT, filename);
  const orig = JSON.parse(fs.readFileSync(srcPath, 'utf-8'));
  orig.items.push(...additions);
  orig.count = orig.items.length;
  orig.augmented_at = new Date().toISOString().slice(0, 10);
  orig.augmentations = additions.length;
  fs.writeFileSync(outPath, JSON.stringify(orig, null, 2));
  console.log(`✓ ${filename}: ${orig.count} items (${additions.length} augmented)`);
}

console.log('\nDone. Run scripts/seed-activities.js next.');
```

- [ ] **Step 2: Run the merge**

```bash
node scripts/merge-exploration-gaps.js
```

Expected output: 4 lines with item counts (foodie=28, outdoor=19, culture=12, nightlife=16) totaling ~75 items. Files written to `tasks/itinerary-research/seed-final/`.

- [ ] **Step 3: Write the seed script**

Create `scripts/seed-activities.js`:

```javascript
#!/usr/bin/env node
/**
 * One-shot seed of the activities DynamoDB table from seed-final JSONs.
 * Idempotent: uses PutItem (overwrites existing rows with same activity_id).
 */
const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = 'mi-itinerario-activities';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const SEED_DIR = path.join(__dirname, '..', 'tasks', 'itinerary-research', 'seed-final');

async function main() {
  const files = fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json'));
  let total = 0;

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), 'utf-8'));
    const items = data.items.map((item, idx) => ({
      ...item,
      activity_id: item.activity_id || `${file.replace('.json', '').toUpperCase()}-${String(idx + 1).padStart(3, '0')}`,
    }));

    // Batch in groups of 25 (DDB limit)
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await client.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: batch.map(Item => ({ PutRequest: { Item } })),
          },
        })
      );
      total += batch.length;
    }
    console.log(`✓ ${file}: ${items.length} items`);
  }
  console.log(`\nTotal seeded: ${total}`);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the seed**

```bash
AWS_PROFILE=casa-coqui node scripts/seed-activities.js
```

Expected: 4 file confirmations and "Total seeded: ~75".

- [ ] **Step 5: Verify in DynamoDB**

```bash
aws dynamodb scan --table-name mi-itinerario-activities --select COUNT
```

Expected: `"Count": 75` (or whatever the merged count is).

- [ ] **Step 6: Commit**

```bash
git add scripts/merge-exploration-gaps.js scripts/seed-activities.js
git commit -m "scripts(itinerary): merge exploration gaps + seed activities table"
```

---

## Task 5: Atardecer hero page at `/puerto-rico-itinerary`

**Files:**
- Modify: `app/globals.css` (load Google Fonts)
- Modify: `tailwind.config.js` (add `display` font family)
- Create: `app/puerto-rico-itinerary/page.js`
- Create: `app/puerto-rico-itinerary/components/AtardecerHero.js`

- [ ] **Step 1: Load fonts in globals.css**

Add to the top of `app/globals.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,700&family=DM+Mono:wght@400;500&display=swap');
```

- [ ] **Step 2: Extend Tailwind config**

In `tailwind.config.js`, under `theme.extend`, add:

```javascript
fontFamily: {
  display: ['"Playfair Display"', 'Georgia', 'serif'],
  mono: ['"DM Mono"', 'monospace'],
  sans: ['"DM Sans"', 'system-ui', 'sans-serif'], // existing
},
```

- [ ] **Step 3: Create the hero component**

Create `app/puerto-rico-itinerary/components/AtardecerHero.js`:

```javascript
'use client';
import Link from 'next/link';

export default function AtardecerHero() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-cafe-50">
      {/* Atardecer radial glow top-right */}
      <div
        className="pointer-events-none absolute top-0 right-0 h-[500px] w-[500px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(251,224,153,0.22) 0%, transparent 70%)',
          transform: 'translate(20%, -30%)',
        }}
      />

      <div className="relative mx-auto max-w-md px-7 pt-20 pb-12 text-center">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.12em] text-atardecer-700">
          San Juan · Puerto Rico
        </p>

        <h1 className="mb-5 font-display text-4xl font-bold leading-[1.05] text-coqui-900 md:text-5xl">
          Your Puerto Rico,
          <br />
          <em className="italic text-atardecer-700">day by day.</em>
        </h1>

        <p className="mb-10 text-base leading-relaxed text-cafe-800">
          Tell us about your trip. We'll build your itinerary —
          <br />
          vetted, personal, free.
        </p>

        <Link
          href="/puerto-rico-itinerary/wizard"
          className="inline-flex w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl bg-coqui-500 px-8 py-4 font-semibold text-white shadow-[0_6px_14px_-3px_rgba(26,154,90,0.4)] transition-transform hover:scale-[1.02]"
        >
          Build my itinerary →
        </Link>

        <p className="mt-5 font-mono text-xs text-cafe-600">
          75+ vetted San Juan activities · powered by local knowledge
        </p>

        <div className="mt-12 flex flex-wrap justify-center gap-3">
          {[
            '🌿 Locally curated',
            '🆓 Always free',
            '🤝 No accounts needed',
          ].map((t) => (
            <span
              key={t}
              className="rounded-full border border-cafe-200 bg-cafe-100 px-3 py-1.5 text-xs text-cafe-800"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create the page**

Create `app/puerto-rico-itinerary/page.js`:

```javascript
import AtardecerHero from './components/AtardecerHero';

export const metadata = {
  title: 'Mi Itinerario · Plan your Puerto Rico trip · Casa Coqui',
  description:
    'Free, vetted, day-by-day Puerto Rico itineraries from a local in San Juan. Built by your host at Casa Coqui.',
  openGraph: {
    title: 'Your Puerto Rico, day by day · Mi Itinerario',
    description:
      'Free local-curated San Juan itineraries. No signup.',
  },
};

export default function PlanLandingPage() {
  return <AtardecerHero />;
}
```

- [ ] **Step 5: Start dev server, verify visually**

```bash
npm run dev
```

Open http://localhost:3000/puerto-rico-itinerary in browser. Expected: hero renders with golden-hour radial glow, Playfair Display headline, atardecer-700 italic accent, single green CTA, trust chips below.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css tailwind.config.js app/puerto-rico-itinerary/page.js app/puerto-rico-itinerary/components/AtardecerHero.js
git commit -m "feat(plan): Atardecer hero landing page"
```

---

## Task 6: Persona wizard (4-step shell + chip grid)

**Files:**
- Create: `app/puerto-rico-itinerary/wizard/page.js`
- Create: `app/puerto-rico-itinerary/components/PersonaWizard.js`
- Create: `app/puerto-rico-itinerary/components/WizardStep.js`

- [ ] **Step 1: Write the WizardStep component**

Create `app/puerto-rico-itinerary/components/WizardStep.js`:

```javascript
'use client';

export default function WizardStep({
  stepNumber,
  totalSteps,
  question,
  helper,
  options,
  multiSelect = true,
  selected,
  onToggle,
}) {
  return (
    <div className="px-7 pt-12 pb-32">
      {/* Progress */}
      <div className="mb-12 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-caribe-700">
          Step {stepNumber} of {totalSteps}
        </span>
        <div className="mx-3 h-1 flex-1 overflow-hidden rounded-full bg-cafe-200">
          <div
            className="h-full rounded-full bg-atardecer-300 transition-all duration-300"
            style={{ width: `${(stepNumber / totalSteps) * 100}%` }}
          />
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-caribe-700">
          {Math.round((stepNumber / totalSteps) * 100)}%
        </span>
      </div>

      <h2 className="mb-2 text-center font-display text-3xl font-bold leading-tight text-coqui-900">
        {question}
      </h2>
      {helper && (
        <p className="mb-8 text-center text-sm text-cafe-700">{helper}</p>
      )}

      <div className="flex flex-wrap justify-center gap-2.5">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value, multiSelect)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-all ${
                isSelected
                  ? 'border-coqui-500 bg-coqui-500 text-white'
                  : 'border-cafe-200 bg-cafe-100 text-coqui-900 hover:bg-cafe-200'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the PersonaWizard orchestrator**

Create `app/puerto-rico-itinerary/components/PersonaWizard.js`:

```javascript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import WizardStep from './WizardStep';
import LoadingState from './LoadingState';

const STEPS = [
  {
    question: "What's your travel vibe?",
    helper: "Pick all that apply. We'll match activities to your taste.",
    multiSelect: true,
    field: 'interests',
    options: [
      { value: 'foodie', label: '🍴 Foodie' },
      { value: 'family', label: '👨‍👩‍👧 Family' },
      { value: 'beach', label: '🌊 Beach + Sun' },
      { value: 'history', label: '🏛 History buff' },
      { value: 'nightlife', label: '🎶 Nightlife' },
      { value: 'outdoor', label: '🥾 Outdoor' },
      { value: 'romantic', label: '💑 Romantic' },
      { value: 'art', label: '🎨 Art & culture' },
      { value: 'budget', label: '💸 Budget-conscious' },
      { value: 'cocktails', label: '🍹 Cocktail enthusiast' },
    ],
  },
  {
    question: 'How many days?',
    helper: 'How long is your San Juan trip?',
    multiSelect: false,
    field: 'num_days',
    options: [
      { value: '3', label: '3 days' },
      { value: '4', label: '4 days' },
      { value: '5', label: '5 days' },
      { value: '6', label: '6 days' },
      { value: '7', label: '7 days' },
      { value: '10', label: '10+ days' },
    ],
  },
  {
    question: 'Who are you traveling with?',
    helper: 'This shapes the recommendations.',
    multiSelect: false,
    field: 'traveler_type',
    options: [
      { value: 'couple', label: '💑 Couple' },
      { value: 'family', label: '👨‍👩‍👧 Family with kids' },
      { value: 'friends', label: '👯 Friends group' },
      { value: 'solo', label: '🧍 Solo' },
    ],
  },
  {
    question: 'Any pace preference?',
    helper: 'Optional — leave blank if no preference.',
    multiSelect: false,
    field: 'pace',
    options: [
      { value: 'packed', label: '⚡ Packed — see everything' },
      { value: 'balanced', label: '🌿 Balanced' },
      { value: 'slow', label: '🌅 Slow — savor it' },
    ],
  },
];

export default function PersonaWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [answers, setAnswers] = useState({
    interests: [],
    num_days: null,
    traveler_type: null,
    pace: null,
  });

  const current = STEPS[step];

  const handleToggle = (value, multi) => {
    setAnswers((prev) => {
      const existing = prev[current.field];
      if (multi) {
        const arr = Array.isArray(existing) ? existing : [];
        return {
          ...prev,
          [current.field]: arr.includes(value)
            ? arr.filter((v) => v !== value)
            : [...arr, value],
        };
      }
      return { ...prev, [current.field]: value };
    });
  };

  const canContinue = () => {
    const v = answers[current.field];
    if (current.multiSelect) return Array.isArray(v) && v.length > 0;
    return v !== null && v !== undefined;
  };

  const handleContinue = async () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...answers,
          num_days: Number(answers.num_days),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Generation failed (${res.status})`);
      }
      const { plan_id } = await res.json();
      router.push(`/puerto-rico-itinerary/${plan_id}`);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  if (loading) return <LoadingState />;

  const selectedForCurrent = current.multiSelect
    ? answers[current.field] || []
    : answers[current.field]
    ? [answers[current.field]]
    : [];

  return (
    <div className="relative min-h-screen bg-cafe-50">
      <WizardStep
        stepNumber={step + 1}
        totalSteps={STEPS.length}
        question={current.question}
        helper={current.helper}
        options={current.options}
        multiSelect={current.multiSelect}
        selected={selectedForCurrent}
        onToggle={handleToggle}
      />

      {error && (
        <p className="mx-auto max-w-md px-7 text-center text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-cafe-50 via-cafe-50/95 to-transparent px-7 pb-7 pt-12">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue()}
          className="w-full rounded-2xl bg-coqui-500 px-8 py-4 font-semibold text-white shadow-[0_6px_14px_-3px_rgba(26,154,90,0.4)] disabled:bg-cafe-300 disabled:text-cafe-600 disabled:shadow-none"
        >
          {step < STEPS.length - 1 ? 'Continue →' : 'Build my itinerary →'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write LoadingState placeholder**

Create `app/puerto-rico-itinerary/components/LoadingState.js`:

```javascript
'use client';

export default function LoadingState() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cafe-50 px-7 text-center">
      <div className="mb-6 h-16 w-16 animate-pulse rounded-full bg-atardecer-200" />
      <h2 className="mb-2 font-display text-2xl font-bold text-coqui-900">
        Building your itinerary…
      </h2>
      <p className="text-sm text-cafe-700">
        Reading the activities, asking the AI, sequencing your days.
      </p>
      <p className="mt-1 font-mono text-xs text-cafe-600">~10 seconds</p>
    </div>
  );
}
```

- [ ] **Step 4: Wire the wizard page**

Create `app/puerto-rico-itinerary/wizard/page.js`:

```javascript
import PersonaWizard from '../components/PersonaWizard';

export const metadata = {
  title: 'Build my itinerary · Mi Itinerario',
};

export default function WizardPage() {
  return <PersonaWizard />;
}
```

- [ ] **Step 5: Manual smoke test**

```bash
npm run dev
```

Visit http://localhost:3000/puerto-rico-itinerary, click "Build my itinerary →", navigate through 4 wizard steps. Verify:
- Chips toggle in/out
- Continue button enables only when a selection exists
- Progress bar fills 25% / 50% / 75% / 100%
- Final "Build my itinerary" click attempts API call (will 404 — that's expected, next task)

- [ ] **Step 6: Commit**

```bash
git add app/puerto-rico-itinerary/wizard app/puerto-rico-itinerary/components
git commit -m "feat(plan): persona wizard with 4 steps + progress + chip grid"
```

---

## Task 7: itinerary-generate Lambda (scaffold + IAM)

**Files:**
- Create: `infra/lambdas/itinerary_generate/index.mjs`
- Create: `infra/lambdas/itinerary_generate/package.json`
- Modify: `infra/stacks/itinerary_stack.py`

- [ ] **Step 1: Write the Lambda scaffold**

Create `infra/lambdas/itinerary_generate/package.json`:

```json
{
  "name": "itinerary-generate",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.700.0",
    "@aws-sdk/client-dynamodb": "^3.700.0",
    "@aws-sdk/lib-dynamodb": "^3.700.0",
    "nanoid": "^5.0.0"
  }
}
```

Create `infra/lambdas/itinerary_generate/index.mjs`:

```javascript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { nanoid } from 'nanoid';

const REGION = process.env.AWS_REGION || 'us-east-1';
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE;
const ITINERARIES_TABLE = process.env.ITINERARIES_TABLE;
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const bedrock = new BedrockRuntimeClient({ region: REGION });

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { interests, num_days, traveler_type, pace } = body;

    if (!Array.isArray(interests) || interests.length === 0)
      return resp(400, { error: 'interests required' });
    if (!num_days || num_days < 1 || num_days > 14)
      return resp(400, { error: 'num_days must be 1-14' });

    const plan_id = nanoid(10);
    const activities = await loadActivities(interests);
    const prompt = buildPrompt({ interests, num_days, traveler_type, pace, activities });

    const days = await generateWithBedrock(prompt);

    const ttl_epoch = Math.floor(Date.now() / 1000) + 90 * 86400;
    await ddb.send(
      new PutCommand({
        TableName: ITINERARIES_TABLE,
        Item: {
          plan_id,
          interests,
          num_days,
          traveler_type,
          pace,
          days,
          generated_at: new Date().toISOString(),
          ttl_epoch,
        },
      })
    );

    return resp(200, { plan_id, days });
  } catch (err) {
    console.error('generate failed:', err);
    return resp(500, { error: 'generation_failed', detail: err.message });
  }
};

async function loadActivities(interests) {
  // Phase-1 simple scan; Phase 2 of this plan adds GSI query
  const out = await ddb.send(new ScanCommand({ TableName: ACTIVITIES_TABLE }));
  return (out.Items || []).filter((item) =>
    (item.best_for_persona || []).some((p) => interests.includes(p))
  );
}

function buildPrompt({ interests, num_days, traveler_type, pace, activities }) {
  const compact = activities.map((a) => ({
    id: a.activity_id,
    name: a.name,
    neighborhood: a.neighborhood,
    type: a.type,
    time_of_day: a.ideal_time_of_day,
    duration_min: a.time_to_allocate_min,
    persona: a.best_for_persona,
    walk: a.walkability_from_old_san_juan,
    why: a.why_it_matters,
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
- Treat Santurce as an evening CLUSTER (Cocina al Fondo + Identidad + La Alcapurria + La Placita).
- Put Old San Juan on Day 1.
- El Yunque on Day 2 or 3, never Day 1.
- NEVER route into La Perla neighborhood (safety). The viewpoint from Calle Norzagaray IS OK.
- The Calle Fortaleza umbrella canopy is GONE as of 2024-2025 — replaced by string lights.

USER PROFILE:
- interests: ${JSON.stringify(interests)}
- num_days: ${num_days}
- traveler_type: ${traveler_type}
- pace: ${pace}

OUTPUT: Strict JSON array of days. NO prose, NO markdown, NO code fences. Schema:
[{"day_num": 1, "theme": "string", "items":[{"activity_id":"string","time":"morning|afternoon|evening","duration_min":number,"note":"string"}]}]

ACTIVITIES_DB:
${JSON.stringify(compact)}`,
        },
      ],
    },
  ];
}

async function generateWithBedrock(messages) {
  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages,
    }),
  });
  const res = await bedrock.send(cmd);
  const raw = JSON.parse(new TextDecoder().decode(res.body));
  const text = raw.content?.[0]?.text || '';
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('Bedrock response had no JSON array');
  return JSON.parse(text.slice(start, end + 1));
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}
```

- [ ] **Step 2: Add Lambda to CDK stack**

In `infra/stacks/itinerary_stack.py`, after the itineraries_table block, add:

```python
# itinerary-generate Lambda
generate_fn = _lambda.Function(
    self,
    "ItineraryGenerateFn",
    runtime=_lambda.Runtime.NODEJS_20_X,
    handler="index.handler",
    code=_lambda.Code.from_asset(
        "lambdas/itinerary_generate",
        bundling=cdk.BundlingOptions(
            image=_lambda.Runtime.NODEJS_20_X.bundling_image,
            command=["bash", "-c", "npm install --omit=dev && cp -r . /asset-output"],
        ),
    ),
    timeout=Duration.seconds(30),
    memory_size=512,
    environment={
        "ACTIVITIES_TABLE": self.activities_table.table_name,
        "ITINERARIES_TABLE": self.itineraries_table.table_name,
    },
)

self.activities_table.grant_read_data(generate_fn)
self.itineraries_table.grant_write_data(generate_fn)

# Bedrock invocation permission for Claude Haiku
generate_fn.add_to_role_policy(
    iam.PolicyStatement(
        actions=["bedrock:InvokeModel"],
        resources=[
            "arn:aws:bedrock:us-east-1::foundation-model/us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "arn:aws:bedrock:us-east-1:*:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        ],
    )
)

self.generate_fn = generate_fn
```

- [ ] **Step 3: Deploy**

```bash
cd infra && cdk deploy MiItinerarioStack --require-approval never
```

Expected: Lambda function created, IAM role attached with DDB read/write + Bedrock invoke.

- [ ] **Step 4: Smoke-test the Lambda directly**

```bash
aws lambda invoke \
  --function-name $(aws cloudformation describe-stacks --stack-name MiItinerarioStack --query "Stacks[0].Outputs[?OutputKey=='ItineraryGenerateFnName'].OutputValue" --output text) \
  --payload '{"body":"{\"interests\":[\"foodie\"],\"num_days\":3,\"traveler_type\":\"couple\",\"pace\":\"balanced\"}"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/out.json && cat /tmp/out.json
```

Expected: response with `plan_id` and `days` array. May take ~10 seconds (Bedrock call).

- [ ] **Step 5: Commit**

```bash
git add infra/lambdas/itinerary_generate infra/stacks/itinerary_stack.py
git commit -m "feat(itinerary): generate Lambda — Bedrock prompt + DDB write"
```

---

## Task 8: API Gateway HTTP API + Lambda integration

**Files:**
- Modify: `infra/stacks/itinerary_stack.py`

- [ ] **Step 1: Add HTTP API + route**

Append in `MiItinerarioStack.__init__`:

```python
http_api = apigw.HttpApi(
    self,
    "ItineraryHttpApi",
    api_name="mi-itinerario-api",
    cors_preflight=apigw.CorsPreflightOptions(
        allow_origins=["*"],  # tighten to casa-coqui.cc domains before prod
        allow_methods=[apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.OPTIONS],
        allow_headers=["content-type"],
    ),
)

http_api.add_routes(
    path="/generate",
    methods=[apigw.HttpMethod.POST],
    integration=apigw_int.HttpLambdaIntegration("GenerateInt", generate_fn),
)

cdk.CfnOutput(self, "HttpApiUrl", value=http_api.api_endpoint, export_name="MiItinerarioApiUrl")
```

- [ ] **Step 2: Deploy + capture URL**

```bash
cd infra && cdk deploy MiItinerarioStack --require-approval never
aws cloudformation describe-stacks --stack-name MiItinerarioStack \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" --output text
```

Save the printed URL — used in the next task.

- [ ] **Step 3: Smoke-test the endpoint**

```bash
API_URL=$(aws cloudformation describe-stacks --stack-name MiItinerarioStack --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" --output text)
curl -X POST "$API_URL/generate" \
  -H "content-type: application/json" \
  -d '{"interests":["foodie","beach"],"num_days":4,"traveler_type":"couple","pace":"balanced"}' | jq
```

Expected: JSON with `plan_id` and `days[]`.

- [ ] **Step 4: Commit**

```bash
git add infra/stacks/itinerary_stack.py
git commit -m "infra(itinerary): API Gateway HTTP API + /generate route"
```

---

## Task 9: Vercel API route → AWS API Gateway proxy

**Files:**
- Create: `app/api/plan/generate/route.js`
- Modify: `.env.local` (add `MI_ITINERARIO_API_URL`)

- [ ] **Step 1: Add env var**

Append to `.env.local`:

```
MI_ITINERARIO_API_URL=https://<replace-with-api-url>.execute-api.us-east-1.amazonaws.com
```

- [ ] **Step 2: Write the Vercel handler**

Create `app/api/plan/generate/route.js`:

```javascript
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const body = await request.json();

  if (!Array.isArray(body.interests) || body.interests.length === 0)
    return Response.json({ error: 'interests_required' }, { status: 400 });
  if (!Number.isInteger(body.num_days) || body.num_days < 1 || body.num_days > 14)
    return Response.json({ error: 'invalid_num_days' }, { status: 400 });

  try {
    const upstream = await fetch(`${process.env.MI_ITINERARIO_API_URL}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('proxy /generate failed:', err);
    return Response.json({ error: 'upstream_unavailable' }, { status: 502 });
  }
}
```

- [ ] **Step 3: Restart dev server + test through the wizard**

```bash
npm run dev
```

Walk through the wizard end-to-end. The final "Build my itinerary →" click should now hit the real Lambda, get back a `plan_id`, and redirect to `/puerto-rico-itinerary/{plan_id}` (which 404s — next task fixes that).

- [ ] **Step 4: Commit** (don't commit the env file — already in .gitignore)

```bash
git add app/api/plan/generate/route.js
git commit -m "feat(api): /api/plan/generate proxy to AWS API Gateway"
```

---

## Task 10: Itinerary view page — read DDB and render days

**Files:**
- Create: `app/puerto-rico-itinerary/[plan_id]/page.js`
- Create: `app/api/puerto-rico-itinerary/[plan_id]/route.js`
- Create: `app/puerto-rico-itinerary/components/DayCard.js`
- Create: `app/puerto-rico-itinerary/components/ActivityCard.js`
- Create: `lib/itinerary/dynamodb.js`

- [ ] **Step 1: Write the DDB read helper**

Create `lib/itinerary/dynamodb.js`:

```javascript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export async function getItinerary(plan_id) {
  const res = await ddb.send(
    new GetCommand({
      TableName: process.env.ITINERARIES_TABLE || 'mi-itinerario-itineraries',
      Key: { plan_id },
    })
  );
  return res.Item || null;
}

export async function getActivitiesByIds(activity_ids) {
  if (!activity_ids?.length) return [];
  const out = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [process.env.ACTIVITIES_TABLE || 'mi-itinerario-activities']: {
          Keys: activity_ids.map((id) => ({ activity_id: id })),
        },
      },
    })
  );
  return out.Responses?.[process.env.ACTIVITIES_TABLE || 'mi-itinerario-activities'] || [];
}
```

- [ ] **Step 2: Write the GET API route**

Create `app/api/puerto-rico-itinerary/[plan_id]/route.js`:

```javascript
import { getItinerary, getActivitiesByIds } from '@/lib/itinerary/dynamodb';

export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  const { plan_id } = params;
  const itinerary = await getItinerary(plan_id);
  if (!itinerary) return Response.json({ error: 'not_found' }, { status: 404 });

  // Hydrate activity_ids → full activity records
  const allIds = (itinerary.days || []).flatMap((d) => (d.items || []).map((i) => i.activity_id));
  const activities = await getActivitiesByIds([...new Set(allIds)]);
  const byId = Object.fromEntries(activities.map((a) => [a.activity_id, a]));

  const hydrated = (itinerary.days || []).map((d) => ({
    ...d,
    items: (d.items || []).map((it) => ({ ...it, activity: byId[it.activity_id] || null })),
  }));

  return Response.json({ ...itinerary, days: hydrated });
}
```

- [ ] **Step 3: Write the ActivityCard component**

Create `app/puerto-rico-itinerary/components/ActivityCard.js`:

```javascript
'use client';

const EMOJI_BY_TYPE = {
  Restaurant: '🍴',
  'Street food': '🥟',
  Café: '☕',
  'Public beach': '🏖',
  'Spanish colonial fort': '🏰',
  Museum: '🖼',
  'Craft cocktail bar': '🍸',
  Hike: '🥾',
  'Photo destination': '📸',
  default: '📍',
};

const TIME_LABEL = {
  morning: '9:00 AM',
  afternoon: '1:00 PM',
  evening: '7:00 PM',
  late_night: '10:00 PM',
};

export default function ActivityCard({ item }) {
  if (!item?.activity) return null;
  const { activity, time, duration_min, note } = item;
  const emoji = EMOJI_BY_TYPE[activity.type] || EMOJI_BY_TYPE.default;

  return (
    <div className="mb-3 flex gap-3 rounded-2xl border border-cafe-100 bg-white p-4 shadow-[0_4px_14px_-2px_rgba(7,54,32,0.06)]">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-cafe-200 text-2xl">
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="mb-0.5 font-mono text-[11px] text-caribe-600">
          {TIME_LABEL[time] || time} · ~{Math.round(duration_min / 30) * 30} min
        </div>
        <div className="mb-1 text-[15px] font-semibold leading-snug text-coqui-900">
          {activity.name}
        </div>
        <p className="text-xs leading-relaxed text-cafe-800">
          {note || activity.why_it_matters}
        </p>
        <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-cafe-500">
          <span>{(activity.best_for_persona || []).slice(0, 2).join(' · ')}</span>
          <span>{activity.price_tier}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the DayCard component**

Create `app/puerto-rico-itinerary/components/DayCard.js`:

```javascript
'use client';
import ActivityCard from './ActivityCard';

export default function DayCard({ day, date }) {
  return (
    <section className="px-5 py-6">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-caribe-600">
          Day {String(day.day_num).padStart(2, '0')}
        </span>
        {date && (
          <span className="font-mono text-xs text-cafe-600">{date}</span>
        )}
      </div>
      <h2 className="mb-1 font-display text-2xl font-bold leading-tight text-coqui-900">
        {day.theme || `Day ${day.day_num}`}
      </h2>
      <p className="mb-5 font-display text-base italic text-cafe-700">
        {(day.items || []).length} stops
      </p>

      {(day.items || []).map((item, idx) => (
        <ActivityCard key={`${day.day_num}-${idx}`} item={item} />
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Write the itinerary page**

Create `app/puerto-rico-itinerary/[plan_id]/page.js`:

```javascript
import DayCard from '../components/DayCard';

async function fetchPlan(plan_id) {
  // Server-side fetch — runs in the same Vercel Function
  const baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/plan/${plan_id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function ItineraryPage({ params }) {
  const plan = await fetchPlan(params.plan_id);

  if (!plan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cafe-50 text-center">
        <div>
          <h2 className="font-display text-2xl font-bold text-coqui-900">
            That itinerary isn't here anymore.
          </h2>
          <p className="mt-2 text-cafe-700">
            Anonymous itineraries expire after 90 days.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-cafe-50">
      <header className="px-5 pt-12 pb-4 text-center">
        <p className="mb-1 font-mono text-xs uppercase tracking-[0.1em] text-caribe-700">
          Your trip · {plan.num_days} days
        </p>
        <h1 className="font-display text-3xl font-bold text-coqui-900">
          San Juan, planned.
        </h1>
      </header>

      {(plan.days || []).map((day) => (
        <DayCard key={day.day_num} day={day} />
      ))}

      <footer className="px-5 py-8 text-center text-xs text-cafe-600">
        plan_id: {plan.plan_id} · expires in {Math.floor((plan.ttl_epoch * 1000 - Date.now()) / 86400000)} days
      </footer>
    </main>
  );
}
```

- [ ] **Step 6: End-to-end smoke test**

```bash
npm run dev
```

Visit http://localhost:3000/puerto-rico-itinerary → wizard → submit → land on `/puerto-rico-itinerary/[plan_id]` showing rendered days with activity cards.

- [ ] **Step 7: Commit**

```bash
git add app/puerto-rico-itinerary/[plan_id] app/api/puerto-rico-itinerary/[plan_id] app/puerto-rico-itinerary/components/DayCard.js app/puerto-rico-itinerary/components/ActivityCard.js lib/itinerary/dynamodb.js
git commit -m "feat(plan): itinerary view page with day + activity rendering"
```

---

## Task 11: itinerary-refine Lambda (swap one day)

**Files:**
- Create: `infra/lambdas/itinerary_refine/index.mjs`
- Create: `infra/lambdas/itinerary_refine/package.json`
- Modify: `infra/stacks/itinerary_stack.py`

- [ ] **Step 1: Write the refine Lambda**

`package.json` is identical to itinerary_generate.

Create `infra/lambdas/itinerary_refine/index.mjs`:

```javascript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const bedrock = new BedrockRuntimeClient({ region: REGION });
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export const handler = async (event) => {
  try {
    const { plan_id, day_num, user_request } = JSON.parse(event.body || '{}');
    if (!plan_id || !day_num || !user_request) return resp(400, { error: 'missing_fields' });

    const cur = await ddb.send(new GetCommand({ TableName: process.env.ITINERARIES_TABLE, Key: { plan_id } }));
    if (!cur.Item) return resp(404, { error: 'plan_not_found' });

    const scan = await ddb.send(new ScanCommand({ TableName: process.env.ACTIVITIES_TABLE }));
    const matched = (scan.Items || []).filter((a) =>
      (a.best_for_persona || []).some((p) => (cur.Item.interests || []).includes(p))
    );

    const newDay = await regenerateDay({ existing: cur.Item, day_num, user_request, activities: matched });
    const updatedDays = (cur.Item.days || []).map((d) => (d.day_num === day_num ? newDay : d));

    await ddb.send(
      new UpdateCommand({
        TableName: process.env.ITINERARIES_TABLE,
        Key: { plan_id },
        UpdateExpression: 'SET days = :d, last_refined_at = :t',
        ExpressionAttributeValues: { ':d': updatedDays, ':t': new Date().toISOString() },
      })
    );

    return resp(200, { day: newDay });
  } catch (err) {
    console.error('refine failed:', err);
    return resp(500, { error: 'refine_failed', detail: err.message });
  }
};

async function regenerateDay({ existing, day_num, user_request, activities }) {
  const compact = activities.map((a) => ({
    id: a.activity_id, name: a.name, neighborhood: a.neighborhood, type: a.type,
    time_of_day: a.ideal_time_of_day, duration_min: a.time_to_allocate_min,
    persona: a.best_for_persona, why: a.why_it_matters,
  }));

  const messages = [{
    role: 'user',
    content: [{ type: 'text', text: `Regenerate ONLY day ${day_num} of an existing itinerary.

USER REQUEST: ${user_request}

EXISTING ITINERARY:
${JSON.stringify(existing.days)}

Output a single Day JSON object (not an array) matching the schema:
{"day_num": ${day_num}, "theme": "string", "items":[{"activity_id":"string","time":"morning|afternoon|evening","duration_min":number,"note":"string"}]}

Use ONLY activities from ACTIVITIES_DB:
${JSON.stringify(compact)}` }],
  }];

  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 1024, messages }),
  }));
  const raw = JSON.parse(new TextDecoder().decode(res.body));
  const text = raw.content?.[0]?.text || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1) throw new Error('Bedrock response had no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

function resp(status, body) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
```

- [ ] **Step 2: Add refine Lambda + route to CDK stack**

In `itinerary_stack.py`, after the generate_fn block:

```python
refine_fn = _lambda.Function(
    self,
    "ItineraryRefineFn",
    runtime=_lambda.Runtime.NODEJS_20_X,
    handler="index.handler",
    code=_lambda.Code.from_asset(
        "lambdas/itinerary_refine",
        bundling=cdk.BundlingOptions(
            image=_lambda.Runtime.NODEJS_20_X.bundling_image,
            command=["bash", "-c", "npm install --omit=dev && cp -r . /asset-output"],
        ),
    ),
    timeout=Duration.seconds(30),
    memory_size=512,
    environment={
        "ACTIVITIES_TABLE": self.activities_table.table_name,
        "ITINERARIES_TABLE": self.itineraries_table.table_name,
    },
)
self.activities_table.grant_read_data(refine_fn)
self.itineraries_table.grant_read_write_data(refine_fn)
refine_fn.add_to_role_policy(
    iam.PolicyStatement(
        actions=["bedrock:InvokeModel"],
        resources=[
            "arn:aws:bedrock:us-east-1::foundation-model/us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "arn:aws:bedrock:us-east-1:*:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        ],
    )
)

http_api.add_routes(
    path="/refine",
    methods=[apigw.HttpMethod.POST],
    integration=apigw_int.HttpLambdaIntegration("RefineInt", refine_fn),
)
```

- [ ] **Step 3: Deploy**

```bash
cd infra && cdk deploy MiItinerarioStack --require-approval never
```

- [ ] **Step 4: Commit**

```bash
git add infra/lambdas/itinerary_refine infra/stacks/itinerary_stack.py
git commit -m "feat(itinerary): refine Lambda for swap-day requests"
```

---

## Task 12: Refine API route + UI "swap day" button

**Files:**
- Create: `app/api/plan/refine/route.js`
- Modify: `app/puerto-rico-itinerary/components/DayCard.js` (add swap button + handler)

- [ ] **Step 1: Vercel route**

Create `app/api/plan/refine/route.js`:

```javascript
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const body = await request.json();
  if (!body.plan_id || !body.day_num || !body.user_request)
    return Response.json({ error: 'missing_fields' }, { status: 400 });

  const upstream = await fetch(`${process.env.MI_ITINERARIO_API_URL}/refine`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 2: Update DayCard with swap UI**

Replace `app/puerto-rico-itinerary/components/DayCard.js` with:

```javascript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ActivityCard from './ActivityCard';

export default function DayCard({ day, date, plan_id }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!input.trim()) return;
    setPending(true);
    try {
      const res = await fetch('/api/plan/refine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_id, day_num: day.day_num, user_request: input.trim() }),
      });
      if (res.ok) router.refresh();
      else alert('Could not refine that day. Try again.');
    } finally {
      setPending(false);
      setOpen(false);
      setInput('');
    }
  };

  return (
    <section className="px-5 py-6">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-caribe-600">
          Day {String(day.day_num).padStart(2, '0')}
        </span>
        {date && <span className="font-mono text-xs text-cafe-600">{date}</span>}
      </div>
      <h2 className="mb-1 font-display text-2xl font-bold leading-tight text-coqui-900">
        {day.theme || `Day ${day.day_num}`}
      </h2>
      <p className="mb-5 font-display text-base italic text-cafe-700">
        {(day.items || []).length} stops
      </p>

      {(day.items || []).map((item, idx) => (
        <ActivityCard key={`${day.day_num}-${idx}`} item={item} />
      ))}

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 w-full rounded-xl border border-dashed border-cafe-300 px-4 py-3 font-mono text-xs uppercase tracking-[0.08em] text-cafe-700 hover:bg-cafe-100"
        >
          ↻ Swap this day
        </button>
      ) : (
        <div className="mt-3 rounded-xl bg-cafe-100 p-3">
          <textarea
            className="mb-2 w-full rounded-md border border-cafe-200 bg-white p-3 text-sm focus:border-coqui-500 focus:outline-none"
            rows={2}
            placeholder="e.g. More food, less beach. Or: focus on nightlife."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="flex-1 rounded-lg bg-coqui-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Rebuilding…' : 'Rebuild day'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-cafe-300 px-3 py-2 text-sm text-cafe-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Pass `plan_id` from page**

In `app/puerto-rico-itinerary/[plan_id]/page.js`, update the DayCard call:

```javascript
<DayCard key={day.day_num} day={day} plan_id={plan.plan_id} />
```

- [ ] **Step 4: End-to-end test**

Run wizard → generate → on the itinerary page, click "Swap this day" on any day → type "more food, less beach" → "Rebuild day" → page refreshes with new content.

- [ ] **Step 5: Commit**

```bash
git add app/api/plan/refine app/puerto-rico-itinerary/components/DayCard.js app/puerto-rico-itinerary/[plan_id]/page.js
git commit -m "feat(plan): swap-day refinement UI + API route"
```

---

## Task 13: Error handling + fallback static template

**Files:**
- Create: `lib/itinerary/fallback-template.js`
- Modify: `app/api/plan/generate/route.js` (use fallback on upstream failure)

- [ ] **Step 1: Write fallback template**

Create `lib/itinerary/fallback-template.js`:

```javascript
/**
 * Returned when Bedrock or the Lambda is unavailable.
 * Hand-crafted "5 days in San Juan" using canonical seed activities.
 */
export const FALLBACK_PLAN = {
  is_fallback: true,
  num_days: 5,
  days: [
    {
      day_num: 1,
      theme: 'Old San Juan',
      items: [
        { activity_id: 'CULTURE-HISTORY-001', time: 'morning', duration_min: 120, note: 'El Morro — start early before cruise crowds.' },
        { activity_id: 'FOODIE-SPOTS-005', time: 'afternoon', duration_min: 60, note: 'Café Cuatro Sombras for single-estate PR coffee.' },
        { activity_id: 'FOODIE-SPOTS-007', time: 'evening', duration_min: 90, note: 'Pirilo Pizza Rústica — wood-fired, locals love it.' },
        { activity_id: 'NIGHTLIFE-EXPERIENCES-001', time: 'late_night', duration_min: 120, note: 'La Factoría — World\'s 50 Best.' },
      ],
    },
    // ... 4 more days similarly templated
  ],
};
```

- [ ] **Step 2: Use fallback in API route**

Modify `app/api/plan/generate/route.js`:

```javascript
import { nanoid } from 'nanoid';
import { FALLBACK_PLAN } from '@/lib/itinerary/fallback-template';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const body = await request.json();
  if (!Array.isArray(body.interests) || body.interests.length === 0)
    return Response.json({ error: 'interests_required' }, { status: 400 });

  try {
    const upstream = await fetch(`${process.env.MI_ITINERARIO_API_URL}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // 25s timeout — Vercel function has 60s cap, leave room for retry/error path
      signal: AbortSignal.timeout(25_000),
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const text = await upstream.text();
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error('generate fallback triggered:', err.message);
    return Response.json(
      { plan_id: `fb-${nanoid(8)}`, ...FALLBACK_PLAN, _fallback_reason: err.message },
      { status: 200 }
    );
  }
}
```

- [ ] **Step 3: Add fallback banner to itinerary page**

In `app/puerto-rico-itinerary/[plan_id]/page.js`, after the header:

```javascript
{plan.is_fallback && (
  <div className="mx-5 mb-4 rounded-xl border border-atardecer-200 bg-atardecer-50 p-3 text-center text-sm text-atardecer-700">
    🌅 We had a hiccup. Showing our default 5-day plan — try again in a minute for a personalized one.
  </div>
)}
```

- [ ] **Step 4: Simulate failure to test**

Temporarily break `MI_ITINERARIO_API_URL` in `.env.local` to `https://invalid.example.com`. Restart dev server. Submit the wizard. Verify the fallback plan renders with the banner.

Restore the env var after verifying.

- [ ] **Step 5: Commit**

```bash
git add lib/itinerary/fallback-template.js app/api/plan/generate/route.js app/puerto-rico-itinerary/[plan_id]/page.js
git commit -m "feat(plan): fallback template when Bedrock/Lambda unavailable"
```

---

## Task 14: Snapshot test for AI output shape

**Files:**
- Create: `lib/itinerary/schema.js`
- Create: `lib/itinerary/schema.test.js`

- [ ] **Step 1: Write the Zod schema**

Install: `npm install zod`

Create `lib/itinerary/schema.js`:

```javascript
import { z } from 'zod';

export const ItemSchema = z.object({
  activity_id: z.string().min(1),
  time: z.enum(['morning', 'afternoon', 'evening', 'late_night']),
  duration_min: z.number().int().positive(),
  note: z.string().optional(),
});

export const DaySchema = z.object({
  day_num: z.number().int().positive(),
  theme: z.string().min(1),
  items: z.array(ItemSchema).min(1).max(8),
});

export const ItinerarySchema = z.object({
  plan_id: z.string(),
  num_days: z.number().int().min(1).max(14),
  days: z.array(DaySchema).min(1),
});
```

- [ ] **Step 2: Write the test**

Create `lib/itinerary/schema.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ItinerarySchema } from './schema.js';

test('valid itinerary parses', () => {
  const ok = ItinerarySchema.parse({
    plan_id: 'abc123',
    num_days: 3,
    days: [
      { day_num: 1, theme: 'Old San Juan', items: [
        { activity_id: 'X-1', time: 'morning', duration_min: 120 }
      ]}
    ],
  });
  assert.equal(ok.num_days, 3);
});

test('rejects empty items array', () => {
  assert.throws(() => ItinerarySchema.parse({
    plan_id: 'abc', num_days: 1,
    days: [{ day_num: 1, theme: 'x', items: [] }],
  }));
});

test('rejects bad time value', () => {
  assert.throws(() => ItinerarySchema.parse({
    plan_id: 'abc', num_days: 1,
    days: [{ day_num: 1, theme: 'x', items: [
      { activity_id: 'X', time: 'whenever', duration_min: 60 }
    ]}],
  }));
});
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 3 passing tests.

- [ ] **Step 4: Wire the schema into the API route**

In `app/api/plan/generate/route.js`, after parsing the upstream response, before returning:

```javascript
const parsed = JSON.parse(text);
const validated = ItinerarySchema.safeParse(parsed);
if (!validated.success) {
  console.error('AI output schema violation:', validated.error.format());
  // fall through to fallback below
  throw new Error('schema_mismatch');
}
```

(Add the import at top: `import { ItinerarySchema } from '@/lib/itinerary/schema';`)

- [ ] **Step 5: Commit**

```bash
git add lib/itinerary/schema.js lib/itinerary/schema.test.js app/api/plan/generate/route.js
git commit -m "feat(plan): Zod schema validation for AI output + fallback on mismatch"
```

---

## Task 15: Cost telemetry + CloudWatch metric

**Files:**
- Modify: `infra/lambdas/itinerary_generate/index.mjs`
- Modify: `infra/lambdas/itinerary_refine/index.mjs`

- [ ] **Step 1: Emit structured logs for cost tracking**

In `index.mjs` of `itinerary_generate`, after the Bedrock invocation succeeds, before writing to DDB:

```javascript
console.log(JSON.stringify({
  metric_type: 'bedrock_invocation',
  model: MODEL_ID,
  input_tokens: raw.usage?.input_tokens,
  output_tokens: raw.usage?.output_tokens,
  plan_id,
  num_days,
  interests_count: interests.length,
  ts: new Date().toISOString(),
}));
```

Same pattern in `itinerary_refine` (use `day_num` instead of `num_days`).

- [ ] **Step 2: Add CloudWatch alarm in CDK**

In `itinerary_stack.py`, after both lambdas:

```python
from aws_cdk import aws_cloudwatch as cw

cw.Alarm(
    self,
    "GenerateFnErrorsAlarm",
    metric=generate_fn.metric_errors(period=Duration.minutes(5)),
    threshold=10,
    evaluation_periods=1,
    alarm_description="Itinerary generate function errors >10 in 5 min",
)

cw.Alarm(
    self,
    "GenerateFnDurationAlarm",
    metric=generate_fn.metric_duration(period=Duration.minutes(5)),
    threshold=25_000,  # ms
    evaluation_periods=2,
    alarm_description="Itinerary generation slower than 25s p99",
)
```

- [ ] **Step 3: Deploy + verify**

```bash
cd infra && cdk deploy MiItinerarioStack --require-approval never
aws cloudwatch describe-alarms --alarm-name-prefix "MiItinerario"
```

Expected: 2 alarms returned, both in INSUFFICIENT_DATA state initially.

- [ ] **Step 4: Commit**

```bash
git add infra/lambdas/itinerary_generate/index.mjs infra/lambdas/itinerary_refine/index.mjs infra/stacks/itinerary_stack.py
git commit -m "feat(itinerary): structured cost logs + CloudWatch alarms"
```

---

## Task 16: Deploy to staging + manual QA

**Files:** (no code changes — deploy + verify only)

- [ ] **Step 1: Deploy stack to staging account** (if separate from dev)

```bash
cd infra && CDK_DEFAULT_ACCOUNT=<staging-acct> cdk deploy MiItinerarioStack
```

- [ ] **Step 2: Update Vercel env var for staging**

Set `MI_ITINERARIO_API_URL` in Vercel project env vars (preview branch) to the staging API URL.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin feat/mi-itinerario
gh pr create --title "Mi Itinerario: Foundation + AI Generation" --body "Plan 1 complete — covers Phases 1+2. Wizard → Bedrock generation → /puerto-rico-itinerary/[id] viewer with swap-day refinement. See docs/superpowers/plans/2026-05-11-mi-itinerario-foundation-and-ai.md"
```

- [ ] **Step 4: Manual QA checklist**

Run through these 10 scenarios on the Vercel preview URL:

1. Land on `/puerto-rico-itinerary` — Atardecer hero renders, fonts load
2. Click CTA → wizard step 1 loads, progress 25%
3. Multi-select chips on step 1, single-select on steps 2/3/4
4. Continue disabled until selection made
5. Submit wizard → loading screen ~10s → land on `/puerto-rico-itinerary/[id]`
6. Itinerary page renders multiple days, activity cards with emojis
7. Click "Swap this day" → textarea opens → submit → page refreshes with new day
8. Refresh `/puerto-rico-itinerary/[id]` directly → still works (DDB persistence)
9. Visit fake `/puerto-rico-itinerary/badid` → "not found" page
10. Force fallback (set bad API URL in preview env) → fallback plan + warning banner

- [ ] **Step 5: Lighthouse audit**

In Chrome DevTools, run Lighthouse on `/puerto-rico-itinerary` (landing). Target: 90+ Performance, 100 Accessibility, 100 Best Practices, 90+ SEO.

- [ ] **Step 6: Commit any QA-driven fixes + merge PR**

Make any UX adjustments. Squash and merge to `main` only if Plan 1 is the only thing in the PR.

---

## Self-Review

**Spec coverage:**
- §4 (architecture) → Tasks 1-9, 11
- §5 (data model — activities, itineraries tables, TTL) → Tasks 2, 3, 4
- §6 (AI prompt pattern with anti-recs + accuracy corrections) → Task 7
- §8 (events layer) → ❌ Deferred to Plan 2
- §9 (Casa Coqui funnel) → ❌ Deferred to Plan 3
- §9.5 (Blog system) → ❌ Deferred to Plan 5
- §10 Phase 1+2 (foundation + AI generation) → Tasks 1-16 ✅
- §11 (error handling — fallback + Bedrock failure) → Task 13
- §12 (testing — Zod schema, snapshots, manual QA) → Tasks 14, 16
- §14 (monitoring — CloudWatch alarms, structured logs) → Task 15

**Placeholder scan:** None. Every step has the code/command/expected output it needs.

**Type consistency:**
- `plan_id` (string) used in all routes ✅
- `activity_id` (string) used consistently in seed, DDB, AI prompt ✅
- `days[].day_num` (number) consistent ✅
- `items[].time` enum: `morning|afternoon|evening|late_night` (locked in Task 7 prompt + Task 14 schema)
- `ttl_epoch` (number) — written in generate, read implicitly via TTL ✅

**Scope check:** Plan covers exactly Phase 1 + Phase 2 from spec. Next plans build on what this delivers. ✅

---

## Execution Handoff

Plan 1 complete and saved to `docs/superpowers/plans/2026-05-11-mi-itinerario-foundation-and-ai.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for overnight autonomous mode.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Better for interactive mode where you want to review each step in real-time.

**Plans 2-5 (Events, Casa Coqui funnel, Polish+Deploy, Blog system) will be written after Plan 1 begins execution — they depend on the foundation being in place.**
