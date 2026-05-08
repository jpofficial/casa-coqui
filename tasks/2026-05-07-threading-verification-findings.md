# Threading Audit — Code Verification Findings

**Date**: 2026-05-07
**Verifier**: fresh session (post-Phase-2 hand-off)
**Source spec**: `explantion/2026-05-07-threading-handoff.md` §3

---

## Verified findings

### Claim 1: Thread key fallback hierarchy
**Status**: NUANCED (substantively TRUE, but the agents missed a tier)

**Evidence**: [lib/thread-key.js:17-28](lib/thread-key.js#L17-L28)

```js
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
```

**Notes**:
- Actual fallback is **4-tier**, not 3: `bookingCode → email: → name: → 'unknown'`. The `'unknown'` literal is a real bucket — the agents flagged this as a bug elsewhere ("collapses ALL unmatched into ONE thread") but didn't enumerate it as a tier.
- The function does NOT take `unitId`, `receivedAt`, or any temporal/property dimension as input. The agents' worry about `email:express@airbnb.com` collapsing all unmatched messages is real: every Airbnb-forwarded conversation arrives from `express@airbnb.com`, so when bookingCode extraction fails, all unmatched senders land in `email:express@airbnb.com` together.
- An `isUnmatchedKey()` helper exists ([lib/thread-key.js:31-38](lib/thread-key.js#L31-L38)) and is consumed by `app/admin/messages/page.js` to render the "unmatched" badge.

---

### Claim 2: `In-Reply-To` and `References` headers are read but not used
**Status**: TRUE (stronger than the agents claimed — they're not even *read*)

**Evidence**:
- `rg -n "inReplyTo|in-reply-to|In-Reply-To|references|References" infra/lambda/parse-airbnb-email/ functions/lib/ functions/index.js` returns **zero matches**.
- [infra/lambda/parse-airbnb-email/index.js:628-636](infra/lambda/parse-airbnb-email/index.js#L628-L636) only extracts `subject`, `fromName`, `fromAddress`, `bodyText`, `receivedAt`, and `messageId` from the parsed MIME object.

**Notes**:
- `mailparser`'s `simpleParser()` automatically populates `parsed.inReplyTo` (string) and `parsed.references` (string | string[]) from the RFC 5322 headers — the data is available in the parsed object but never inspected and never persisted to Firestore.
- This means a fix would be ~5 lines: pull from `parsed.inReplyTo` / `parsed.references` and write them onto `airbnb_messages` docs as new fields. Index later for parent-child reconstruction.
- The agents said `rfcMessageId` is used "only for dedup (~lines 660-670)" — that's confirmed at [infra/lambda/parse-airbnb-email/index.js:478-485](infra/lambda/parse-airbnb-email/index.js#L478-L485) and [660-670](infra/lambda/parse-airbnb-email/index.js#L660-L670).

---

### Claim 3: Context window cap is "last 5 messages"
**Status**: NUANCED (TRUE in `buildReplyInput`, but the load path is `.limit(10)` — there's a 10→5 funnel)

**Evidence**:
- Trim happens at [functions/lib/reply-ai.js:93-99](functions/lib/reply-ai.js#L93-L99):
  ```js
  if (thread && thread.length > 0) {
    input.conversationHistory = thread.slice(-5).map((msg) => ({ ... }));
  }
  ```
- BUT the Firestore load at [functions/index.js:256-266](functions/index.js#L256-L266) reads up to 10 first:
  ```js
  const threadSnap = await db
    .collection('airbnb_messages')
    .where('threadKey', '==', threadKey)
    .orderBy('receivedAt', 'asc')
    .limit(10)
    .get();
  thread = threadSnap.docs
    .filter((d) => d.id !== messageId)
    .map((d) => d.data());
  ```
- The current message is filtered out, so up to 9 prior messages enter `buildReplyInput`, then trimmed to 5.

**Notes**:
- Voice samples are loaded with `.limit(50)` and trimmed via `.slice(0, 10)` ([functions/index.js:269-276](functions/index.js#L269-L276), [reply-ai.js:101-103](functions/lib/reply-ai.js#L101-L103)).
- Item 5 in the priority list ("Expand context window 5 → 20 messages") is a **two-line change**: bump `.limit(10)` → `.limit(20+1)` in `index.js` AND `.slice(-5)` → `.slice(-20)` in `reply-ai.js`. Cheap.

---

### Claim 4: `voiceProfilePrompt` is always empty string
**Status**: **FALSE** — agents got this wrong.

**Evidence**: [functions/index.js:283-301](functions/index.js#L283-L301)

```js
const voiceProfileDoc = await db.collection('settings').doc('voice_profile').get();
const voiceProfile = voiceProfileDoc.exists ? voiceProfileDoc.data() : { rules: [], examples: [] };

let voiceProfilePrompt = '';
if (voiceProfile.rules?.length || voiceProfile.examples?.length) {
  voiceProfilePrompt = '\n\n## VOICE PROFILE — Learned from host corrections\n';
  if (voiceProfile.rules?.length) {
    voiceProfilePrompt += '\nSTYLE RULES (follow these exactly):\n';
    voiceProfile.rules.forEach((rule, i) => { voiceProfilePrompt += `${i + 1}. ${rule}\n`; });
  }
  if (voiceProfile.examples?.length) {
    voiceProfilePrompt += '\nEXAMPLE MESSAGES (match this tone and style):\n';
    voiceProfile.examples.forEach((ex, i) => {
      voiceProfilePrompt += `\n--- Example ${i + 1} (${ex.context || 'general'}, ${ex.language || 'en'}) ---\n${ex.text}\n`;
    });
  }
}
```

- It's populated from `settings/voice_profile` Firestore doc, which is **actively maintained** by `onAirbnbMessageSent` ([functions/index.js:419-521](functions/index.js#L419-L521)) — every time a sent reply differs from the AI draft, a Haiku call extracts style rules + example messages and merges them into the profile (capped at 30 rules + 10 examples).
- It's threaded into both single-shot ([reply-ai.js:136](functions/lib/reply-ai.js#L136) `SYSTEM_PROMPT + (voiceProfilePrompt || '')`) and the chain path ([reply-agent-chain.js:115-116, 265, 300, 339](functions/lib/reply-agent-chain.js#L115-L116)).

**Notes**:
- Agents probably read older code or a different file. This is a **load-bearing live feature** — Casa Coqui is actively learning the host's voice from edits.
- Implication for spec: do NOT regress this. Any plumbing changes to `generateReply` / `generateReplyChain` must keep `voiceProfilePrompt` flowing.

---

### Claim 5: "Mark as Sent" only updates `draftStatus` + `editedReply`
**Status**: TRUE (with one minor addition: `sentAt` timestamp)

**Evidence**: [app/admin/messages/page.js:469-483](app/admin/messages/page.js#L469-L483)

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

**Notes**:
- Confirmed: NO outbound `airbnb_messages` doc creation. NO Airbnb push. NO Resolution-Center / API call. The reply lives only as the `editedReply` field on the inbound message doc.
- BUT note the side-channel: `onAirbnbMessageSent` ([functions/index.js:419+](functions/index.js#L419)) fires on this update transition (`draftStatus → 'sent'`) and uses the diff `(draftReply vs editedReply)` to mine voice rules. This is the voice-learning loop.
- Item 3 in the priority list (create outbound doc with `direction: 'outbound'` + same `threadKey`) is the right cheap fix. Risk: must be careful not to retrigger `onAirbnbMessageCreated` (which only acts on `direction: 'inbound'` per [index.js:229](functions/index.js#L229), so safe).

---

### Claim 6: Local `messages` collection is separate from `airbnb_messages`
**Status**: TRUE

**Evidence**:
- In-app chat write: [app/admin/messages/page.js:237-244](app/admin/messages/page.js#L237-L244)
  ```js
  await addDoc(collection(db, 'messages'), {
    bookingCode: thread.bookingCode,
    guestName: thread.guestName,
    sender: 'host',
    text: trimmed,
    createdAt: serverTimestamp(),
    read: false,
  });
  ```
- Subscriptions: `messages` collection at [page.js:768-782](app/admin/messages/page.js#L768-L782); `airbnb_messages` at [page.js:786-799](app/admin/messages/page.js#L786-L799). Two separate `onSnapshot`s.
- They merge **for UI only** at [page.js:804-805](app/admin/messages/page.js#L804-L805): `const messages = [...inAppMessages, ...airbnbThreadMessages]; const threads = buildThreads(messages);`

**Notes**:
- Different schemas: `messages` uses `{sender, text, bookingCode, createdAt, read}`. `airbnb_messages` uses `{direction, body, threadKey, draftStatus, draftReply, editedReply, receivedAt, ...}`.
- The reply-agent chain (`onAirbnbMessageCreated`) **only reads `airbnb_messages`** for thread context ([index.js:257-258](functions/index.js#L257-L258)). In-app guest-portal chat is invisible to the AI.
- Indexed: `messages(bookingCode ASC, createdAt ASC)` ([firestore.indexes.json:95-101](firestore.indexes.json#L95-L101)) — supports the in-app chat ordering, not AI lookups.

---

### Claim 7: `filterRAGResults` does NOT filter by language
**Status**: TRUE

**Evidence**: [functions/lib/rag-filter.js](functions/lib/rag-filter.js) — only two filters defined:

1. `no_car_rental` — redacts replies that mention Julio's old Ford Focus rental.
2. `no_traffic_hedging` — annotates replies that include traffic disclaimers.

No language detection, no language matching against the inbound message.

**Notes**:
- Language IS captured at output (the `language: 'en' | 'es'` field on the tool result, [reply-ai.js:49-53](functions/lib/reply-ai.js#L49-L53)) and is one of the inputs to the chain's reasoner ([reply-agent-chain.js:362](functions/lib/reply-agent-chain.js#L362)).
- The inbound message has no explicit language label; language is inferred per-call.
- Possible follow-up (NOT in scope for this thread-coherence spec): add a `_language` filter that drops retrieved past-conversations whose host-reply language doesn't match the inbound's inferred language. Would tighten RAG quality but is orthogonal to threading.

---

### Claim 8: Booking match has no email-from or date-range fallback
**Status**: TRUE

**Evidence**: [infra/lambda/parse-airbnb-email/index.js:443-452](infra/lambda/parse-airbnb-email/index.js#L443-L452)

```js
async function findMatchingBooking(firestore, confirmationCode) {
  if (!confirmationCode) return null;
  const snap = await firestore
    .collection('bookings')
    .where('airbnbConfirmationCode', '==', confirmationCode)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
}
```

- Called once at [index.js:920](infra/lambda/parse-airbnb-email/index.js#L920) for `guest_message`. If null → unmatched path at [index.js:922-979](infra/lambda/parse-airbnb-email/index.js#L922-L979) writes a doc with `bookingId: null` and a thread key built from `(null, fromAddress, guestName||fromName)`.

**Notes**:
- This is the headline weakness. Every email forwarded by Airbnb has the host's email as the `from` line via Gmail forward, but the **inner** Airbnb conversation includes the guest's display name in the body and subject. Today: subject pattern matching gives us `guestName`; nothing else. No date-window check.
- bookings collection has `airbnbConfirmationCode`, `code` (booking link code), `guestName`, `guestEmail`, `checkInDate`, `checkOutDate`, `unit`, `status`. All available for fallback matching.
- `parse-airbnb-email/index.js` is also called for `reservation_confirmation` ([index.js:734-803](infra/lambda/parse-airbnb-email/index.js#L734-L803)) and `resolution_request` ([index.js:811-887](infra/lambda/parse-airbnb-email/index.js#L811-L887)) using the same single-key matcher — strengthening it improves three flows.

---

### Claim 9: Existing Firestore indexes
**Status**: TRUE — the threading index exists. No bookings indexes by name/email/date exist yet.

**Evidence**: [firestore.indexes.json](firestore.indexes.json)

- `airbnb_messages(threadKey ASC, receivedAt ASC)` ✅ exists at [lines 3-10](firestore.indexes.json#L3-L10) — this is what the AI's thread query relies on.
- `airbnb_messages(direction ASC, draftStatus ASC, sentAt DESC)` exists ([lines 11-19](firestore.indexes.json#L11-L19)) — voice corpus query.
- `bookings` has 4 composite indexes ([lines 37-69](firestore.indexes.json#L37-L69)):
  - `(externalId, unit)`
  - `(source, unit, status)`
  - `(welcomeStatus, createdAt)`
  - `(welcomeStatus, welcomeSnoozedUntil)`
- **NONE** index by `guestEmail`, `guestName`, `checkInDate`, or `checkOutDate`.

**Notes**:
- For Part A (booking-match strengthening), we'll need at least:
  - `bookings(guestEmail ASC, checkInDate ASC, checkOutDate ASC)` — for email + date-range
  - `bookings(guestName ASC, checkInDate ASC, checkOutDate ASC)` — for name + date-range
  - Plus possibly `booking_members(name ASC)` and `booking_members(email ASC)` for multi-guest fallback (collection group queries).
- Range queries on multiple fields (`checkInDate <= X AND checkOutDate >= X`) require a workaround in Firestore (only one inequality per index). Likely approach: equality on `guestEmail` (or `guestName`), then in-memory filter for date-window.

---

### Claim 10: `booking_members` collection structure
**Status**: TRUE (schema confirmed)

**Evidence**:
- Write at [app/api/guests/checkin/route.js:88-100](app/api/guests/checkin/route.js#L88-L100):
  ```js
  await adminDb.collection('booking_members').add({
    bookingCode,
    name: fullName,
    email,
    phone,
    role: 'primary',
    checkedInAt,
    ...
  });
  ```
- Used by guest invite flow ([app/api/guests/invite/route.js:60-296](app/api/guests/invite/route.js)).
- 11 files reference `booking_members` (api routes, admin bookings page, guest pages).

**Notes**:
- Multi-guest matching is feasible: collection-group query on `booking_members.name` (case-folded) → resolve to `bookingCode` → look up `bookings` by `code`.
- Schema is rich enough to also try `booking_members.email` as a secondary key.
- Open question for the spec: do we always use a `name`/`email` lookup against `booking_members`, OR fall through `bookings.guestName` first then `booking_members`? Probably: try `bookings.guestName` first (cheaper, primary booker most common), then fall back to `booking_members`.

---

## Surprises (things the agents missed or got wrong)

1. **`voiceProfilePrompt` IS populated** ([functions/index.js:283-301](functions/index.js#L283-L301)). The agents called it "always empty string" — that's wrong. There's an active voice-learning loop that mines style rules + example messages from every host-edited reply via `onAirbnbMessageSent` ([functions/index.js:419-521](functions/index.js#L419-L521)). This is one of the more interesting parts of the system and must be preserved through any refactor.

2. **The "context window cap" is actually a 10 → 5 funnel**, not a flat `.limit(5)`. The Firestore query loads 10, the current message is filtered out, then `buildReplyInput` trims `.slice(-5)`. The cheap "expand to 20" change touches both spots.

3. **Mailparser already extracts `parsed.inReplyTo` and `parsed.references`** — they're sitting unused on the parsed object. The fix is *additive*: persist them. No new parsing dependency.

4. **`findMatchingBooking` is shared across THREE flows**, not just guest messages: reservation_confirmation (enrichment, [line 735](infra/lambda/parse-airbnb-email/index.js#L735)), resolution_request (claim → booking link, [line 830](infra/lambda/parse-airbnb-email/index.js#L830)), guest_message ([line 920](infra/lambda/parse-airbnb-email/index.js#L920)). Strengthening it ripples positively — but also requires regression-testing all three.

5. **`onAirbnbMessageCreated` builds its own thread key inline** ([functions/index.js:247-254](functions/index.js#L247-L254)) as a defense against missing `threadKey` field — i.e. the legacy/backfilled docs. So the JS chain is somewhat resilient to historical data with no `threadKey`. New thread-key logic must keep this fallback path coherent.

6. **The bookings doc has TWO confirmation-code-ish fields**: `airbnbConfirmationCode` (the HM/HB code from Airbnb, used for matching) and `code` (the Casa Coqui-issued booking link code, used as `bookingCode` in `threadKey`). The Lambda writes `threadKey: buildThreadKey({ bookingCode: booking.data.code, ... })` ([line 1004-1005](infra/lambda/parse-airbnb-email/index.js#L1004-L1005)) — so the threadKey "gold tier" is the **Casa Coqui code**, not the Airbnb code. Subtle but worth pinning down in the spec.

7. **Local `messages` collection is invisible to the AI agent.** The two-collection split was already known, but the *practical* implication is: every host reply sent through the guest-portal in-app chat (different from "Mark as Sent" on Airbnb threads) is also lost from AI context. The fix scope might want to consider whether to pull `messages` into the thread query too — or leave it strictly as guest-portal-only and only fix the Airbnb side.

8. **The `'unknown'` thread key bucket exists and is being grouped.** Today, every message that has no `bookingCode`, no `senderEmail`, AND no `senderName` collapses into one `'unknown'` thread. This is rare in practice (the parser always extracts at least `fromAddress`) but it's a real fallthrough.

---

## Implications for the spec

**The cheapest big win**: Part A (booking-match strengthening) on its own promotes most of today's "unmatched" messages to tier-1 threading via `bookingCode`. Part B (composite key) is the safety net for the residual.

**Key design decisions to nail down in the spec**:

1. **Order of fallback in strengthened booking match.** Proposed:
   - Tier 1: `airbnbConfirmationCode` (current, unchanged)
   - Tier 2: `(fromAddress + active stay window)` against `bookings.guestEmail` (active = `checkInDate <= today AND checkOutDate >= today - 30 days` for post-checkout follow-ups)
   - Tier 3: `(extractedGuestName + active stay window)` against `bookings.guestName`
   - Tier 4: `(extractedGuestName)` against `booking_members.name` (collection-group query)

2. **Date-window definition.** "Active" needs a precise spec — checkout + 30-day grace? Pre-arrival 14-day window for inquiry-stage messages?

3. **Composite-key shape.** The handoff proposes `name:{safeName}|unit:{unit}|w:{YYYY-MM}`. Open: should `unit` come from inbound parsing (Lambda doesn't extract it today) or be omitted? Currently the parser doesn't reliably extract `unitId` from email subject — punt to `unknown` and rely on `(name + month)`.

4. **Backfill.** Existing `airbnb_messages` docs have old thread keys. Options:
   - Leave them (acceptable; only future messages benefit). Cleanest.
   - Re-run the strengthened matcher on existing unmatched docs and re-thread (one-time backfill script). More invasive but heals history.
   - Recommendation: leave them; backfill is YAGNI.

5. **Multi-guest `booking_members` priority.** Today, `bookings.guestName` is the primary booker. If a sibling guest "Sofia" messages from her own Airbnb account using a different name, today's threadKey would be `name:sofia` (no booking match). Tomorrow, `(sofia + stay window)` should hit `booking_members(name='sofia') → bookingCode → bookings.code`.

6. **Outbound capture deferral.** The spec should explicitly defer Item 3 (Mark-as-Sent creates outbound doc) to a follow-up. Reason: the threading fix is logically prior; without solid threading, an outbound doc lands in a fragile/wrong thread.

**Estimated effort breakdown** (refining the handoff's ~2.5h estimate):

| Task | Effort | Notes |
|---|---|---|
| Part A: extend `findMatchingBooking` (4 tiers, async) | 60 min | Needs test cases for each tier |
| Part A: collection-group query for `booking_members` | 20 min | New code path |
| Part B: composite key in `lib/thread-key.js` (+ `receivedAt` param) | 25 min | Touches 5+ callers — careful |
| New Firestore indexes (3-4 composites) | 10 min code, 5-15 min propagation | `firebase deploy --only firestore:indexes` |
| Update `app/admin/messages/page.js` `buildThreads` callers | 15 min | Pass `receivedAt` through |
| Update `functions/index.js` inline `buildThreadKey` call | 5 min | Add `receivedAt` |
| Tests (Part A: jest in `infra/lambda/parse-airbnb-email/__tests__/`) | 45 min | TDD per priority guideline |
| Manual smoke + backfill decision | 15 min | |
| **Total** | **~3.0 hours** | Slight bump from 2.5h |

---

**End of verification findings.** Ready for spec.
