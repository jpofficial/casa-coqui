# Reservation & Reply Agent — Implementation Progress

## Phase 1: SES + CDK Stack
- [x] `infra/stacks/email_stack.py` — CDK stack (SES, S3, Lambda, Secrets Manager)
- [x] `infra/app.py` — Register EmailStack
- [x] `infra/lambda/parse-airbnb-email/index.js` — Placeholder Lambda handler
- [ ] **Julio**: Gmail auto-forward filter setup (after SES is receiving)
- [ ] **Deploy**: `cdk deploy CasaCoquiEmailStack`

## Phase 2: Welcome Draft
- [x] `lib/welcome-ai.js` — ES module welcome generator
- [x] `functions/lib/welcome-ai.js` — CommonJS duplicate
- [x] `lib/reply-ai.js` — ES module reply generator
- [x] `functions/lib/reply-ai.js` — CommonJS duplicate
- [x] `functions/icsSync.js` — Welcome generation after booking creation
- [x] `app/api/admin/sync-ics/route.js` — Same welcome generation for manual sync
- [x] `app/api/bookings/route.js` — Welcome fields on manual booking creation
- [x] `app/api/bookings/[id]/route.js` — Welcome status in PATCH allowed fields
- [x] `app/api/bookings/[id]/welcome/route.js` — Manual regenerate endpoint
- [x] `functions/package.json` — Added @anthropic-ai/sdk dependency
- [ ] **Deploy**: `firebase functions:secrets:set ANTHROPIC_API_KEY`
- [ ] **Deploy**: `cd functions && npm install && firebase deploy --only functions`

## Phase 3: Welcome UI
- [x] `app/admin/bookings/page.js` — Welcome message panel (in progress via agent)
- [x] `app/admin/page.js` — Dashboard widget for pending welcomes (in progress via agent)
- [x] `lib/i18n.js` — Welcome-related i18n keys (in progress via agent)

## Phase 4: Lambda Email Parser
- [x] `infra/lambda/parse-airbnb-email/index.js` — Full MIME parser + Firestore writer
- [x] `infra/lambda/parse-airbnb-email/package.json` — Dependencies

## Phase 5: Reply Agent + UI
- [x] `functions/index.js` — `onAirbnbMessageCreated` Firestore trigger
- [x] `app/admin/messages/page.js` — Airbnb Messages tab (in progress via agent)
- [x] `lib/i18n.js` — Airbnb message i18n keys (in progress via agent)

## Cross-cutting
- [x] `firestore.rules` — Rules for airbnb_messages, airbnb_messages_quarantine, agent_runs
- [x] `scripts/seed-voice-corpus.js` — One-time voice corpus import
- [x] `SECRETS.md` — API key documentation

## Open Items for Julio
1. Welcome message template — share an example or describe the vibe
2. Bilingual rule — always English? Always Spanish? Detect from name/message?
3. Escalation preference — draft something safe + flag, or just notify?
4. Voice corpus seed — dig up 10-20 past Airbnb replies

## 2026-04-15 Admin Calendar Cleanup — Review

- Spec: `docs/superpowers/specs/2026-04-15-admin-calendar-cleanup-design.md`
- Plan: `docs/superpowers/plans/2026-04-15-admin-calendar-cleanup.md`
- Branch: `feat/admin-calendar` (worktree at `/Users/jperez/dev/casa-coqui-admin-calendar`)
- Tests: `npm test` — all 14 pass (7 buildWarningList + 7 buildAgendaForWindow)
- Build: `npm run build` — succeeds (env copied from main repo)
- Pending: manual browser verification of Agenda/Calendar toggle, color-pill cells, warning Fix → deep-link, cleaner view unchanged
