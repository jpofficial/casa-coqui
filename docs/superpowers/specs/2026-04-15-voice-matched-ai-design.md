# Voice-Matched AI — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Branch:** TBD (feature branch off main)

## Problem

The AI drafts welcome messages and guest replies, but they sound robotic — not like Julio. When Julio edits a draft before sending, those corrections are stored (`editedReply`) but never fed back to improve future drafts. There's no way to tell the AI "sound more like me" interactively.

## Solution

A voice learning system with two feedback channels:

1. **Implicit** — automatically learns from the diff between AI drafts and Julio's edits
2. **Explicit** — a chat refinement drawer where Julio can coach the AI on specific messages

Both channels feed into a persistent **Voice Profile** that the AI references on every generation.

## Architecture

### Voice Profile (`settings/voice_profile`)

A single Firestore document with two sections:

```json
{
  "rules": [
    "Uses 'aight' instead of 'alright'",
    "Never says 'amenities' — says 'what we got'",
    "Signs off as 'Julio' or just '-J'",
    "Keeps messages under 4 sentences"
  ],
  "examples": [
    {
      "text": "Hey Maria! Super excited to host you...",
      "context": "welcome",
      "language": "en",
      "addedAt": "2026-04-15T00:00:00Z"
    },
    {
      "text": "Yo what's good! The washer should be free in about 20...",
      "context": "reply",
      "language": "en",
      "addedAt": "2026-04-15T00:00:00Z"
    }
  ],
  "updatedAt": "2026-04-15T00:00:00Z"
}
```

- **Rules**: Explicit style patterns extracted from corrections. Capped at ~30 rules to keep prompt size manageable. Oldest/least-relevant rules pruned when limit is hit.
- **Examples**: Best sent messages as tone references. Capped at ~10 examples. Auto-selected from high-quality edits + manually curated.
- Injected into the system prompt of both `lib/welcome-ai.js` and `functions/lib/reply-agent-chain.js`.

### Implicit Learning (Cloud Function)

Triggered when a message is marked as sent with edits (`editedReply !== draftReply`):

1. Compare `draftReply` vs `editedReply` (the actual sent text)
2. Call Claude Haiku: "What voice/style rules explain the changes between the draft and the final version? Be specific about word choices, tone, length, and patterns."
3. AI returns proposed rules as a structured array
4. Append new rules to `voice_profile.rules` (dedup against existing)
5. If the edited reply is distinct enough (not a minor typo fix), save it as a new example

**Guard rails:**
- Skip if diff is trivial (< 3 word changes or only whitespace/punctuation)
- Skip if `editedReply` is shorter than 10 chars (deleted/empty)
- Rate limit: max 1 voice profile update per minute (prevent rapid-fire edits from flooding)

### Chat Refinement Drawer (UI Component)

A slide-out drawer triggered by a "Refine" button on:
- Welcome draft cards (bookings page)
- Guest reply draft cards (messages page)

**Drawer layout:**

```
┌─────────────────────────────────┐
│ ✕ Refine Draft                  │
├─────────────────────────────────┤
│ Current Draft                   │
│ ┌─────────────────────────────┐ │
│ │ "Hi Sarah! Thanks for..."   │ │
│ └─────────────────────────────┘ │
│                                 │
│ ── Conversation ──────────────  │
│ You: sound more casual, like    │
│      how I actually text people │
│ AI:  "Yo Sarah! Stoked you're  │
│       coming thru..."           │
│                                 │
│ You: perfect but say aight      │
│      instead of alright         │
│ AI:  "Yo Sarah! Stoked you're  │
│       coming thru... aight..."  │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Type feedback...        [→] │ │
│ └─────────────────────────────┘ │
│                                 │
│ [Accept Draft]                  │
└─────────────────────────────────┘
```

**Behavior:**
- Each message in the chat sends: user feedback + current draft + full voice profile + original guest message (for replies) or booking context (for welcomes)
- AI regenerates the draft incorporating the feedback
- On "Accept Draft": the accepted text replaces the current draft, and all feedback from the chat is extracted as new voice rules (same extraction as implicit learning)
- Chat history is ephemeral (not persisted) — only the resulting rules/examples are saved

**API:**
- `POST /api/ai/refine` — accepts `{ draft, feedback, context, voiceProfile }`, returns `{ revisedDraft }`
- Stateless per request. Full conversation context passed each time (small, max ~5 exchanges).

### Surfaces

| Surface | Auto-draft | Refine drawer | Implicit learning |
|---------|-----------|---------------|-------------------|
| Welcome messages | Existing (`lib/welcome-ai.js`) | New | New |
| Guest reply drafts | Existing (`functions/lib/reply-agent-chain.js`) | New | New |

### Changes to Existing AI

1. **`lib/welcome-ai.js`**: Load `settings/voice_profile` and inject rules + examples into `SYSTEM_PROMPT`
2. **`functions/lib/reply-agent-chain.js`**: Same — inject voice profile into the Drafter and Evaluator steps
3. **Reply chain Evaluator**: Add a new check — "Does this match the voice profile rules?" with specific rule violations flagged
4. **`functions/lib/reply-ai.js`** (single-shot fallback): Inject voice profile into system prompt

### Bootstrapping

On first use (empty voice profile):
- Query `airbnb_messages` for the 10 most recent docs where `draftStatus === 'sent'` and `editedReply` exists
- Use those as initial examples
- Run the diff extraction on each to seed initial rules
- Can also be triggered manually from an admin settings page

### Admin Settings (optional, phase 2)

`/admin/settings/voice` page:
- View current rules (edit/delete individual rules)
- View example bank (remove examples, add new ones manually)
- "Reset voice profile" button
- "Re-learn from history" button (re-runs bootstrapping)

## Non-Goals

- No fine-tuning of the AI model
- No real-time voice cloning or audio
- No per-guest voice adaptation (one voice profile for all guests)
- No auto-sending — all drafts still require human review

## Data Model Changes

### New Firestore document
- `settings/voice_profile` — as described above

### Modified fields on `airbnb_messages`
- No new fields needed. Already has `draftReply`, `editedReply`, `draftStatus`.

## File Changes Summary

| File | Change |
|------|--------|
| `settings/voice_profile` (Firestore) | New document |
| `lib/voice-profile.js` | New — load/update voice profile, inject into prompts |
| `lib/welcome-ai.js` | Inject voice profile into system prompt |
| `functions/lib/reply-agent-chain.js` | Inject voice profile into Drafter + Evaluator |
| `functions/lib/reply-ai.js` | Inject voice profile into system prompt |
| `functions/index.js` | New trigger: onUpdate for airbnb_messages (implicit learning) |
| `app/api/ai/refine/route.js` | New — chat refinement endpoint |
| `components/admin/RefineDrawer.js` | New — chat refinement drawer component |
| `app/admin/bookings/page.js` | Add "Refine" button to welcome draft cards |
| `app/admin/messages/page.js` | Add "Refine" button to reply draft cards |
| `firestore.rules` | Allow admin read/write on `settings/voice_profile` |
| `scripts/seed-voice-profile.js` | New — bootstrap voice profile from history |
