# Mi Itinerario — Puerto Rico Itinerary Planner
## Design Specification

**Date:** 2026-05-11
**Author:** Brainstorm session — Julio + AWS tutor agent
**Status:** Draft — awaiting user review
**Target launch:** Mid-June 2026 (before June 29, 2026 DOP-C02 exam date)

---

## 1. Executive Summary

Mi Itinerario is an AI-powered Puerto Rico vacation itinerary generator hosted at `casa-coqui.cc/plan`. Users describe their trip in a short persona wizard; Bedrock Claude assembles a day-by-day itinerary from a curated database of vetted San Juan-area activities, injecting time-sensitive events from Eventbrite. The product doubles as a top-of-funnel for Casa Coqui Airbnb bookings via a persona-matched lodging recommendation and an honest "Where to Stay" comparison panel.

Secondary monetization: a Spanglish-branded tip jar ("invítame un cafecito") at end of itinerary, integrated via Buy Me a Coffee.

The application is also a deliberate AWS DOP-C02 exam lab — every weak exam week (W8 Lambda/API GW, W10 DynamoDB/Networking, W11 Bedrock/Cognito/Monitoring) gets real production use.

---

## 2. Goals & Non-Goals

### Goals (MVP)
- Ship a public PR itinerary planner at `casa-coqui.cc/plan` in ≤8 weeks
- Ship a Casa Coqui blog at `casa-coqui.cc/blog` with 3 anchor posts (umbrella accuracy correction, anti-recommendations, Santurce evening circuit) to drive organic SEO traffic into `/plan` from day 1
- Drive measurable lodging bookings to Casa Coqui (target: 5+ inbound inquiries/month within 90 days of launch)
- Seed ≥85 vetted San Juan-area activities (67 from initial 4-agent research + ~18 augmentations from X1/X2/X3 exploration agents — Cocina al Fondo, Identidad Bar, Calle Fortaleza, Las Pailas, La Perla viewpoint, Playa Escambrón, etc.)
- Integrate Eventbrite events into AI prompts so itineraries reflect real, current happenings
- Hit at least 6 AWS services in production-grade configurations for exam practice
- Cost ceiling: <$30/month infra at 10K monthly users

### Non-Goals (explicitly out of MVP)
- Multi-persona support (only Persona A — first-time North American tourist — at launch; B/C deferred to V1.1)
- Full events scout (Instagram scraping, multi-source aggregation) — Eventbrite only in MVP
- West-Puerto-Rico content (Rincón, Aguadilla, Cabo Rojo, Ponce) — outside Casa Coqui's bookable radius
- Stripe direct integration — Buy Me a Coffee in MVP, Stripe migration in V1.1
- Mobile app — web only; PWA-ready but no app store
- User profiles beyond email magic-link save
- Affiliate revenue tracking (Viator, GetYourGuide) — V2

---

## 3. User Personas

### Persona A — First-time North American Tourist (MVP target)
- **Profile:** Couple or family of 2-4, 4-10 day trip, never been to PR, English-first
- **Discovery:** Google search ("Puerto Rico itinerary 5 days", "things to do San Juan")
- **Concerns:** Safety, do I rent a car?, is the water safe?, what's worth it vs tourist trap
- **Decision moment:** "Where do we stay?" — Casa Coqui surfaces here
- **Casa Coqui fit:** 🟢 Strong — exactly the booking demographic

### Persona B — PR Diaspora (V1.1 roadmap)
Returning to family, bilingual, knows basics, wants hidden gems and food-forward content.

### Persona C — Digital Nomad / Long-Stayer (V1.1 roadmap)
2 weeks+ stay, remote worker, wants WiFi cafés, neighborhood deep-dives, surf forecasts.

**Architectural constraint:** All persona-specific content (prompts, activity filters, copy) lives in separate "content packs" so adding B and C is additive, not rebuild.

---

## 4. System Architecture

### 4.1 Hybrid hosting split (Decision Q6 — Option C)

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND — Vercel (existing Casa Coqui Next.js 14 app)         │
│                                                                 │
│   /plan                  ← Mi Itinerario landing + wizard       │
│   /plan/[plan_id]        ← Public itinerary view (sharable)    │
│   /plan/save             ← Email magic-link save flow           │
│   /plan/account          ← Cognito-authed user dashboard (V1.1) │
│                                                                 │
│   API routes (Vercel Functions):                                │
│   POST /api/plan/generate     → invokes Lambda                  │
│   POST /api/plan/refine       → invokes Lambda                  │
│   GET  /api/plan/[plan_id]    → reads DDB                       │
│   POST /api/plan/save         → triggers Cognito magic link    │
│   GET  /api/events/today      → reads events_cache from DDB     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓ HTTPS (AWS SDK from Vercel Function)
                              │
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND — AWS (new infrastructure)                             │
│                                                                 │
│  ┌──────────────┐     ┌──────────────────────────────────────┐ │
│  │ API Gateway  │────→│ Lambda functions:                    │ │
│  │ (HTTP API)   │     │  • itinerary-generate (Bedrock)      │ │
│  └──────────────┘     │  • itinerary-refine (Bedrock)        │ │
│                       │  • events-fetch (Eventbrite + cache) │ │
│                       │  • daily-concierge (V1.1, FCM push)  │ │
│                       └──────────────────────────────────────┘ │
│                                  │                              │
│                                  ↓                              │
│                       ┌──────────────────────────────────────┐ │
│                       │ DynamoDB tables:                     │ │
│                       │  • activities  (seeded by 4 agents)  │ │
│                       │  • itineraries (anon TTL=90d, persist if user-tied) │
│                       │  • events_cache (TTL=event_date+1d)  │ │
│                       │  • places_cache (TTL=30d for V1.1)   │ │
│                       │  • users (Cognito-tied)              │ │
│                       └──────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │ EventBridge cron │→ │ Lambda: events-  │                     │
│  │ (V1.1, weekly)   │  │ scout (Bedrock   │                     │
│  └──────────────────┘  │ parses pages)    │                     │
│                        └──────────────────┘                     │
│                                                                 │
│  ┌──────────────────┐                                          │
│  │ Cognito User Pool│ ← magic-link email saves                  │
│  │ (Mi Itinerario)  │                                          │
│  └──────────────────┘                                          │
│                                                                 │
│  ┌──────────────────┐                                          │
│  │ Secrets Manager  │ ← Eventbrite API key, Google Places key   │
│  └──────────────────┘                                          │
└─────────────────────────────────────────────────────────────────┘

  Existing Casa Coqui Firebase FCM (untouched) handles guest push.
```

### 4.2 Why hybrid (not all-AWS, not all-Vercel)

- **Vercel frontend:** Already where Casa Coqui lives. `/plan` is just another route in the existing Next.js app. Zero new infra to host UI. Edge caching for static pages works out of the box.
- **AWS backend:** New services are additive — don't destabilize the Casa Coqui codebase. Every AWS service used is a deliberate exam-prep lab.
- **Firebase FCM stays:** Already wired for Casa Coqui guest notifications. Cognito will only handle Mi Itinerario (random tourists), a different user population — keeping them separate is correct, not technical debt.

---

## 5. Data Model

### 5.1 `activities` (DynamoDB)
The seed DB of vetted San Juan-area things to do. Populated by 4 parallel research agents (Phase 0).

```
PK: activity_id              (e.g., "OSJ-FOODIE-001")
GSI1: neighborhood + type    (e.g., "Old San Juan#Restaurant")
GSI2: best_for_persona       (e.g., "foodie")

Attributes:
  name, neighborhood, type, hours, price_tier, description,
  why_it_matters, best_for_persona[], walkability_from_old_san_juan,
  kid_friendly, reservation_required, ideal_time_of_day,
  time_to_allocate_min, photo_url, source_urls[]
```

**Estimated size:** 67 items at launch, ~150 by V1.1.

### 5.2 `itineraries` (DynamoDB)
Each generated itinerary, anonymous or user-tied.

```
PK: plan_id                  (e.g., "p7x9k2d4")
TTL: 90 days from creation if anonymous; NO TTL if user_id is set

Attributes:
  user_id (nullable, set if email-saved → Cognito sub),
  persona, num_days, interests[], start_date,
  days: [
    { day_num: 1, date: "2026-08-12", items: [
      { time: "morning", activity_id: "OSJ-CULTURE-003", duration_min: 120 },
      ...
    ]}
  ],
  events_injected[],          (which events the AI worked in)
  generated_at, last_refined_at,
  share_url
```

### 5.3 `events_cache` (DynamoDB)
Cached Eventbrite (and V1.1 scout) results.

```
PK: date_iso                 (e.g., "2026-08-15")
SK: event_id
TTL: date_iso + 1 day

Attributes:
  name, venue, neighborhood, category, start_time, end_time,
  price_tier, url, source ("eventbrite" | "discover-pr" | "instagram-scout"),
  confidence_score (0-1, V1.1 for scout-sourced),
  geo: { lat, lng }
```

### 5.4 `places_cache` (DynamoDB, V1.1)
Google Places API enrichment cache.

```
PK: google_place_id
TTL: 30 days

Attributes:
  formatted_address, opening_hours, photos[], rating,
  last_fetched_at
```

### 5.5 `users` (DynamoDB, V1.1)
Email-saved users (Cognito-tied).

```
PK: cognito_sub
Attributes:
  email, locale, created_at, saved_plan_ids[],
  notification_prefs: { events: bool, casa_coqui: bool }
```

### 5.6 Activity DB augmentation from exploration research (2026-05-11)

After the initial 67-item seed was generated by the 4 specialist research agents (Phase 0), three additional exploration agents (X1 SEO blogs / X2 Reddit / X3 YouTube + Pinterest) searched the open web for real-traveler itineraries from 2023+ to validate gaps and surface missing venues.

**Validation result:** Our seed had **54-62% overlap** with what real travelers actually recommend across all three source types — strong signal that our manual curation is representative, with meaningful gaps to fill.

**Consensus gaps to add to activities table** (venues mentioned across multiple exploration agents):

| Venue | Category | Source | Signal |
|---|---|---|---|
| **Cocina al Fondo** | Restaurant (Santurce) | X1 + X2 | **#1 priority** — 2023 James Beard winner, top editorial momentum |
| **Identidad Cocktail Bar** | Bar (Santurce) | X1 + X2 | 2025 James Beard Best New Bar finalist |
| **Calle Fortaleza** | Photo destination (OSJ) | X3 | **#2 photogenic venue** in all visual content (8/12 hero). ⚠️ Accuracy correction: umbrella canopy GONE as of 2024-2025, replaced with string lights |
| **Las Pailas natural water slides** | Outdoor (Río Grande) | X3 | Fastest-rising new venue — zero 2023 content, hero in 4/12 2024-26 content |
| **La Perla viewpoint** | Photo destination (OSJ) | X3 | Hero in 5/12 visual content. ⚠️ Viewpoint from Calle Norzagaray only — do NOT route into La Perla neighborhood itself (X2 anti-rec) |
| **La Casita Blanca** | Restaurant (Santurce) | X2 | Locals' canonical comida criolla answer |
| **La Alcapurria Quemá** | Street food (Santurce) | X2 | Constantly named by locals near La Placita |
| **Playa Escambrón** | Beach (San Juan) | X1 | Closest snorkeling beach to OSJ; appears in 3 blog itineraries |
| **Pork Highway (PR-184)** | Day excursion | X2 | Lechón road, day trip from SJ |

**Pattern-level finding (X2):** Santurce should be treated as a **named itinerary cluster**, not individual restaurant stops. The recurring local correction across Reddit: route tourists from OSJ → Santurce/Miramar for evening dining. Cocina al Fondo + Identidad + La Alcapurria Quemá + La Placita form a coherent evening circuit. The AI prompt should encourage Santurce as a Day-themed cluster, not scatter these venues across separate days.

**Photo-spot additions** (X3 visual content gap — 19 venues missing from seed):
Puerto Rican Flag Door, Black PR Flag Mural, Plaza Dársena rainbow arch, Hotel El Convento alleyway, Santa María Magdalena de Pazzis Cemetery (the cemetery beside El Morro — photogenic from the fortress side).

These additions bring the seed from 67 → ~85 activities for MVP launch. The exploration agent JSON files remain in `tasks/itinerary-research/exploration/` as research artifacts; activity-bound additions will be merged into the canonical seed JSON files during Phase 1.

---

## 6. AI Integration Pattern

### 6.1 Model selection
- **Generation (Phase 1):** Claude Haiku 4.5 — fast, cheap, sufficient for assembly-from-DB task
- **Refinement (user pushback "swap Day 3"):** Claude Haiku 4.5
- **Events scout parsing (V1.1):** Claude Sonnet 4.6 — semantic HTML parsing benefits from stronger reasoning

### 6.2 System prompt pattern (curator, not generator)
The AI is constrained to pick + sequence from the activity DB only. It does NOT invent restaurants or attractions.

```
SYSTEM: You are a knowledgeable local San Juan friend helping a first-time
visitor build a vacation itinerary. You may ONLY recommend activities from
the provided ACTIVITIES_DB. Do not invent places. If asked about something
not in the DB, say so honestly.

For each day, propose 3-5 items balancing:
- Geographic clustering (don't bounce across the island)
- Energy variation (high-energy morning, restful afternoon)
- Persona match (use best_for_persona tags)
- Time-of-day fit (use ideal_time_of_day)

PATTERNS TO FOLLOW (validated by 2023-2026 traveler research):
- Treat Santurce as an evening cluster (Cocina al Fondo + Identidad +
  La Alcapurria Quemá + La Placita form a coherent night out)
- For multi-day trips, put OSJ on Day 1 (universal pattern in real itineraries)
- El Yunque is always Day 2 or 3, never Day 1

ANTI-RECOMMENDATIONS — NEVER suggest these even if user asks:
- Routing tourists INTO La Perla neighborhood (local hard-no, safety risk
  per Reddit consensus). The La Perla VIEWPOINT from Calle Norzagaray IS
  recommended for photos — clarify this distinction if user asks.
- Fortaleza Street souvenir shops (all imported junk, zero locally made)
- Señor Frog's and other chain tourist traps

ACCURACY CORRECTIONS — handle if user asks:
- The Calle Fortaleza umbrella canopy is GONE as of 2024-2025; replaced
  with string lights behind a barricade. Most Pinterest pins are stale.

When EVENTS_TODAY is non-empty for a date, weave at least one event into
that day's itinerary if it matches the user's interests.

OUTPUT: Strict JSON matching the itineraries.days schema.

USER: { persona, num_days, interests, start_date, special_requests }
ACTIVITIES_DB: [ ... ~85 items, filtered to user's interests ... ]
EVENTS_TODAY: [ ... events_cache hits for the date range ... ]
```

### 6.3 Refinement pattern
When user clicks "swap Day 3 for nightlife instead":

```
SYSTEM: (same as above)
PREVIOUS_ITINERARY: { days: [...] }
USER_REQUEST: "Swap Day 3 — show me a nightlife-focused day instead"
USER: regenerate ONLY day 3, keeping all other days unchanged.
```

Returns just `{ day: 3, items: [...] }` — cheap (small token count).

### 6.4 Cost projection
- ~3K input tokens (DB context) + ~1K output (itinerary JSON) per generation
- Claude Haiku 4.5 pricing: ~$1/MTok input, ~$5/MTok output → **~$0.008 per itinerary**
- Refinement (per day): ~$0.002
- **At 1K itineraries/month: ~$10 in Bedrock**
- DynamoDB on-demand: pennies at this scale
- Total infra <$30/month at 10K users

---

## 7. Events Layer

### 7.1 MVP — Eventbrite only

A scheduled Lambda (`events-fetch`) runs hourly:
1. Query Eventbrite Public API for events in San Juan metro, next 90 days
2. Upsert to `events_cache` table with TTL set to event_end_date + 1 day
3. Auto-cleanup happens via DynamoDB TTL

Itinerary generator queries `events_cache` for the user's trip dates and injects matches into the AI prompt context.

**Why hourly:** Most events are scheduled weeks in advance; the major risk is cancellations/time changes, which an hourly refresh handles cheaply.

**Why not real-time:** Eventbrite API has rate limits; cached responses are fine. Single source = no aggregation complexity.

### 7.2 V1.1 — Full scout (multi-source, AI-parsed)

Adds Discover PR official events calendar, Bandsintown, TicketPop, venue Instagram pages, Reddit r/PuertoRico events thread.

EventBridge cron triggers weekly Lambda → Step Functions orchestrates:
1. **Scrape** — fetch raw HTML from each source
2. **Parse** — Bedrock Claude semantically extracts structured event JSON
3. **Validate** — confidence_score check; reject ambiguous results
4. **Dedupe** — match against existing `events_cache` by name + date + venue
5. **Write** — upsert valid events with TTL

Step Functions provides retry/error handling (W7 exam-aligned), CloudWatch Insights for debugging failed scrapes.

### 7.3 V2 — Casa Coqui guest concierge

Daily morning Lambda queries Firestore for guests currently checked in, matches their persona signals against `events_cache` for today, sends localized FCM push via existing `lib/notifications.js`:

> 🎶 Bad Bunny watch party at La Placita tonight, 9pm — 8 min walk

Reuses 80% of existing Casa Coqui notification infra (FCM, prefs, bilingual strings). Adds one new category: `local_events`.

---

## 8. Casa Coqui Funnel (Decision Q5 — C+D combined)

Two surfacing strategies, both shown at end of itinerary.

### 8.1 Persona-matched recommendation (when fit)
After day-by-day plan, IF the user's persona + party size matches Casa Coqui's capacity (≤4 guests, couple-or-family use case), show:

```
┌───────────────────────────────────────────────────────┐
│ 🏠 Stay where the locals are                          │
│                                                       │
│ Casa Coqui — Old San Juan, 5-min walk to El Morro    │
│ Two units, sleeps 2-4, hosted by Julio                │
│                                                       │
│ Your dates: Aug 12-18 → [Check availability]          │
└───────────────────────────────────────────────────────┘
```

Link routes to existing Casa Coqui booking flow (same domain, same auth — works seamlessly).

If user's party size > Casa Coqui capacity OR persona doesn't fit (e.g., "I need 4 bedrooms"), this card is hidden and only the comparison panel shows.

### 8.2 Honest "Where to Stay" panel (always shown)

```
┌───────────────────────────────────────────────────────┐
│ Where to stay in San Juan                             │
│                                                       │
│ ⭐ Casa Coqui — Old San Juan (Our property)           │
│    From $X/night · 2 units · sleeps 4 · [Book]        │
│                                                       │
│ Other neighborhoods to consider:                      │
│  • Condado — Beachfront hotels, $$$, 10-min Uber      │
│  • Isla Verde — Resort feel, $$$$, 15-min Uber        │
│  • Santurce — Boutique + Airbnb, $$, art district     │
└───────────────────────────────────────────────────────┘
```

Honesty rationale: comparison panels convert better than aggressive selling. The 3 alternatives get ~5% click share; Casa Coqui gets ~60% because it's featured AND we're transparent about being a product.

---

## 9. Tip Jar — Buy Me a Coffee

After the lodging panel, a Spanglish CTA:

```
☕ ¿Te ayudó este itinerario?
Invítame un cafecito — every dollar helps me keep
this free for the next traveler.

[☕ Cafecito $1]  [☕☕ Café con leche $3]  [☕☕☕ Pinta de Medalla $5]
```

- "Pinta de Medalla" = Puerto Rico inside joke (Medalla beer)
- All three buttons link to a Buy Me a Coffee account (`buymeacoffee.com/micasacoqui` — handle TBD)
- MVP: BMaC handles payment, ~8% combined fees
- V1.1: migrate to Stripe Payment Links direct (2.9% + 30¢, better economics)

---

## 9.5 Blog System (SEO Funnel)

Added 2026-05-11 after exploration agents surfaced accuracy gaps + content opportunities competitors don't have. Blog at `casa-coqui.cc/blog` drives organic search traffic into `/plan`.

### 9.5.1 Route structure
```
casa-coqui.cc/blog                ← index, latest posts (paginated)
casa-coqui.cc/blog/[slug]         ← individual post (MDX-rendered)
casa-coqui.cc/blog/tag/[tag]      ← tag archives (V1.1)
```

### 9.5.2 Tech
- **Content:** MDX files in `content/blog/*.mdx` with frontmatter (title, slug, date, hero_image, tags, og_description)
- **Rendering:** Next.js `generateStaticParams` for static gen — every post becomes a pre-rendered HTML file at build time
- **Performance:** Static HTML → 100/100 Lighthouse possible → ranks fast
- **OG images:** Lambda function (`og-image-generator`) dynamically renders 1200x630 social cards per post slug. AWS exam practice: Lambda (W8) + Bedrock optional for image gen prompts (W11)
- **Distribution:** CloudFront fronting the static blog assets (W10 exam practice). Cache static HTML + OG images aggressively (1 day TTL with cache invalidation on publish)
- **Analytics:** CloudWatch RUM tracks real-user blog engagement: scroll depth, time on page, click-through to `/plan` CTAs (W11 exam practice)

### 9.5.3 MVP launch content (3 anchor posts)

Each post embeds a Mi Itinerario CTA at the end ("Want this in your trip? Build your free itinerary →") and the Casa Coqui "Where to Stay" panel reusable component.

**Post 1: "The Old San Juan umbrellas are gone — what to photograph in 2026 instead"**
- SEO target: corrects millions of stale Pinterest pins → ranking opportunity
- Content: 800-1200 words, current state of Calle Fortaleza, alternative photo spots from our seed
- Hero photo: current Calle Fortaleza with string lights (Julio shoots it personally)
- Source: X3 exploration agent finding (accuracy correction)

**Post 2: "Where locals tell tourists NOT to go in San Juan (and where to go instead)"**
- SEO target: anti-recommendation content ranks well — most blogs only say what TO do
- Content: ~1500 words, La Perla framing, Fortaleza souvenir shops, chain restaurants, with positive redirects
- Source: X2 Reddit exploration agent finding (local correction patterns)

**Post 3: "Santurce is the new Old San Juan — a local's evening circuit"**
- SEO target: original POV nobody else has, validated by both Reddit + X1 blog research
- Content: ~1500 words, evening circuit (Cocina al Fondo → Identidad Bar → La Alcapurria Quemá → La Placita), walking map, photos
- Source: X2 Reddit signal #1 actionable insight

### 9.5.4 V1.1+ content roadmap
- "Las Pailas water slides — Puerto Rico's hidden gem" (X3 emerging venue)
- "James Beard winners in San Juan you haven't heard of" (X1 + X2 culinary gaps)
- "El Yunque trail guide for first-timers (post-Maria reopening status)" (Phase 0 + X1)
- Monthly "What's happening in San Juan this [month]" (auto-generated via events scout V1.1)

### 9.5.5 Funnel integration
- Every blog post has 2 CTAs:
  1. **Inline:** "→ Add Cocina al Fondo to your San Juan itinerary" (deep link to `/plan?seed=foodie`)
  2. **Footer:** "Build your free Puerto Rico itinerary" (general `/plan` CTA)
- Each post embeds the Casa Coqui "Where to Stay" component (same component used in `/plan` flow) — direct lodging conversion
- Buy Me a Coffee tip jar at end of post (reuses Mi Itinerario tip component)

### 9.5.6 SEO foundation
- Schema.org `Article` markup on every post
- Open Graph + Twitter Cards generated per post
- Canonical URLs (always `casa-coqui.cc/blog/[slug]`)
- Sitemap.xml auto-generated, submitted to Google Search Console
- Internal linking discipline: every post links to ≥3 other blog posts + ≥2 activity references

---

## 10. Build Phases

| Phase | Duration | Deliverable | AWS exam services touched |
|-------|----------|-------------|----------------------------|
| **0. Content Seeding** | 1-2 days | 4 parallel research agents → 67 activities JSON → manually reviewed → seed to DynamoDB | — |
| **1. Foundation** | 1 week | DDB tables provisioned, Next.js `/plan` route, persona wizard UI, plan-id URL routing, basic empty-state | DynamoDB (W10) |
| **2. AI Generation** | 1-2 weeks | Bedrock prompt design, Lambda for generate + refine, end-to-end flow w/ live AI, snapshot tests | Lambda (W8), API Gateway (W8), Bedrock (W11), Secrets Manager (W11) |
| **3. Events Layer (MVP)** | 1 week | Eventbrite API integration, hourly fetch Lambda, events_cache table w/ TTL, prompt injection | EventBridge (W8), DynamoDB TTL (W10) |
| **4. Casa Coqui Funnel** | 1 week | Persona-match card, Where-to-Stay panel, link to existing booking flow, analytics events | CloudWatch (W11) |
| **5. Polish + Deploy** | 1 week | Tip jar (BMaC integration), SEO meta + OG tags, accessibility audit, mobile QA, Vercel prod deploy, Route 53 DNS for casa-coqui.cc/plan, monitoring dashboard | Route 53 (W10), CloudWatch dashboards (W11) |
| **6. Blog System + 3 anchor posts** | 1 week | MDX blog at `/blog`, OG image Lambda, CloudFront caching, 3 anchor posts written + published, schema.org markup, sitemap submitted to Google Search Console | Lambda (W8), CloudFront (W10), CloudWatch RUM (W11) |
| **Total MVP** | **~7-8 weeks** | Public launch | **9+ AWS services in production** |

### V1.1 (post-launch, 2-3 weeks)
- Full events scout (Step Functions, multi-source scrapers, Bedrock parsing)
- Cognito magic-link email saves (replaces anonymous-only)
- Google Places API enrichment layer
- Casa Coqui guest FCM concierge

### V2 (vision)
- Persona B (diaspora) + Persona C (nomad) content packs
- Stripe direct integration
- Affiliate tracking (Viator, GetYourGuide)
- Email digest "What's happening in SJ this weekend" → top-of-funnel marketing
- AI agent learns guest preferences over multi-trip history

---

## 11. Error Handling

| Failure mode | Fallback |
|--------------|----------|
| Bedrock timeout or 5xx | Serve pre-rendered static template "Top 5 days in San Juan" + apology banner |
| Eventbrite API down | Omit events from prompt; itinerary still generates |
| DynamoDB throttling | Retry with exponential backoff (built into AWS SDK) |
| Vercel Function timeout (300s) | Return partial itinerary + "Refine specific days" CTA |
| Google Places API quota exceeded (V1.1) | Skip enrichment, fall back to cached or seed data |
| Cognito magic-link email bounce | Show error w/ retry option, log to CloudWatch |

All Lambdas write structured JSON logs to CloudWatch with correlation IDs (plan_id + request_id) for cross-service tracing.

---

## 12. Testing Strategy

- **Unit:** Pure functions (prompt builders, schema validators) — Jest, target 80% coverage
- **Snapshot:** AI output structure — capture 5 representative input combos, snapshot the parsed JSON shape (not content). Catches drift in prompt → output contract.
- **Integration:** Full flow w/ mocked Bedrock + real DynamoDB Local — Vercel Function → Lambda → DDB → response
- **E2E:** Playwright against staging env — persona wizard → generate → refine → save flow
- **Manual QA:** Generate 10 real itineraries pre-launch, walk each one personally to verify all places exist and recommendations are sensible
- **Load test:** k6 against API Gateway — verify 100 concurrent itinerary generations within Bedrock + Lambda limits

---

## 13. Security & Compliance

- All API routes (Vercel + AWS) use HTTPS only
- Eventbrite + Google Places API keys in Secrets Manager (NOT env vars)
- Cognito magic-link tokens single-use, 15-min TTL
- DynamoDB encryption at rest enabled (default AWS-owned keys, MVP; customer-managed KMS in V1.1 for exam practice on cross-account encryption patterns)
- Rate limiting on `/api/plan/generate` — 5 generations per IP per hour (AWS WAF or simple Vercel middleware)
- No PII stored beyond email for opted-in users
- Tip jar (BMaC) handles all payment data — no card info touches our infra
- Privacy policy + Terms link in footer

---

## 14. Monitoring & Observability

- **CloudWatch dashboards:** Itinerary generation rate, Bedrock latency p50/p95/p99, Lambda errors, DynamoDB throttles
- **CloudWatch alarms:** Bedrock 5xx > 1% for 5 min, Lambda errors > 10 in 1 min, monthly Bedrock cost > $50
- **Vercel analytics:** Page views, conversion funnel (wizard start → generate → save → tip → Casa Coqui click)
- **Tap-through tracking:** Casa Coqui card click rate, "Where to Stay" alternative click distribution (for honesty signal)

---

## 15. Open Questions

These need resolution before or during Phase 1:

1. **Buy Me a Coffee handle** — `micasacoqui`? `julio-coqui`? Reserve before Phase 5.
2. **Eventbrite API tier** — Free public API likely sufficient; verify rate limits during Phase 3.
3. **Bedrock region** — us-east-1 has Claude Haiku 4.5; confirm AppConfig / Secrets Manager region alignment.
4. **Casa Coqui booking flow link** — does the existing booking page accept query params for date pre-fill? If not, small UX gap.
5. **WAF need at launch?** — Probably overkill for MVP traffic; defer to V1.1 unless first-week traffic surprises.
6. **Analytics destination** — Vercel Analytics free tier vs Google Analytics 4 vs Plausible. Pick before Phase 5.

---

## 16. Glossary

- **Persona A/B/C** — content packs for North American tourist / PR diaspora / digital nomad
- **Activity** — a vetted place (restaurant, beach, museum, bar, experience) in the seeded DB
- **Event** — a time-bound happening (concert, festival, market, watch party) from Eventbrite
- **Itinerary / Plan** — generated day-by-day output stored under a `plan_id`
- **Scout** — V1.1 EventBridge-triggered multi-source events aggregator
- **Concierge** — V1.1+ daily FCM push to active Casa Coqui guests with today's relevant events

---

## 17. References

- Brand identity: `.claude/agent-memory/copa-best-ux-lead/brand-identity.md` (Spanglish tone, bilingual touches, warmth words)
- Casa Coqui tech stack: `CLAUDE.md` (Next.js 14, Firebase, Vercel)
- Existing notification infra: `lib/notifications.js`, `lib/notification-strings.js`
- Existing FCM prefs: `notification_prefs/{bookingCode}` Firestore docs
- Brainstorm decisions (MemPalace): drawers in `casa_coqui/decisions/` dated 2026-05-11
- Casa Coqui location correction: `casa_coqui/general/julio correction 2026-05-11 — Casa Coqui location`
