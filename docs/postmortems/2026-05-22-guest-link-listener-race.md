# Postmortem — Guest links silently 404 inside the portal

**Date of incident report:** 2026-05-22
**Discovery:** Host reports that links generated for newly-created bookings open the portal but show "We could not find a booking with this link."
**Severity:** High — every manually-created booking was unusable for the guest. (ICS-synced Airbnb bookings hit the same code path, so they were also affected on first visit.)
**Author:** on-call engineer
**Status:** Fix landed in `hooks/useFirestore.js` (claim-aware retry on `permission-denied`).

---

## Summary

When an admin creates a reservation, the API correctly generates a signed link of the form `https://www.casa-coqui.cc/g/{code}?t={accessToken}` and writes a booking document to Firestore. When the guest opens the link, anonymous Firebase auth succeeds and `/api/guests/validate-token` sets the required `bookingCode` custom claim — but the Firestore listener subscribed by the guest portal page errored out with `PERMISSION_DENIED` *before* the claim was attached, was terminated by the SDK, and was never re-subscribed. The page rendered as if the booking did not exist.

## Impact

- All manually-created bookings since the April 4 Firestore rules hardening (`62507c5`) were broken end-to-end from the guest's perspective.
- Detection was delayed because most production bookings come from the Airbnb ICS sync and the host had not been clicking through fresh guest links between then and 2026-05-22.
- No data loss. No security regression — the listener correctly refused to leak data without claims; the bug was in the recovery path after claims were granted.

## Timeline

| Date | Event |
|------|-------|
| 2026-04-04 | `df9d028` — signed-token guest link infrastructure landed |
| 2026-04-04 | `62507c5` — Firestore rules locked down: `bookings` read now requires `request.auth.token.bookingCode == resource.data.code` |
| 2026-04-04 → 2026-05-22 | Latent. Most bookings synced from Airbnb; manual portal entries untested in production |
| 2026-05-22 | Host reports link does not work on freshly-created booking |
| 2026-05-22 | Investigation, root cause, fix shipped in `hooks/useFirestore.js` |

## Root cause

The guest portal page (`app/g/[code]/page.js`) does two things in parallel on mount:

1. **Listener path** — `useCollection('bookings', where('code','==',code))` (in `hooks/useFirestore.js`) subscribes to the booking document via `onSnapshot` as soon as the anonymous Firebase user object becomes available.
2. **Auth recovery path** — calls `signInAnonymously`, then `POST /api/guests/validate-token`, which sets the `bookingCode` custom claim via the Admin SDK, then refreshes the ID token client-side with `getIdToken(true)`.

The listener subscribes when the user object exists but **before** the validate-token call returns. Firestore evaluates the rule with `request.auth.token.bookingCode` undefined, the rule fails, and the listener fires its `error` callback with `code === 'permission-denied'`. **Per Firebase docs, `onSnapshot` listeners are terminated on `PERMISSION_DENIED` and do not auto-retry.**

A few hundred milliseconds later the claim is granted and `getIdToken(true)` refreshes the client token, but:

- `useAuth` listens via `onAuthStateChanged`, which **does not fire on pure-claim refreshes** (only on sign-in/sign-out), so `useAuth`'s `user` ref is unchanged.
- `useCollection`'s effect deps are `[user, authLoading, collectionName]`, none of which changed, so the hook does not re-subscribe.

End result: `bookings === []` forever, even though the booking exists, the link is valid, and the claim has been granted. The page renders the small amber "Booking not found" banner inside the StayCard (`app/g/[code]/page.js:397-402`).

## Why this wasn't caught earlier

- The signed-token PR included no integration test that exercised the cold-start guest flow (no existing session, fresh anonymous sign-in).
- Manual QA used a browser that already had a warm anonymous session with claims, so the listener never errored.
- Airbnb-synced bookings exhibit the same bug, but the host typically tests those by impersonating in dev — again with a warm session.
- The error surfaces as a small banner *inside an otherwise normally-rendered StayCard*, not as a full-page failure, so monitoring/screenshots looked superficially fine.

## Fix

`hooks/useFirestore.js` — when `onSnapshot` returns `permission-denied`, subscribe to `onIdTokenChanged` once. The next claim/token change bumps a state value that re-runs the effect and re-subscribes with the fresh token. Capped at 2 retries per mount so genuinely-denied collections (e.g., a guest hitting an admin-only collection) don't loop.

Applies to both `useDocument` and `useCollection`, so every claim-gated listener in the app gets the same protection.

```js
if (err.code === 'permission-denied' && retryCountRef.current < MAX_CLAIMS_RETRIES) {
  retryCountRef.current += 1;
  unsubTokenChange = onIdTokenChanged(auth, (u) => {
    if (!u) return;
    if (unsubTokenChange) { unsubTokenChange(); unsubTokenChange = null; }
    setClaimsRetry((n) => n + 1);
  });
}
```

`onIdTokenChanged` fires on initial subscription with the current user, so even if the claims race resolved before the error callback ran (rare but possible under fast networks), the retry still triggers immediately with the now-valid token.

## Verification

- Lint: `eslint hooks/useFirestore.js` — clean.
- The fix targets the symptom *at the data layer*; no rules/indexes redeploy required.
- Manual reproduction plan (to run before declaring closed):
  1. Create a fresh booking via admin (`/admin/bookings`).
  2. Open the displayed `guestLink` in an Incognito window (no warm session).
  3. Expect: portal loads with greeting, dates, WiFi — no "Booking not found" banner.
  4. Expect in console: one `Firestore` permission-denied log followed by a successful snapshot — confirms the retry path runs and recovers.

## Followups / hardening

- [ ] Add an integration test (Playwright) for the cold-start guest flow against the Firestore emulator with rules loaded.
- [ ] Consider moving `useAuth` from `onAuthStateChanged` to `onIdTokenChanged` so claim refreshes are first-class. (Out of scope for the immediate fix — needs to be paired with a stable `user` ref / explicit `tokenVersion` to avoid no-op renders.)
- [ ] Surface listener errors in Sentry / log drain — the `console.error` from `useFirestore.js` is invisible in production today.
- [ ] Add a Cypress/Playwright smoke that creates a booking and opens the link in a clean session as part of CI on PRs that touch `app/g/`, `app/api/guests/`, `firestore.rules`, or `hooks/useFirestore.js`.

## Lessons

1. **Listener subscriptions and async claim grants race.** Any code that issues a Firestore listener under anonymous auth *while* an asynchronous claim grant is in flight is fundamentally racy. The fix must live in the data layer (retry on claim refresh) or the subscription must be gated until claims land.
2. **`onAuthStateChanged` is not enough for claim-gated UIs.** It misses claim-only refreshes. `onIdTokenChanged` is the right primitive when authorization depends on custom claims.
3. **`permission-denied` is a terminal listener error.** It does not retry, even if auth state subsequently changes. Code paths that combine anonymous auth + custom claims + Firestore listeners must handle this explicitly.
4. **Rules-tightening PRs need a "cold path" QA gate.** A warm browser session masks every flow that depends on claim grant timing. Future rules changes should include a checklist item: "Tested in a private window with no prior session."
