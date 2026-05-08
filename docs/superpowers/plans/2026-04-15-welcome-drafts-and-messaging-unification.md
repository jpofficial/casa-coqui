# Welcome Drafts Queue + Messaging Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `/admin/bookings` into a tabbed queue (Drafts/In-house/Upcoming/Past), add Send-later + Retry + Mark-as-Sent-with-edit actions, and unify the welcome message into the guest's Messages thread via a new `threadKey` field that also gives unmatched senders their own threads.

**Architecture:**
- **Data model additions:** `airbnb_messages.threadKey` (grouping key), `airbnb_messages.source` (welcome_draft / reply_draft / inbound). `bookings.welcomeStatus` extended with `'snoozed'` and `'error'` states. New fields `welcomeSnoozedUntil`, `welcomeError`, `welcomeSentText`.
- **Server changes:** Welcome PATCH API gains `action: 'mark-sent' | 'snooze' | 'skip'`. Mark-as-Sent writes an `airbnb_messages` doc so the welcome appears in the Messages thread. Lambda sets `threadKey` on inbound writes. New scheduled Cloud Function sweeps snoozed→ready and stuck pending→error every 15 min. Reply agent loads thread history by `threadKey` instead of `bookingId` so unmatched senders get context.
- **UI changes:** Tabbed bookings page, collapsed cards, new pill component, Mark-Sent confirm modal, Send-later picker, Messages page ⚠ Unmatched badge, Link-to-booking modal.
- **Migration:** One-time script backfills `threadKey` on existing `airbnb_messages`. No backfill for historically-sent welcomes (acceptable gap in old threads).

**Tech Stack:** Next.js 14 App Router (JS, no TS), Firebase Firestore + Cloud Functions (v2), AWS Lambda for email ingestion, Tailwind CSS, existing `lib/i18n.js` system for ES/EN.

**Testing approach:** The project has no active test harness (Playwright is installed but unused, no unit test runner). For pure functions (`buildThreadKey`, state transitions, snooze date math) we add Node's built-in `node --test` with a new `lib/__tests__/` folder and a `npm test` script — no new dependencies. For UI + integration we use manual smoke tests documented in Task 18 (mirrors spec §10).

---

## File structure

### New files
- `lib/thread-key.js` — Pure helper: `buildThreadKey({ bookingCode, senderEmail, senderName })`. Used by Lambda, functions, backfill, and messages UI.
- `lib/welcome-status.js` — Pure helpers for welcome status transitions + snooze defaults.
- `lib/__tests__/thread-key.test.js` — Unit tests for `lib/thread-key.js`.
- `lib/__tests__/welcome-status.test.js` — Unit tests for `lib/welcome-status.js`.
- `functions/scheduled.js` — New Cloud Function running every 15 min for sweeper logic.
- `app/api/bookings/[id]/welcome/route.js` — extend with PATCH handler (same file, new export).
- `app/api/messages/threads/link/route.js` — New POST route for Link-to-booking.
- `components/admin/StatusPill.js` — New shared status pill component (`ready | generating | snoozed | sent | skipped | error | cancelled | in_house | past | unmatched`).
- `components/admin/BookingCard.js` — Extracted collapsed/expandable booking card (today is inlined in page.js).
- `components/admin/WelcomeMarkSentModal.js` — Modal for edit-before-confirm on Mark-as-Sent.
- `components/admin/WelcomeSendLaterModal.js` — Picker for snooze time.
- `components/admin/LinkToBookingModal.js` — Picker for linking an unmatched thread to a booking.
- `scripts/backfill-thread-keys.js` — One-time migration.

### Modified files
- `infra/lambda/parse-airbnb-email/index.js` — Lambda: write `threadKey` on inbound + `welcomeStatus: 'error'` on generation failure (currently swallowed).
- `functions/index.js` — Reply agent loads history by `threadKey`; set `source: 'inbound'` on reads.
- `app/admin/bookings/page.js` — Replace flat list with tabs + counts + default tab logic + new actions.
- `app/admin/messages/page.js` — Switch `buildThreads` to group by `threadKey`; add ⚠ Unmatched badge.
- `lib/i18n.js` — Add keys for new pills, modal copy, picker labels, error state.

---

## Phase 1 — Data model helpers

### Task 1: Create `lib/thread-key.js` helper + unit tests

**Files:**
- Create: `lib/thread-key.js`
- Create: `lib/__tests__/thread-key.test.js`

- [ ] **Step 1: Add `npm test` script to package.json**

Edit `/Users/jperez/dev/casa-coqui/package.json` — inside the `"scripts"` object, add a line after `"lint"`:

```json
"test": "node --test lib/__tests__/"
```

- [ ] **Step 2: Write failing test**

Create `lib/__tests__/thread-key.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildThreadKey } = require('../thread-key');

test('uses bookingCode when present', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: 'ABC123', senderEmail: 'x@y.com' }),
    'ABC123'
  );
});

test('falls back to lowercased email when no bookingCode', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: 'Rob@Yahoo.COM' }),
    'email:rob@yahoo.com'
  );
});

test('falls back to lowercased trimmed name when no email', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: null, senderName: '  John Doe ' }),
    'name:john doe'
  );
});

test('returns "unknown" when nothing identifies the sender', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: null, senderName: null }),
    'unknown'
  );
});

test('ignores empty strings', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: '', senderEmail: '', senderName: 'Jane' }),
    'name:jane'
  );
});

test('isUnmatchedKey detects email: and name: keys', () => {
  const { isUnmatchedKey } = require('../thread-key');
  assert.strictEqual(isUnmatchedKey('ABC123'), false);
  assert.strictEqual(isUnmatchedKey('email:a@b.com'), true);
  assert.strictEqual(isUnmatchedKey('name:foo'), true);
  assert.strictEqual(isUnmatchedKey('unknown'), true);
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
cd /Users/jperez/dev/casa-coqui && npm test
```

Expected: FAIL with `Cannot find module '../thread-key'`.

- [ ] **Step 4: Implement `lib/thread-key.js`**

```js
/**
 * Build a stable grouping key for an airbnb_messages document.
 *
 * Used by:
 *   - Lambda on inbound write (infra/lambda/parse-airbnb-email)
 *   - Mark-as-Sent write (app/api/bookings/[id]/welcome)
 *   - Backfill script (scripts/backfill-thread-keys.js)
 *   - Messages page grouping (app/admin/messages/page.js)
 *   - Reply agent context load (functions/index.js)
 *
 * Precedence:
 *   1. bookingCode (matched booking)
 *   2. 'email:' + lowercased email
 *   3. 'name:' + lowercased trimmed name
 *   4. 'unknown' (fully anonymous, preserved for backwards-compat)
 */
function buildThreadKey({ bookingCode, senderEmail, senderName } = {}) {
  if (bookingCode && String(bookingCode).trim()) {
    return String(bookingCode).trim();
  }
  if (senderEmail && String(senderEmail).trim()) {
    return 'email:' + String(senderEmail).trim().toLowerCase();
  }
  if (senderName && String(senderName).trim()) {
    return 'name:' + String(senderName).trim().toLowerCase();
  }
  return 'unknown';
}

function isUnmatchedKey(threadKey) {
  if (!threadKey) return true;
  return (
    threadKey === 'unknown' ||
    threadKey.startsWith('email:') ||
    threadKey.startsWith('name:')
  );
}

module.exports = { buildThreadKey, isUnmatchedKey };
```

- [ ] **Step 5: Run test, verify it passes**

```bash
npm test
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json lib/thread-key.js lib/__tests__/thread-key.test.js
git commit -m "feat: add buildThreadKey helper for grouping airbnb_messages"
```

---

### Task 2: Create `lib/welcome-status.js` helper + unit tests

**Files:**
- Create: `lib/welcome-status.js`
- Create: `lib/__tests__/welcome-status.test.js`

- [ ] **Step 1: Write failing test**

Create `lib/__tests__/welcome-status.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  WELCOME_STATUSES,
  isActionable,
  computeDefaultSnoozeIso,
  isStuckPending,
} = require('../welcome-status');

test('exports the full status enum', () => {
  assert.deepStrictEqual(
    Object.keys(WELCOME_STATUSES).sort(),
    ['ERROR', 'PENDING', 'READY', 'SENT', 'SKIPPED', 'SNOOZED']
  );
});

test('isActionable returns true for ready only', () => {
  assert.strictEqual(isActionable('ready'), true);
  assert.strictEqual(isActionable('pending'), false);
  assert.strictEqual(isActionable('snoozed'), false);
  assert.strictEqual(isActionable('sent'), false);
  assert.strictEqual(isActionable('skipped'), false);
  assert.strictEqual(isActionable('error'), false);
});

test('computeDefaultSnoozeIso returns 9am local on day before check-in', () => {
  const checkIn = '2026-07-05'; // Jul 5 2026
  const iso = computeDefaultSnoozeIso(checkIn);
  const d = new Date(iso);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 6); // July (0-indexed)
  assert.strictEqual(d.getDate(), 4);  // day before
  assert.strictEqual(d.getHours(), 9);
  assert.strictEqual(d.getMinutes(), 0);
});

test('computeDefaultSnoozeIso returns null for invalid input', () => {
  assert.strictEqual(computeDefaultSnoozeIso(null), null);
  assert.strictEqual(computeDefaultSnoozeIso(''), null);
  assert.strictEqual(computeDefaultSnoozeIso('not-a-date'), null);
});

test('isStuckPending detects pending older than 10 min', () => {
  const tenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.strictEqual(isStuckPending('pending', tenMinAgo), true);
  assert.strictEqual(isStuckPending('pending', fiveMinAgo), false);
  assert.strictEqual(isStuckPending('ready', tenMinAgo), false);
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test
```

Expected: FAIL with `Cannot find module '../welcome-status'`.

- [ ] **Step 3: Implement `lib/welcome-status.js`**

```js
const WELCOME_STATUSES = {
  PENDING: 'pending',
  READY: 'ready',
  SNOOZED: 'snoozed',
  SENT: 'sent',
  SKIPPED: 'skipped',
  ERROR: 'error',
};

/** Only 'ready' welcomes appear in the Drafts tab / are actionable via Mark-Sent. */
function isActionable(status) {
  return status === WELCOME_STATUSES.READY;
}

/**
 * Default Send-later timestamp: 9:00 AM local time on the day before check-in.
 * Returns null if checkInDate is missing/invalid.
 */
function computeDefaultSnoozeIso(checkInDate) {
  if (!checkInDate) return null;
  // checkInDate is a yyyy-mm-dd string stored in Firestore.
  const parts = String(checkInDate).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  const target = new Date(y, m - 1, d - 1, 9, 0, 0, 0); // local time
  if (Number.isNaN(target.getTime())) return null;
  return target.toISOString();
}

/** True when a booking is still 'pending' more than 10 minutes after creation. */
function isStuckPending(status, bookingCreatedAt) {
  if (status !== WELCOME_STATUSES.PENDING) return false;
  if (!bookingCreatedAt) return false;
  const createdMs = new Date(bookingCreatedAt).getTime();
  if (Number.isNaN(createdMs)) return false;
  return Date.now() - createdMs > 10 * 60 * 1000;
}

module.exports = {
  WELCOME_STATUSES,
  isActionable,
  computeDefaultSnoozeIso,
  isStuckPending,
};
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npm test
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/welcome-status.js lib/__tests__/welcome-status.test.js
git commit -m "feat: add welcome-status helpers (statuses, snooze default, stuck-pending)"
```

---

## Phase 2 — Migration script

### Task 3: Backfill `threadKey` on existing `airbnb_messages`

**Files:**
- Create: `scripts/backfill-thread-keys.js`

- [ ] **Step 1: Write the script**

Create `scripts/backfill-thread-keys.js`:

```js
#!/usr/bin/env node
/**
 * One-time backfill: compute `threadKey` for every existing airbnb_messages doc
 * that doesn't yet have one.
 *
 * Usage:
 *   node scripts/backfill-thread-keys.js          # dry run (prints what would change)
 *   node scripts/backfill-thread-keys.js --apply  # actually writes
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env or the service-account JSON
 * at casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json (already in repo root).
 */

const path = require('path');
const admin = require('firebase-admin');
const { buildThreadKey } = require('../lib/thread-key');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

async function main() {
  if (!admin.apps.length) {
    const keyPath = path.resolve(
      __dirname,
      '..',
      'casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json'
    );
    admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
  }

  const db = admin.firestore();
  const snap = await db.collection('airbnb_messages').get();

  console.log(`Scanned ${snap.size} airbnb_messages docs`);
  let planned = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.threadKey) continue; // already backfilled

    const newKey = buildThreadKey({
      bookingCode: data.bookingCode || null,
      senderEmail: data.senderEmail || data.fromAddress || null,
      senderName: data.guestName || data.fromName || null,
    });

    planned++;
    if (APPLY) {
      batch.update(doc.ref, { threadKey: newKey });
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`  committed batch (${batchCount} updates)`);
        batch = db.batch();
        batchCount = 0;
      }
    } else {
      console.log(`  would set ${doc.id}.threadKey = "${newKey}"`);
    }
  }

  if (APPLY && batchCount > 0) {
    await batch.commit();
    console.log(`  committed final batch (${batchCount} updates)`);
  }

  console.log(
    APPLY
      ? `Done. Updated ${planned} docs.`
      : `Dry run. Would update ${planned} docs. Re-run with --apply to commit.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run (no writes)**

```bash
cd /Users/jperez/dev/casa-coqui && node scripts/backfill-thread-keys.js
```

Expected: Prints `Scanned N airbnb_messages docs` and a list of `would set … .threadKey = "…"` lines. No writes happen.

- [ ] **Step 3: Commit the script (do NOT apply yet — we apply in Task 18 after code lands)**

```bash
git add scripts/backfill-thread-keys.js
git commit -m "feat: add one-time threadKey backfill script (dry-run default)"
```

---

## Phase 3 — Lambda + Cloud Function server changes

### Task 4: Lambda sets `threadKey` + `source` on inbound writes

**Files:**
- Modify: `infra/lambda/parse-airbnb-email/index.js` (multiple sites)

- [ ] **Step 1: Copy `lib/thread-key.js` into Lambda deploy bundle**

The Lambda ships as its own node package under `infra/lambda/parse-airbnb-email/`. It can't import from the app's `lib/` folder at runtime. Copy the file in:

```bash
cp /Users/jperez/dev/casa-coqui/lib/thread-key.js /Users/jperez/dev/casa-coqui/infra/lambda/parse-airbnb-email/thread-key.js
```

- [ ] **Step 2: Require the helper at the top of the Lambda**

Edit `infra/lambda/parse-airbnb-email/index.js`. At the top of the file alongside the other requires, add:

```js
const { buildThreadKey } = require('./thread-key');
```

- [ ] **Step 3: Add `threadKey` + `source` when writing matched inbound**

Find the existing matched-inbound write in `index.js` (search for the `firestore.collection('airbnb_messages').add({` call inside the guest_message branch — around line 1055 based on the current file). On the object being added, include:

```js
threadKey: buildThreadKey({
  bookingCode: booking.code,
  senderEmail: fromAddress,
  senderName: guestName || fromName,
}),
source: 'inbound',
```

- [ ] **Step 4: Add `threadKey` + `source` when writing unmatched inbound**

Find the unmatched-inbound write (the branch where `bookingId: null` is set — around line 1046 based on current file). Add the same two fields:

```js
threadKey: buildThreadKey({
  bookingCode: null,
  senderEmail: fromAddress,
  senderName: guestName || fromName,
}),
source: 'inbound',
```

- [ ] **Step 5: Make `generateWelcomeDraft` surface errors instead of swallowing**

Edit the `generateWelcomeDraft` function in `infra/lambda/parse-airbnb-email/index.js` (currently around line 623). Change the catch block from:

```js
} catch (err) {
  console.error('Welcome message generation failed (non-fatal)', {
    bookingId,
    error: err.message,
  });
}
```

to:

```js
} catch (err) {
  console.error('Welcome message generation failed', {
    bookingId,
    error: err.message,
  });
  // Record the failure so the admin UI can surface a Retry button.
  try {
    await firestore.collection('bookings').doc(bookingId).update({
      welcomeStatus: 'error',
      welcomeError: err.message ? String(err.message).slice(0, 500) : 'unknown',
    });
  } catch (updateErr) {
    console.error('Failed to persist welcome error state', updateErr.message);
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/parse-airbnb-email/thread-key.js infra/lambda/parse-airbnb-email/index.js
git commit -m "feat(lambda): write threadKey + source on airbnb_messages; surface welcome errors"
```

- [ ] **Step 7: Note — Lambda is deployed in Task 19**

The Lambda change only takes effect after CDK redeploy. Do not test inbound flow until Task 19 runs.

---

### Task 5: Extend welcome PATCH route (mark-sent / snooze / skip)

**Files:**
- Modify: `app/api/bookings/[id]/welcome/route.js`

- [ ] **Step 1: Add PATCH export to the file**

Edit `/Users/jperez/dev/casa-coqui/app/api/bookings/[id]/welcome/route.js`. Add these new imports at the top (keep existing imports):

```js
import { FieldValue } from 'firebase-admin/firestore';
import { buildThreadKey } from '@/lib/thread-key';
```

Then append to the bottom of the file (below the existing `POST` handler):

```js
// ---------------------------------------------------------------------------
// PATCH /api/bookings/[id]/welcome
//
// Action dispatcher for Mark-as-Sent, Snooze, and Skip.
// Admin-only. Mirrors writes so that Mark-as-Sent adds a thread entry to
// airbnb_messages, unifying the welcome into the guest's conversation log.
// ---------------------------------------------------------------------------

export async function PATCH(request, { params }) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    if (!['mark-sent', 'snooze', 'skip'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Unknown action. Expected mark-sent | snooze | skip.' },
        { status: 400 }
      );
    }

    const bookingRef = adminDb.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Booking not found.' },
        { status: 404 }
      );
    }
    const booking = { id: bookingDoc.id, ...bookingDoc.data() };
    const now = new Date().toISOString();

    if (action === 'skip') {
      await bookingRef.update({ welcomeStatus: 'skipped' });
      return NextResponse.json({ success: true, data: { welcomeStatus: 'skipped' } });
    }

    if (action === 'snooze') {
      const snoozedUntil = body.snoozedUntil;
      if (!snoozedUntil || Number.isNaN(new Date(snoozedUntil).getTime())) {
        return NextResponse.json(
          { success: false, error: 'snoozedUntil must be a valid ISO timestamp.' },
          { status: 400 }
        );
      }
      await bookingRef.update({
        welcomeStatus: 'snoozed',
        welcomeSnoozedUntil: snoozedUntil,
      });
      return NextResponse.json({
        success: true,
        data: { welcomeStatus: 'snoozed', welcomeSnoozedUntil: snoozedUntil },
      });
    }

    // action === 'mark-sent'
    const finalText = typeof body.text === 'string' ? body.text.trim() : '';
    if (!finalText) {
      return NextResponse.json(
        { success: false, error: 'text is required for mark-sent.' },
        { status: 400 }
      );
    }

    // Write a batch: update booking + create airbnb_messages thread entry.
    const messagesRef = adminDb.collection('airbnb_messages').doc();
    const threadKey = buildThreadKey({
      bookingCode: booking.code,
      senderEmail: booking.guestEmail || null,
      senderName: booking.guestName || null,
    });

    const batch = adminDb.batch();
    batch.update(bookingRef, {
      welcomeStatus: 'sent',
      welcomeSentAt: now,
      welcomeSentText: finalText,
    });
    batch.set(messagesRef, {
      bookingId: booking.id,
      bookingCode: booking.code || null,
      threadKey,
      guestName: booking.guestName || null,
      senderEmail: booking.guestEmail || null,
      direction: 'outbound',
      sender: 'host',
      text: finalText,
      source: 'welcome_draft',
      sentAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      read: true,
    });
    await batch.commit();

    return NextResponse.json({
      success: true,
      data: { welcomeStatus: 'sent', messageId: messagesRef.id, threadKey },
    });
  } catch (error) {
    console.error('[PATCH /api/bookings/[id]/welcome]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update welcome.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Manual smoke-test the route via curl**

First, grab an admin ID token from your browser (DevTools → Application → IndexedDB → firebase auth → accessToken). Then:

```bash
# Pick any booking with welcomeStatus='ready' from /admin/bookings, note its ID.
curl -X PATCH "http://localhost:3000/api/bookings/<BOOKING_ID>/welcome" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action":"skip"}'
```

Expected: `{"success":true,"data":{"welcomeStatus":"skipped"}}`. Verify in Firestore console that the booking flipped to `skipped`.

- [ ] **Step 3: Revert the test booking back to 'ready' in Firestore console**

Manually set `welcomeStatus: 'ready'` on the test booking so later tasks can use it.

- [ ] **Step 4: Commit**

```bash
git add app/api/bookings/[id]/welcome/route.js
git commit -m "feat(api): PATCH welcome route handles mark-sent, snooze, skip actions"
```

---

### Task 6: Scheduled sweeper (snoozed→ready, stuck pending→error)

**Files:**
- Create: `functions/scheduled.js`
- Modify: `functions/index.js` (one line — re-export the new function)

- [ ] **Step 1: Create the scheduled Cloud Function**

Create `/Users/jperez/dev/casa-coqui/functions/scheduled.js`:

```js
/**
 * Scheduled sweeper for welcome message lifecycle.
 *
 * Runs every 15 minutes and:
 *   1. Flips bookings with welcomeStatus='snoozed' + welcomeSnoozedUntil <= now
 *      back to 'ready' and fires a staff push.
 *   2. Flips bookings with welcomeStatus='pending' + createdAt older than 10 min
 *      to 'error' so they surface with a Retry button.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const { db } = require('./firebaseInit');
const { notifyAdminAndCohost } = require('./lib/staff-notifications');

exports.welcomeSweeper = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Puerto_Rico',
    memory: '256MiB',
  },
  async () => {
    const now = new Date();
    const nowIso = now.toISOString();
    const tenMinAgoIso = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    // --- 1. Snoozed → Ready ---
    const snoozedSnap = await db
      .collection('bookings')
      .where('welcomeStatus', '==', 'snoozed')
      .where('welcomeSnoozedUntil', '<=', nowIso)
      .get();

    logger.info(`[welcomeSweeper] ${snoozedSnap.size} snoozed drafts are due`);

    for (const doc of snoozedSnap.docs) {
      const booking = doc.data();
      try {
        await doc.ref.update({
          welcomeStatus: 'ready',
          welcomeSnoozedUntil: null,
        });
        await notifyAdminAndCohost({
          title: 'Welcome draft ready',
          body: `${booking.guestName || 'Guest'} — review and mark as sent`,
          type: 'welcome_ready',
          data: { bookingId: doc.id, targetPath: '/admin/bookings' },
        });
      } catch (err) {
        logger.error('[welcomeSweeper] snooze flip failed', { id: doc.id, err: err.message });
      }
    }

    // --- 2. Stuck pending → Error ---
    const pendingSnap = await db
      .collection('bookings')
      .where('welcomeStatus', '==', 'pending')
      .where('createdAt', '<=', tenMinAgoIso)
      .get();

    logger.info(`[welcomeSweeper] ${pendingSnap.size} pending drafts are stuck (>10 min)`);

    for (const doc of pendingSnap.docs) {
      try {
        await doc.ref.update({
          welcomeStatus: 'error',
          welcomeError: 'Generation timed out — click Retry',
        });
      } catch (err) {
        logger.error('[welcomeSweeper] pending→error failed', { id: doc.id, err: err.message });
      }
    }
  }
);
```

- [ ] **Step 2: Register the function in `functions/index.js`**

Edit `/Users/jperez/dev/casa-coqui/functions/index.js`. At the bottom of the file, add:

```js
// Scheduled sweepers
exports.welcomeSweeper = require('./scheduled').welcomeSweeper;
```

- [ ] **Step 3: Verify the functions emulator can load it**

```bash
cd /Users/jperez/dev/casa-coqui/functions && npm run build 2>/dev/null || node -e "require('./scheduled.js'); console.log('loads ok')"
```

Expected: `loads ok` printed. (If the project doesn't have a `build` script, the `node -e` fallback confirms no syntax errors.)

- [ ] **Step 4: Commit**

```bash
git add functions/scheduled.js functions/index.js
git commit -m "feat(functions): scheduled welcomeSweeper for snoozed→ready and stuck pending→error"
```

- [ ] **Step 5: Note — function is deployed in Task 19**

The function does nothing until `firebase deploy --only functions:welcomeSweeper` runs. Defer to Task 19.

---

### Task 7: Reply agent loads thread history by `threadKey`

**Files:**
- Modify: `functions/index.js:236-248`

- [ ] **Step 1: Copy `lib/thread-key.js` into functions deploy bundle**

Same pattern as the Lambda — the functions dir is a separate deploy:

```bash
cp /Users/jperez/dev/casa-coqui/lib/thread-key.js /Users/jperez/dev/casa-coqui/functions/lib/thread-key.js
```

- [ ] **Step 2: Replace the thread-loading block**

In `/Users/jperez/dev/casa-coqui/functions/index.js`, find:

```js
// Load conversation thread (previous messages in this booking)
let thread = [];
if (message.bookingId) {
  const threadSnap = await db
    .collection('airbnb_messages')
    .where('bookingId', '==', message.bookingId)
    .orderBy('receivedAt', 'asc')
    .limit(10)
    .get();
  thread = threadSnap.docs
    .filter((d) => d.id !== messageId) // exclude current message
    .map((d) => d.data());
}
```

Replace with:

```js
// Load conversation thread using threadKey so unmatched senders get their
// own per-sender thread context instead of lumping with other unknowns.
const { buildThreadKey } = require('./lib/thread-key');
const threadKey =
  message.threadKey ||
  buildThreadKey({
    bookingCode: message.bookingCode || null,
    senderEmail: message.senderEmail || message.fromAddress || null,
    senderName: message.guestName || message.fromName || null,
  });

let thread = [];
if (threadKey) {
  const threadSnap = await db
    .collection('airbnb_messages')
    .where('threadKey', '==', threadKey)
    .orderBy('receivedAt', 'asc')
    .limit(10)
    .get();
  thread = threadSnap.docs
    .filter((d) => d.id !== messageId) // exclude current message
    .map((d) => d.data());
}
```

- [ ] **Step 3: Verify the file still loads**

```bash
cd /Users/jperez/dev/casa-coqui/functions && node -e "require('./index.js'); console.log('loads ok')"
```

Expected: `loads ok` (may also emit Firebase init warnings — those are fine).

- [ ] **Step 4: Commit**

```bash
git add functions/lib/thread-key.js functions/index.js
git commit -m "feat(functions): reply agent loads thread history by threadKey"
```

---

### Task 8: Link-to-booking API route

**Files:**
- Create: `app/api/messages/threads/link/route.js`

- [ ] **Step 1: Create the route**

Create `/Users/jperez/dev/casa-coqui/app/api/messages/threads/link/route.js`:

```js
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/messages/threads/link
//
// Migrate an unmatched thread (threadKey starts with 'email:' or 'name:') to
// a real booking's thread key. Updates every airbnb_messages doc in the
// thread so it joins the booking's conversation.
//
// Body: { fromThreadKey: string, bookingId: string }
// ---------------------------------------------------------------------------

export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json().catch(() => ({}));
    const { fromThreadKey, bookingId } = body;

    if (!fromThreadKey || !bookingId) {
      return NextResponse.json(
        { success: false, error: 'fromThreadKey and bookingId are required.' },
        { status: 400 }
      );
    }

    const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Booking not found.' },
        { status: 404 }
      );
    }
    const booking = { id: bookingDoc.id, ...bookingDoc.data() };
    const newKey = booking.code;

    if (!newKey) {
      return NextResponse.json(
        { success: false, error: 'Booking is missing a code.' },
        { status: 400 }
      );
    }

    const snap = await adminDb
      .collection('airbnb_messages')
      .where('threadKey', '==', fromThreadKey)
      .get();

    if (snap.empty) {
      return NextResponse.json({ success: true, data: { migrated: 0 } });
    }

    // Batch in chunks of 500.
    let migrated = 0;
    let batch = adminDb.batch();
    let batchCount = 0;
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        threadKey: newKey,
        bookingId: booking.id,
        bookingCode: newKey,
      });
      batchCount++;
      migrated++;
      if (batchCount >= 500) {
        await batch.commit();
        batch = adminDb.batch();
        batchCount = 0;
      }
    }
    if (batchCount > 0) await batch.commit();

    return NextResponse.json({ success: true, data: { migrated, newThreadKey: newKey } });
  } catch (error) {
    console.error('[POST /api/messages/threads/link]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to link thread.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Smoke-test (dry — confirm 404 on missing booking)**

```bash
curl -X POST "http://localhost:3000/api/messages/threads/link" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"fromThreadKey":"email:nobody@example.com","bookingId":"does-not-exist"}'
```

Expected: `{"success":false,"error":"Booking not found."}` with HTTP 404.

- [ ] **Step 3: Commit**

```bash
git add app/api/messages/threads/link/route.js
git commit -m "feat(api): POST /messages/threads/link to migrate unmatched thread to booking"
```

---

## Phase 4 — i18n keys

### Task 9: Add new i18n keys

**Files:**
- Modify: `lib/i18n.js`

- [ ] **Step 1: Read existing welcome-related keys**

Open `/Users/jperez/dev/casa-coqui/lib/i18n.js` and search for `admin_book_welcome_` to find the existing key block. We'll extend both `en` and `es` locale objects.

- [ ] **Step 2: Add these keys to the `en` locale block**

Locate the English locale object in `lib/i18n.js` and add these entries next to the existing `admin_book_welcome_*` keys:

```js
// Welcome drafts — tabs, pills, actions
admin_book_tab_drafts: 'Drafts',
admin_book_tab_inhouse: 'In-house',
admin_book_tab_upcoming: 'Upcoming',
admin_book_tab_past: 'Past',
admin_book_pill_ready: '✉ Ready',
admin_book_pill_generating: '✉ Generating…',
admin_book_pill_snoozed: '⏱ Snoozed',
admin_book_pill_sent: '✉ Sent',
admin_book_pill_skipped: '✉ Skipped',
admin_book_pill_error: '⚠ Error',
admin_book_pill_cancelled: 'Cancelled',
admin_book_pill_inhouse: '🏠 In-house',
admin_book_pill_past: 'Past',
admin_book_welcome_sendLater: '⏱ Send later',
admin_book_welcome_retry: '↻ Retry',
admin_book_welcome_error: 'Generation failed',
admin_book_welcome_snoozedUntil: 'Snoozed until {when}',

// Mark-as-sent modal
admin_book_markSent_title: 'Mark welcome as sent',
admin_book_markSent_hint: 'Edit the text below to match what you pasted into Airbnb. Saved to the guest\'s conversation.',
admin_book_markSent_confirm: 'Mark as Sent',
admin_book_markSent_cancel: 'Cancel',

// Send-later picker
admin_book_sendLater_title: 'Send later',
admin_book_sendLater_tomorrow: 'Tomorrow morning',
admin_book_sendLater_dayBefore: 'Day before check-in',
admin_book_sendLater_morningOf: 'Morning of check-in',
admin_book_sendLater_custom: 'Pick date & time…',
admin_book_sendLater_confirm: 'Snooze',

// Messages page — unmatched
admin_msg_unmatched_badge: '⚠ Unmatched',
admin_msg_unmatched_hint: 'No booking linked yet.',
admin_msg_link_button: 'Link to booking →',
admin_msg_link_title: 'Link this thread to a booking',
admin_msg_link_confirm: 'Link',
```

- [ ] **Step 3: Add Spanish translations to the `es` locale block**

```js
// Welcome drafts — tabs, pills, actions
admin_book_tab_drafts: 'Borradores',
admin_book_tab_inhouse: 'En casa',
admin_book_tab_upcoming: 'Próximos',
admin_book_tab_past: 'Pasados',
admin_book_pill_ready: '✉ Listo',
admin_book_pill_generating: '✉ Generando…',
admin_book_pill_snoozed: '⏱ Pospuesto',
admin_book_pill_sent: '✉ Enviado',
admin_book_pill_skipped: '✉ Omitido',
admin_book_pill_error: '⚠ Error',
admin_book_pill_cancelled: 'Cancelado',
admin_book_pill_inhouse: '🏠 En casa',
admin_book_pill_past: 'Pasado',
admin_book_welcome_sendLater: '⏱ Enviar más tarde',
admin_book_welcome_retry: '↻ Reintentar',
admin_book_welcome_error: 'Falló la generación',
admin_book_welcome_snoozedUntil: 'Pospuesto hasta {when}',

// Mark-as-sent modal
admin_book_markSent_title: 'Marcar bienvenida como enviada',
admin_book_markSent_hint: 'Edita el texto para que coincida con lo que pegaste en Airbnb. Se guarda en la conversación del huésped.',
admin_book_markSent_confirm: 'Marcar como enviada',
admin_book_markSent_cancel: 'Cancelar',

// Send-later picker
admin_book_sendLater_title: 'Enviar más tarde',
admin_book_sendLater_tomorrow: 'Mañana temprano',
admin_book_sendLater_dayBefore: 'Día antes del check-in',
admin_book_sendLater_morningOf: 'Día del check-in',
admin_book_sendLater_custom: 'Elegir fecha y hora…',
admin_book_sendLater_confirm: 'Posponer',

// Messages page — unmatched
admin_msg_unmatched_badge: '⚠ Sin vincular',
admin_msg_unmatched_hint: 'Aún no hay reserva vinculada.',
admin_msg_link_button: 'Vincular a reserva →',
admin_msg_link_title: 'Vincular este hilo a una reserva',
admin_msg_link_confirm: 'Vincular',
```

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.js
git commit -m "feat(i18n): add keys for bookings tabs, pills, modals, send-later picker"
```

---

## Phase 5 — Frontend: Bookings page

### Task 10: Create `StatusPill` component

**Files:**
- Create: `components/admin/StatusPill.js`

- [ ] **Step 1: Create the component**

Create `/Users/jperez/dev/casa-coqui/components/admin/StatusPill.js`:

```js
'use client';

import { t } from '@/lib/i18n';

/**
 * Renders a single colored pill reflecting a booking's welcome or lifecycle
 * state. Accepts one of: ready, generating, snoozed, sent, skipped, error,
 * cancelled, in_house, past, unmatched.
 */
export default function StatusPill({ status, locale = 'en' }) {
  const styleMap = {
    ready:      'bg-amber-100 text-amber-800',
    generating: 'bg-indigo-100 text-indigo-800',
    snoozed:    'bg-purple-100 text-purple-800',
    sent:       'bg-emerald-100 text-emerald-800',
    skipped:    'bg-gray-200 text-gray-600',
    error:      'bg-red-100 text-red-700',
    cancelled:  'bg-red-100 text-red-700',
    in_house:   'bg-blue-100 text-blue-800',
    past:       'bg-gray-100 text-gray-600',
    unmatched:  'bg-amber-50 text-amber-700 border border-amber-200',
  };

  const labelKeyMap = {
    ready:      'admin_book_pill_ready',
    generating: 'admin_book_pill_generating',
    snoozed:    'admin_book_pill_snoozed',
    sent:       'admin_book_pill_sent',
    skipped:    'admin_book_pill_skipped',
    error:      'admin_book_pill_error',
    cancelled:  'admin_book_pill_cancelled',
    in_house:   'admin_book_pill_inhouse',
    past:       'admin_book_pill_past',
    unmatched:  'admin_msg_unmatched_badge',
  };

  const cls = styleMap[status] || 'bg-gray-100 text-gray-600';
  const label = t(locale, labelKeyMap[status] || 'admin_book_pill_past');

  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold ${cls}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/StatusPill.js
git commit -m "feat(ui): StatusPill component for booking lifecycle states"
```

---

### Task 11: Refactor bookings page into tabbed layout

**Files:**
- Modify: `app/admin/bookings/page.js`

This is the largest UI change. It replaces the flat list with tabs and wires `StatusPill` + collapsed cards. The existing `WelcomeMessagePanel` stays for now but gets wrapped in a `<details>` element and new actions get added in Tasks 12–14.

- [ ] **Step 1: Add tab state + derive tab lists**

At the top of the default export component in `/Users/jperez/dev/casa-coqui/app/admin/bookings/page.js`, add (inside the component, next to existing hooks):

```js
import StatusPill from '@/components/admin/StatusPill';

// … existing code inside the component …

const [activeTab, setActiveTab] = useState(null); // null until we've decided default

// Classify each booking into exactly one tab.
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const tabBuckets = { drafts: [], inhouse: [], upcoming: [], past: [] };
for (const b of bookings) {
  if (b.status === 'cancelled' || (b.checkOutDate && b.checkOutDate < today)) {
    tabBuckets.past.push(b);
    continue;
  }
  if (b.welcomeStatus === 'ready' && b.status === 'active') {
    tabBuckets.drafts.push(b); // Drafts is derived from welcomeStatus only
  }
  if (b.status === 'active') {
    if (b.checkInDate && b.checkOutDate && b.checkInDate <= today && today <= b.checkOutDate) {
      tabBuckets.inhouse.push(b);
    } else if (b.checkInDate && b.checkInDate > today) {
      tabBuckets.upcoming.push(b);
    }
  }
}

// Default tab logic: run once after bookings load.
useEffect(() => {
  if (activeTab !== null) return;
  if (tabBuckets.drafts.length > 0) setActiveTab('drafts');
  else if (tabBuckets.inhouse.length > 0) setActiveTab('inhouse');
  else setActiveTab('upcoming');
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [bookings.length]);
```

Note: a booking with `welcomeStatus === 'ready'` can appear in both Drafts and Upcoming — that's intentional; Drafts is a view, not a partition.

- [ ] **Step 2: Replace the flat list markup with tab bar + active panel**

Find the JSX that renders `bookings.map((b) => <BookingCard />)` (or the equivalent rendering each booking card inline). Replace with:

```jsx
{activeTab && (
  <>
    <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
      {[
        { id: 'drafts',   label: t(locale, 'admin_book_tab_drafts'),   count: tabBuckets.drafts.length },
        { id: 'inhouse',  label: t(locale, 'admin_book_tab_inhouse'),  count: tabBuckets.inhouse.length },
        { id: 'upcoming', label: t(locale, 'admin_book_tab_upcoming'), count: tabBuckets.upcoming.length },
        { id: 'past',     label: t(locale, 'admin_book_tab_past'),     count: tabBuckets.past.length },
      ].map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`px-4 py-2 text-sm border-b-2 whitespace-nowrap ${
            activeTab === tab.id
              ? 'text-coqui-700 border-coqui-600 font-semibold'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          }`}
        >
          {tab.label}
          {tab.count > 0 && (
            <span className={`inline-block ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              tab.id === 'drafts' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
            }`}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>

    <div className="space-y-2">
      {tabBuckets[activeTab].length === 0 && (
        <p className="text-center text-sm text-gray-500 py-10">
          {activeTab === 'drafts'
            ? 'No welcome drafts waiting. 🎉'
            : 'Nothing here yet.'}
        </p>
      )}
      {tabBuckets[activeTab].map((booking, idx) => (
        <details
          key={booking.id}
          open={activeTab === 'drafts' && idx === 0}
          className="bg-white border border-gray-200 rounded-xl p-4 group"
        >
          <summary className="flex justify-between items-start cursor-pointer list-none">
            <div>
              <div className="font-semibold text-gray-900">{booking.guestName}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                📅 {booking.checkInDate} → {booking.checkOutDate} · {booking.unit}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getPillForBooking(booking, today).map((s) => (
                <StatusPill key={s} status={s} locale={locale} />
              ))}
              <span className="text-gray-400 text-xs group-open:rotate-90 transition-transform">▸</span>
            </div>
          </summary>

          <div className="mt-3">
            {/* Existing booking metadata block — keep as-is (dates, code, link, Edit/Cancel) */}
            {/* Existing <WelcomeMessagePanel booking={booking} user={user} /> — keep as-is for now */}
            <WelcomeMessagePanel booking={booking} user={user} />
          </div>
        </details>
      ))}
    </div>
  </>
)}
```

- [ ] **Step 3: Add `getPillForBooking` helper above the component**

At module scope near other helpers in `app/admin/bookings/page.js`:

```js
// Returns the status pills to show for a booking (may be multiple).
function getPillForBooking(booking, today) {
  const pills = [];
  if (booking.status === 'cancelled') pills.push('cancelled');
  else if (booking.checkOutDate && booking.checkOutDate < today) pills.push('past');
  else if (booking.checkInDate && booking.checkOutDate &&
           booking.checkInDate <= today && today <= booking.checkOutDate) {
    pills.push('in_house');
  }

  // Welcome pill — only if there's a meaningful state.
  switch (booking.welcomeStatus) {
    case 'ready':      pills.push('ready'); break;
    case 'pending':    pills.push('generating'); break;
    case 'snoozed':    pills.push('snoozed'); break;
    case 'sent':       pills.push('sent'); break;
    case 'skipped':    pills.push('skipped'); break;
    case 'error':      pills.push('error'); break;
    default: break;
  }
  return pills;
}
```

- [ ] **Step 4: Start dev server and manually verify tabs render**

```bash
cd /Users/jperez/dev/casa-coqui && npm run dev
```

Open `http://localhost:3000/admin/bookings`, log in as admin. Verify:
- Tab bar shows with counts.
- Default tab is Drafts (or In-house / Upcoming if no drafts).
- First card in Drafts is expanded; others collapsed.
- Clicking each tab switches the visible list.
- Status pills render next to guest name.

- [ ] **Step 5: Commit**

```bash
git add app/admin/bookings/page.js
git commit -m "feat(admin): tabbed bookings page with collapsed cards and status pills"
```

---

### Task 12: Mark-as-Sent modal (edit before confirm)

**Files:**
- Create: `components/admin/WelcomeMarkSentModal.js`
- Modify: `app/admin/bookings/page.js` (wire into `WelcomeMessagePanel`'s Mark as Sent handler)

- [ ] **Step 1: Create the modal component**

Create `/Users/jperez/dev/casa-coqui/components/admin/WelcomeMarkSentModal.js`:

```js
'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';

export default function WelcomeMarkSentModal({ open, initialText, locale = 'en', onConfirm, onCancel }) {
  const [text, setText] = useState(initialText || '');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function handleConfirm() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onConfirm(text.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          {t(locale, 'admin_book_markSent_title')}
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          {t(locale, 'admin_book_markSent_hint')}
        </p>
        <textarea
          className="w-full h-48 p-3 border border-gray-300 rounded-lg text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-coqui-500"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg disabled:opacity-50"
          >
            {t(locale, 'admin_book_markSent_cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !text.trim()}
            className="px-4 py-2 text-sm bg-coqui-600 text-white rounded-lg font-semibold hover:bg-coqui-700 disabled:opacity-50"
          >
            {saving ? '…' : t(locale, 'admin_book_markSent_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the modal into `WelcomeMessagePanel`**

Edit `/Users/jperez/dev/casa-coqui/app/admin/bookings/page.js`. At the top of the file add the import:

```js
import WelcomeMarkSentModal from '@/components/admin/WelcomeMarkSentModal';
```

Inside the `WelcomeMessagePanel` function component, add modal state:

```js
const [showMarkSent, setShowMarkSent] = useState(false);
```

Replace the existing `handleMarkSent` implementation with:

```js
async function handleMarkSent(finalText) {
  setMarking(true);
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/bookings/${booking.id}/welcome`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ action: 'mark-sent', text: finalText }),
    });
    if (!res.ok) throw new Error(`mark-sent failed: ${res.status}`);
    setShowMarkSent(false);
  } catch (err) {
    console.error('[WelcomeMessagePanel] markSent failed:', err);
    alert('Failed to mark as sent — check console.');
  } finally {
    setMarking(false);
  }
}
```

Change the "Mark as Sent" button's `onClick={handleMarkSent}` to `onClick={() => setShowMarkSent(true)}`, and render the modal at the bottom of the panel JSX (just before the closing `</div>` of the component's outer wrapper):

```jsx
<WelcomeMarkSentModal
  open={showMarkSent}
  initialText={welcomeMessage || ''}
  locale={locale}
  onConfirm={handleMarkSent}
  onCancel={() => setShowMarkSent(false)}
/>
```

- [ ] **Step 3: Manual test**

Start dev server. Click Mark as Sent on a `ready` draft. Modal opens. Edit the text, click Confirm. Verify:
- Booking flips to `welcomeStatus: 'sent'` in Firestore (check the console/admin UI re-render).
- New `airbnb_messages` doc appears with `direction: 'outbound'`, `source: 'welcome_draft'`, `threadKey === booking.code`, and your edited text.
- Open `/admin/messages` → that guest's thread shows the welcome as the opening message.

- [ ] **Step 4: Commit**

```bash
git add components/admin/WelcomeMarkSentModal.js app/admin/bookings/page.js
git commit -m "feat(admin): Mark-as-Sent modal writes welcome to guest thread"
```

---

### Task 13: Send-later modal + snooze action

**Files:**
- Create: `components/admin/WelcomeSendLaterModal.js`
- Modify: `app/admin/bookings/page.js`

- [ ] **Step 1: Create the modal**

Create `/Users/jperez/dev/casa-coqui/components/admin/WelcomeSendLaterModal.js`:

```js
'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import { computeDefaultSnoozeIso } from '@/lib/welcome-status';

export default function WelcomeSendLaterModal({ open, checkInDate, locale = 'en', onConfirm, onCancel }) {
  const presets = [
    { id: 'tomorrow',    labelKey: 'admin_book_sendLater_tomorrow',    iso: () => {
        const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString();
    }},
    { id: 'dayBefore',   labelKey: 'admin_book_sendLater_dayBefore',   iso: () => computeDefaultSnoozeIso(checkInDate) },
    { id: 'morningOf',   labelKey: 'admin_book_sendLater_morningOf',   iso: () => {
        if (!checkInDate) return null;
        const [y, m, d] = checkInDate.split('-').map(Number);
        return new Date(y, m - 1, d, 9, 0, 0, 0).toISOString();
    }},
    { id: 'custom',      labelKey: 'admin_book_sendLater_custom',      iso: null },
  ];

  const defaultPresetId = checkInDate ? 'dayBefore' : 'tomorrow';
  const [selected, setSelected] = useState(defaultPresetId);
  const [customDt, setCustomDt] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  function currentIso() {
    if (selected === 'custom') {
      if (!customDt) return null;
      const d = new Date(customDt);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const preset = presets.find((p) => p.id === selected);
    return preset?.iso ? preset.iso() : null;
  }

  async function handleConfirm() {
    const iso = currentIso();
    if (!iso) return;
    setSaving(true);
    try {
      await onConfirm(iso);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          {t(locale, 'admin_book_sendLater_title')}
        </h3>
        <div className="space-y-2">
          {presets.map((p) => {
            const disabled = p.id !== 'custom' && p.id !== 'tomorrow' && !checkInDate;
            return (
              <label key={p.id} className={`flex items-center gap-2 p-2 border rounded-lg text-sm cursor-pointer ${
                selected === p.id ? 'border-coqui-600 bg-coqui-50' : 'border-gray-200'
              } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <input
                  type="radio"
                  name="snooze-preset"
                  value={p.id}
                  checked={selected === p.id}
                  onChange={() => setSelected(p.id)}
                  disabled={disabled}
                />
                {t(locale, p.labelKey)}
              </label>
            );
          })}
          {selected === 'custom' && (
            <input
              type="datetime-local"
              value={customDt}
              onChange={(e) => setCustomDt(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm"
            />
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            {t(locale, 'admin_book_markSent_cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !currentIso()}
            className="px-4 py-2 text-sm bg-coqui-600 text-white rounded-lg font-semibold hover:bg-coqui-700 disabled:opacity-50"
          >
            {saving ? '…' : t(locale, 'admin_book_sendLater_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `WelcomeMessagePanel`**

In `app/admin/bookings/page.js`, add the import + state:

```js
import WelcomeSendLaterModal from '@/components/admin/WelcomeSendLaterModal';

// inside WelcomeMessagePanel:
const [showSendLater, setShowSendLater] = useState(false);

async function handleSnooze(snoozedUntilIso) {
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/bookings/${booking.id}/welcome`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ action: 'snooze', snoozedUntil: snoozedUntilIso }),
    });
    if (!res.ok) throw new Error(`snooze failed: ${res.status}`);
    setShowSendLater(false);
  } catch (err) {
    console.error('[WelcomeMessagePanel] snooze failed:', err);
    alert('Failed to snooze — check console.');
  }
}
```

Add a new button next to Regenerate in the panel's action row:

```jsx
<button
  onClick={() => setShowSendLater(true)}
  className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 min-h-[36px] bg-white border border-gray-300 text-gray-700 active:bg-gray-50"
>
  {t(locale, 'admin_book_welcome_sendLater')}
</button>
```

And render the modal:

```jsx
<WelcomeSendLaterModal
  open={showSendLater}
  checkInDate={booking.checkInDate}
  locale={locale}
  onConfirm={handleSnooze}
  onCancel={() => setShowSendLater(false)}
/>
```

- [ ] **Step 3: Manual test**

Click Send later on a draft. Pick "Day before check-in". Confirm. Verify the booking flipped to `welcomeStatus: 'snoozed'` with `welcomeSnoozedUntil` set. Card leaves Drafts tab.

- [ ] **Step 4: Commit**

```bash
git add components/admin/WelcomeSendLaterModal.js app/admin/bookings/page.js
git commit -m "feat(admin): Send-later modal with day-before-checkin default"
```

---

### Task 14: Error state + Retry button

**Files:**
- Modify: `app/admin/bookings/page.js` (inside `WelcomeMessagePanel`)

- [ ] **Step 1: Render error panel and Retry button**

In `WelcomeMessagePanel` inside `app/admin/bookings/page.js`, add a branch before the `isPending` render:

```jsx
{welcomeStatus === 'error' && (
  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-3">
    <p className="text-xs text-red-700 font-medium mb-1">
      ⚠ {t(locale, 'admin_book_welcome_error')}
    </p>
    {booking.welcomeError && (
      <p className="text-[11px] text-red-600/80">{booking.welcomeError}</p>
    )}
    <button
      onClick={handleRegenerate}
      disabled={regenerating}
      className="mt-2 px-3 py-1.5 text-xs bg-white border border-red-300 text-red-700 rounded-lg hover:bg-red-100 disabled:opacity-50"
    >
      {t(locale, 'admin_book_welcome_retry')}
    </button>
  </div>
)}
```

Also, in the top-level guard `if (!welcomeStatus || welcomeStatus === 'sent') return null;` — keep as is (error and snoozed should still render).

- [ ] **Step 2: Manual test**

Simulate: in Firestore console, set a booking's `welcomeStatus: 'error'` + `welcomeError: 'Test error'`. Reload the admin page. Verify red error panel renders with Retry button. Click Retry — it calls the existing regenerate endpoint (unchanged).

- [ ] **Step 3: Commit**

```bash
git add app/admin/bookings/page.js
git commit -m "feat(admin): error state with Retry button for failed welcome drafts"
```

---

## Phase 6 — Frontend: Messages page

### Task 15: Thread grouping by `threadKey` + Unmatched badge

**Files:**
- Modify: `app/admin/messages/page.js`

- [ ] **Step 1: Replace `buildThreads` to key on `threadKey`**

In `/Users/jperez/dev/casa-coqui/app/admin/messages/page.js`, find the existing `buildThreads` function (around lines 61-86). Replace with:

```js
import { buildThreadKey, isUnmatchedKey } from '@/lib/thread-key';

function buildThreads(messages) {
  const threadMap = {};
  for (const msg of messages) {
    const key =
      msg.threadKey ||
      buildThreadKey({
        bookingCode: msg.bookingCode || null,
        senderEmail: msg.senderEmail || msg.fromAddress || null,
        senderName: msg.guestName || msg.fromName || null,
      });

    if (!threadMap[key]) {
      threadMap[key] = {
        threadKey: key,
        bookingCode: isUnmatchedKey(key) ? null : key,
        guestName: msg.guestName || msg.fromName || key,
        messages: [],
        lastMessage: null,
        unreadCount: 0,
        unmatched: isUnmatchedKey(key),
      };
    }
    threadMap[key].messages.push(msg);
    if (!threadMap[key].lastMessage || compareFirestoreDates(msg.createdAt, threadMap[key].lastMessage.createdAt) > 0) {
      threadMap[key].lastMessage = msg;
    }
    if (msg.sender === 'guest' && !msg.read) {
      threadMap[key].unreadCount += 1;
    }
  }
  return Object.values(threadMap).sort((a, b) =>
    compareFirestoreDates(b.lastMessage?.createdAt, a.lastMessage?.createdAt)
  );
}
```

- [ ] **Step 2: Render the ⚠ Unmatched badge on thread rows**

Find where threads are rendered in the left list. For each thread row, add:

```jsx
{thread.unmatched && (
  <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full">
    {t(locale, 'admin_msg_unmatched_badge')}
  </span>
)}
```

- [ ] **Step 3: Verify existing threads still render**

Start dev server, open `/admin/messages`. Verify:
- Existing matched threads still group correctly by booking.
- Any thread whose messages have `threadKey` starting with `email:` or `name:` shows the ⚠ Unmatched badge.
- Clicking a thread opens its conversation as before.

- [ ] **Step 4: Commit**

```bash
git add app/admin/messages/page.js
git commit -m "feat(admin): messages page groups by threadKey + unmatched badge"
```

---

### Task 16: Link-to-booking modal on unmatched threads

**Files:**
- Create: `components/admin/LinkToBookingModal.js`
- Modify: `app/admin/messages/page.js`

- [ ] **Step 1: Create the modal**

Create `/Users/jperez/dev/casa-coqui/components/admin/LinkToBookingModal.js`:

```js
'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { t } from '@/lib/i18n';

export default function LinkToBookingModal({ open, threadKey, guestName, user, locale = 'en', onLinked, onCancel }) {
  const [bookings, setBookings] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    async function load() {
      const q = query(collection(db, 'bookings'), where('status', '==', 'active'));
      const snap = await getDocs(q);
      setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }
    load();
  }, [open]);

  if (!open) return null;

  async function handleLink() {
    if (!selectedId) return;
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/messages/threads/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ fromThreadKey: threadKey, bookingId: selectedId }),
      });
      if (!res.ok) throw new Error(`link failed: ${res.status}`);
      const data = await res.json();
      onLinked(data?.data?.newThreadKey || null);
    } catch (err) {
      console.error('[LinkToBookingModal] failed:', err);
      alert('Failed to link — check console.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">{t(locale, 'admin_msg_link_title')}</h3>
        <p className="text-xs text-gray-500 mb-3">Sender: <b>{guestName}</b></p>
        <select
          className="w-full p-2 border border-gray-300 rounded-lg text-sm"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">— Select a booking —</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.guestName} · {b.checkInDate} → {b.checkOutDate} · {b.unit}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            {t(locale, 'admin_book_markSent_cancel')}
          </button>
          <button
            onClick={handleLink}
            disabled={saving || !selectedId}
            className="px-4 py-2 text-sm bg-coqui-600 text-white rounded-lg font-semibold hover:bg-coqui-700 disabled:opacity-50"
          >
            {saving ? '…' : t(locale, 'admin_msg_link_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into messages page**

In `app/admin/messages/page.js` add the import and state:

```js
import LinkToBookingModal from '@/components/admin/LinkToBookingModal';

// inside the default export component:
const [linkTarget, setLinkTarget] = useState(null); // { threadKey, guestName } or null
```

In the thread detail/header (where a specific thread is displayed after selecting), when the thread is unmatched, render a "Link to booking" button:

```jsx
{selectedThread?.unmatched && (
  <button
    onClick={() => setLinkTarget({ threadKey: selectedThread.threadKey, guestName: selectedThread.guestName })}
    className="text-xs px-3 py-1.5 bg-coqui-600 text-white rounded-lg font-semibold hover:bg-coqui-700"
  >
    {t(locale, 'admin_msg_link_button')}
  </button>
)}
```

And render the modal at the end:

```jsx
<LinkToBookingModal
  open={!!linkTarget}
  threadKey={linkTarget?.threadKey}
  guestName={linkTarget?.guestName}
  user={user}
  locale={locale}
  onLinked={() => { setLinkTarget(null); /* Firestore listener will refresh threads */ }}
  onCancel={() => setLinkTarget(null)}
/>
```

- [ ] **Step 3: Manual test**

In Firestore console, create a synthetic unmatched doc under `airbnb_messages`:

```js
{
  bookingId: null, bookingCode: null,
  threadKey: 'email:test-unmatched@example.com',
  senderEmail: 'test-unmatched@example.com',
  guestName: 'Test Unmatched',
  direction: 'inbound',
  sender: 'guest',
  body: 'Hi — can you help?',
  read: false,
  createdAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  source: 'inbound',
}
```

Open `/admin/messages`. Verify:
- A new thread appears with the ⚠ Unmatched badge.
- Open it — the "Link to booking →" button shows.
- Click it, pick a booking, confirm. The thread disappears from Unmatched and reappears under that booking.

- [ ] **Step 4: Commit**

```bash
git add components/admin/LinkToBookingModal.js app/admin/messages/page.js
git commit -m "feat(admin): Link-to-booking modal migrates unmatched threads"
```

---

## Phase 7 — Deploy + validation

### Task 17: Run the `threadKey` backfill

- [ ] **Step 1: Confirm dry-run output first**

```bash
cd /Users/jperez/dev/casa-coqui && node scripts/backfill-thread-keys.js | head -50
```

Review the `would set …` lines. Sanity check: most should be `threadKey = <bookingCode>` matching existing docs.

- [ ] **Step 2: Apply**

```bash
node scripts/backfill-thread-keys.js --apply
```

Expected: `Done. Updated N docs.` — where N matches the dry-run count.

- [ ] **Step 3: Confirm in Firestore**

Open Firestore console → `airbnb_messages` → spot-check 3–5 docs. Each should now have a `threadKey` field.

(No commit — this is a data migration, not a code change.)

---

### Task 18: Deploy Firestore rules, Cloud Functions, and Lambda

**Reminder:** Firestore rules are unchanged in this spec (the existing `allow write: if isAdmin()` already covers the new fields). Only functions + Lambda need deploys.

- [ ] **Step 1: Deploy Cloud Functions**

```bash
cd /Users/jperez/dev/casa-coqui && firebase deploy --only functions:welcomeSweeper,functions:onAirbnbMessageCreated
```

Expected: both functions deploy successfully. The sweeper shows up in GCP Scheduler.

- [ ] **Step 2: Deploy the Lambda (CDK)**

```bash
cd /Users/jperez/dev/casa-coqui/infra && npm install && npm run deploy
```

(If there's no `deploy` script, use `npx cdk deploy`.) Expected: Lambda function updated with the new threadKey-writing version.

- [ ] **Step 3: Push a test inbound to exercise the full path (optional)**

Forward a real Airbnb reservation email to the configured inbox. Within ~30 s verify:
- New booking appears in Firestore with `welcomeStatus: 'ready'` and a welcomeMessage.
- If the reservation email triggers an inbound guest message too, that message has `threadKey` set.
- Card appears in the Drafts tab.

---

### Task 19: Manual smoke tests from spec §10

Work through each of these end-to-end. Screenshot or note any failure.

- [ ] **Test 1 — Fresh forward to Drafts tab:** Forward a real Airbnb confirmation email. Within ~10s the booking lands in Drafts tab with `✉ Ready` pill.
- [ ] **Test 2 — Mark as Sent → thread:** Click Mark as Sent on a draft, edit the text, confirm. Navigate to `/admin/messages` → the guest's thread shows the welcome as the opening host message.
- [ ] **Test 3 — Send later round-trip:** Snooze a draft for 15 min. Card leaves Drafts. After sweeper fires (~15 min) the card returns to Drafts with `✉ Ready` and a staff push arrives.
- [ ] **Test 4 — Stuck pending → error:** Manually set a booking's `welcomeStatus: 'pending'` with `createdAt` 15 min ago. Trigger the sweeper via GCP Scheduler "Run now." Booking flips to `error` + `welcomeError` is set. Red error panel + Retry button renders.
- [ ] **Test 5 — Unmatched thread separation:** Create two synthetic inbound `airbnb_messages` docs with different `senderEmail`, `bookingId: null`, and no `threadKey`. After page reload, they appear as **two** distinct unmatched threads (not one lumped "unknown" row).
- [ ] **Test 6 — Link to booking:** On one of the unmatched threads, click Link to booking, pick a booking, confirm. Every doc in that thread's `threadKey` / `bookingId` / `bookingCode` now point to the selected booking. The thread appears under that booking.
- [ ] **Test 7 — Reply agent uses welcome context:** After marking a welcome as sent, force a new inbound `airbnb_messages` doc (same bookingId). Check `agent_runs` for the resulting generation — its `prompt` field should include the welcome message in `thread`.

---

## Self-review checklist

Covered every spec section:

- [x] §4 scope: `bookings` page tabs (Task 11), Messages grouping (Task 15), welcome API (Task 5), Lambda (Task 4), reply agent (Task 7), sweeper (Task 6), rules — no change needed (noted in Task 18), backfill (Tasks 3 + 17).
- [x] §5 data model: `threadKey`, `source`, `welcomeSnoozedUntil`, `welcomeError`, `welcomeSentText` all written by Tasks 4, 5, 6.
- [x] §6.1 tabs + default-tab logic: Task 11.
- [x] §6.2 Mark-as-Sent with modal: Tasks 5 + 12.
- [x] §6.3 Send-later: Tasks 5 + 13.
- [x] §6.4 Skip: Task 5.
- [x] §6.5 Regenerate: unchanged (existing POST route).
- [x] §6.6 Sweeper: Task 6.
- [x] §6.7 Messages unmatched + link: Tasks 8 + 15 + 16.
- [x] §7 API contract: Tasks 5 + 8.
- [x] §8 migration: Tasks 3 + 17.
- [x] §10 test plan: Task 19.

Type consistency: `buildThreadKey` signature `{bookingCode, senderEmail, senderName}` used consistently across Tasks 1, 4, 5, 7, 15. `welcomeStatus` enum values (`pending|ready|snoozed|sent|skipped|error`) used consistently across Tasks 2, 5, 6, 11, 14. PATCH body schema (`action`, `text`, `snoozedUntil`) matches between Tasks 5, 12, 13. Modal prop names (`open`, `onConfirm`, `onCancel`) consistent across Tasks 12, 13, 16.

No placeholders detected on scan.
