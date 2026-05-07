# Airbnb Resolution Center Email Parser — What We Built

**Date**: 2026-05-06
**Status**: Backbone built, tested locally (38/38 passing), not yet deployed.

---

## The problem

Airbnb's AirCover team sends emails from `resolutions@airbnb.com` (note: **plural** — "resolutions") whenever a host damage claim, reimbursement request, or AirCover case is opened on your account. These emails contain critical information:

- **Claim ID** (e.g. `CLSF-05873844`) — Airbnb's permanent identifier for the case
- **Booking confirmation code** (e.g. `HMRJNRRYF5`) — which reservation triggered it
- **Resolution Center URL** — where you upload documentation
- **Deadline** for response
- **What documentation Airbnb wants** (receipts, invoices, photos)

**The bug**: Before today, your email pipeline didn't know what to do with these emails. It would receive them, fail to classify them, and dump them into a "quarantine" collection meant for triage. You got no notification, no structured record, no way for an admin tool or chatbot to act on them later. The emails effectively vanished into a holding cell.

---

## The pipeline (before vs. after)

### Before

```
Airbnb → Gmail forward → SES → S3 → Lambda
                                       ↓
                              classifyEmail() = 'unknown'
                                       ↓
                              airbnb_messages_quarantine
                              (no notification, no structure)
```

### After

```
Airbnb → Gmail forward → SES → S3 → Lambda
                                       ↓
                              classifyEmail() = 'resolution_request'  ← NEW
                                       ↓
                              parseResolutionFields()  ← NEW
                                  extracts claimId, confirmationCode, URL
                                       ↓
                              airbnb_resolutions/{claimId}  ← NEW collection
                                  upserted (multiple emails for same claim merge)
                                       ↓
                              notifyAdminAndCohost()  ← NEW (first arrival only)
                                  → FCM push + staff_notifications doc
                                  → deeplink target: /admin/resolutions
```

---

## What we built — 5 pieces

### 1. A new email type

We added `'resolution_request'` to the list of email categories the Lambda recognizes (alongside the existing `guest_message`, `reservation_confirmation`, `payout`, etc.).

**File**: `infra/lambda/parse-airbnb-email/index.js` line 170 (the `MessageType` typedef)

### 2. Classifier patterns (5 of them)

The classifier checks the email subject for any of these patterns and tags it as `resolution_request`:

| Pattern | Matches |
|---|---|
| `Airbnb Reimbursement Request` | The exact subject Airbnb uses for damage claims |
| `Host damage protection` | Other AirCover variants |
| `AirCover` | Generic AirCover-themed updates |
| `Resolution Center` | Manual resolution case updates |
| `CLSF-####` | **Catch-all** — any subject containing the claim ID format |

The last one is the most defensive. Even if Airbnb invents a new subject phrasing, as long as it carries the `CLSF-` claim ID, we'll classify it correctly.

**File**: `infra/lambda/parse-airbnb-email/index.js` lines 266–282

### 3. A parser function

`parseResolutionFields({ subject, bodyText })` reads the email and extracts three structured fields:

- **`claimId`**: The `CLSF-NNNNNNNN` identifier (regex: `/\bCLSF-(\d{4,})\b/i`, normalized to upper case)
- **`confirmationCode`**: The Airbnb HM-prefix booking code (regex: `/\bHM[A-Z0-9]{8,10}\b/`)
- **`resolutionUrl`**: The Resolution Center link Airbnb wants you to visit (regex: `/https?:\/\/airbnb\.com\/mediation\/[^\s"'<>]+/i`)

It searches both the subject AND the body, so even if the subject is something generic like `Fwd: Important`, the parser still finds the claim ID in the body text.

**One bug we caught and fixed during testing**: an early version of the URL cleaner stripped `=` characters too aggressively, eating the `=` in `referenceId=CLSF-05873844`. We narrowed the strip to only target `=` followed by a line break (which is how MIME-encoded emails wrap long URLs), preserving real query-string `=` signs.

**File**: `infra/lambda/parse-airbnb-email/index.js` lines 285+

### 4. A new Firestore collection: `airbnb_resolutions`

Instead of dumping these emails into the generic quarantine bucket, we now write them to a dedicated collection where each document is keyed by its `claimId`. So `airbnb_resolutions/CLSF-05873844` is the canonical record for that case.

**Why key by claimId?** Airbnb often sends multiple emails for the same case ("we received your docs", "we need more info", "case closed"). By using `claimId` as the document ID, every subsequent email **upserts** into the same document — no duplicates, easy timeline.

The schema captures everything needed for an admin UI or chatbot later:

```javascript
{
  claimId: 'CLSF-05873844',
  confirmationCode: 'HMRJNRRYF5',
  bookingId: '<matched-booking-id-or-null>',
  status: 'open',                      // open | responding | closed | archived
  subject, fromName, fromAddress,
  receivedAt, createdAt, updatedAt, adminNotifiedAt,
  resolutionUrl,
  bodyText: '<full plain text capped at 16KB>',
  rawEmailS3Key: '<pointer back to S3 for full re-parse later>',
  messageId, sesMessageId,
}
```

**Firestore security rule**: admin and cohost can read; only the Lambda (via Admin SDK) can create. Updates from the client are restricted to changing `status`, `notes`, or `updatedAt` — so an admin can mark a case "closed" but can't tamper with the claim ID or original email content.

**File**: `firestore.rules` line 454

### 5. Admin notification

The first time a new `claimId` arrives, the Lambda calls `notifyAdminAndCohost()` to:

1. Send an FCM push to all admin/cohost staff phones
2. Write a `staff_notifications` Firestore doc (so it shows up in the in-app bell icon)

The notification carries a `targetPath: '/admin/resolutions'` for deep-linking — that page doesn't exist yet, but when you build it, the deeplink will work automatically.

**Subsequent emails for the same claim** silently update the document without re-notifying. Otherwise you'd get spammed every time Airbnb sent a follow-up.

**Notification copy** (bilingual):
- EN: "Airbnb resolution case opened" — "Claim CLSF-05873844 from resolutions@airbnb.com — booking HMRJNRRYF5"
- ES: "Caso de resolución de Airbnb abierto" — "Reclamo CLSF-05873844 de resolutions@airbnb.com — booking HMRJNRRYF5"

---

## What we tested

We added 9 new tests to `infra/lambda/parse-airbnb-email/__tests__/classify-email.test.js`:

**Classifier tests** (6):
- "Airbnb Reimbursement Request [CLSF-...] [HM...]"
- "Fwd: Airbnb Reimbursement Request..." (Gmail-forwarded variant)
- "Host damage protection update [CLSF-12345678]"
- Subjects with bare `CLSF-` claim IDs (no surrounding wording)
- "Your AirCover claim has been updated"
- "Resolution Center: documentation requested"

**Parser tests** (3):
- Full extraction from a real-world email body
- All-nulls case when nothing matches
- ClaimId in body when subject is just `Fwd: Important`

**Result**: 38/38 tests passing.

---

## What we did NOT build (intentionally deferred)

Per your guidance — "We don't need all that right now. WE should just save this and add atleast the back bone of this flow." — these are stubbed but not implemented:

| Feature | Why deferred | Where to add later |
|---|---|---|
| Admin UI page at `/admin/resolutions` | Backbone first; build UI when needed | New file under `app/admin/resolutions/page.js` |
| Photo / attachment extraction | Airbnb sends URLs, not raw photos — needs link extraction strategy | Extend `parseResolutionFields()` |
| Email threading sub-collection | Current upsert overwrites top-level fields; OK for v1 | Add `airbnb_resolutions/{claimId}/thread/{ts}` subcollection |
| Chatbot reply composer | Whole separate feature | New endpoint that reads `airbnb_resolutions/{claimId}` + composes reply |
| Deadline parsing | Best-effort regex on body — additive, no schema change needed | Add to `parseResolutionFields()` |

---

## Files we touched

| File | Change | Lines |
|---|---|---|
| `infra/lambda/parse-airbnb-email/index.js` | classifier + parser + routing branch + export | ~85 added |
| `firestore.rules` | new collection rule block | ~10 added |
| `infra/lambda/parse-airbnb-email/__tests__/classify-email.test.js` | 9 new tests + import | ~70 added |
| `scripts/backfill-airbnb-resolutions.js` | new script — re-classify quarantined emails | ~110 (new file) |

The backfill script lets you re-process emails already sitting in `airbnb_messages_quarantine` so they land in `airbnb_resolutions` retroactively. Default is dry-run; pass `--apply` to actually write.

---

## How this gets to production

The Lambda lives in a separate AWS CDK stack (not the main Vercel pipeline), so deploy is a two-step process:

### Step 1 — Lambda (CDK)

```bash
cd /Users/jperez/dev/casa-coqui/infra
source activate.sh   # if you have a Python venv for CDK
cdk deploy CasaCoquiEmailStack
```

This bundles `infra/lambda/parse-airbnb-email/` and updates the function in AWS.

### Step 2 — Firestore rules (main pipeline)

```bash
git push origin main
```

This triggers the AWS CodePipeline, builds, waits for your manual approval, then runs `firebase deploy --only functions,firestore:rules,firestore:indexes`.

### Step 3 (optional) — Backfill existing quarantine

```bash
node scripts/backfill-airbnb-resolutions.js          # dry run — see what would happen
node scripts/backfill-airbnb-resolutions.js --apply  # actually write
```

This walks the quarantine collection, finds anything that looks like a resolution request, and creates the matching `airbnb_resolutions/{claimId}` documents. Each one gets a `backfilledFromQuarantine` field pointing back to the source quarantine doc, so you can audit later.

---

## What this enables next

Once deployed, every new resolution email lands as a structured Firestore document. From there you can:

1. **Build the admin UI**: list all open resolutions, filter by status, see which booking each maps to
2. **Build the chatbot reply composer**: feed `bodyText` + booking history into the AI agent, generate a draft reply with documentation references, send via Airbnb's reply-by-email mechanism
3. **Connect to your operations data**: link each claim to the underlying booking, cleaning jobs (smoke odor in this case 👀), guest profile
4. **Track resolution outcomes**: when does Airbnb side with the host? With the guest? What documentation works?

The backbone we just laid is the **data foundation** — none of those next steps are blocked anymore.
