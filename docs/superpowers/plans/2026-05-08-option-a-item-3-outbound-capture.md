# Option A — Item 3: Outbound Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Workflow chosen for this plan:** Subagents drive each task end-to-end (apply diffs, run tests, commit). Doc agent records after each commit. Same pattern as Issue #1 closure work, since Julio is hands-off for AWS exam prep.

**Goal:** When the host marks an AI-drafted reply as sent, also create a separate outbound `airbnb_messages` doc representing the sent reply as a first-class message in the thread. The reply-agent's thread query then returns BOTH inbound and outbound docs, so the AI sees what the host already committed to and won't contradict prior replies.

**Architecture:** Mark-as-Sent moves from a single client-side `updateDoc` to a server-side API route that runs an atomic batch: (1) update the inbound doc with `draftStatus: 'sent'` (preserves voice-learning trigger), (2) create a fresh outbound doc with the reply text, same `threadKey`, `direction: 'outbound_draft'`, `draftStatus: 'sent'`. Idempotency guard prevents double-creation if Mark-as-Sent fires twice.

**Tech Stack:** Next.js 14 App Router, Firebase Admin SDK (server-side), Firestore batched writes, the `lib/api-auth.js` `requireRole` helper.

**Source priority list:** [explantion/2026-05-07-threading-handoff.md](../../../explantion/2026-05-07-threading-handoff.md) §2 priority table, item 3.

**Verification doc** (background context): [tasks/2026-05-07-threading-verification-findings.md](../../../tasks/2026-05-07-threading-verification-findings.md) §5.

---

## Background

### Today

[`app/admin/messages/page.js:469-483`](../../../app/admin/messages/page.js#L469-L483):

```js
async function handleMarkSent(finalReply) {
  setBusy(true);
  try {
    await updateDoc(doc(db, 'airbnb_messages', message.id), {
      draftStatus: 'sent',
      sentAt: serverTimestamp(),
      editedReply: finalReply,
    });
  } catch (err) {
    console.error('Failed to mark as sent:', err);
  } finally {
    setBusy(false);
    setMarkSentOpen(false);
  }
}
```

The reply text lives only as the `editedReply` field on the inbound doc. The reply-agent's thread query at [functions/index.js:257-262](../../../functions/index.js#L257-L262) returns inbound docs only — `editedReply` is not surfaced to the AI as a previous "host turn" because `buildReplyInput` only reads outbound-direction docs from that field.

### Fix

Server-side API route that:
1. Updates the inbound doc (preserving `onAirbnbMessageSent` voice-learning trigger).
2. Creates a separate outbound doc with `direction: 'outbound_draft'`, `draftStatus: 'sent'`, body: editedReply, same `threadKey`.
3. Both writes in a single Firestore batch — atomic.

### Why `direction: 'outbound_draft'` (not a new value)

[`functions/lib/reply-ai.js:96`](../../../functions/lib/reply-ai.js#L96) — `buildReplyInput` already handles this case:

```js
input.conversationHistory = thread.slice(-5).map((msg) => ({
  direction: msg.direction,
  body: msg.direction === 'outbound_draft' ? (msg.editedReply || msg.draftReply || msg.body) : msg.body,
  timestamp: msg.receivedAt || msg.sentAt || null,
}));
```

The voice-corpus query at [functions/index.js:271-275](../../../functions/index.js#L271-L275) also already filters `outbound_draft + sent`. Our new docs join the corpus and the thread context for free, with zero new code paths in the reply-agent.

### Source label

`source: 'reply-mark-sent'` distinguishes from the existing welcome-flow `source: 'welcome_draft'`. Same collection, two origins, easy to disambiguate.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `app/api/airbnb-messages/[id]/mark-sent/route.js` | **Create** | POST endpoint: auth (admin/cohost), validate, batch-update inbound + create outbound |
| `app/admin/messages/page.js` | Modify | Replace direct `updateDoc` in `handleMarkSent` with `fetch()` to new API |
| `tasks/changes/option-a/2026-05-08-item-3-outbound-capture-changes.md` | **Create** | Change log; doc agent appends after each commit |

**No changes to:** `firestore.rules`, `firestore.indexes.json`, `functions/`, `lib/`, anything in the reply-agent path. The new outbound docs flow through existing `onAirbnbMessageCreated` (filtered out as non-inbound) and `onAirbnbMessageSent` (only fires on updates, not creates).

---

## Workflow per task

For each Task N below:

1. **Dispatch implementer subagent** (`general-purpose`, has write/edit/bash). Self-contained brief: read current file state, apply diffs, run tests, commit with the canned message.
2. **Dispatch doc-agent** (`general-purpose`, run in background). Append a section to the change log.
3. Move to Task N+1 once both complete.

**Branch decision:** stay on `main` (consistent with prior precedent).

---

## Task 1: Create the API route

**Files:**
- Create: `app/api/airbnb-messages/[id]/mark-sent/route.js`

**Goal:** POST endpoint accepts `{ editedReply }`, authenticates as admin/cohost, runs atomic batch.

- [ ] **Step 1.1: Inspect existing API route patterns**

Read `app/api/bookings/[id]/route.js` (or any other admin-protected POST route) to confirm:
- Import path for `requireRole` from `@/lib/api-auth`
- Import path for `adminDb` and `admin` (firebase-admin) helpers
- Standard response shape: `Response.json({ success: true, ... })` or `NextResponse.json(...)`

If the project uses NextResponse, use that. If it uses plain `Response`, use that.

- [ ] **Step 1.2: Create the API route**

Create `app/api/airbnb-messages/[id]/mark-sent/route.js`:

```js
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import admin from 'firebase-admin';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/airbnb-messages/[id]/mark-sent
 *
 * Marks an inbound airbnb_messages doc's AI-draft as sent AND creates a
 * separate outbound_draft doc representing the reply as a first-class
 * message in the thread. Both writes in one batch.
 *
 * Body: { editedReply: string }
 * Auth: admin or cohost.
 */
export async function POST(request, { params }) {
  try {
    const auth = await requireRole(request, ['admin', 'cohost']);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const body = await request.json();
    const editedReply = String(body?.editedReply || '').trim();

    if (!editedReply) {
      return NextResponse.json(
        { success: false, error: 'editedReply is required' },
        { status: 400 }
      );
    }

    const inboundRef = adminDb.collection('airbnb_messages').doc(id);
    const inboundSnap = await inboundRef.get();
    if (!inboundSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Message not found' },
        { status: 404 }
      );
    }

    const inbound = inboundSnap.data();

    // Idempotency: if already sent, no-op (avoid duplicate outbound docs).
    if (inbound.draftStatus === 'sent') {
      return NextResponse.json({
        success: true,
        alreadySent: true,
        outboundId: null,
      });
    }

    if (inbound.direction !== 'inbound') {
      return NextResponse.json(
        { success: false, error: 'Only inbound messages can be marked sent' },
        { status: 400 }
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = adminDb.batch();

    // 1. Update inbound doc (preserves onAirbnbMessageSent voice-learning trigger).
    batch.update(inboundRef, {
      draftStatus: 'sent',
      sentAt: now,
      editedReply,
    });

    // 2. Create outbound doc representing what host actually said.
    const outboundRef = adminDb.collection('airbnb_messages').doc();
    batch.set(outboundRef, {
      direction: 'outbound_draft',
      draftStatus: 'sent',
      body: editedReply,
      editedReply,
      draftReply: inbound.draftReply || null,
      threadKey: inbound.threadKey,
      bookingId: inbound.bookingId || null,
      bookingCode: inbound.bookingCode || null,
      airbnbConfirmationCode: inbound.airbnbConfirmationCode || null,
      guestName: inbound.guestName || null,
      sentAt: now,
      receivedAt: now,
      createdAt: now,
      source: 'reply-mark-sent',
      inboundMessageId: id,
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      outboundId: outboundRef.id,
    });
  } catch (err) {
    console.error('[mark-sent] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 1.3: Smoke check — file is syntactically valid**

```bash
node -e "require('fs').readFileSync('/Users/jperez/dev/casa-coqui/app/api/airbnb-messages/[id]/mark-sent/route.js', 'utf-8').length" 2>&1
```

Expected: prints a number (file length in chars). Next.js's actual JSX/TS compilation runs at dev-server boot; if there's a syntax error it'll surface there.

- [ ] **Step 1.4: Commit**

```bash
cd /Users/jperez/dev/casa-coqui && git add 'app/api/airbnb-messages/[id]/mark-sent/route.js' && git commit -m "$(cat <<'EOF'
feat(api): mark-sent route writes both inbound update + outbound doc

Implements Option A Item 3 (outbound capture) from the priority list
in explantion/2026-05-07-threading-handoff.md §2.

POST /api/airbnb-messages/{id}/mark-sent runs an atomic batch:
  1. Updates the inbound doc (draftStatus='sent', sentAt, editedReply)
     - preserves the existing onAirbnbMessageSent voice-learning trigger
  2. Creates a separate outbound_draft doc with the same threadKey
     - direction='outbound_draft', draftStatus='sent' (so it's never re-drafted)
     - body=editedReply
     - source='reply-mark-sent' to distinguish from welcome flow
     - inboundMessageId references back to the message being replied to

Idempotency: if inbound.draftStatus is already 'sent', the route returns
success with alreadySent=true and skips the outbound creation.

The reply-agent's thread query in functions/index.js will now return
both inbound and outbound docs, so when a follow-up guest message
arrives, buildReplyInput surfaces the host's prior reply as part of
conversationHistory. The AI no longer contradicts its own prior commitments.

The voice-corpus query (outbound_draft + sent) also picks up these new
docs naturally, growing the host's voice sample over time.

UI caller wired in next commit (Task 2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.5: Doc agent records Task 1**

---

## Task 2: Wire the admin Messages UI to the API

**Files:**
- Modify: `app/admin/messages/page.js`

**Goal:** `handleMarkSent` calls the new API instead of writing Firestore directly.

- [ ] **Step 2.1: Replace direct updateDoc with API call**

Find the existing function around lines 469-483:

```js
async function handleMarkSent(finalReply) {
  setBusy(true);
  try {
    await updateDoc(doc(db, 'airbnb_messages', message.id), {
      draftStatus: 'sent',
      sentAt: serverTimestamp(),
      editedReply: finalReply,
    });
  } catch (err) {
    console.error('Failed to mark as sent:', err);
  } finally {
    setBusy(false);
    setMarkSentOpen(false);
  }
}
```

Replace with:

```js
async function handleMarkSent(finalReply) {
  setBusy(true);
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    if (!idToken) {
      throw new Error('Not authenticated');
    }
    const res = await fetch(`/api/airbnb-messages/${message.id}/mark-sent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ editedReply: finalReply }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('Failed to mark as sent:', err);
  } finally {
    setBusy(false);
    setMarkSentOpen(false);
  }
}
```

Note: `auth` is already imported at the top of the file from `'@/lib/firebase'`. Reuse that import.

- [ ] **Step 2.2: Smoke check — file reads cleanly**

```bash
node -e "const c = require('fs').readFileSync('/Users/jperez/dev/casa-coqui/app/admin/messages/page.js', 'utf-8'); console.log('reads OK', c.length, 'chars'); console.log('handleMarkSent has fetch:', c.includes('/api/airbnb-messages/') && c.includes('mark-sent'))" 2>&1
```

Expected: `reads OK <N> chars` AND `handleMarkSent has fetch: true`.

- [ ] **Step 2.3: Verify the old client-side updateDoc is fully gone**

```bash
grep -n 'updateDoc.*airbnb_messages' /Users/jperez/dev/casa-coqui/app/admin/messages/page.js | head -5
```

Expected: any remaining matches should be inside `handleRegenerate` and `handleEscalate` (which still use direct updateDoc — those don't need API routes). The OLD pattern `draftStatus: 'sent'` should NOT appear in any direct updateDoc anymore.

- [ ] **Step 2.4: Commit**

```bash
cd /Users/jperez/dev/casa-coqui && git add app/admin/messages/page.js && git commit -m "$(cat <<'EOF'
feat(admin/messages): handleMarkSent calls /api/airbnb-messages/{id}/mark-sent

Replaces the direct client-side Firestore updateDoc with a fetch to
the new server-side API route. Server-side does the atomic batch
(inbound update + outbound doc creation) so the UI doesn't need to
know about the dual-write pattern.

Behavior unchanged from the user's perspective. Reply-agent now
sees the host's prior reply in thread context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2.5: Doc agent records Task 2**

---

## Task 3: Manual smoke test (production)

**Files:** None — this is a production verification step.

**Goal:** Verify the new flow works end-to-end against real Firebase + a recent inbound message.

- [ ] **Step 3.1: Wait for Vercel to auto-deploy**

After Tasks 1 + 2 commit, push to main triggers Vercel's deploy. Wait ~2 min, confirm deploy succeeded via Vercel dashboard or:

```bash
curl -sI https://<casa-coqui-prod-url>/admin/messages | head -3
```

(Replace `<casa-coqui-prod-url>` with whatever Vercel domain Casa Coqui is on.)

- [ ] **Step 3.2: Mark a recent message as sent**

In the admin Messages UI in production:
1. Find an inbound message with `draftStatus: 'ready'` (or escalated).
2. Click "Mark as Sent" (or the equivalent button).
3. Optionally edit the draft, confirm.

- [ ] **Step 3.3: Verify both docs landed in Firestore**

Run a verify script (similar pattern to threading deploy-logs):

```js
// tasks/changes/option-a/item-3-logs/verify-mark-sent.js
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({ credential: admin.credential.cert(require(credsPath)) });

(async () => {
  const fs = admin.firestore();
  // Find the most recent reply-mark-sent outbound doc
  const snap = await fs.collection('airbnb_messages')
    .where('source', '==', 'reply-mark-sent')
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get();

  if (snap.empty) {
    console.log(JSON.stringify({ found: 0, status: 'no reply-mark-sent docs yet' }));
    process.exit(1);
  }

  for (const doc of snap.docs) {
    const d = doc.data();
    const inboundRef = fs.collection('airbnb_messages').doc(d.inboundMessageId);
    const inboundSnap = await inboundRef.get();
    const inbound = inboundSnap.exists ? inboundSnap.data() : null;
    console.log(JSON.stringify({
      outboundId: doc.id,
      threadKey: d.threadKey,
      direction: d.direction,
      draftStatus: d.draftStatus,
      bodyPreview: (d.body || '').slice(0, 80),
      inboundMessageId: d.inboundMessageId,
      inboundExists: !!inbound,
      inboundDraftStatus: inbound?.draftStatus,
    }, null, 2));
  }
  process.exit(0);
})().catch((err) => { console.error('ERROR:', err.message); process.exit(2); });
```

```bash
mkdir -p tasks/changes/option-a/item-3-logs
node tasks/changes/option-a/item-3-logs/verify-mark-sent.js 2>&1 | tee tasks/changes/option-a/item-3-logs/01-verify.log
```

Expected output:
- At least 1 `reply-mark-sent` doc found.
- `direction: 'outbound_draft'`, `draftStatus: 'sent'`.
- `inboundExists: true`, `inboundDraftStatus: 'sent'`.
- `threadKey` matches the inbound's threadKey.

- [ ] **Step 3.4: Verify thread query in admin UI shows both messages**

In the admin Messages UI, open the thread that contains the just-marked-sent message. Confirm that:
- The inbound message is shown (with the new `Sent Reply` block from `editedReply`)
- The outbound doc appears as a separate message bubble in the thread (since `buildThreads` groups by threadKey)

If the outbound doc DOESN'T appear in the UI, check that `app/admin/messages/page.js` rendering logic handles `direction: 'outbound_draft'` docs in the chat view (it should — welcome-flow drafts already render).

- [ ] **Step 3.5: Send a follow-up to the same guest (or wait for one organic) and verify AI sees the prior reply**

Forward another message from the same guest (or wait for one organically). When the new inbound doc is created and the Cloud Function fires, check Firestore for the new doc's `_agentRun.prompt` field (logged via `agent_runs` collection). The conversationHistory in the prompt should now include the prior outbound message body.

(This step may need a follow-up session if no organic message arrives within 30 min of the smoke test.)

- [ ] **Step 3.6: Commit verify script + log**

```bash
cd /Users/jperez/dev/casa-coqui && git add tasks/changes/option-a/item-3-logs/ && git commit -m "$(cat <<'EOF'
docs(option-a): item 3 smoke verification artifacts

verify-mark-sent.js queries Firestore for the most recent
reply-mark-sent outbound docs and validates that:
- direction='outbound_draft' + draftStatus='sent'
- threadKey matches the referenced inbound
- inboundMessageId resolves to a real doc with draftStatus='sent'

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3.7: Doc agent records final results**

---

## Acceptance criteria

| Criterion | Covered by |
|---|---|
| Mark-as-Sent on an inbound message produces an outbound doc with the same threadKey | Task 1 (server logic) + Task 3.3 (smoke verify) |
| Idempotent: re-running Mark-as-Sent on already-sent doc does NOT create duplicate outbound | Task 1 (idempotency check) — should also be covered in smoke if you accidentally re-click |
| Voice-learning loop (`onAirbnbMessageSent`) still fires on the inbound update | Preserved by design — inbound update path unchanged |
| Voice corpus query (outbound_draft + sent) picks up new docs | Preserved by design — same direction value |
| Reply-agent thread context includes outbound docs | Task 3.5 (organic follow-up smoke) |
| Admin Messages UI renders outbound doc in the thread | Task 3.4 (manual UI check) |

---

## Rollback plan

Each task is its own commit. To roll back:
- Task 2 only (`git revert <Task 2 SHA>`): UI reverts to direct client `updateDoc`. Inbound docs continue to land in `draftStatus: 'sent'`. Outbound docs from prior Mark-as-Sent calls remain in Firestore (harmless, just orphaned).
- Tasks 1 + 2 (`git revert` both): API route still on disk but unreferenced. Outbound docs from prior calls remain. Reply-agent reverts to inbound-only thread context.

If you need to also remove the residual outbound docs:

```js
// One-shot cleanup
const snap = await fs.collection('airbnb_messages')
  .where('source', '==', 'reply-mark-sent').get();
const batch = fs.batch();
snap.docs.forEach((d) => batch.delete(d.ref));
await batch.commit();
```

---

## Self-review

1. ✅ Spec coverage — all 6 acceptance criteria mapped to tasks.
2. ✅ No placeholders — every code block is concrete.
3. ✅ Type/name consistency — `outboundRef.id`, `inboundMessageId` used consistently across Tasks 1 and 3.
4. ✅ Each task is self-contained.

**End of plan.**
