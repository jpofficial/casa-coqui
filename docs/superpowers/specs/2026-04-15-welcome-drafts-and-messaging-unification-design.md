# Welcome Drafts Queue + Messaging Unification — Design

**Status:** Draft for review
**Date:** 2026-04-15
**Author:** Julio + Claude (brainstorming session)

## 1. Problem

The `/admin/bookings` page today is a flat list of every booking (active, upcoming, past). Every card renders its `WelcomeMessagePanel` fully expanded, so the page scrolls for screens. There is no queue view of "welcome messages that need to be sent." When a welcome *is* marked sent, nothing gets written to the guest's conversation thread on `/admin/messages`, so the host has no unified record of the welcome → guest Q&A → host reply lifecycle. Unmatched inbound messages (Lambda couldn't match the sender to a booking) all collapse into a single `'unknown'` thread, mixing unrelated guests and polluting the reply agent's context.

The host sends actual messages manually through Airbnb (no Airbnb host API exists). Casa Coqui is a **record-keeping + drafting** surface only — it must never attempt to transmit.

## 2. Goals

- Give the host a focused queue of welcome drafts waiting to be sent, separate from the booking record list.
- Make each welcome card collapsible, with quick actions (Mark as Sent, Copy, Send later, Regenerate, Skip).
- On "Mark as Sent," write the final welcome text into the guest's thread on `/admin/messages` so the conversation log is complete.
- Keep using the existing reply agent; ensure welcome messages feed its thread history automatically.
- Group inbound messages from unmatched senders into per-sender threads instead of one "unknown" bucket.
- Surface stuck-pending welcome drafts as `error` so they can be retried.

## 3. Non-goals

- Sending messages through Airbnb or any third-party messaging API. Every outbound channel is manual (host copies + pastes).
- Backfilling `airbnb_messages` for welcomes already marked sent prior to this change.
- Redesigning `/admin/messages` thread UI (column layout, composer, etc.) — out of scope.
- Adding a separate "Matched / Unmatched" filter tab on Messages. Use a badge on unlinked threads instead.

## 4. Scope of change

| Surface | Change |
|---|---|
| `app/admin/bookings/page.js` | Replace flat list with tab bar (Drafts · In-house · Upcoming · Past). Collapse cards. New status pills. Wire new actions. |
| `app/admin/messages/page.js` | Thread grouping uses `threadKey` field. Add "⚠ Unmatched" badge on threads keyed by sender. |
| `app/api/bookings/[id]/welcome/route.js` | New PATCH path for `mark-sent` that writes an `airbnb_messages` doc in addition to the existing booking update. |
| `app/api/bookings/[id]/welcome/route.js` | Extend to accept `snoozedUntil` (ISO) for the new "Send later" action. |
| `infra/lambda/parse-airbnb-email/index.js` | `generateWelcomeDraft()` now writes `welcomeStatus: 'error' + welcomeError` on failure instead of swallowing. Also sets `threadKey` on new `airbnb_messages` docs. |
| `functions/index.js` (`onAirbnbMessageCreated`) | Load thread history via `threadKey` (not only `bookingId`), so unmatched senders get context. |
| `functions/icsSync.js` or a new `functions/scheduled.js` | New scheduled job (every 15 min) that flips `snoozed → ready` when timer elapses, and flips stuck `pending → error` after 10 min. |
| Firestore migration | One-time script to backfill `threadKey` on existing `airbnb_messages`. |

## 5. Data model

### 5.1 `bookings` — new / changed fields

| Field | Type | Notes |
|---|---|---|
| `welcomeStatus` | `'pending'` \| `'ready'` \| `'snoozed'` \| `'sent'` \| `'skipped'` \| `'error'` | Added `snoozed` and `error` states. |
| `welcomeSnoozedUntil` | ISO string \| null | When snooze expires and card returns to Drafts. |
| `welcomeError` | string \| null | Last error message when `status === 'error'`. |
| `welcomeSentText` | string \| null | Final text the host confirmed (may differ from `welcomeMessage` if edited in the modal). |

(`welcomeMessage`, `welcomeDraftedAt`, `welcomeSentAt` remain as today.)

### 5.2 `airbnb_messages` — new fields

| Field | Type | Notes |
|---|---|---|
| `threadKey` | string | `bookingCode` if matched; else `'email:<lowercased email>'`; else `'name:<lowercased name>'`. Used by `/admin/messages` for grouping and by the reply agent for thread history. |
| `source` | `'welcome_draft'` \| `'reply_draft'` \| `'inbound'` | Distinguishes the welcome message from other outbound and from inbound. |

On write paths:
- Lambda inbound write: `threadKey = bookingCode || 'email:' + senderEmail.toLowerCase() || 'name:' + senderName.toLowerCase()`. `source: 'inbound'`.
- Mark-as-sent write: `threadKey = bookingCode`. `source: 'welcome_draft'`. `direction: 'outbound'`. `sender: 'host'`.
- Reply drafts continue to update existing inbound docs; set `source: 'reply_draft'` on the outbound doc created when a reply is marked sent (future work — not required by this spec).

### 5.3 Status pill set (UI layer)

`Ready · Generating · Snoozed · Sent · Skipped · Error · Cancelled · In-house · Past`

## 6. UX flows

### 6.1 Bookings page tabs

- **Default tab:** Drafts if count > 0, otherwise In-house, otherwise Upcoming.
- **Drafts:** `welcomeStatus === 'ready'` and `status === 'active'`. First card auto-expanded.
- **In-house:** `checkInDate ≤ today ≤ checkOutDate` and `status === 'active'`.
- **Upcoming:** `checkInDate > today` and `status === 'active'`.
- **Past:** `checkOutDate < today` OR `status === 'cancelled'`.

Cards start collapsed everywhere except the first card in Drafts. Click to expand.

### 6.2 Mark as Sent flow

1. Host clicks **✓ Mark as Sent** on a draft.
2. A new confirmation modal opens pre-filled with the draft text — host may edit before confirming. (Today's flow flips status directly with no edit step. This modal is new; mirrors the pattern already used on `/admin/messages`.)
3. On confirm, client calls `PATCH /api/bookings/{id}/welcome` with `{ action: 'mark-sent', text: <final> }`.
4. Server (single transaction):
   - Updates `bookings/{id}`: `welcomeStatus: 'sent'`, `welcomeSentAt`, `welcomeSentText`.
   - Creates `airbnb_messages` doc:
     ```js
     {
       bookingId, bookingCode,
       threadKey: bookingCode,
       guestName,
       direction: 'outbound',
       sender: 'host',
       text: <final text>,
       source: 'welcome_draft',
       sentAt: <serverTimestamp>,
       createdAt: <serverTimestamp>,
       read: true,
     }
     ```
5. Client optimistically moves the card out of Drafts to In-house/Upcoming with a `✉ SENT` pill.

### 6.3 Send later flow

1. Host clicks **⏱ Send later** → small picker: `Tomorrow morning` · `Day before check-in` · `Morning of check-in` · `Pick date/time…`. Default highlight: **Day before check-in at 9am local**.
2. Client calls `PATCH /api/bookings/{id}/welcome` with `{ action: 'snooze', snoozedUntil: <ISO> }`.
3. Server: `welcomeStatus: 'snoozed'`, `welcomeSnoozedUntil: <ISO>`.
4. Card leaves Drafts, appears in Upcoming with `⏱ SNOOZED until Jul 4` pill.
5. Scheduled function (§6.6) flips back to `ready` when timer elapses and fires a staff push.

### 6.4 Skip flow

Existing behavior: `welcomeStatus: 'skipped'`. No `airbnb_messages` write. No-op otherwise. Card moves out of Drafts.

### 6.5 Regenerate flow

Existing behavior: calls `/api/bookings/{id}/welcome?force=true`. No change.

### 6.6 Scheduled sweeper (new)

A new Cloud Function runs every 15 minutes (shares schedule with `icsSync` or reuses its scheduler):

- `welcomeStatus == 'snoozed' && welcomeSnoozedUntil <= now` → `welcomeStatus = 'ready'`; fire staff push: *"Welcome draft for {guestName} is ready to send."*
- `welcomeStatus == 'pending' && bookingCreatedAt < now - 10min` → `welcomeStatus = 'error'`, `welcomeError = 'Generation timed out — click Retry'`. (Handles Lambda crashes mid-call.)

### 6.7 Messages page — unmatched threads

- Thread list groups by `threadKey` (currently `bookingCode`). Unmatched threads (`threadKey` starting with `email:` or `name:`) show the sender's display name with a small yellow **⚠ Unmatched** badge.
- A **"Link to booking →"** action on the thread header lets the host pick a booking from a dropdown. On confirm, server updates every `airbnb_messages` doc in that thread: `threadKey = newBookingCode`, `bookingId`, `bookingCode`.
- Reply agent at `functions/index.js:238` now loads thread history by `threadKey` (not only `bookingId`). No other change to the chain strategy.

## 7. API contract changes

### 7.1 `PATCH /api/bookings/{id}/welcome`

Body (one of):
```json
{ "action": "mark-sent", "text": "…final text…" }
{ "action": "snooze",    "snoozedUntil": "2026-07-04T13:00:00Z" }
{ "action": "skip" }
```

Returns `{ success: true, booking: { …updated fields… } }` or `{ success: false, error }`.

The existing `POST /api/bookings/{id}/welcome?force=true` (regenerate) is unchanged.

### 7.2 `POST /api/messages/threads/link` (new)

Links an unmatched thread to a booking.

Body: `{ threadKey: "email:rob@yahoo.com", bookingId: "abc123" }`

Server loads `bookings/{bookingId}`, then batch-updates every `airbnb_messages` doc where `threadKey === <old>`: sets `threadKey: booking.code`, `bookingId`, `bookingCode: booking.code`. Returns `{ success: true, migrated: <n> }`.

## 8. Migration

One-time script `scripts/backfill-thread-keys.js`:
- For every `airbnb_messages` doc without `threadKey`:
  - If `bookingCode` present → `threadKey = bookingCode`.
  - Else if `senderEmail` present → `threadKey = 'email:' + senderEmail.toLowerCase()`.
  - Else if `guestName` present → `threadKey = 'name:' + guestName.toLowerCase()`.
  - Else `threadKey = 'unknown'` (preserves current behavior for fully-anonymous docs).

Run with `--apply` flag, chunked writes (500 per batch). Idempotent.

No backfill for existing sent welcomes — thread history will have a gap for past guests and that's acceptable.

## 9. Firestore rules

- `airbnb_messages` update rule must allow staff to change `threadKey`, `bookingId`, `bookingCode` (for the "Link to booking" action).
- `bookings` update rule for welcome fields already allows staff writes; add `welcomeSnoozedUntil`, `welcomeError`, `welcomeSentText` to the allowed-fields list.

## 10. Testing plan

Manual smoke tests (mirrors the live flows; no Firestore emulator is set up):

1. **Fresh forward → Drafts tab:** Forward a real Airbnb confirmation email. Confirm the new booking lands in Drafts tab with `welcomeStatus: 'ready'` within ~10 s.
2. **Mark as Sent → thread:** Click Mark as Sent, confirm modal, check that the welcome appears as the first message in that guest's thread on `/admin/messages`.
3. **Send later → snooze round-trip:** Snooze a draft for 15 minutes. Confirm card leaves Drafts, shows `⏱ SNOOZED` in Upcoming. Wait for the sweeper; confirm card returns to Drafts with `✉ READY` and a staff push lands.
4. **Stuck pending → error:** Manually set a booking's `welcomeStatus: 'pending'` with `createdAt` 15 min ago. Sweeper should flip it to `error` + `welcomeError`.
5. **Unmatched thread separation:** Forward two inbound messages from two different unknown senders (e.g. create synthetic inbound `airbnb_messages` docs with `bookingId: null`, different `senderEmail`). Confirm `/admin/messages` shows them as **two** separate threads both carrying the `⚠ Unmatched` badge.
6. **Link to booking:** Use the new "Link to booking" action on an unmatched thread. Confirm every doc in that thread updates to the new `threadKey` and re-appears under the linked booking.
7. **Reply agent context:** Send an inbound message after a welcome was marked sent. Inspect the agent input JSON (via `agent_runs`) — the welcome must appear in `thread`.

## 11. Open questions

- Should the "Link to booking" dropdown only show unlinked bookings, or all bookings? (Allowing re-link is more flexible but accidental merges are bad.) **Default: all bookings, require a confirm step.**
- If a guest's name changes between inbound emails (typo, nickname), the `name:` threadKey won't merge. Acceptable edge case — email-based keying covers the common case.

## 12. Rollout

Single deploy. No feature flag required — existing welcomes without `threadKey` still work (the Messages page falls back to `bookingCode || 'unknown'` grouping if `threadKey` is missing). Backfill script runs independently after deploy.
