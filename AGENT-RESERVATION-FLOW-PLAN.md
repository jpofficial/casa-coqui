# Reservation & Reply Agent Flow — Plan v3.3 (Canonical)

**Status:** v3.2 deployed; v3.3 captures Path A correctness amendments (2026-04-18 review)
**Date:** 2026-04-18 (v3.3)
**Owner:** Julio + lead engineer
**Supersedes:** all prior drafts

---

## 0. Goal

Two flows. Both produce **drafts only** — never auto-send. Julio copies and pastes into Airbnb.

- **Flow A (new reservation):** Airbnb ICS → booking auto-created → cleaner notified immediately (unchanged) → AI drafts welcome message → Julio reviews, copies, pastes into Airbnb, marks sent.
- **Flow B (inbound message):** Airbnb forwards guest message to email → SES inbound → Lambda writes to Firestore → reply agent drafts response in Julio's voice → Julio reviews, copies, pastes, marks sent.

---

## 1. What already exists (verified in code)

- `functions/icsSync.js` — polls Airbnb ICS every 30 min, creates `bookings` with 10-char hex `code`, creates cleaning job, notifies cleaner. Wired in `functions/index.js`.
- `app/admin/settings/page.js` — UI for ICS feed configuration (likely empty in Firestore).
- `app/api/receipts/inbound/route.js` — pattern to mirror for inbound email handling.
- `lib/pricing-ai.js` — pattern for single-call Anthropic integration (`claude-haiku-4-5`, forced tool use).
- `infra/lib/foundation-stack.js` and `pipeline-stack.js` — existing CDK stacks. Route53 hosted zone for `casa-coqui.cc`.

**Step 0 (Julio, before any code):** Open Firebase Console → Functions → `icsSync` → Logs. Confirm the function is deployed and what error (if any) it's hitting. Most likely: `settings/property.icsFeeds` is empty. If so, paste Airbnb ICS URLs in `/admin/settings`, toggle on, save, force-run with `gcloud scheduler jobs run icsSync --location us-east1`, confirm a booking appears.

---

## 0.5 Current state (shipped 2026-04-15)

Welcome queue UX, `welcomeStatus` 6-state machine (`pending | ready | snoozed | sent | skipped | error`), `threadKey` unmatched-sender threading, `welcomeSweeper`, and the reply agent's RAG pipeline are canonical per:
- `docs/superpowers/specs/2026-04-15-welcome-drafts-and-messaging-unification-design.md`
- `docs/superpowers/plans/2026-04-15-welcome-drafts-and-messaging-unification.md`

This plan does not re-litigate those decisions. v3.3 amendments below are additive to the 2026-04-15 shipped design.

---

## 0.6 Lambda correctness gaps (P0, v3.3)

`infra/lambda/parse-airbnb-email/index.js` has four correctness issues that accumulated since the 2026-04-15 welcome-drafts deploy:

1. `findMatchingBooking` double-broken fallback (field-name drift + `.toDate()` on ISO string) — dead code that never matches.
2. `createBookingFromConfirmation` is racy (query-then-create against concurrent ICS writes), has a silent first-unit fallback (wrong-apartment risk), and a regex date parser with no sanity checks (silent wrong-day risk).
3. Welcome-draft ownership race — both `functions/icsSync.js:243` and Lambda call `generateWelcomeMessage`; the `welcomeStatus !== 'pending'` guard has a read-then-write race.
4. Idempotency check ordering — SES-redelivery dedupe runs AFTER side effects in the reservation_confirmation branch.

**Path A (locked over 5 rounds of review, 2026-04-18):** Lambda enriches existing bookings or quarantines with `reason: 'unmatched_awaiting_ics'`. ICS is the sole booking creator. ICS reactively drains the quarantine on create. ICS poll frequency increases 30-min → 5-min.

See:
- Spec: `docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md`
- Plan: `docs/superpowers/plans/2026-04-18-parse-airbnb-email-correctness.md`

5-commit PR covers: (1) delete Lambda booking creation + dual-key migration for 6 legacy bookings + enrichment extractor; (2) tombstone-claim dedupe with transactional reclaim; (3) welcome-draft ownership lock to ICS + `TERMINAL_WELCOME_STATES` guard; (4) push-on-first-enrich + ICS 5-min + `lockSweeper` + TTL; (5) reactive quarantine drain on ICS booking create.

---

## 2. Phase 1 — SES Subdomain + CDK Stack

**Goal:** `inbox.casa-coqui.cc` receiving email via SES, raw archive in S3, Lambda parsing it.

**Why subdomain (not apex):** MX on apex would hijack all `casa-coqui.cc` mail. `inbox.casa-coqui.cc` has zero blast radius and keeps the apex free for future `you@casa-coqui.cc`.

### 2.1 DNS + SES domain (CDK, no manual clicking)
- Hosted zone lookup for `casa-coqui.cc` (existing in Route53)
- MX record on `inbox.casa-coqui.cc` → `10 inbound-smtp.us-east-1.amazonaws.com`
- SES domain identity for `inbox.casa-coqui.cc` with auto-DKIM (CDK creates 3 CNAME records via Route53)
- TXT SPF record on `inbox.casa-coqui.cc`
- Pin SES region to `us-east-1` (matches existing stacks; SES inbound only in `us-east-1`, `us-west-2`, `eu-west-1`)

### 2.2 `CasaCoquiEmailStack` resources (`infra/lib/email-stack.js`)

| Resource | Purpose |
|---|---|
| S3 Bucket | `casa-coqui-inbound-email` — raw email archive |
| Lambda Function | Reads raw email from S3, parses, classifies, writes to Firestore |
| SES Receipt Rule Set + Rule | On email to `airbnb@inbox.casa-coqui.cc`: (1) save to S3, (2) invoke Lambda |
| IAM Role | Lambda: S3 read, Secrets Manager read, CloudWatch logs |
| Secrets Manager Secret | Firebase service account JSON (Lambda fetches at cold start, caches) |
| SSM Parameter | Shared webhook secret (reserved for any future API-route ingest) |

**Cross-cloud auth:** Firebase service account JSON stored in AWS Secrets Manager. Lambda fetches via `secretsmanager:GetSecretValue` at cold start, initializes Firebase Admin SDK, caches the client across invocations.

**Idempotency:** Lambda checks for existing doc by both `rawEmailS3Key` AND `Message-ID` email header. SES retries within 15 min produce no duplicates.

**SES SPF reject:** Verify the SES receipt rule does NOT reject on SPF failure (default is off). Gmail forwarding rewrites the envelope sender so SPF will fail; SES default "accept anyway" is what we want.

### 2.3 Gmail auto-forward (Julio, ~5 min)
Tightened filter — broad filter catches payouts/reviews/policy emails and pollutes the corpus:
- Filter: `from:(automated@airbnb.com OR messages@airbnb.com) subject:("New message from" OR "responded to your message") → forward to airbnb@inbox.casa-coqui.cc`
- Lambda also classifies message type; anything that isn't a guest message goes to `airbnb_messages_quarantine`
- Gmail will send a verification email to `airbnb@inbox.casa-coqui.cc` — SES must be receiving before this step

---

## 3. Phase 2 — Data Model + Welcome Draft

**Goal:** When ICS creates an Airbnb booking, AI drafts a welcome message in Julio's voice.

### 3.1 New fields on `bookings`
```
welcomeStatus:           'pending' | 'ready' | 'sent' | 'skipped'
                         (default 'sent' for migrated rows;
                          'pending' for new airbnb AND manual bookings)
welcomeMessage:          string
welcomeDraftedAt:        timestamp
welcomeSentAt:           timestamp
airbnbConfirmationCode:  string  (parsed from ICS DESCRIPTION when available)
```

Manual bookings get `welcomeStatus: 'pending'` too so the same review flow works for both.

### 3.2 Welcome generation: one function, two entry points

**Lib file** `lib/welcome-ai.js` (and `functions/lib/welcome-ai.js` — duplicated for v1):
- Header comment: `// DUPLICATED at functions/lib/welcome-ai.js — keep in sync until extracted to a workspace package.`
- Single export `generateWelcomeMessage({ booking, settings, template })` → returns `{ message, language }`
- Single Anthropic API call (NOT agentic — same pattern as `lib/pricing-ai.js`)
- Model: `claude-haiku-4-5`
- Logs to `agent_runs` collection (schema in §7)

**Entry points:**
1. `functions/icsSync.js`: directly imports `generateWelcomeMessage` after creating a booking, writes draft to Firestore. No HTTP, no service-to-service auth.
2. `POST /api/bookings/[id]/welcome` (Next.js): for the manual "Regenerate" button. Same lib function.

**Why no `fetch()` from Cloud Function → Next.js API:** route is gated by `requireRole(['admin'])`, would need service-to-service auth, extra hop, deployed-URL coupling. Direct import is simpler.

**Idempotency guard:** both entry points start with `if (booking.welcomeStatus !== 'pending') return;`

### 3.3 Anthropic API key placement
Same key, two runtimes:
- **Cloud Functions:** `firebase functions:secrets:set ANTHROPIC_API_KEY` + `defineSecret('ANTHROPIC_API_KEY')` in v2 functions
- **Next.js (Vercel):** server-side env var `ANTHROPIC_API_KEY` (already exists for `pricing-ai`)
- Document rotation procedure in `SECRETS.md` — rotate both together

---

## 4. Phase 3 — Welcome Message Admin UI

**`app/admin/bookings/page.js`:**
- New "Welcome Message" panel on bookings where `welcomeStatus !== 'sent'`
- Shows drafted text in a readable card
- Actions: **Copy** (clipboard), **Mark as Sent**, **Regenerate**, **Skip**
- "Mark as Sent" → `welcomeStatus: 'sent'`, `welcomeSentAt: now`

**`app/admin/page.js` dashboard widget:**
- Card: "X bookings need welcome messages" (count of `welcomeStatus === 'ready'`)
- Links to bookings filtered to pending welcomes

---

## 5. Phase 4 — Inbound Email Lambda

### 5.1 Lambda (`infra/lambda/parse-airbnb-email/index.js`)
- Triggered by SES → reads raw email from S3
- Parses: sender name, subject, body, timestamp, `Message-ID`
- **Classifies message type** — guest message vs payout vs review-request vs policy. Only guest messages go to `airbnb_messages`; everything else to `airbnb_messages_quarantine`.
- Extracts Airbnb confirmation code (e.g., `HMABCD1234`) from subject/body
- Writes directly to Firestore using Firebase Admin SDK (no HTTP)
- Idempotent on `rawEmailS3Key` AND `Message-ID`

### 5.2 Matching strategy
1. **Primary:** Airbnb confirmation code → `bookings.airbnbConfirmationCode`
2. **Fallback:** guest name + active date range
3. **Unmatched:** `airbnb_messages_quarantine` (nothing silently lost)

### 5.3 New collection `airbnb_messages`
```
bookingId
guestName
direction:               'inbound' | 'outbound_draft'
body
receivedAt
rawEmailS3Key
messageId                (email Message-ID header, for idempotency)
airbnbConfirmationCode
draftReply               (null until generated)
draftStatus:             'pending' | 'ready' | 'sent' | 'skipped'
draftedAt
sentAt
editedReply              (what Julio actually sent — for voice training)
```

### 5.4 Reply agent trigger (in `functions/index.js`)
- Firestore `onCreate(airbnb_messages/{id})` Cloud Function
- Filters: `direction === 'inbound' AND draftStatus === 'pending'`
- Calls `functions/lib/reply-ai.js` (duplicated from `lib/reply-ai.js`)
- Updates same doc with `draftReply`, `draftStatus: 'ready'`, `draftedAt`
- Logs to `agent_runs`
- Notifies admin
- Decoupled from Lambda — if AI call fails, the inbound message is already safely stored

---

## 6. Phase 5 — Reply Agent + UI

### 6.1 `lib/reply-ai.js` (+ `functions/lib/reply-ai.js`)
- Single function `generateReply({ message, thread, booking, settings, voiceSamples })`
- Voice samples loader lives in the Cloud Function trigger (caller fetches, passes in): query `airbnb_messages` where `direction === 'outbound_draft' AND draftStatus === 'sent'`, limit 50, ordered by `sentAt desc`
- Returns `{ reply, shouldEscalate, escalateReason }`
- Escalation triggers: refunds, complaints, schedule conflicts, anything legal-adjacent

### 6.2 Voice corpus cold start
- One-time import script `scripts/seed-voice-corpus.js`
- Julio pastes 10–20 real past Airbnb replies into a JSON/text file
- Script creates `airbnb_messages` docs with `direction: 'outbound_draft'`, `draftStatus: 'sent'`, `editedReply: <text>`
- Until seeded, replies are competent but generic; system prompt carries baseline tone

### 6.3 `app/admin/messages/page.js`
- New "Airbnb Messages" tab/section alongside in-app messages
- Inbound message + drafted reply inline
- Actions: **Copy Reply**, **Mark as Sent**, **Regenerate with Notes**, **Escalate**
- "Mark as Sent" captures the edited version (`editedReply`) — critical for voice training accuracy
- Default: if Julio clicks "Mark as Sent" without editing, `editedReply = draftReply` (no nulls in corpus)

### 6.4 Dashboard widget update (`app/admin/page.js`)
- Add "Y messages need reply" alongside welcome count

---

## 7. `agent_runs` collection (cross-cutting)

```
kind:           'welcome' | 'reply'
refId:          bookingId or messageId
model:          'claude-haiku-4-5'
inputTokens:    number
outputTokens:   number
latencyMs:      number
prompt:         string  (full prompt — for reproducibility)
response:       string  (raw model output)
escalated:      boolean (reply only)
createdAt:      timestamp
```

**Retention:** at low volume (~60/month) this grows slowly. Add a scheduled cleanup in 6 months for records > 1 year. Not v1 work.

---

## 8. Sequencing

```
Phase 1 (SES + CDK)         ←── start immediately, AWS infra
Phase 2 (Welcome draft)     ←── start in parallel with Phase 1
Phase 3 (Welcome UI)        ←── depends on Phase 2
Phase 4 (Lambda)            ←── depends on Phase 1 (SES live)
Phase 5 (Reply agent + UI)  ←── depends on Phase 4
```

Each phase is one PR.

---

## 9. Verification plan

- **Phase 1:** Send test email to `airbnb@inbox.casa-coqui.cc` → confirm raw email in S3
- **Phase 2:** Trigger ICS sync → confirm `welcomeStatus: 'ready'` + draft text on booking + `agent_runs` doc logged
- **Phase 3:** Open booking in admin → copy → mark sent → verify `welcomeStatus: 'sent'`
- **Phase 4:** Forward a real Airbnb guest message → confirm `airbnb_messages` doc created. Forward same email twice → still one doc (idempotency). Forward a payout email → lands in `airbnb_messages_quarantine`
- **Phase 5:** Reply draft appears → edit → mark sent → verify `editedReply` stored and corpus grows
- **Firestore rules:** run `firebase emulators:exec` tests for `airbnb_messages`, `airbnb_messages_quarantine`, `agent_runs` before each deploy

---

## 10. Files to create / modify

**New:**
- `infra/lib/email-stack.js`
- `infra/lambda/parse-airbnb-email/index.js`
- `lib/welcome-ai.js` (+ `functions/lib/welcome-ai.js` duplicate)
- `lib/reply-ai.js` (+ `functions/lib/reply-ai.js` duplicate)
- `app/api/bookings/[id]/welcome/route.js`
- `scripts/seed-voice-corpus.js`
- `SECRETS.md`

**Modified:**
- `functions/icsSync.js` — call welcome generator after booking creation; parse confirmation code from ICS DESCRIPTION
- `app/api/admin/sync-ics/route.js` — same trigger for manual sync
- `functions/index.js` — register `onCreate(airbnb_messages)` reply trigger
- `app/admin/bookings/page.js` — welcome message panel
- `app/admin/page.js` — dashboard widgets
- `app/admin/messages/page.js` — Airbnb messages tab
- `infra/bin/app.js` — register `EmailStack`
- `firestore.rules` — rules for `airbnb_messages`, `airbnb_messages_quarantine`, `agent_runs`

---

## 11. Open items for Julio

1. **Welcome message template** — share an example (or describe the vibe). The AI needs your voice as a seed.
2. **Bilingual rule** — always English? Always Spanish? Detect from guest name / message language?
3. **Escalation preference** — when the reply agent isn't confident (refunds, complaints): (a) draft something safe + flag, or (b) just notify with no draft?
4. **Voice corpus seed** — dig up 10–20 past Airbnb replies. Screenshots, copy/paste, CSV — any format.

---

## 12. Cost estimate

| Service          | Volume                       | Monthly cost      |
|------------------|------------------------------|-------------------|
| SES inbound      | ~60 emails                   | Free (under 1k)   |
| S3 storage       | ~60 × ~50KB                  | < $0.01           |
| Lambda           | ~60 invocations × ~5s        | < $0.01           |
| Secrets Manager  | 1 secret                     | $0.40             |
| Anthropic Haiku  | ~10 welcomes + ~50 replies   | < $1.00           |
| **Total**        |                              | **< $2.00/month** |

---

## 13. Risks

1. **ICS guest names are placeholders.** Real names arrive in the first guest message. Reply agent updates `bookings.guestName` opportunistically when it sees a real name.
2. **Two-copy code drift** between `lib/` and `functions/lib/`. Header comment + manual discipline for v1; revisit if more code accumulates.
3. **Voice drift if Julio always edits before sending.** "Mark as Sent" captures the edited version (§6.3).
4. **Gmail filter too broad.** Mitigated by tightened subject filter + Lambda classification + quarantine collection.
5. **SPF failure on Gmail-forwarded mail.** Mitigated by leaving SES receipt rule's SPF reject off (default).
6. **Anthropic API key in two places.** Document rotation in `SECRETS.md`; rotate together.
