# Casa Coqui — Notification System v2: FCM-Only Architecture

## Executive Summary

This document is the complete implementation plan for migrating Casa Coqui's notification system from a fragmented FCM+Twilio+SMS architecture to a **centralized FCM-only system** with in-app notification fallback, user preferences, and delivery reliability.

Five engineering sub-agents audited the codebase independently:
1. **Senior Backend Engineer** — architecture, recipient logic, centralized service design
2. **Senior Frontend Engineer** — FCM client, service worker, notification center UI
3. **Senior UX Designer** — push permission strategy, notification settings, anti-fatigue
4. **Senior QA Engineer** — test coverage, edge cases, validation plan
5. **Senior Twilio Removal Engineer** — dependency inventory, safe migration plan

---

## PART 1: FCM-ONLY ARCHITECTURE

### 1.1 Current State Assessment

**Is push working end to end?** Partially.

- **Server send path**: Working. `lib/notifications.js` uses `messaging.send()` and `messaging.sendEachForMulticast()` correctly via `firebase-admin/messaging`.
- **Client registration**: Has a critical bug. `hooks/usePush.js` auto-refresh block (lines 66-88) does **not** re-write `bookingCode` or `staffId` — only `token` and `updatedAt`. After token rotation, the doc loses its identity fields and becomes invisible to `broadcastToActiveGuests()`.
- **Token storage**: `fcm_tokens/{token}` — fields: `token`, `createdAt`, `updatedAt`, `userAgent`, `bookingCode?`, `staffId?`. No `role` field stored.
- **Foreground**: `usePush.js` uses `new Notification()` — fails silently on iOS PWA. Must route through service worker instead.
- **Background**: `firebase-messaging-sw.js` works correctly for showing notifications.
- **Click routing**: **BROKEN for guests**. Click handler always opens `/admin` regardless of recipient. A guest clicking a laundry notification goes to admin login.
- **Permission denied**: `requestPermission()` returns silently, `permission` set to `'denied'`, no fallback. With SMS removed, guest gets zero notifications.
- **Push unsupported**: iOS Safari pre-16.4 and non-PWA contexts return `supported=false`. No fallback exists.

### 1.2 Critical Bugs to Fix Before Anything Else

| # | Bug | File | Lines | Fix |
|---|-----|------|-------|-----|
| 1 | Token auto-refresh drops `bookingCode`/`staffId` | `hooks/usePush.js` | 66-88 | Always re-write identity fields on refresh |
| 2 | Click handler routes all users to `/admin` | `public/firebase-messaging-sw.js` | 36-48 | Route by `eventType` and `bookingCode` from payload |
| 3 | Foreground handler uses `new Notification()` (fails iOS) | `hooks/usePush.js` | 50-58 | Route through service worker via `postMessage` |
| 4 | Full `fcm_tokens` collection scan on broadcast | `lib/notifications.js` | 135 | Filter by `bookingCode` with indexed query |
| 5 | No fallback when push denied/unsupported | Multiple | — | In-app notification center as fallback |

### 1.3 Centralized Architecture

Replace all scattered helpers with a single service:

**New files to create:**
```
lib/notification-service.js      — single notificationService.send() entry point
lib/notification-templates.js    — message templates by EVENT_TYPE
lib/notification-recipients.js   — recipient resolution per event type
lib/notification-prefs.js        — preference lookup + quiet hours
lib/otp.js                       — pure OTP helpers (extracted from twilio.js)
```

**Files to delete after migration:**
```
lib/notifications.js             — replaced by notification-service.js
lib/staff-notifications.js       — merged into notification-service.js
lib/twilio.js                    — SMS removed entirely
```

### 1.4 Event Type Registry

```javascript
EVENT_TYPES = {
  // Guest-received
  BROADCAST:           'broadcast',
  MAINTENANCE_UPDATE:  'maintenance_update',
  DIRECT_MESSAGE:      'direct_message',
  HOST_REPLY:          'host_reply',
  LAUNDRY_AVAILABLE:   'laundry_available',
  LAUNDRY_OWNER_NUDGE: 'laundry_owner_nudge',
  PARKING_ALERT:       'parking_alert',

  // Staff-received
  GUEST_MESSAGE:       'guest_message',
  MAINTENANCE_CREATED: 'maintenance_created',
  CLEANING_ASSIGNED:   'cleaning_assigned',
  CLEANING_REASSIGNED: 'cleaning_reassigned',
  CLEANING_STATUS:     'cleaning_status',
};
```

### 1.5 notificationService.send() Flow

```
Caller emits event
    │
    ├── 1. Cooldown check (parking only, 10-min window)
    ├── 2. Build {title, body} from template + context
    ├── 3. Resolve recipients (role + booking aware)
    ├── 4. For each recipient:
    │     ├── Resolve UID
    │     ├── Check notification_preferences (skip if disabled)
    │     ├── Check quiet hours (defer if deferrable event)
    │     ├── Write to user_notifications/{uid}/items (always)
    │     ├── Resolve FCM tokens
    │     ├── Send FCM push (with webpush.fcmOptions.link for click routing)
    │     └── Clean stale tokens on failure
    └── 5. Write aggregate log to notification_log collection
```

**Key design decisions:**
- **In-app record always written** — even if push fails, user can see notification in-app
- **Quiet hours queue, not suppress** — deferrable events write `status: 'queued_quiet_hours'` to in-app, no push
- **webpush.fcmOptions.link** — click URL computed per event type and recipient, passed to service worker
- **Preferences checked server-side** — enforced categories cannot be disabled

### 1.6 Notification Preferences Schema

**Collection:** `notification_preferences/{uid}`

```javascript
{
  // Enforced (cannot disable)
  push_broadcast: true,         // admin broadcasts
  push_parking_alert: true,     // safety-critical
  push_host_reply: true,        // core communication
  push_guest_message: true,     // staff: core workflow
  push_maintenance_created: true, // staff: core workflow

  // Mutable (user can toggle)
  push_maintenance_update: true,
  push_laundry_available: true,
  push_laundry_owner_nudge: true,
  push_cleaning_assigned: true,
  push_cleaning_status: true,

  // Quiet hours
  quiet_hours_enabled: true,
  quiet_hours_start: 22,        // 10 PM property local time
  quiet_hours_end: 8,           // 8 AM

  updatedAt: ISO string,
}
```

### 1.7 In-App Notification Center (Push Fallback)

**Collection:** `user_notifications/{uid}/items/{auto-id}`

```javascript
{
  eventType: string,
  title: string,
  body: string,
  data: object,
  read: false,
  status: 'delivered' | 'in_app_only' | 'queued_quiet_hours',
  createdAt: ISO string,
  bookingCode: string | null,
}
```

**API routes:**
- `GET /api/notifications/inbox` — last 50 items + unread count
- `PATCH /api/notifications/inbox` — mark read (by IDs or all)
- `GET/PATCH /api/notifications/preferences` — get/update preferences

**Client:** Real-time `onSnapshot` listener on unread items drives badge count. Full list loaded on demand when notification center opens.

---

## PART 2: PUSH ENABLEMENT STRATEGY

### 2.1 Optimal Moment to Ask

**Ask at the end of the get-started page**, after PWA install context is established.

Guest journey: `Link tap → Phone verify → Get-started → Guest portal`

The get-started page already shows four feature cards (parking, laundry, messages, community). Add a push opt-in section **below the PWA install section, before "Continue to Your Portal"**.

Why this moment:
- User is emotionally invested (completed check-in)
- Feature value is freshly established (benefit cards visible)
- On iOS, PWA install step precedes push (required order)
- Setup context is the right bounded space for this ask

### 2.2 Pre-Permission Explainer

```
┌──────────────────────────────────────────────┐
│  [bell icon, green circle]                    │
│  Get alerts that matter during your stay      │
│                                               │
│  ┌────────────────────────────────────┐       │
│  │ [icon] Casa Coqui                  │       │
│  │ Washer is free — grab your laundry │       │
│  │ now while it's available.     now  │       │
│  └────────────────────────────────────┘       │
│  (mock notification preview)                  │
│                                               │
│  What you'll hear about:                      │
│                                               │
│  [car]    Parking Alerts                      │
│  [cycle]  Laundry Is Free                     │
│  [chat]   Host Messages                       │
│                                               │
│  Your host sends maybe 2-3 notifications      │
│  per stay. No spam, ever.                     │
│                                               │
│  ┌────────────────────────────────────┐       │
│  │ Keep Me Informed During My Stay    │       │ ← green-600
│  └────────────────────────────────────┘       │
│                                               │
│      I'll check the app manually              │ ← text-sm gray link
└──────────────────────────────────────────────┘
```

**Key copy decisions:**
- CTA: "Keep Me Informed During My Stay" (not "Allow" or "Enable")
- Skip: "I'll check the app manually" (non-judgmental, honest)
- "2-3 notifications per stay" — explicit volume kills spam fear
- Mock notification preview — removes unknown factor

### 2.3 Re-Prompt Strategy

| Re-prompt | Delay | Location | Trigger |
|-----------|-------|----------|---------|
| 1 | 24 hours | Compact banner, home screen | Time-based |
| 2 | 48h after prompt 1 | Contextual (laundry/community/maintenance) | Feature-based |
| 3+ | Never | Settings page only | User-initiated |

**Maximum 2 automatic re-prompts, then stop.** localStorage keys scoped by booking code.

### 2.4 Contextual Prompts

**Laundry** (when machines in use):
```
[cycle icon]  Want to know when the washer is free?
              Get a notification the moment it opens up.
              [Alert Me When Free]              [Not now]
```

**Maintenance** (after request submitted):
```
[check icon]  Request submitted
              Enable notifications to hear when your host responds.
              [Notify Me About This]            [No thanks]
```

**Community Board** (first visit with existing posts):
```
[community icon]  There are posts from other guests
                  Get notified when new posts appear.
                  [Follow This Board]             [Skip]
```

### 2.5 Persistent Reminder Banner

Compact banner on home screen below header, shown when `permission !== 'granted'`:

```
[bell]  Turn on alerts to stay updated  [Enable]  [×]
```

- Auto-hides after 72 hours from booking start
- Permanent dismiss on "×" (per booking code)
- `bg-stone-50 border-b border-stone-200`, 52px height

### 2.6 iOS-Specific Flow

iOS requires PWA install before push works. When `platform === 'ios' && !isStandalone`:
- Show "Add to Home Screen first, then we can send you alerts"
- Link to install guide
- After install + reopen: show "App installed — you can now enable notifications" banner

### 2.7 Admin/Staff Flow

**Current bug:** `admin/layout.js` line 24-26 calls `requestPermission()` immediately with zero context (cold prompt).

**Fix:** Replace with localStorage-gated one-time explainer:

```
[bell]  Enable host notifications
        Get instant alerts for maintenance requests,
        parking incidents, and guest check-ins.
        [Enable Host Alerts]              [Later]
```

Role-specific copy for cleaners/maintenance workers.

### 2.8 Anti-Patterns to Avoid

1. Cold-prompting on page load (current admin bug)
2. Using "Allow" as CTA label (duplicates browser dialog)
3. Re-prompting more than twice automatically
4. Blocking content behind the permission ask
5. Re-asking within same session after dismissal
6. Hiding the skip/dismiss option
7. Sending >2-3 push notifications per day per guest
8. Showing push UI after checkout date

---

## PART 3: NOTIFICATION CENTER & SETTINGS UX

### 3.1 Guest Notification Settings

**Location:** Linked from the "Alerts" tab in bottom nav (already exists at `/g/[code]/notification-settings`)

```
┌──────────────────────────────────────────────┐
│ < Alerts         Notification Settings       │
├──────────────────────────────────────────────┤
│                                              │
│ [GREEN CARD if enabled / AMBER if denied]    │
│  Push notifications: enabled/disabled        │
│  [Enable Notifications] (if denied)          │
│                                              │
│ NOTIFICATION TYPES                           │
│                                              │
│  [amber]  Parking Alerts            [ON]     │
│  [teal]   Laundry Status            [ON]     │
│  [indigo] Host Announcements   REQUIRED      │
│  [rose]   Community Posts           [ON]     │
│  [red]    Maintenance Updates       [ON]     │
│                                              │
│ ───────────────────────────────────────────  │
│  [gray]   Send a test notification           │
│           [Send Test]                        │
│                                              │
│ Even with push off, all alerts appear in     │
│ your Notifications tab inside the app.       │
└──────────────────────────────────────────────┘
```

### 3.2 Category Mutability

| Category | Key | Toggleable | Who Receives | Rationale |
|----------|-----|-----------|--------------|-----------|
| Parking Alerts | `parking_alert` | Yes | All active guests | Some guests don't have cars |
| Laundry Status | `laundry_available` | Yes | All active guests | Convenience |
| Host Announcements | `broadcast` | **No** | All active guests | Safety/operations |
| Community Posts | (future) | Yes | All active guests | Optional social |
| Maintenance Updates | `maintenance_update` | Yes (default on) | Requesting guest | Guest can check in-app |
| Messages | `host_reply` | **No** | Specific guest | Core communication |
| Cleaning Updates | `cleaning_assigned` | Yes | Assigned cleaner | Staff convenience |
| Operational Alerts | `maintenance_created` | **No** (staff) | Admin + cohost | Core workflow |

### 3.3 Admin Notification Inbox

Create `/admin/notifications/page.js` — unified inbox showing maintenance, messages, community, and cleaning notifications. Add bell icon with unread badge to admin header.

### 3.4 Guest Notification Center

Already exists at `/g/[code]/notifications` with `NotificationCenter.js`. Real-time listener on `user_notifications/{uid}/items`. Unread badges on bottom nav "Alerts" tab.

---

## PART 4: REQUIRED NOTIFICATION FLOWS (Event-to-Recipient Matrix)

| # | Event | Trigger File | Replace | Recipients | Channel |
|---|-------|-------------|---------|------------|---------|
| 1 | Admin Broadcast | `api/notifications/broadcast` | `broadcastToActiveGuests()` → `notificationService.send({ eventType: 'broadcast' })` | All active guests | FCM + in-app |
| 2 | Parking Alert | `api/community` (type=parking) | `broadcastToActiveGuests()` → `notificationService.send({ eventType: 'parking_alert' })` | All active guests | FCM + in-app |
| 3 | Guest Message | `api/messages/notify` | `notifyAdminAndCohost()` → `notificationService.send({ eventType: 'guest_message' })` | Admin + cohosts | FCM + in-app |
| 4 | Host Reply | `api/messages/notify` | `sendNotification()` → `notificationService.send({ eventType: 'host_reply' })` | Single guest | FCM + in-app |
| 5 | Maintenance Created | `api/maintenance` POST | `notifyAdminAndCohost()` → `notificationService.send({ eventType: 'maintenance_created' })` | Admin + cohosts | FCM + in-app |
| 6 | Maintenance Update | `api/maintenance/[id]` PATCH | `sendDirectMessage()` → `notificationService.send({ eventType: 'maintenance_update' })` | Single guest | FCM + in-app |
| 7 | Laundry: Someone Waiting | `api/laundry/waitlist` POST | `sendPushOnly()` → `notificationService.send({ eventType: 'laundry_owner_nudge' })` | Session owner | FCM + in-app |
| 8 | Laundry: Machine Free | `lib/laundry.js` notifyWaitlist | `sendNotification()` → `notificationService.send({ eventType: 'laundry_available' })` | Waitlist guests | FCM + in-app |
| 9 | Cleaning Assigned | `api/cleaning/jobs` POST | **NEW** — add `notificationService.send({ eventType: 'cleaning_assigned' })` | Assigned cleaner | FCM + in-app |
| 10 | Cleaning Reassigned | `api/cleaning/jobs/[id]` PATCH | **NEW** — add when `assigneeId` changes | New assignee | FCM + in-app |
| 11 | Cleaning Status | `api/cleaning/jobs/[id]` PATCH | **NEW** — add when cleaner updates status | Admin + cohosts | FCM + in-app |

---

## PART 5: RELIABILITY & DELIVERY HARDENING

### 5.1 Token Lifecycle

- **Registration**: `usePush.js` writes `fcm_tokens/{token}` with `bookingCode`, `staffId`, `role`, `createdAt`, `updatedAt`, `userAgent`
- **Auto-refresh**: On every mount, `refreshRegistration()` re-writes identity fields (fixes current rotation bug)
- **Deduplication**: After registering new token, delete old tokens for same identity (prevents stale accumulation)
- **Stale cleanup**: On send failure with `messaging/registration-token-not-registered`, batch-delete stale docs (awaited, not fire-and-forget)
- **TTL cleanup**: Scheduled Cloud Function deletes tokens with `updatedAt > 90 days`
- **Booking expiry**: When booking status changes to `cancelled`, delete associated tokens

### 5.2 Delivery Logging

**Collection:** `notification_log/{auto-id}`

```javascript
{
  eventType, title, body, sentBy, context,
  pushCount, inAppCount, failedCount, totalRecipients,
  logEntries: [
    { recipientUid, method: 'push'|'in_app_only'|'push_failed', reason?, error? }
  ],
  createdAt: ISO string,
}
```

### 5.3 Quiet Hours

- **Current**: Suppresses silently, notification lost forever
- **New**: Writes in-app record with `status: 'queued_quiet_hours'`, no push
- Quiet hours only apply to **deferrable** events (laundry, cleaning status, maintenance update)
- **Immediate** events (broadcast, parking, messages, maintenance created) ignore quiet hours

### 5.4 Click Routing (Service Worker)

The service worker resolves click URL from `fcmOptions.link` (set server-side):

| Event Type | Guest URL | Staff URL |
|-----------|-----------|-----------|
| laundry_available | `/g/{code}/laundry` | — |
| maintenance_update | `/g/{code}/maintenance` | — |
| host_reply | `/g/{code}/messages` | — |
| broadcast/parking | `/g/{code}` | — |
| guest_message | — | `/admin/messages` |
| maintenance_created | — | `/admin/maintenance` |
| cleaning_* | — | `/admin/cleaning` |

### 5.5 Multi-Device Support

- Multiple tokens per identity are allowed (phone + tablet)
- All tokens for a recipient receive the notification
- Tag-based grouping in service worker prevents duplicate notification drawer entries
- Deduplication only removes tokens for the same identity when a **new** token is registered

---

## PART 6: TWILIO REMOVAL PLAN

### 6.1 Critical Finding

**Twilio OTP is NOT used in production.** The live auth flow uses Firebase Phone Auth exclusively (`PhoneStep.js` → `signInWithPhoneNumber()` → `confirmationResult.confirm()`). The legacy Twilio OTP endpoints (`/api/guests/verify`, `/api/guests/confirm`) are dead code.

This makes removal significantly safer.

### 6.2 File-by-File Removal Plan

#### Immediate Deletions (Zero Risk)

| File | Action | Reason |
|------|--------|--------|
| `lib/twilio.js` | **DELETE** | All functions replaced or unused |
| `app/api/guests/verify/route.js` | **DELETE** | Dead code — Firebase Phone Auth used instead |
| `app/api/guests/confirm/route.js` | **DELETE** | Dead code — Firebase Phone Auth used instead |

#### Modifications Required (Remove SMS Fallback)

| File | Lines | Change |
|------|-------|--------|
| `lib/notifications.js` | 3 | Remove `import { sendSMS } from '@/lib/twilio'` |
| `lib/notifications.js` | 62-66 | Remove phone number detection in `sendNotification()` |
| `lib/notifications.js` | 146-147, 199-209 | Remove `smsTargets` array and SMS loop in `broadcastToActiveGuests()` |
| `lib/notifications.js` | 278-320 | Remove SMS fallback in `sendDirectMessage()` |
| `lib/staff-notifications.js` | 3 | Remove `import { sendSMS } from '@/lib/twilio'` |
| `lib/staff-notifications.js` | 69-87 | Remove SMS fallback block in `notifyStaff()` |
| `app/api/messages/notify/route.js` | 109 | Remove `sendNotification({ to: guest.phone })` SMS path |

**Note:** These modifications become unnecessary if using the centralized `notificationService.send()` — the new service has no SMS path. The modification approach is for incremental migration.

#### UI Text Updates

| File | Change |
|------|--------|
| `components/guest/AccessCodes.js` | Line 211: Replace `sms:` link with email or maintenance request link |
| `components/guest/CheckInGuide.js` | Line 157: Replace `sms:` link with email or maintenance request link |
| `lib/help-articles.js` | Lines 16, 22: Remove "via SMS" references |

#### Configuration Cleanup

| File | Change |
|------|--------|
| `.env.local` | Delete `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| `.env.example` | Delete Twilio section |
| `package.json` | `npm uninstall twilio` |
| `CLAUDE.md` | Remove Twilio references (lines 17, 65-66, 91, 93) |
| `GETTING-STARTED.md` | Remove Twilio setup instructions (lines 13, 66-76, 96-97, 143-144) |

### 6.3 Safe Migration Order

1. **Validate Firebase Phone Auth is the only auth path** (confirmed: `PhoneStep.js` handles all OTP)
2. **Create `lib/otp.js`** — extract `generateOTP()` and `verifyOTP()` as pure functions (no Twilio dep)
3. **Build `notificationService.send()`** — new service has no SMS, only FCM + in-app
4. **Migrate all API routes** to use `notificationService.send()` instead of old helpers
5. **Delete old helpers** — `lib/notifications.js`, `lib/staff-notifications.js`
6. **Delete `lib/twilio.js`** and dead OTP endpoints
7. **Update UI text** — remove SMS links and references
8. **Remove env vars and package dependency**
9. **Update documentation**

---

## PART 7: QA VALIDATION PLAN

### 7.1 Testing Framework Setup

**No test infrastructure exists.** Recommend:
- **Framework**: Vitest (faster than Jest, native ESM, Next.js compatible)
- **Mocking**: `vi.mock()` for Firebase Admin SDK, FCM messaging
- **React hooks**: `@testing-library/react-hooks` for `usePush.js`
- **File convention**: `*.test.js` co-located with source files

### 7.2 Unit Tests Required

| Module | Function | Key Test Cases |
|--------|----------|---------------|
| `notification-service.js` | `send()` | Active guests only, preference filtering, quiet hours queueing, cooldown guard, stale token cleanup, in-app record always created |
| `notification-templates.js` | `buildNotification()` | Each event type produces correct title/body, context variables interpolated, body truncated to 100 chars |
| `notification-recipients.js` | `resolveRecipients()` | Each event type returns correct recipient descriptors, empty arrays for missing context |
| `notification-prefs.js` | `isAllowedByPrefs()` | Enforced prefs always true, mutable prefs respect toggle |
| `notification-prefs.js` | `isQuietHours()` | Boundary times (10PM, 8AM), disabled quiet hours, spans midnight |
| `usePush.js` | `requestPermission()` | Token stored with identity fields, stale tokens deduplicated, denied state handled |
| `usePush.js` | `refreshRegistration()` | Identity fields re-written on every refresh |

### 7.3 Integration Tests Required

| Route | Test |
|-------|------|
| `POST /api/maintenance` | Verify `notificationService.send(MAINTENANCE_CREATED)` called with correct context |
| `PATCH /api/maintenance/[id]` | Verify guest notified with `MAINTENANCE_UPDATE` when response provided |
| `POST /api/community` (parking) | Verify `PARKING_ALERT` broadcast, cooldown respected |
| `POST /api/laundry/waitlist` | Verify owner nudge on first waiter only |
| `POST /api/laundry/end` | Verify waitlist notified with `LAUNDRY_AVAILABLE` |
| `POST /api/messages/notify` | Verify correct direction (guest→staff or staff→guest) |
| `POST /api/cleaning/jobs` | Verify cleaner notified with `CLEANING_ASSIGNED` |
| `PATCH /api/cleaning/jobs/[id]` | Verify reassignment and status change notifications |
| `GET /api/notifications/preferences` | Returns defaults merged with stored prefs |
| `PATCH /api/notifications/preferences` | Enforced prefs cannot be disabled |

### 7.4 End-to-End Push Validation Checklist

- [ ] Token registration: guest grant → token in `fcm_tokens` with `bookingCode`
- [ ] Token registration: staff grant → token in `fcm_tokens` with `staffId`
- [ ] Permission denied → no token written, in-app fallback only
- [ ] Foreground: notification shows via service worker (not `new Notification()`)
- [ ] Background: notification shows via `onBackgroundMessage`
- [ ] Click: guest notification → opens correct `/g/{code}/...` page
- [ ] Click: staff notification → opens correct `/admin/...` page
- [ ] Multiple devices: both receive notification
- [ ] Token refresh: identity fields preserved after rotation
- [ ] Stale token: cleaned up after failed send
- [ ] Booking cancelled: tokens no longer targeted

### 7.5 Browser/Device Matrix

| Browser | Push? | Token Reg? | Foreground? | Background? | Click? |
|---------|-------|-----------|-------------|-------------|--------|
| Chrome Android | Yes | Yes | Yes | Yes | Yes |
| Safari iOS (PWA installed) | Yes (16.4+) | Yes | Yes | Yes | Yes |
| Safari iOS (not installed) | **No** | No | No | No | — |
| Chrome Desktop | Yes | Yes | Yes | Yes | Yes |
| Firefox Desktop | Yes | Yes | Yes | Yes | Yes |
| Samsung Internet | Yes | Yes | Yes | Yes | Yes |

### 7.6 Permission Scenarios

- [ ] `default` → grant → full flow works
- [ ] `default` → deny → in-app only, "how to re-enable" card shown
- [ ] `default` → dismiss → re-prompt at 24h and 48h, then settings only
- [ ] `denied` → no re-prompt, settings page shows browser instructions
- [ ] iOS not-installed → install prompt shown, no push explainer
- [ ] iOS installed → push explainer shown normally

### 7.7 Edge Cases

- [ ] Guest with 2 devices → both get notification, tag deduplicates drawer
- [ ] Guest checkout (booking cancelled) → no more notifications
- [ ] Staff deactivated → no more notifications
- [ ] Quiet hours → deferrable event: in-app record, no push
- [ ] Quiet hours → immediate event: push sent regardless
- [ ] Race: 2 guests join waitlist simultaneously → owner notified once (use transaction)
- [ ] Broadcast to 0 active guests → success with counts=0
- [ ] Category toggled off → in-app record with `status: 'in_app_only'`, no push

---

## PART 8: PHASED IMPLEMENTATION ROADMAP

### Phase 1: Prove FCM Works (Priority 1)

**Goal:** Fix critical bugs so push is reliable end-to-end.

| Task | File(s) | Effort | Impact |
|------|---------|--------|--------|
| Fix token auto-refresh to preserve `bookingCode`/`staffId` | `hooks/usePush.js` | 1h | Critical |
| Fix service worker click routing by event type | `public/firebase-messaging-sw.js` | 2h | Critical |
| Fix foreground handler to use service worker | `hooks/usePush.js` | 1h | High |
| Wire push opt-in into get-started page | `app/g/[code]/get-started/page.js` | 2h | High |
| Fix admin cold-prompt with explainer | `app/admin/layout.js` | 1h | High |

### Phase 2: Build Centralized Service + Remove Twilio (Priority 1)

**Goal:** Single notification entry point, SMS removed.

| Task | File(s) | Effort | Impact |
|------|---------|--------|--------|
| Create `notification-templates.js` | New file | 2h | Foundation |
| Create `notification-recipients.js` | New file | 2h | Foundation |
| Create `notification-prefs.js` | New file | 2h | Foundation |
| Create `notification-service.js` | New file | 4h | Critical |
| Create `lib/otp.js` (extract from twilio) | New file | 30m | Cleanup |
| Create preferences API routes | `api/notifications/preferences/` | 2h | High |
| Create inbox API routes | `api/notifications/inbox/` | 2h | High |
| Migrate all 11 API routes to `notificationService.send()` | 11 files | 4h | Critical |
| Delete `lib/twilio.js`, dead OTP routes | 3 files | 30m | Cleanup |
| Delete `lib/notifications.js`, `lib/staff-notifications.js` | 2 files | 30m | Cleanup |
| Remove Twilio env vars, package dep, docs | Config files | 1h | Cleanup |
| Update UI SMS links | 2 components + help articles | 1h | Low |

### Phase 3: Notification Settings + Push Enablement UX (Priority 2)

**Goal:** Users can manage preferences, strong but clean push opt-in.

| Task | File(s) | Effort | Impact |
|------|---------|--------|--------|
| Build pre-permission explainer with mock preview | `PushPermissionExplainer.js` | 3h | High |
| Build multi-step re-prompt logic | `PushPermissionGate.js` | 2h | Medium |
| Build contextual push banners (laundry, maintenance, community) | New component | 3h | Medium |
| Build persistent home screen reminder banner | `app/g/[code]/page.js` | 1h | Medium |
| Wire notification settings to preferences API | `NotificationSettings.js` | 2h | High |
| Add test notification button | Settings page + API | 1h | Low |
| Build admin notification inbox | New page | 4h | Medium |
| Add unread badges to admin nav | Admin layout | 2h | Medium |

### Phase 4: Reliability + Analytics (Priority 3)

**Goal:** Production-grade delivery tracking and cleanup.

| Task | File(s) | Effort | Impact |
|------|---------|--------|--------|
| Token TTL cleanup Cloud Function (90-day) | `functions/tokenCleanup.js` | 2h | Medium |
| Clean tokens on booking cancellation | `api/bookings/[id]` | 1h | Medium |
| Await stale token batch.commit() | `notification-service.js` | 30m | Low |
| Delivery status dashboard for admin | Admin page | 4h | Low |
| Set up Vitest + Firebase mocks | Config files | 3h | High |
| Write unit tests for notification service | Test files | 8h | High |
| Write integration tests for API routes | Test files | 6h | High |

---

## Summary: Top 10 Actions Ranked by Impact x Effort

| Rank | Action | Impact | Effort |
|------|--------|--------|--------|
| 1 | Fix token auto-refresh identity fields | Critical | 1h |
| 2 | Fix service worker click routing | Critical | 2h |
| 3 | Build `notificationService.send()` centralized service | Critical | 4h |
| 4 | Wire push opt-in into get-started page | High | 2h |
| 5 | Delete `lib/twilio.js` + dead OTP routes | High | 30m |
| 6 | Migrate API routes to centralized service | High | 4h |
| 7 | Add missing cleaning job notifications | High | 2h |
| 8 | Build notification preferences API | High | 2h |
| 9 | Fix admin cold-prompt with explainer | High | 1h |
| 10 | Create in-app notification inbox API | Medium | 2h |
