# Guest Entry Flow Fixes — 2026-03-19

## Overview

Four interrelated problems were fixed in the guest entry flow. All stem from the same architectural reality: guests use Firebase Anonymous Auth, and the PWA can launch in a different browser context than the one where the guest originally checked in.

---

## Problem 1: Repeated Sign-In After Save-to-Home-Screen

### Root Cause

Guest checks in via an in-app browser (e.g., tapping the booking link in WhatsApp or iMessage opens an in-app browser — WebKit on iOS, Chrome Custom Tab on Android). The anonymous Firebase auth session is stored in IndexedDB within that browser's storage partition.

When the guest saves the app to their home screen and launches the PWA, it runs in Safari's standalone context (iOS) or Chrome's standalone context (Android). This is a **different storage partition** — the IndexedDB from the in-app browser is not accessible. Firebase `onAuthStateChanged` fires with `null`, and the old code redirected to `/g/{code}/checkin`, forcing the guest to check in again as a brand-new anonymous user.

### Fix: Session Auto-Recovery (`app/g/[code]/page.js`)

Added a `useEffect` that detects the no-auth state and automatically recovers:

1. `authLoading` completes with no `user` → `recovering.current` ref set to `true` (prevents re-entry)
2. `showRecoveryLoader` state set to `true` (shows spinner instead of redirect)
3. `signInAnonymously(firebaseAuth)` creates a new anonymous session
4. Check if the new session already has correct `bookingCode` claim (in case IndexedDB was actually present) — if so, skip the API call
5. If claims don't match, call `POST /api/guests/set-claims` with the booking code from the URL
6. If `set-claims` returns `success: false` (booking not found or inactive), redirect to `/g/{code}/checkin`
7. On success, call `getIdToken(true)` to refresh the token with new claims, then let the page render normally

**Key design decisions:**
- Uses `useRef` guard (`recovering`) rather than state, because the effect must not re-trigger on state changes
- `showRecoveryLoader` is separate state to control the UI (shows a full-page spinner during recovery)
- Falls back to checkin redirect on any error — never leaves the guest stuck
- The booking code in the URL is the trust anchor — `set-claims` validates it server-side against an active booking

### Defense-in-Depth: Explicit Persistence (`lib/firebase.js`)

Added `setPersistence(auth, browserLocalPersistence)` with a `.catch(() => {})` guard. The default is already `browserLocalPersistence`, but setting it explicitly guards against edge cases where iOS Safari standalone mode might behave differently. This is a belt-and-suspenders measure — the session recovery above is the primary fix.

---

## Problem 2: Install Step Keeps Appearing

### Root Cause

The install banner visibility was tracked only via `localStorage('install_guide_seen_{code}')`. It never checked whether the app was actually running as an installed PWA. Even when running in standalone mode (i.e., the app IS installed), the banner would show if localStorage had been cleared or was in a different storage partition.

Additionally, the setup wizard redirect (`/g/{code}/setup`) would fire during session recovery before auth was resolved, causing a redirect race.

### Fix: Standalone-Aware Install Banner (`app/g/[code]/page.js`)

The `useEffect` that manages install banner + setup redirect now:

1. **Waits for auth**: Returns early if `authLoading || showRecoveryLoader` — prevents race with session recovery
2. **Checks standalone first**: If `isStandalone()` returns `true`, sets `installGuideSeen(true)` and returns — the install step is inherently complete
3. **Only then checks localStorage**: Falls through to the original `localStorage` check only when not in standalone mode
4. **Setup redirect also gated**: Only fires when `user` exists (recovery handles the no-user case) AND not in standalone mode

---

## Problem 3: Guest Home Card Order

### Root Cause

The Check-In Guide card was in the "Arrival Info" section (`getArrivalCards()`), which rendered at position 6 or later on the page. Parking was the first card in "Your Stay" section but only after Check-In Guide was buried. An arriving guest had to scroll to find the most critical information.

### Fix: Card Reorder (`app/g/[code]/page.js`)

Moved Check-In Guide from `getArrivalCards()` to the first position in `getStayCards()`. New card order:

**"Your Stay" section (top of page):**
1. Check-In Guide (green, with "Done" badge when checked in)
2. Parking
3. Laundry
4. Community Board
5. Maintenance
6. Invite Group (primary guest only)

**"Arrival Info" section (below):**
1. Access Codes
2. House Rules

This puts the two most time-sensitive items (Check-In Guide + Parking) at positions 1-2.

---

## Problem 4: Checkin Page Auto-Redirect Without Claims

### Root Cause

When an already-checked-in guest lands on `/g/{code}/checkin` (e.g., they bookmarked it or tapped the original link again), the page detects `existingCheckin.checkedIn === true` and redirects to `/g/{code}`. But if the current anonymous user is new (session recovery scenario), this redirect happens without setting claims. The portal page loads, but all Firestore queries fail because the user has no `bookingCode` claim.

### Fix: Claims-Aware Auto-Redirect (`app/g/[code]/checkin/page.js`)

The auto-redirect `useEffect` now:

1. Checks `existingCheckin?.checkedIn` and `user` (as before)
2. Gets the current user's `getIdTokenResult()` and checks `claims.bookingCode`
3. If `bookingCode !== code`, calls `POST /api/guests/set-claims` and `getIdToken(true)` to refresh
4. Then proceeds with the redirect to `/g/{code}`

Uses a `useRef` guard (`redirecting`) to prevent the effect from firing twice.

---

## Files Changed

| File | What Changed |
|------|-------------|
| `lib/firebase.js` | Added `setPersistence` import + explicit `browserLocalPersistence` call |
| `app/g/[code]/page.js` | Session recovery effect, standalone-aware install/setup, card reorder (Check-In Guide to `getStayCards()`) |
| `app/g/[code]/checkin/page.js` | Claims check + set-claims call before auto-redirect |

---

## Risks and Regressions to Watch

### Session Recovery
- **Race with Firestore queries**: The `useCollection` and `useDocument` hooks fire immediately. During recovery, the user has no claims, so Firestore queries may briefly fail or return empty. The `showRecoveryLoader` prevents rendering data-dependent UI during this window, but hooks still fire internally. Monitor for console errors.
- **set-claims preserves staff roles**: The `set-claims` endpoint was patched previously (commit `ec766a6`) to preserve existing staff claims. If that patch is ever reverted, session recovery for admin users who visit guest portals would overwrite their admin claims with `role: 'guest'`.
- **Anonymous user accumulation**: Each recovery creates a new anonymous Firebase user. These accumulate in Firebase Auth. Consider periodic cleanup via Admin SDK or Firebase Console.
- **Offline/slow network**: If `set-claims` API call fails due to network, the catch block redirects to checkin. This is acceptable degraded behavior but could surprise guests with intermittent connectivity.

### Install Banner
- **isStandalone() accuracy**: Relies on `display-mode: standalone` media query + `navigator.standalone` (iOS). If a browser changes behavior, the check could return false for installed PWAs. The `lib/platform.js` utility has been stable but is not tested on all browsers.
- **localStorage still used as fallback**: For non-standalone browsers, `install_guide_seen_{code}` still controls visibility. If a guest clears browser data, the banner reappears (acceptable UX — they might need the instructions again).

### Card Reorder
- **No data dependency**: This is purely a presentation change. No API or data model impact.
- **i18n**: All card labels use `t(locale, key)` — no hardcoded strings affected.

### Checkin Claims
- **Double set-claims call**: If the guest portal's session recovery also fires, there could be two `set-claims` calls in quick succession. Both are idempotent (same booking code), so no harm beyond extra API calls.

---

## Manual QA Steps

### Session Recovery
1. Open guest portal link in WhatsApp/iMessage (in-app browser)
2. Complete check-in form
3. Save to home screen via the setup wizard
4. Launch from home screen
5. **Expected**: Portal loads without checkin form. Brief spinner during recovery. All cards show data.
6. **Verify**: No console errors about Firestore permission denied

### Install Banner
1. Open guest portal in Safari (not standalone)
2. Confirm install banner appears (if not previously dismissed)
3. Add to home screen
4. Launch from home screen
5. **Expected**: Install banner does NOT appear, even if localStorage was cleared
6. **Verify**: `isStandalone()` returns true in console

### Card Order
1. Open guest portal (any method)
2. **Expected**: Check-In Guide is the first card in "Your Stay" section
3. **Expected**: Parking is the second card
4. **Expected**: "Arrival Info" section has only Access Codes and House Rules

### Checkin Auto-Redirect
1. Complete check-in as a guest
2. Clear browser storage (or open in new browser context)
3. Navigate directly to `/g/{code}/checkin`
4. **Expected**: Brief loading, then redirect to portal (not stuck on checkin form)
5. **Verify**: Firestore queries work on portal page (cards show real data)

---

## Future Improvements

- **Persistent auth across browser contexts**: Could store a guest recovery token in a server-side cookie that works across in-app browser and Safari standalone. This would eliminate the need for anonymous re-auth entirely.
- **Anonymous user cleanup**: Firebase Cloud Function to periodically delete anonymous users older than N days.
- **Proactive claims refresh**: Could add a middleware or layout-level check that validates claims on every page load, not just on recovery. Would catch stale claims from token expiry.
- **Deep link preservation**: If the guest tapped a deep link (e.g., `/g/{code}/parking`) and hits recovery, they currently land on the portal home. Could preserve the intended destination in sessionStorage.
- **Metrics**: Track how often session recovery fires vs. normal auth. High recovery rate would indicate the persistence fix isn't effective and the root cause needs deeper investigation.
