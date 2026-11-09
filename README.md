# Casa Coqui — Guest Portal & Property Management Platform

**Live site:** [casa-coqui.com](https://casa-coqui.com) · guest portal opens from a private per-booking link; the admin dashboard is behind a host login.

A production Progressive Web App that runs a real multi-family Airbnb property in Puerto Rico. It pairs a mobile-first **guest portal** with a host-facing **admin dashboard**, and is backed by an event-driven serverless architecture spanning Firebase and AWS — including an AI reply agent, an automated email pipeline, and a data-driven pricing engine.

> Built as a solo project to solve the day-to-day operations of hosting: getting guests checked in without friction, keeping the host on top of cleaning/maintenance/supplies, and answering booking messages in the host's own voice.

---

## Screenshots

> **Placeholders — screenshots not captured yet.** Each cell below names the file it expects under
> [`docs/screenshots/`](docs/screenshots/README.md). Capture the three screens listed there, drop the PNGs in,
> and replace the placeholder row with the commented-out image row.

| Guest portal (phone) | Host admin dashboard | Pricing — rate calendar |
|:--:|:--:|:--:|
| 📱 _placeholder_<br>`docs/screenshots/guest-portal-phone.png` | 🖥️ _placeholder_<br>`docs/screenshots/admin-dashboard.png` | 📈 _placeholder_<br>`docs/screenshots/pricing-rate-calendar.png` |
| `/g/[code]` home — welcome, check-in guide, WiFi, live laundry status | `/admin` home — active stays, laundry status, monthly revenue, tasks | `/admin/pricing/calendar` — nightly rates, fill-rate advisor, chat |

<!-- SCREENSHOTS: once the PNGs exist, swap the placeholder row above for this one:
| ![Guest portal on a phone](docs/screenshots/guest-portal-phone.png) | ![Host admin dashboard](docs/screenshots/admin-dashboard.png) | ![Pricing rate calendar](docs/screenshots/pricing-rate-calendar.png) |
-->

---

## Highlights

- **Two audiences, one codebase** — a guest portal reached by a unique link + phone-OTP verification, and an admin dashboard for the host, both installable as PWAs with offline support and push notifications.
- **AI reply agent** — an AWS Step Functions pipeline (draft → evaluate → reason → revise → write-back) that drafts guest replies in the host's voice using retrieval over past conversations, with prompts managed as configuration (AWS AppConfig) rather than hardcoded.
- **Automated email pipeline** — inbound Airbnb emails land in SES, a Lambda parses and threads them, and bookings + welcome-message drafts are created in Firestore automatically.
- **Pricing autopilot** — a competitor-scraping + decision-engine tool that captures market rates, models seasonality/holidays, and recommends nightly prices.
- **Infrastructure as code** — the whole AWS side is defined in CDK (Python) with a CodePipeline/CodeBuild delivery flow.
- **Bilingual & mobile-first** — full English/Spanish localization, designed for phones first (most guests *and* the host are on mobile).

---

## Architecture

```
                     ┌──────────────────────────────┐
   Guest (phone) ───▶│  Next.js 14 App Router (PWA)  │◀─── Host (admin)
                     │   Vercel · Tailwind · FCM     │
                     └──────────────┬───────────────┘
                                    │
             ┌──────────────────────┼───────────────────────┐
             ▼                      ▼                        ▼
     ┌──────────────┐      ┌─────────────────┐      ┌─────────────────┐
     │   Firebase   │      │   AWS (CDK)     │      │   Anthropic     │
     │  Firestore   │      │  SES → Lambda   │      │  Claude models  │
     │  Auth (OTP)  │      │  Step Functions │      │  voice-matched  │
     │  Storage     │      │  DynamoDB · S3  │      │  reply drafting │
     │  Functions   │      │  AppConfig      │      │                 │
     │  Messaging   │      │  CodePipeline   │      │                 │
     └──────────────┘      └─────────────────┘      └─────────────────┘
```

**Event-driven by design:** Firestore triggers, SES/Lambda email ingestion, Step Functions orchestration, and scheduled Cloud Functions (link expiration, supply reorder checks, cleaning reminders) keep the app reactive without polling.

---

## Feature tour

### Guest portal (`/g/[code]`)
Unique-link access with phone-OTP verification and auto-expiry at checkout · pre-arrival check-in · WiFi & access codes · house rules · **real-time laundry status** with a waitlist · community board · one-tap **parking reports** (photo upload + broadcast) · maintenance requests · direct messaging with the host · installable PWA with push notifications.

### Admin dashboard (`/admin`)
Bookings & occupancy calendar · **cleaning management** with a dedicated cleaner role and job forum · expenses & revenue tracking · **supply inventory with auto-reorder** · maintenance inbox · receipt/bill storage · broadcast & direct notifications · staff messaging · team management · **dynamic pricing** calendar and advisor.

### AI & automation
- **Reply agent** (`infra/sam/reply-agent/`) — multi-step Step Functions chain with RAG retrieval, an evaluator/reviser loop, and a dead-letter path.
- **Voice-matched drafting** (`lib/voice-profile.js`, `lib/welcome-ai.js`) — drafts read like the host, seeded from a corpus of their real replies.
- **Email parsing** (`infra/lambda/parse-airbnb-email/`) — robust Airbnb-email classification and thread-key derivation, heavily unit-tested.
- **Pricing engine** (`tools/pricing/`) — market capture, competitor timelines, a seasons/holidays model, and a decision engine (see `tools/pricing/TECHNICAL-PAPER.md`).

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router), React 18, JavaScript |
| Styling | Tailwind CSS (utility-first, mobile-first), Framer Motion |
| Data / Auth | Firebase Firestore, Firebase Auth (phone OTP + email/password) |
| Storage / Push | Firebase Cloud Storage, Firebase Cloud Messaging |
| Serverless | Firebase Cloud Functions, AWS Lambda, AWS Step Functions |
| AI | Anthropic Claude (`@anthropic-ai/sdk`), RAG, AWS AppConfig-managed prompts |
| Data stores | S3, SQLite (pricing tool) |
| Email | Amazon SES (inbound), Resend (outbound) |
| Infra / CI-CD | AWS CDK (Python), CodePipeline · CodeBuild |
| Hosting | Vercel (web) + AWS (backend services) |
| PWA | next-pwa, custom service worker with deep-linking & notification grouping |
| Testing | `node:test` (app `lib/`) + Jest (Cloud Functions, Lambda, SAM) + pytest (CDK) — one `npm test` runs every JS suite; GitHub Actions runs them on each PR |

---

## Repository layout

```
app/                 Next.js routes — /g/[code] (guest), /admin, /api
components/          Guest, admin, cleaner, and shared UI components
lib/                 Domain logic — notifications, pricing, reply-agent, i18n, firebase helpers
hooks/               React hooks — auth, real-time Firestore, push, staff notifications
functions/          Firebase Cloud Functions (email parse, reorder, reminders, link expiry)
infra/              AWS CDK app, Lambdas, and the SAM reply-agent state machine
ci/                  CodeBuild buildspecs for the two AWS pipelines (Vercel, pricing)
tools/pricing/       Standalone pricing-autopilot tool (SQLite, scrapers, decision engine)
scripts/             Ops scripts — seed/, migrations/, debug/
docs/                Design specs, plans, and postmortems (the "how" and "why")
```

---

## Running locally

> This repository is shared as a portfolio/reference. Running the full stack requires your own Firebase project and AWS account.

```bash
npm install
cp .env.example .env.local   # then fill in your own Firebase/AWS/Resend values
npm run dev                  # http://localhost:3000
npm run install:all          # also installs functions/, Lambda and SAM test deps (once)
npm test                     # every JavaScript test suite — see "Tests" below
```

Environment variables are documented in [`.env.example`](.env.example), and the approach to secrets (what lives where, and rotation) is documented in [`docs/secrets-management.md`](docs/secrets-management.md). No credentials are committed to this repository.

---

## Tests

[![CI](https://github.com/jpofficial/casa-coqui/actions/workflows/ci.yml/badge.svg)](https://github.com/jpofficial/casa-coqui/actions/workflows/ci.yml)

`npm test` at the repo root runs **every JavaScript suite — 303 tests across 29 files** (counts as of this commit; ~4 s locally). Each package keeps its own runner and can be run alone:

| Suite | What it covers | Runner | Files / tests | Command |
|-------|----------------|--------|---------------|---------|
| App `lib/` | thread keys, rate calendar, calendar helpers, welcome status | `node:test` | 5 / 50 | `npm run test:lib` |
| Cloud Functions `functions/` | SFN bridge, AppConfig client, backoff, iCal parsing, welcome guard | Jest | 9 / 66 | `npm run test:functions` |
| Email-parser Lambda `infra/lambda/parse-airbnb-email/` | classification, guest-name extraction, booking match cascade, thread keys, a sanitized real-email regression canary and a ReDoS time budget | Jest | 13 / 179 | `npm run test:lambda` |
| SAM reply-agent Lambdas `infra/sam/reply-agent/` | reasoner throttle naming, write-back persistence | Jest | 2 / 8 | `npm run test:sam` |
| CDK stacks `infra/` (Python) | Foundation + Email stack assertions and a full-template snapshot | pytest | 2 / 21 | `npm run test:infra` |

The Lambda and SAM packages have their own `package-lock.json`; `npm run install:all` installs all of them. The CDK tests need `pip install -r infra/requirements.txt -r infra/requirements-dev.txt` (a Node runtime must be on `PATH` for jsii).

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs install → lint → prompt-drift check → all JS suites, plus the CDK tests, on every pull request. Production delivery is separate: an AWS CodePipeline/CodeBuild flow defined in [`infra/stacks/pipeline_stack.py`](infra/stacks/pipeline_stack.py) with buildspecs in [`ci/`](ci/README.md).

---

## Engineering notes worth a look

The [`docs/`](docs/README.md) folder holds the reasoning behind the larger pieces:

- **`docs/architecture/`** — system designs: the FCM-only notification architecture, the reservation & reply-agent flow, and the role-based (guest / host / cleaner) experience model.
- **`docs/postmortems/`** — real incident write-ups (a welcome-message generation bug, a listener race condition) and how they were fixed.
- **`docs/superpowers/specs/` & `plans/`** — design docs and implementation plans for larger features (the reply-agent port, thread coherence).
- **`tools/pricing/TECHNICAL-PAPER.md`** — a deeper write-up of the pricing model.

---

## License

No license is granted — this repository is published for portfolio and reference purposes. Please don't reuse it without permission.
