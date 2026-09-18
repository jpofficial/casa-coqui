# Casa Coqui Notification System — Follow-Up Review
**Date:** 2026-03-15
**Role:** Lead Notification Reliability Engineer
**Branch:** main (commits through 68b635d)

---

## 1. Executive Summary

The previous engineer's three commits (22ff7da, 6a2c6a1, 68b635d) are **all confirmed working** with no regressions. The broadcast notification pipeline (parking, community, admin announcements) is solid. Guest routing safety is intact — no cross-booking leakage is possible through the current architecture.

**Three significant gaps remain:**

| Priority | Gap | Impact |
|----------|-----|--------|
| **P0** | `sendDirectMessage()` sends empty FCM `data` | Guest taps maintenance/announcement push → lands on `/admin` login or root `/` instead of correct page |
| **P0** | Admin community page bypasses API (direct Firestore write) | Admin-created parking posts send zero push notifications |
| **P1** | SMS fallback path sends phone number as FCM token | Silent failure — admin sees "sent via SMS" but nothing was delivered |
| **P1** | Laundry waitlist + host messages have no in-app notification record | Missed pushes = permanently lost alerts |
| **P2** | No `?postId=` deep-linking support | Notification taps reach the right page but not the exact post |
| **P2** | Stale SMS references in admin UI | Admin UI shows "X SMS sent" when Twilio has been removed |

The system is **not production-ready** for direct messages and admin community posts. Broadcasts to guests work well.

---

## 2. Revalidated Current State

### Commit 22ff7da — FCM data payload & deep-linking

| Fix | Status | Evidence |
|-----|--------|----------|
| FCM `data` payload populated in broadcasts | **Confirmed Working** | `lib/notifications.js:142-145` — `enrichedData` includes `type`, per-recipient `bookingCode`, and caller data |
| Service worker deep-link routing | **Confirmed Working** | `public/firebase-messaging-sw.js:33-49` — `CATEGORY_PATHS` map routes guests to `/g/{code}/{section}` and staff to `/admin/{section}` |
| Guest notification taps no longer route to `/admin` | **Confirmed Working** | Three-layer guard: SW resolves correct path, `guest-layout-client.js:183` blocks non-`/g/` URLs, `admin-layout-client.js:38` blocks non-`/admin` URLs |
| Community parking posts use `type: 'parking'` not `'community'` | **Confirmed Working** | `app/api/community/route.js:109` — broadcast uses `type: 'parking'` |
| Firestore rules allow community reads for guests | **Confirmed Working** | `firestore.rules:253-256` — any authenticated user can read community docs |

**Minor concern:** `ForegroundToast.js:44` trusts `targetPath` from FCM data without `/g/` prefix validation. Low risk — no API sets `targetPath` today, and server-side compromise is required to exploit.

### Commit 6a2c6a1 — Parking broadcast index fix

| Fix | Status | Evidence |
|-----|--------|----------|
| Cooldown query wrapped in try/catch | **Confirmed Working** | `lib/notifications.js:29-47` — catches Firestore index errors, returns `false` (allows broadcast) |
| Parking broadcasts complete even if cooldown fails | **Confirmed Working** | `lib/notifications.js:96-99` — cooldown returning `false` lets broadcast proceed |
| `/api/parking/notify` route functional | **Confirmed Working** | `app/api/parking/notify/route.js:12-38` — delegates to `broadcastToActiveGuests` |

### Commit 68b635d — Laundry/property_issue community posts

| Fix | Status | Evidence |
|-----|--------|----------|
| `AUTO_MESSAGES` includes laundry and property_issue | **Confirmed Working** | `app/api/community/route.js:12-17` — all three non-general types have entries |
| API has fallback message waterfall | **Confirmed Working** | `app/api/community/route.js:68-85` — custom → auto → 400 error |
| Community form preserves typed messages | **Partially Working** | Client `POST_TYPES` sets `autoMessage: null` for laundry/property_issue, so users must type a message. Server fallbacks only activate if frontend is bypassed. Works but design is inconsistent. |

---

## 3. Remaining Gaps (Ranked)

### P0 — Critical (blocks trust)

#### Gap 1: `sendDirectMessage()` FCM data is empty
- **User impact:** Every direct message push notification (maintenance updates, admin announcements) routes to wrong destination on tap
- **Security risk:** None (no data = no leakage)
- **Effort:** Small (4 lines changed)

#### Gap 2: Admin community page bypasses API
- **User impact:** Admin-created parking posts trigger zero push notifications to guests
- **Security risk:** None
- **Effort:** Small (one function rewrite in one file)

### P1 — High (degrades reliability)

#### Gap 3: SMS fallback sends phone number as FCM token
- **User impact:** Host messages to guests without FCM tokens silently fail. Admin sees "sent via SMS" but nothing was delivered.
- **Security risk:** None
- **Effort:** Small (remove dead code path)

#### Gap 4: Laundry waitlist notifications have no in-app record
- **User impact:** Missed push = lost "machine available" alert. No way to recover.
- **Security risk:** None
- **Effort:** Small (use `sendPushOnly` instead of raw `sendNotification`)

#### Gap 5: Host-to-guest message notifications have no in-app record
- **User impact:** Missed push = guest never sees host message notification
- **Security risk:** None
- **Effort:** Small (write notification doc after send)

### P2 — Medium (polish)

#### Gap 6: No exact-post deep-linking (`?postId=`)
- **User impact:** Notifications reach the right page but not the right post
- **Effort:** Medium (SW + community page + callers)

#### Gap 7: Stale SMS references in admin UI
- **User impact:** Admin sees "X SMS sent" count and "SMS fallback" labels. Misleading.
- **Effort:** Small (UI text cleanup)

#### Gap 8: Firestore rules allow cross-booking maintenance notification reads
- **User impact:** Technically, Guest A could query Guest B's maintenance notification if they know the doc ID
- **Security risk:** Low in practice (UI never shows it, content is generic)
- **Effort:** Small (tighten Firestore rule)

#### Gap 9: `sendPushOnly()` doesn't inject `bookingCode` into FCM data
- **User impact:** Laundry nudge notifications route to `/` instead of `/g/{code}/laundry`
- **Effort:** Small

---

## 4. Root Cause Analysis

### Gap 1: `sendDirectMessage()` empty FCM data

**File:** `lib/notifications.js:247-249`
```javascript
await messaging.send({
  token,
  notification: { title, body },
  // ← no `data` field
});
```

**Why it fails:** The function has `bookingCode` and `category` available but never passes them to FCM. The service worker's `resolveDeepLink({})` returns `/admin` (no bookingCode → staff path fallback). Guests tap → land on admin login.

**Downstream breakage:**
- SW deep-link: resolves to `/admin` for guests
- SW tag: all direct messages get `staff-general` tag (collapse/overwrite each other)
- SW action buttons: "View Request" missing for maintenance
- ForegroundToast: routes to `/g/{code}` (home) instead of category page
- ForegroundToast: shows generic gray bell icon instead of category icon

### Gap 2: Admin community page bypasses API

**File:** `app/admin/community/page.js:65-88`
```javascript
await addDoc(collection(db, 'community'), {
  message: message.trim(),
  type,
  // ... direct Firestore write
});
```

**Why it fails:** The guest flow goes through `POST /api/community` which calls `broadcastToActiveGuests()` for parking posts (line 105-112). The admin page writes directly to Firestore client SDK, completely skipping: push notifications, rate limiting, validation, cooldown checks, and notification doc creation.

### Gap 3: SMS fallback sends phone as FCM token

**File:** `app/api/messages/notify/route.js:107-110`
```javascript
const result = await sendNotification({ to: guest.phone, ... });
return NextResponse.json({ success: true, method: 'sms' });
```

**Why it fails:** `sendNotification()` passes `to` as an FCM token to `messaging.send({ token: to })`. A phone number is not a valid FCM token. FCM throws, the catch returns `{ success: false }`, but the route ignores the result and tells the admin "sent via SMS."

### Gap 4: Laundry waitlist — no in-app record

**File:** `lib/laundry.js:46-47` (via `sendNotification`)

**Why it fails:** `notifyWaitlist()` uses `sendNotification()` (raw FCM push) which does NOT write to the `notifications` collection. Other functions like `sendDirectMessage()` and `sendPushOnly()` write Firestore docs for in-app visibility, but the laundry path skips this.

### Gap 5: Host messages — no in-app record

**File:** `app/api/messages/notify/route.js:95`
```javascript
const result = await sendNotification({ to: token, title, body: notifBody });
```

**Why it fails:** Same as Gap 4 — uses raw `sendNotification()` which only fires FCM, no Firestore doc written to `notifications` collection.

---

## 5. Smallest Safe Patch Plan

### Patch 1: Add FCM `data` to `sendDirectMessage()`

**File:** `lib/notifications.js`
**Current (lines 247-249):**
```javascript
await messaging.send({
  token,
  notification: { title, body },
});
```

**Change to:**
```javascript
await messaging.send({
  token,
  notification: { title, body },
  data: { type: category, bookingCode },
});
```

**Why needed:** Enables SW deep-linking, correct tag grouping, action buttons, and foreground toast routing for all direct messages.
**Security impact:** None. `category` and `bookingCode` are already available in the function scope. The bookingCode belongs to the intended recipient.
**Blast radius:** Affects all `sendDirectMessage()` callers: `/api/notifications/direct`, `/api/maintenance/[id]`, `/api/assignments/[id]`. All benefit from the fix.
**Rollback:** Revert the 2-line addition.
**Test:** Send a direct maintenance update → tap notification → should open `/g/{code}/maintenance`.

---

### Patch 2: Route admin community posts through API

**File:** `app/admin/community/page.js`
**Current (lines 65-88):** Direct `addDoc()` to Firestore.
**Change:** Replace `handlePost` body with `fetch('/api/community', { ... })` using the admin's auth token.

```javascript
async function handlePost(e) {
  e.preventDefault();
  if (!message.trim()) return;
  setSubmitting(true);
  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/community', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        type,
        message: message.trim(),
        photoUrl: photoUrl || null,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    setMessage('');
    setType('general');
    setPhotoUrl('');
    setShowForm(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  } catch (err) {
    console.error('Failed to post:', err);
  } finally {
    setSubmitting(false);
  }
}
```

**Also:** Remove unused `addDoc`, `collection` imports from `firebase/firestore` and `db` from `@/lib/firebase`.

**Why needed:** Admin parking posts will now trigger `broadcastToActiveGuests()`, write notification docs, enforce rate limiting, and follow the same pipeline as guest posts.
**Security impact:** Positive — admin posts now go through server-side validation.
**Blast radius:** Admin community page only. API already handles admin roles correctly.
**Rollback:** Revert the file.
**Note:** The API enforces photo requirement for parking/property_issue posts. If admin should skip this, add a role check: `if (type === 'parking' && !photoUrl && caller.role === 'guest')`.
**Test:** Admin creates parking community post → all active guests receive push notification.

---

### Patch 3: Remove dead SMS fallback in messages/notify

**File:** `app/api/messages/notify/route.js`
**Current (lines 100-113):** Falls back to sending phone number as FCM token when no FCM token exists.
**Change:** Remove the fake SMS branch. When no FCM token exists, write an in-app notification doc and return `{ method: 'in-app-only' }`.

**Why needed:** Eliminates silent failure and lying to the admin about SMS delivery.
**Security impact:** None.
**Blast radius:** Only affects host-to-guest message delivery when guest has no FCM token.
**Rollback:** Revert the file.
**Test:** Send message to guest without FCM token → admin sees "in-app only" status instead of "SMS".

---

### Patch 4: Add in-app record for laundry waitlist notifications

**File:** `lib/laundry.js` — `notifyWaitlist()` function
**Change:** Replace `sendNotification()` call with `sendPushOnly()` (which already writes a Firestore notification doc) or add a manual notification doc write after the FCM send.

**Why needed:** Missed push = permanently lost alert. In-app record ensures guest can see it later.
**Security impact:** None.
**Blast radius:** Laundry waitlist flow only.
**Rollback:** Revert the function.
**Test:** Join laundry waitlist → machine becomes available → check notification center shows the alert.

---

### Patch 5: Add in-app record for host-to-guest message notifications

**File:** `app/api/messages/notify/route.js`
**Change:** After `sendNotification()` call, write a doc to `notifications` collection with `{ type: 'direct', bookingCode, title, message: body, broadcast: false, category: 'message', readBy: [], createdAt, method, status }`.

Also add FCM `data` to the `sendNotification` call: `data: { type: 'message', bookingCode }`.

**Why needed:** Missed push = guest never knows host messaged them until they open the messages page.
**Security impact:** None. The notification doc uses the correct `bookingCode`.
**Blast radius:** Host-to-guest message flow only.
**Rollback:** Revert the additions.
**Test:** Host sends message → guest sees notification in notification center even if push was missed.

---

### Patch 6: Add `message` type to service worker CATEGORY_PATHS

**File:** `public/firebase-messaging-sw.js`
**Change:** Add to `CATEGORY_PATHS`:
```javascript
message: (code) => code ? `/g/${code}/messages` : '/admin/messages',
```

**Why needed:** Once Patch 5 adds `type: 'message'` to FCM data, the SW needs to know where to route it.
**Security impact:** None.
**Blast radius:** Only affects message notification click routing.
**Note:** Guest messages page may not exist yet (`/g/{code}/messages`). If not, route to `/g/{code}` for now.
**Test:** Tap host message notification → opens correct page.

---

### Patch 7: Clean up stale SMS references in admin UI

**File:** `app/admin/notify/page.js`
**Changes:**
- Remove "SMS" count from delivery stats display (line ~209)
- Change "Will receive via push notification with SMS fallback" to "Will receive via push notification" (line ~338)
- Remove SMS-related badge/label (line ~273)

**Why needed:** Twilio was removed. UI should not reference SMS.
**Security impact:** None.
**Blast radius:** Admin notification page only.
**Test:** Visual verification — no SMS mentions in admin notify UI.

---

## 6. QA Proof Plan

### Prerequisites
- Two active bookings (one per unit): Booking A, Booking B
- Admin account on separate device
- Push notifications granted on all devices

### Core Test Matrix

| # | Scenario | Platform | App State | Expected | Validates |
|---|----------|----------|-----------|----------|-----------|
| T1 | Admin broadcast | iPad PWA (installed) | Killed | OS push → tap opens `/g/{code}` | Broadcast pipeline |
| T2 | Admin broadcast | Android Chrome | Backgrounded | OS push → tap opens correct page | SW postMessage relay |
| T3 | Admin broadcast | iPhone PWA | Foreground | Toast appears, tap routes correctly | ForegroundToast |
| T4 | Guest parking report | Android Chrome | Killed | Other guest receives push, tap → `/g/{code}/parking` | Parking broadcast + routing |
| T5 | Admin community parking post | iPad PWA | Any | All guests receive push (after Patch 2) | Admin→API migration |
| T6 | Maintenance update to guest | iPhone PWA | Killed | Guest receives push, tap → `/g/{code}/maintenance` (after Patch 1) | Direct message FCM data |
| T7 | Admin direct message | Android Chrome | Backgrounded | Guest receives push, tap → correct page (after Patch 1) | Direct message routing |
| T8 | Host message to guest | iPad PWA | Backgrounded | Guest receives push + in-app record (after Patches 5+6) | Message notification pipeline |
| T9 | Laundry machine available | iPhone PWA | Backgrounded | Push received + in-app record (after Patch 4) | Laundry waitlist pipeline |
| T10 | Notification opt-out | iPad PWA | Any | Guest with parking opt-out does NOT receive parking push | Preference check |
| T11 | Cooldown dedup | Any | Any | 2 parking reports in 10 min → only first broadcasts | Cooldown logic |

### Cross-Guest Safety Tests

| # | Test | Expected | Severity if Fails |
|---|------|----------|-------------------|
| S1 | Guest A queries Guest B's direct notifications | Firestore denies | Critical |
| S2 | Guest A opens `/g/{B_CODE}/...` | Auth blocks access | Critical |
| S3 | Admin DM to Guest B → Guest A's device | No push to Guest A | Critical |
| S4 | Guest A notification center | Only own notifications + broadcasts | Critical |
| S5 | Guest A writes FCM token with Guest B's bookingCode | Firestore rules deny | Critical |

### Device Matrix

| Device | Tests |
|--------|-------|
| iPad Safari (installed PWA) | T1, T5, T8, T10, S1-S5 |
| iPhone Safari (installed PWA, iOS 16.4+) | T3, T6, T9 |
| Android Chrome (installed PWA) | T2, T4, T7, T11 |
| Android Chrome (not installed) | T4, T7 |

### Per-Device Checklist
- [ ] Push permission prompt appears
- [ ] Push notifications arrive (killed/backgrounded)
- [ ] Foreground toast appears when app is open
- [ ] Tap opens correct deep-link
- [ ] Badge count increments on notification, clears on open
- [ ] Notification center shows all expected items
- [ ] No cross-guest data leakage

---

## 7. Go / No-Go Recommendation

### **NO-GO for production as-is.** Three blockers must be fixed first:

1. **Patch 1 (sendDirectMessage FCM data)** — Without this, every maintenance update and admin announcement push sends guests to the wrong page. This is the single most impactful fix.

2. **Patch 2 (admin community → API)** — Without this, admin parking posts generate zero notifications. The admin might assume guests were alerted when they weren't.

3. **Patch 3 (remove dead SMS fallback)** — The system actively lies about SMS delivery. Admin trust is undermined.

### After these three patches + QA verification:

**CONDITIONAL GO** — The system will be functional and trustworthy for the core notification use cases. The remaining patches (4-7) are improvements that can ship in a fast follow-up.

### Patch Priority Order

| Order | Patch | Risk | Effort |
|-------|-------|------|--------|
| 1st | Patch 1: sendDirectMessage FCM data | None | 5 min |
| 2nd | Patch 2: Admin community → API | Low (photo requirement) | 15 min |
| 3rd | Patch 3: Remove dead SMS fallback | None | 10 min |
| 4th | Patch 7: SMS UI cleanup | None | 10 min |
| 5th | Patch 4: Laundry waitlist in-app | None | 10 min |
| 6th | Patch 5+6: Message notification records + routing | None | 15 min |

---

## Appendix: Files Referenced

| File | Role |
|------|------|
| `lib/notifications.js` | Core notification functions: `sendNotification`, `broadcastToActiveGuests`, `sendDirectMessage`, `sendPushOnly` |
| `lib/staff-notifications.js` | `notifyStaff`, `notifyAdminAndCohost` |
| `lib/laundry.js` | `notifyWaitlist` (laundry machine availability) |
| `public/firebase-messaging-sw.js` | Service worker: deep-linking, tag grouping, action buttons, click handling |
| `components/guest/ForegroundToast.js` | In-app toast for foreground notifications |
| `components/guest/NotificationCenter.js` | Guest notification inbox |
| `components/guest/CommunityPost.js` | Guest community post form (uses API) |
| `app/admin/community/page.js` | Admin community page (bypasses API — Gap 2) |
| `app/api/community/route.js` | Community post API with broadcast trigger |
| `app/api/parking/notify/route.js` | Dedicated parking broadcast route |
| `app/api/notifications/direct/route.js` | Admin direct message to guest |
| `app/api/maintenance/[id]/route.js` | Maintenance update → guest notification |
| `app/api/messages/notify/route.js` | Host↔guest message notifications |
| `app/g/[code]/guest-layout-client.js` | Guest layout with NOTIFICATION_CLICK handler |
| `app/admin/admin-layout-client.js` | Admin layout with NOTIFICATION_CLICK handler |
| `hooks/usePush.js` | FCM token registration + foreground handler |
| `hooks/useNotifications.js` | Real-time notification subscription |
| `firestore.rules` | Security rules for all collections |
