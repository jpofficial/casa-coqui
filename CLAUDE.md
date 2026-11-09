# Casa Coqui — Guest Portal & Property Management App

## Project Overview
A Progressive Web App (PWA) that runs a real multi-unit Airbnb property in Puerto Rico (live at https://casa-coqui.com). Three audiences:
- **Guest Portal** (`/g/[code]`): Mobile-first experience reached from a unique per-booking link + phone verification. Guests see the check-in guide, parking, house rules, WiFi, laundry status, community board, maintenance requests, and direct messaging with the host.
- **Admin Dashboard** (`/admin`): Host-facing panel — bookings and occupancy calendar, broadcast notifications, expenses, supply inventory with auto-reorder, maintenance inbox, receipts, revenue reporting, cleaning management, dynamic pricing, Airbnb message threads with AI reply drafts, and team management.
- **Staff**: Co-hosts, cleaners and maintenance staff log into the same `/admin` app and see a role-scoped subset (see *Roles*).

## Tech Stack
- **Framework**: Next.js 14 (App Router), React 18, JavaScript (no TypeScript)
- **Styling**: Tailwind CSS (utility-first, mobile-first), Framer Motion
- **Backend/DB**: Firebase Firestore (NoSQL, real-time)
- **Auth**: Firebase Auth — phone OTP for guests, email/password for staff; roles via custom claims
- **Storage**: Firebase Cloud Storage (photos, receipts, PDFs)
- **Cloud Functions**: Firebase Cloud Functions v2 (`functions/`) — iCal sync, welcome drafts, reorder checks, cleaning reminders, link expiry, the Step Functions bridge
- **AWS** (`infra/`, CDK in Python): SES inbound email → S3 → Lambda parser (`infra/lambda/parse-airbnb-email`), Step Functions reply agent (`infra/sam/reply-agent`), AppConfig-managed prompts, CodePipeline/CodeBuild delivery, pricing autopilot
- **AI**: Anthropic Claude via `@anthropic-ai/sdk` with RAG over past conversations
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **Email**: Amazon SES (inbound), Resend (outbound)
- **Hosting**: Vercel (web) + AWS (backend services)
- **PWA**: next-pwa, custom service worker with deep-linking and notification grouping

## Coding Conventions
- Functional components only, no class components
- React hooks for all state management (useState, useEffect, useContext)
- Tailwind CSS for ALL styling — no CSS modules, no styled-components
- File naming: kebab-case for files, PascalCase for components
- Use async/await, never raw promises with .then()
- Environment variables in `.env.local` (prefixed `NEXT_PUBLIC_` for client-side); the committed template is `.env.example`. Cloud Functions params live in `functions/.env.<projectId>` (template: `functions/.env.example`).
- All Firebase config via environment variables, never hardcoded. No account-specific identifiers (AWS account id, ARNs, emails) in committed code — CDK reads them from context/env (`infra/cdk.context.example.json`).
- API routes return consistent JSON: `{ success: true, data: {} }` or `{ success: false, error: "" }`
- `lib/` is ESM (imported by Next.js); `functions/lib/` is CommonJS (Cloud Functions runtime). Several modules exist in both — see *Shared modules*.

## Project Structure
```
/app
  /g/[code]            — Guest portal (dynamic route per booking): home, checkin, access,
                         rules, laundry, parking, community, chat, maintenance, notifications…
  /admin               — Staff app: dashboard, bookings, stays, calendar, cleaning, assignments,
                         community, messages (Airbnb threads + AI drafts), staff-messages,
                         notify, expenses, supplies, maintenance, receipts, revenue,
                         pricing (+ /pricing/calendar), hours, team, settings, login
  /api                 — Route handlers: admin, ai, airbnb-messages, assignments, bookings,
                         cleaning, community, cron, email, expenses, guests, laundry,
                         maintenance, manifest, messages, notifications, parking, pricing,
                         receipts, revenue, staff-messages, stays, supplies
/components
  /guest/              — Guest-specific components
  /admin/              — Admin components (+ /admin/pricing)
  /cleaner/            — Cleaner home + job forum
  /ui/                 — Shared UI primitives
/lib                   — Domain logic (ESM): firebase.js (client), firebase-admin.js (server),
                         api-auth.js, roles.js, notifications.js, staff-notifications.js,
                         i18n.js, thread-key.js, reply-ai.js, reply-agent-chain.js, rag-filter.js,
                         welcome-ai.js, voice-profile.js, pricing-*.js, …
  /__tests__/          — node:test suites
/hooks                 — useAuth, useFirestore, useLocale, useNotifications, usePush,
                         useStaffNotifications, useStaffNotificationPrefs
/functions             — Firebase Cloud Functions (CommonJS): index.js, icsSync.js,
                         cleaningReminder.js, expireLinks.js, reorderCheck.js, parseReceipt.js
  /lib/                — Function helpers incl. CJS copies of shared modules; Jest tests
/infra                 — AWS CDK app (Python): app.py, stacks/, tests/ (pytest)
  /lambda/parse-airbnb-email/   — SES inbound email parser Lambda + Jest tests
  /sam/reply-agent/             — Step Functions reply agent (SAM) + Lambdas
/ci                    — CodeBuild buildspecs (Vercel build/deploy, pricing)
/scripts               — seed/, migrations/, debug/, check-prompt-drift.js
/tools/pricing         — Standalone pricing-autopilot tool (SQLite, scrapers, decision engine)
/docs                  — Architecture docs, specs/plans, postmortems, screenshots
/public                — PWA manifest, service worker, icons
firestore.rules / firestore.indexes.json — Firestore security rules and indexes
```

## Roles
Staff roles are Firebase custom claims (`request.auth.token.role`), mirrored on `users/{uid}.role`:
- `admin` — the host; full access; the only role that can invite/manage the team (`/admin/team`, `app/api/admin/invite`, `app/api/admin/team/[uid]`)
- `cohost` — operations subset of `/admin` (stays, cleaning, assignments, messages, community, hours)
- `cleaner` — `/admin/cleaning` only (cleaner home + job forum in `components/cleaner/`)
- `maintenance` — `/admin/assignments` only

Route access per role is defined in `lib/roles.js` and enforced client-side by `hooks/useAuth.js`; data access is enforced by `firestore.rules` (`isAdmin()`, `isStaff()`) and server-side by `lib/api-auth.js`. Guests are anonymous Firebase users carrying `bookingCode` / `tier` claims. Claims are granted by `scripts/seed/create-admin.js` / `promote-admin.js` (admin) and the invite API (staff); `scripts/debug/check-admin-claims.js` verifies the admin claim before a rules deploy.

## Database (Firestore Collections)
The schema is defined by usage plus `firestore.rules` (access) and `firestore.indexes.json` (composite indexes). Key collections:
- `bookings` — Booking records with guest link codes and welcome-message status
- `guests` / `checkins` — Guest profiles and pre-arrival check-in data
- `users` — Staff profiles (`role`, `status`, onboarding)
- `notifications` — Broadcast + direct messages
- `airbnb_messages` — Inbound Airbnb threads (from the SES Lambda) and AI reply drafts
- `cleaning_jobs`, `assignments` — Cleaning and maintenance work items
- `expenses`, `revenue`, `receipts` — Finance
- `supplies` — Inventory with qty, min, auto-reorder
- `maintenance` — Guest maintenance requests with status tracking
- `laundry` — Machine status (washer/dryer docs, guest self-reported)
- `community` — Community board posts
- `settings` — App config (property, units, WiFi, templates)
- `agent_runs` — AI call logs for debugging

## Shared modules (duplicated on purpose — keep in sync)
`thread-key.js` exists in `lib/`, `functions/lib/` and `infra/lambda/parse-airbnb-email/`; `reply-ai.js`, `welcome-ai.js`, `reply-agent-chain.js` and `rag-filter.js` exist in `lib/` (ESM) and `functions/lib/` (CJS). Each deploy target only ships its own directory, so changes must be mirrored. `scripts/check-prompt-drift.js` (run in `prebuild`) fails the build if the reply-agent SYSTEM_PROMPT drifts between `lib/reply-ai.js`, `functions/lib/reply-ai.js` and the AppConfig seed.

## Key Flows to Understand
1. **Guest Access**: Host creates booking → unique link generated → guest taps link → phone OTP verification → check-in form → portal access → link expires at checkout
2. **Parking Report**: Guest reports → photo uploaded to Storage → generic broadcast auto-sent to all guests via push → host gets full details separately
3. **Notifications**: Host triggers broadcast → fetch active guests → send FCM push to those with tokens → log delivery status in Firestore
4. **Auto-Reorder**: Cloud Function runs on schedule → checks supplies against minimums → generates Amazon cart link → pushes notification to admin for approval
5. **Airbnb email → reply draft**: Airbnb email lands in SES → S3 → `parse-airbnb-email` Lambda classifies, matches the booking and writes `airbnb_messages` → `onAirbnbMessageCreated` Cloud Function starts the Step Functions reply agent (or the legacy JS chain, per AppConfig flags) → draft written back for the host to review in `/admin/messages`
6. **Receipt Storage**: Email forwarded to dedicated address → Cloud Function parses → stores in Storage → files by month in Firestore

## Testing
- `npm test` (repo root) runs every JavaScript suite: `lib/` (node:test), `functions/`, the parser Lambda and the SAM Lambdas (Jest). `npm run install:all` installs all package deps first.
- `npm run test:infra` runs the CDK pytest suite in `infra/tests` (needs `pip install -r infra/requirements.txt -r infra/requirements-dev.txt`).
- `.github/workflows/ci.yml` runs lint + all suites on pull requests. Production delivery is AWS CodePipeline/CodeBuild (`ci/`, `infra/stacks/pipeline_stack.py`).

## Important Notes
- Mobile-first design — most users (guests AND staff) are on phones
- Four staff roles (admin / cohost / cleaner / maintenance) — see *Roles*; the admin is the single host account, but role management exists
- Guest-to-guest communication is NOT supported — host is the hub
- Laundry status is guest self-reported (honor system)
- All dates/times should be in the property's local timezone (America/Puerto_Rico)
- Bilingual: all guest- and staff-facing strings go through `lib/i18n.js` (English/Spanish)
