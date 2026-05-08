# Post-Mortem: Welcome Message Not Generated + Guest Name Missing

**Date:** 2026-04-17
**Severity:** Medium (feature degradation, no data loss)
**Affected systems:** Airbnb email Lambda, ICS sync, welcome message generation
**Status:** Fixed

---

## Symptom

After deploying to production, bookings created from forwarded Airbnb reservation emails show `guestName: 'Airbnb Guest'` (generic) with no personalized welcome message generated. The admin sees `welcomeStatus: 'pending'` indefinitely. The feature worked correctly during testing on the `develop` branch.

---

## Root Cause

Two independent bugs that interact to produce the symptom:

### Bug 1 — Lambda dedup skips enrichment (PRIMARY)

**Location:** `infra/lambda/parse-airbnb-email/index.js`, lines 362-373

The ICS calendar sync (`functions/icsSync.js`) runs on a Cloud Function schedule, polling Airbnb's ICS calendar feed every few hours. It creates bookings with `guestName: 'Airbnb Guest'` because Airbnb calendar event summaries are intentionally generic for privacy (e.g., "Reserved", "Not available", or strings containing "airbnb"). The `extractGuestName()` function correctly identifies these as non-names and defaults to `'Airbnb Guest'`.

The ICS sync also extracts the `airbnbConfirmationCode` from the VEVENT DESCRIPTION field and writes it to the booking document.

When the host later forwards the reservation confirmation email, the Lambda's `createBookingFromConfirmation()` runs a dedup check:

```javascript
// Old code (before fix)
if (confirmationCode) {
  const existing = await firestore
    .collection('bookings')
    .where('airbnbConfirmationCode', '==', confirmationCode)
    .limit(1)
    .get();

  if (!existing.empty) {
    console.log('Booking already exists for confirmation code — skipping', { ... });
    return null;  // <-- THE BUG: returns null, caller skips welcome generation
  }
}
```

Because the ICS sync already created a booking with the same confirmation code, this check finds it and returns `null`. The calling code (lines 995-1006) only triggers welcome generation when the result is non-null:

```javascript
if (result) {
  // Generate welcome message draft
  const bookingDoc = await firestore.collection('bookings').doc(result.bookingId).get();
  await generateWelcomeDraft(firestore, result.bookingId, bookingDoc.data(), propertySettings);
} else {
  // This branch executes — welcome generation never happens
  console.log('Reservation confirmation processed — no new booking (duplicate or missing data)');
}
```

**Result:** The guest name extracted from the email (which has the real name in the subject line like "Reservation confirmed - Maria Rodriguez arrives May 23") is silently discarded. The booking retains `'Airbnb Guest'`. Welcome generation never fires.

### Bug 2 — API route settings scoping (SECONDARY)

**Location:** `app/api/admin/sync-ics/route.js`, lines 110, 215, 325

The manual ICS sync endpoint (triggered from the admin UI) has a JavaScript scoping error:

```javascript
// Line 110 — module-level function definition
async function processFeed(feed) {
  // ...
  // Line 215 — references `settings` which is NOT in this scope
  const settingsForWelcome = settings;  // ReferenceError!
  const template = settingsForWelcome.welcomeTemplate || null;
  // ...
}

// Line 316 — POST handler where `settings` is actually defined
export async function POST(request) {
  // Line 325
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  // Line 350
  const stats = await processFeed(feed);  // does NOT pass settings
}
```

`processFeed` is defined at module scope (line 110) and cannot access `settings` from the `POST` handler's local scope. This throws a `ReferenceError`, which is caught by the try/catch wrapping the welcome generation (lines 214-233) and logged as a generic error. The welcome stays in `'pending'` status.

**Note:** The Cloud Function version (`functions/icsSync.js`) does NOT have this bug — its `generateWelcomeDraft()` function loads settings from Firestore internally (line 237). So scheduled syncs can generate welcome messages (with the generic "Airbnb Guest" name), but manual admin syncs cannot generate them at all.

---

## Why This Wasn't Caught Before Production

### 1. Testing used email-first flow; production uses ICS-first flow

During development on the `develop` branch, the team tested by forwarding reservation emails **before** the ICS sync had ever run. In this sequence:

1. Email arrives at Lambda
2. No existing booking found (ICS hasn't created one yet)
3. Lambda creates booking with real guest name from email subject
4. Welcome message generates successfully with personalized name

In production, the ICS sync runs on a schedule (every few hours). By the time the host sees the Airbnb notification and forwards the email, the ICS sync has **already** created the booking:

1. ICS sync creates booking with `guestName: 'Airbnb Guest'` + confirmation code
2. Email arrives at Lambda (minutes to hours later)
3. Dedup finds existing booking by confirmation code
4. Lambda returns `null` — guest name and welcome generation skipped

**The race condition only manifests in the production ordering.** The develop testing environment didn't have an active ICS sync schedule, so the email always arrived first.

### 2. Dedup was tested for correctness, not enrichment

The dedup check was specifically added to prevent duplicate bookings when the same email is forwarded twice. The test scenario was:

- Forward email once → booking created ✓
- Forward same email again → no duplicate ✓

The test that was **never written**:

- ICS sync creates booking → forward email → guest name updated? Welcome generated?

The concept of "enrichment on dedup match" was not part of the design. The dedup was binary: exists = skip, doesn't exist = create.

### 3. ICS sync and email Lambda were developed as independent features

| Commit | Feature | Interaction tested? |
|--------|---------|-------------------|
| `6b20030` | ICS sync: auto-create bookings from Airbnb calendar | No — email Lambda didn't exist yet |
| `a365f41` | Email Lambda: welcome generation after booking creation | No — only tested email-first path |
| `895ae56` | Surface welcome errors in admin UI | No — tested error display, not "never attempted" |

These were built as additive, independent features. No integration test covered their interaction via the shared `airbnbConfirmationCode` field. The confirmation code was added to both paths independently.

### 4. Airbnb ICS summaries weren't tested with real data

Airbnb's ICS feed uses privacy-preserving SUMMARY fields:
- `"Reserved"` — no guest name
- `"Not available"` — blocked dates
- `"HMABCD1234"` — sometimes just the confirmation code

During development, mock ICS data may have included actual guest names in the summary field. The production behavior — always generic summaries — wasn't captured in test fixtures.

### 5. Silent error handling masked the API route bug

The `settings` scoping bug in the API route throws a `ReferenceError` on every manual sync. But:

```javascript
} catch (welcomeErr) {
  console.error('[sync-ics] Welcome draft failed:', welcomeErr.message);
  // No status update on the booking — stays 'pending' forever
}
```

- The error is logged to server console only — admin UI never surfaces it
- The booking shows `welcomeStatus: 'pending'`, which looks like "still processing"
- No alert, no error badge, no retry prompt visible to the host
- The Cloud Function version's `generateWelcomeDraft` sets `welcomeStatus: 'error'` on failure (line 266), but the API route version doesn't

### 6. No end-to-end test for the combined production flow

The test matrix verified each feature in isolation:

| Feature | Test | Result |
|---------|------|--------|
| ICS sync creates bookings | Manual sync → check Firestore | ✓ Booking created |
| Email Lambda creates bookings | Forward email → check Firestore | ✓ Booking created with name |
| Welcome generation | Booking created → check welcomeStatus | ✓ Message drafted |
| Dedup prevents duplicates | Forward same email twice | ✓ Only one booking |

The missing test:

| Combined flow | ICS sync runs → email forwarded → check booking | ? Name updated? Welcome generated? |

---

## The Fix

### Fix 1 — Lambda enrichment (primary)

**File:** `infra/lambda/parse-airbnb-email/index.js`

When `createBookingFromConfirmation` finds an existing booking (dedup match), instead of returning `null`, it now:

1. Checks if the existing guest name is generic (`'Airbnb Guest'`, `'Guest'`, or empty)
2. If the email has a real guest name, updates the booking with it
3. Also fills in any missing fields from the email (guest count, payout amount, guest message)
4. Sets `enrichedFromEmailAt` timestamp for audit trail
5. If `welcomeStatus` is `'pending'` or `'error'`, returns the booking ID to trigger welcome generation
6. The caller re-reads the booking doc from Firestore after enrichment, so `generateWelcomeDraft` receives the updated guest name

### Fix 2 — API route settings scoping (secondary)

**File:** `app/api/admin/sync-ics/route.js`

- `processFeed(feed)` → `processFeed(feed, settings)` — accepts settings as parameter
- Caller passes `settings` from the POST handler
- Removed broken `settingsForWelcome` indirection

---

## Lessons Learned

### 1. Test the production sequence, not just the feature

When two systems write to the same Firestore collection (`bookings`), test the realistic timing:
- ICS sync fires on schedule (first)
- Email forwarded by host (second)
- Both write to the same booking document

**Action:** Add an integration test that seeds a booking via ICS sync, then processes a reservation email with the same confirmation code, and asserts: guest name is updated, welcome message is generated.

### 2. Dedup should enrich, not just skip

When a dedup match is found, the question isn't just "does this record exist?" but "does the existing record have less information than what I'm about to write?" If the answer is yes, merge/enrich rather than skip.

**Pattern:** Any dedup check that returns early should first ask: "Can I improve the existing record with data I have?"

### 3. Silent catch blocks need observable failure states

Any `catch` that swallows errors should at minimum:
- Set an error status on the affected record (`welcomeStatus: 'error'`)
- Include the error message for debugging
- Never leave a record in a limbo `'pending'` state that looks like "still processing"

**Action:** Audit all try/catch blocks in both ICS sync paths for silent failures.

### 4. Integration tests for shared-collection writers

When multiple systems (ICS sync, email Lambda, manual creation via admin UI) all write to the same Firestore collection, there must be integration tests covering their interactions — especially around dedup fields they share.

### 5. Test with real external service data

Airbnb's ICS format should have been captured from a real calendar export and used as test fixtures. The privacy-preserving behavior (generic summaries) is a critical characteristic that affects downstream logic.

**Action:** Export a real Airbnb ICS feed (redacted) and add it as a test fixture for the ICS sync.

### 6. Module-scope functions can't close over handler-local variables

In Next.js API routes, functions defined at module scope (outside the `POST`/`GET` handler) cannot access variables declared inside the handler. Either pass them as parameters or load them independently inside the function. The Cloud Function version got this right; the API route version didn't.

---

## Timeline

| Date | Event |
|------|-------|
| Pre-April | ICS sync (`6b20030`) added — creates bookings from Airbnb calendar |
| Pre-April | Welcome generation (`a365f41`) added to Lambda — works for email-first bookings |
| Pre-April | Welcome error surfacing (`895ae56`) added — but doesn't catch "never attempted" |
| 2026-04-17 | Host reports: guests showing as "Airbnb Guest" with no welcome messages |
| 2026-04-17 | Root cause identified: ICS-first race condition + settings scoping bug |
| 2026-04-17 | Fix implemented: Lambda enrichment + API route settings parameter |
