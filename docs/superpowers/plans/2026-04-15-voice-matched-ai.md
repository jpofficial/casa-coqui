# Voice-Matched AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the welcome/reply AI to sound like Julio through implicit learning (edit diffs) and an explicit chat refinement drawer.

**Architecture:** A `settings/voice_profile` Firestore doc stores learned style rules and curated examples. Both channels (implicit diff extraction + explicit chat) write to this profile. The profile is injected into the system prompt of all AI generation paths (welcome, reply chain, reply single-shot). A new `RefineDrawer` component provides the chat UI on both bookings and messages pages.

**Tech Stack:** Next.js 14 App Router, Firebase Firestore, Anthropic SDK (claude-haiku-4-5-20251001), Tailwind CSS

**Obsidian notes:** All changes documented in `JulioOS/01 - Projects/Casa Coqui/Changes/Voice-Matched AI/`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/voice-profile.js` | Load, update, inject voice profile into prompts |
| `app/api/ai/refine/route.js` | Chat refinement API endpoint |
| `components/admin/RefineDrawer.js` | Slide-out chat drawer for refining drafts |
| `lib/welcome-ai.js` | Modified — inject voice profile |
| `functions/lib/reply-agent-chain.js` | Modified — inject voice profile into drafter + evaluator |
| `functions/lib/reply-ai.js` | Modified — inject voice profile |
| `functions/index.js` | Modified — add implicit learning on message update |
| `app/admin/bookings/page.js` | Modified — add Refine button + drawer |
| `app/admin/messages/page.js` | Modified — add Refine button + drawer |
| `firestore.rules` | Modified — allow admin read/write on voice_profile |
| `scripts/seed-voice-profile.js` | Bootstrap voice profile from sent message history |

---

### Task 1: Voice Profile Library (`lib/voice-profile.js`)

**Files:**
- Create: `lib/voice-profile.js`

- [ ] **Step 1: Create the voice profile loader and prompt injector**

```javascript
// lib/voice-profile.js
import { adminDb } from '@/lib/firebase-admin';

const MAX_RULES = 30;
const MAX_EXAMPLES = 10;
const PROFILE_PATH = 'settings/voice_profile';

/**
 * Load the voice profile from Firestore.
 * Returns { rules: string[], examples: { text, context, language, addedAt }[] }
 */
export async function loadVoiceProfile() {
  const doc = await adminDb.collection('settings').doc('voice_profile').get();
  if (!doc.exists) return { rules: [], examples: [] };
  const data = doc.data();
  return {
    rules: data.rules || [],
    examples: data.examples || [],
  };
}

/**
 * Build a prompt fragment from the voice profile to inject into system prompts.
 */
export function buildVoiceProfilePrompt(profile) {
  if (!profile || (!profile.rules?.length && !profile.examples?.length)) {
    return '';
  }

  let prompt = '\n\n## VOICE PROFILE — Learned from host corrections\n';

  if (profile.rules.length > 0) {
    prompt += '\nSTYLE RULES (follow these exactly):\n';
    profile.rules.forEach((rule, i) => {
      prompt += `${i + 1}. ${rule}\n`;
    });
  }

  if (profile.examples.length > 0) {
    prompt += '\nEXAMPLE MESSAGES (match this tone and style):\n';
    profile.examples.forEach((ex, i) => {
      prompt += `\n--- Example ${i + 1} (${ex.context || 'general'}, ${ex.language || 'en'}) ---\n${ex.text}\n`;
    });
  }

  return prompt;
}

/**
 * Add new rules to the voice profile, deduplicating against existing.
 * Prunes oldest rules if over MAX_RULES.
 */
export async function addRulesToProfile(newRules) {
  const profile = await loadVoiceProfile();
  const existingLower = new Set(profile.rules.map((r) => r.toLowerCase().trim()));
  const unique = newRules.filter((r) => !existingLower.has(r.toLowerCase().trim()));
  if (unique.length === 0) return;

  const merged = [...profile.rules, ...unique];
  const pruned = merged.length > MAX_RULES ? merged.slice(merged.length - MAX_RULES) : merged;

  await adminDb.collection('settings').doc('voice_profile').set(
    { rules: pruned, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

/**
 * Add a new example to the voice profile.
 * Prunes oldest examples if over MAX_EXAMPLES.
 */
export async function addExampleToProfile({ text, context, language }) {
  const profile = await loadVoiceProfile();
  const newExample = { text, context, language, addedAt: new Date().toISOString() };
  const merged = [...profile.examples, newExample];
  const pruned = merged.length > MAX_EXAMPLES ? merged.slice(merged.length - MAX_EXAMPLES) : merged;

  await adminDb.collection('settings').doc('voice_profile').set(
    { examples: pruned, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/voice-profile.js
git commit -m "feat: voice profile library — load, inject, update rules + examples"
```

---

### Task 2: Inject Voice Profile into Welcome AI

**Files:**
- Modify: `lib/welcome-ai.js`

- [ ] **Step 1: Import and inject voice profile into generateWelcomeMessage**

In `lib/welcome-ai.js`, add the import at the top (after line 1):

```javascript
import { loadVoiceProfile, buildVoiceProfilePrompt } from '@/lib/voice-profile';
```

Then modify `generateWelcomeMessage` (line 114) to load and inject the profile:

```javascript
export async function generateWelcomeMessage({ booking, settings, template }) {
  const startTime = Date.now();
  const userMessage = buildWelcomeInput({ booking, settings, template });

  // Load voice profile for style injection
  const profile = await loadVoiceProfile();
  const voiceFragment = buildVoiceProfilePrompt(profile);
  const systemWithVoice = SYSTEM_PROMPT + voiceFragment;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: systemWithVoice,
    tools: [WELCOME_TOOL],
    tool_choice: { type: 'tool', name: 'welcome_message' },
    messages: [{ role: 'user', content: userMessage }],
  });
```

The rest of the function stays the same.

- [ ] **Step 2: Commit**

```bash
git add lib/welcome-ai.js
git commit -m "feat: inject voice profile into welcome message generation"
```

---

### Task 3: Inject Voice Profile into Reply Chain

**Files:**
- Modify: `functions/lib/reply-agent-chain.js`
- Modify: `functions/lib/reply-ai.js`
- Modify: `functions/index.js`

**Note:** Cloud Functions use CommonJS (`require`), not ESM. The voice profile must be loaded in `functions/index.js` (which has `firebase-admin` access) and passed to the generation functions.

- [ ] **Step 1: Add voiceProfilePrompt parameter to reply chain**

In `functions/lib/reply-agent-chain.js`, modify `generateReplyChain` signature (line 229) to accept `voiceProfilePrompt`:

```javascript
async function generateReplyChain({ message, contextJson, voicePrompt, relevantConversations, voiceProfilePrompt }) {
```

Then in `buildDrafterPrompt` usage (around line 261), append the voice profile:

```javascript
function buildDrafterPrompt(voicePrompt, voiceProfilePrompt) {
  return `${voicePrompt}${voiceProfilePrompt || ''}

IMPORTANT: You have been given a STRATEGY from the reasoner. Follow it exactly...`;
}
```

In the EVALUATOR step, add a voice profile rule check to the evaluator prompt injection. After the existing evaluator system prompt (around line 296), append to the user content:

```javascript
const evaluatorUserContent = `${JSON.stringify({ draft: draftText, strategy: reasonerOutput, ragContext: relevantConversations })}

${voiceProfilePrompt ? `\nADDITIONAL VOICE RULES TO CHECK AGAINST:\n${voiceProfilePrompt}` : ''}`;
```

Update the module.exports to reflect the new parameter.

- [ ] **Step 2: Add voiceProfilePrompt parameter to single-shot reply**

In `functions/lib/reply-ai.js`, modify `generateReply` signature (line 250) to accept `voiceProfilePrompt`:

```javascript
async function generateReply({ message, thread, booking, settings, voiceSamples, relevantConversations, voiceProfilePrompt }) {
```

Inject it into the system prompt used in the API call (around line 257):

```javascript
const systemWithVoice = SYSTEM_PROMPT + (voiceProfilePrompt || '');

const response = await client.messages.create({
  model: MODEL,
  max_tokens: 512,
  system: systemWithVoice,
  // ... rest unchanged
});
```

- [ ] **Step 3: Load voice profile in Cloud Function trigger and pass to generators**

In `functions/index.js`, in `onAirbnbMessageCreated` (around line 274, after loading settings), add voice profile loading:

```javascript
// Load voice profile for style injection
const voiceProfileDoc = await db.collection('settings').doc('voice_profile').get();
const voiceProfile = voiceProfileDoc.exists ? voiceProfileDoc.data() : { rules: [], examples: [] };

// Build prompt fragment (inline since we can't import ESM lib)
let voiceProfilePrompt = '';
if (voiceProfile.rules?.length || voiceProfile.examples?.length) {
  voiceProfilePrompt = '\n\n## VOICE PROFILE — Learned from host corrections\n';
  if (voiceProfile.rules?.length) {
    voiceProfilePrompt += '\nSTYLE RULES (follow these exactly):\n';
    voiceProfile.rules.forEach((rule, i) => {
      voiceProfilePrompt += `${i + 1}. ${rule}\n`;
    });
  }
  if (voiceProfile.examples?.length) {
    voiceProfilePrompt += '\nEXAMPLE MESSAGES (match this tone and style):\n';
    voiceProfile.examples.forEach((ex, i) => {
      voiceProfilePrompt += `\n--- Example ${i + 1} (${ex.context || 'general'}, ${ex.language || 'en'}) ---\n${ex.text}\n`;
    });
  }
}
```

Then pass it to both generators (around lines 300-320):

```javascript
result = await generateReplyChain({
  message: messageWithId,
  contextJson,
  voicePrompt: SYSTEM_PROMPT,
  relevantConversations,
  voiceProfilePrompt,
});
// ... fallback:
result = await generateReply({
  message: messageWithId, thread, booking, settings, voiceSamples, relevantConversations, voiceProfilePrompt,
});
```

- [ ] **Step 4: Commit**

```bash
git add functions/lib/reply-agent-chain.js functions/lib/reply-ai.js functions/index.js
git commit -m "feat: inject voice profile into reply chain and single-shot generators"
```

---

### Task 4: Implicit Learning Cloud Function

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Add onAirbnbMessageUpdated trigger for implicit learning**

Add a new export in `functions/index.js` after the existing `onAirbnbMessageCreated`:

```javascript
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');

exports.onAirbnbMessageSent = onDocumentUpdated(
  {
    document: 'airbnb_messages/{messageId}',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['ANTHROPIC_API_KEY'],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    // Only trigger when draftStatus transitions to 'sent' and there's an edit
    if (before.draftStatus === 'sent' || after.draftStatus !== 'sent') return;
    if (!after.editedReply || !after.draftReply) return;

    const draft = after.draftReply.trim();
    const edited = after.editedReply.trim();

    // Skip trivial edits
    if (draft === edited) return;
    const draftWords = draft.split(/\s+/);
    const editedWords = edited.split(/\s+/);
    const diffCount = Math.abs(draftWords.length - editedWords.length) +
      draftWords.filter((w, i) => editedWords[i] !== w).length;
    if (diffCount < 3) return;
    if (edited.length < 10) return;

    // Extract style rules from the diff
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const extractionResponse = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You analyze differences between an AI draft and a human-edited version to extract voice/style rules. Return a JSON array of concise style rules (strings). Each rule should be specific and actionable. Focus on: word choices, tone, length, punctuation, greeting/sign-off patterns, slang, formality level. Return 1-5 rules max. Only return rules that represent PATTERNS, not one-off edits.`,
      tools: [{
        name: 'style_rules',
        description: 'Extract style rules from the diff between AI draft and human edit',
        input_schema: {
          type: 'object',
          properties: {
            rules: {
              type: 'array',
              items: { type: 'string' },
              description: 'Concise style rules extracted from the diff',
            },
            isDistinctExample: {
              type: 'boolean',
              description: 'True if the edited version is high quality and distinct enough to be a voice example',
            },
          },
          required: ['rules', 'isDistinctExample'],
        },
      }],
      tool_choice: { type: 'tool', name: 'style_rules' },
      messages: [{
        role: 'user',
        content: JSON.stringify({
          aiDraft: draft,
          humanEdited: edited,
          context: after.source === 'welcome_draft' ? 'welcome' : 'reply',
        }),
      }],
    });

    const toolUse = extractionResponse.content.find((b) => b.type === 'tool_use');
    if (!toolUse) return;

    const { rules, isDistinctExample } = toolUse.input;

    // Load current profile
    const profileDoc = await db.collection('settings').doc('voice_profile').get();
    const profile = profileDoc.exists ? profileDoc.data() : { rules: [], examples: [] };

    // Deduplicate and merge rules
    const existingLower = new Set((profile.rules || []).map((r) => r.toLowerCase().trim()));
    const uniqueRules = (rules || []).filter((r) => !existingLower.has(r.toLowerCase().trim()));

    const updates = { updatedAt: new Date().toISOString() };

    if (uniqueRules.length > 0) {
      const merged = [...(profile.rules || []), ...uniqueRules];
      updates.rules = merged.length > 30 ? merged.slice(merged.length - 30) : merged;
    }

    if (isDistinctExample && edited.length >= 20) {
      const newExample = {
        text: edited,
        context: after.source === 'welcome_draft' ? 'welcome' : 'reply',
        language: edited.match(/[áéíóúñ¿¡]/i) ? 'es' : 'en',
        addedAt: new Date().toISOString(),
      };
      const examples = [...(profile.examples || []), newExample];
      updates.examples = examples.length > 10 ? examples.slice(examples.length - 10) : examples;
    }

    if (uniqueRules.length > 0 || isDistinctExample) {
      await db.collection('settings').doc('voice_profile').set(updates, { merge: true });
      console.log(`[onAirbnbMessageSent] Voice profile updated: +${uniqueRules.length} rules, example=${isDistinctExample}`);
    }
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add functions/index.js
git commit -m "feat: implicit voice learning — extract style rules from edit diffs"
```

---

### Task 5: Chat Refinement API Endpoint

**Files:**
- Create: `app/api/ai/refine/route.js`

- [ ] **Step 1: Create the refine endpoint**

```javascript
// app/api/ai/refine/route.js
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { loadVoiceProfile, buildVoiceProfilePrompt, addRulesToProfile, addExampleToProfile } from '@/lib/voice-profile';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = 'claude-haiku-4-5-20251001';

export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { draft, feedback, context, history } = body;
    // draft: current draft text
    // feedback: user's latest feedback message
    // context: { type: 'welcome'|'reply', guestName, bookingCode, inboundMessage? }
    // history: [{ role: 'user'|'assistant', content }] — prior chat turns

    if (!draft || !feedback) {
      return NextResponse.json(
        { success: false, error: 'draft and feedback are required.' },
        { status: 400 }
      );
    }

    const profile = await loadVoiceProfile();
    const voiceFragment = buildVoiceProfilePrompt(profile);

    const systemPrompt = `You are helping Julio refine an AI-drafted message for an Airbnb guest. Julio will give you feedback on the current draft. Rewrite the draft incorporating his feedback while keeping the core information intact.
${voiceFragment}

RULES:
1. Apply the feedback precisely — if Julio says "more casual", make it casual. If he says "misspell alright as aight", do it.
2. Keep the same core content (guest name, check-in info, portal link, etc.)
3. Return ONLY the revised message text, no explanation.
4. Match Julio's natural voice — short, warm, not corporate.`;

    // Build conversation messages
    const messages = [];

    // Add prior turns if any
    if (history?.length) {
      for (const turn of history) {
        messages.push({ role: turn.role, content: turn.content });
      }
    }

    // Add current turn
    const userContent = `Current draft:\n---\n${draft}\n---\n\nContext: ${context?.type || 'message'} for guest "${context?.guestName || 'Guest'}"${context?.inboundMessage ? `\n\nGuest's original message:\n${context.inboundMessage}` : ''}\n\nMy feedback: ${feedback}`;
    messages.push({ role: 'user', content: userContent });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages,
    });

    const revisedDraft = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return NextResponse.json({
      success: true,
      data: {
        revisedDraft,
        usage: {
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
        },
      },
    });
  } catch (error) {
    console.error('[POST /api/ai/refine]', error);
    const detail = error?.message || String(error);
    return NextResponse.json(
      { success: false, error: 'Failed to refine draft.', detail },
      { status: 500 }
    );
  }
}

// PATCH — save chat corrections as voice profile rules
export async function PATCH(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { feedbackMessages, acceptedDraft, context } = body;
    // feedbackMessages: string[] — all the user's feedback from the chat
    // acceptedDraft: string — the final accepted draft text
    // context: { type: 'welcome'|'reply' }

    if (!feedbackMessages?.length || !acceptedDraft) {
      return NextResponse.json(
        { success: false, error: 'feedbackMessages and acceptedDraft are required.' },
        { status: 400 }
      );
    }

    // Extract rules from the feedback
    const extractResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: 'You extract reusable voice/style rules from a host\'s feedback about AI-drafted messages. Return a JSON array of concise, actionable rules. Focus on patterns, not one-off changes. 1-5 rules max.',
      tools: [{
        name: 'extract_rules',
        description: 'Extract reusable voice rules from feedback',
        input_schema: {
          type: 'object',
          properties: {
            rules: {
              type: 'array',
              items: { type: 'string' },
              description: 'Concise style rules extracted from feedback',
            },
          },
          required: ['rules'],
        },
      }],
      tool_choice: { type: 'tool', name: 'extract_rules' },
      messages: [{
        role: 'user',
        content: JSON.stringify({
          feedbackMessages,
          context: context?.type || 'general',
        }),
      }],
    });

    const toolUse = extractResponse.content.find((b) => b.type === 'tool_use');
    const rules = toolUse?.input?.rules || [];

    if (rules.length > 0) {
      await addRulesToProfile(rules);
    }

    // Save the accepted draft as a voice example
    await addExampleToProfile({
      text: acceptedDraft,
      context: context?.type || 'general',
      language: acceptedDraft.match(/[áéíóúñ¿¡]/i) ? 'es' : 'en',
    });

    return NextResponse.json({
      success: true,
      data: { rulesAdded: rules.length, rules },
    });
  } catch (error) {
    console.error('[PATCH /api/ai/refine]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save voice corrections.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/ai/refine/route.js
git commit -m "feat: chat refinement API — POST for draft iteration, PATCH to save voice rules"
```

---

### Task 6: RefineDrawer Component

**Files:**
- Create: `components/admin/RefineDrawer.js`

- [ ] **Step 1: Create the RefineDrawer component**

This follows the `HelpDrawer.js` pattern (fixed right-side slide-out, backdrop overlay, ESC to close, body scroll lock).

```javascript
// components/admin/RefineDrawer.js
'use client';

import { useState, useEffect, useRef } from 'react';

export default function RefineDrawer({ isOpen, onClose, draft, context, onAccept }) {
  // draft: string — current draft text
  // context: { type: 'welcome'|'reply', guestName, bookingCode, inboundMessage? }
  // onAccept: (acceptedDraft) => void — called when user accepts a refined draft

  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', content }
  const [input, setInput] = useState('');
  const [currentDraft, setCurrentDraft] = useState(draft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Reset state when draft changes or drawer opens
  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      setCurrentDraft(draft);
      setInput('');
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [isOpen, draft]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSend() {
    const feedback = input.trim();
    if (!feedback || loading) return;

    const newMessages = [...messages, { role: 'user', content: feedback }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const { auth } = await import('@/lib/firebase');
      const idToken = await auth.currentUser.getIdToken();

      const res = await fetch('/api/ai/refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          draft: currentDraft,
          feedback,
          context,
          history: newMessages.slice(0, -1), // prior turns only
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCurrentDraft(data.data.revisedDraft);
        setMessages([...newMessages, { role: 'assistant', content: data.data.revisedDraft }]);
      } else {
        setMessages([...newMessages, { role: 'assistant', content: `Error: ${data.error}` }]);
      }
    } catch (err) {
      console.error('[RefineDrawer] send failed:', err);
      setMessages([...newMessages, { role: 'assistant', content: 'Something went wrong. Try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept() {
    setSaving(true);
    try {
      // Save corrections to voice profile
      const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
      if (userMessages.length > 0) {
        const { auth } = await import('@/lib/firebase');
        const idToken = await auth.currentUser.getIdToken();
        await fetch('/api/ai/refine', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            feedbackMessages: userMessages,
            acceptedDraft: currentDraft,
            context,
          }),
        });
      }
      onAccept(currentDraft);
      onClose();
    } catch (err) {
      console.error('[RefineDrawer] accept failed:', err);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-[60] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Refine draft"
        className={`fixed top-0 right-0 h-full w-full sm:w-[28rem] bg-white shadow-xl z-[70] transform transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100 flex-none">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-blue-600">
              <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.683a1 1 0 01.633.633l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633l-.683-2.051z" />
            </svg>
            <h2 className="text-base font-semibold text-gray-900">Refine Draft</h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-gray-400">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Current draft */}
        <div className="px-4 py-3 border-b border-gray-100 flex-none bg-gray-50">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Current Draft</p>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{currentDraft}</p>
        </div>

        {/* Chat messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">
              Tell the AI how to adjust this message. e.g. &quot;sound more like me&quot; or &quot;less formal&quot;
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-xl px-4 py-2.5 text-sm text-gray-500">
                <span className="animate-pulse">Rewriting...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input + Accept */}
        <div className="flex-none border-t border-gray-100 p-3 space-y-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g. 'more casual' or 'say aight instead of alright'"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleAccept}
              disabled={saving || loading}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 active:bg-green-800 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Accept Draft'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/RefineDrawer.js
git commit -m "feat: RefineDrawer — chat-based draft refinement with voice learning"
```

---

### Task 7: Wire RefineDrawer into Bookings Page (Welcome Drafts)

**Files:**
- Modify: `app/admin/bookings/page.js`

- [ ] **Step 1: Import RefineDrawer and add state to WelcomeMessagePanel**

At the top of the file, add the import:

```javascript
import RefineDrawer from '@/components/admin/RefineDrawer';
```

Inside `WelcomeMessagePanel` (around line 583), add state:

```javascript
const [refineOpen, setRefineOpen] = useState(false);
```

- [ ] **Step 2: Add Refine button to the welcome draft card UI**

In the button row (around line 748-854), add a "Refine" button next to the existing Regenerate button. Only show when there's a draft (`welcomeStatus === 'ready'`):

```javascript
{booking.welcomeStatus === 'ready' && (
  <button
    onClick={() => setRefineOpen(true)}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors font-medium"
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192z" />
    </svg>
    Refine
  </button>
)}
```

- [ ] **Step 3: Add RefineDrawer instance and handler**

After the existing modals at the bottom of WelcomeMessagePanel (around line 870), add:

```javascript
<RefineDrawer
  isOpen={refineOpen}
  onClose={() => setRefineOpen(false)}
  draft={booking.welcomeMessage || ''}
  context={{
    type: 'welcome',
    guestName: booking.guestName,
    bookingCode: booking.code,
  }}
  onAccept={async (acceptedDraft) => {
    // Update the booking with the refined draft
    const idToken = await user.getIdToken();
    await fetch(`/api/bookings/${booking.id}/welcome?force=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });
    // Update local state — the real-time listener will pick up the Firestore change,
    // but we also update the booking doc directly
    const { doc: firestoreDoc, updateDoc } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    await updateDoc(firestoreDoc(db, 'bookings', booking.id), {
      welcomeMessage: acceptedDraft,
      welcomeStatus: 'ready',
    });
  }}
/>
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/bookings/page.js
git commit -m "feat: wire RefineDrawer into welcome draft cards on bookings page"
```

---

### Task 8: Wire RefineDrawer into Messages Page (Reply Drafts)

**Files:**
- Modify: `app/admin/messages/page.js`

- [ ] **Step 1: Import RefineDrawer and add state to AirbnbMessageCard**

At the top of the file, add the import:

```javascript
import RefineDrawer from '@/components/admin/RefineDrawer';
```

Inside `AirbnbMessageCard` (around line 447), add state:

```javascript
const [refineOpen, setRefineOpen] = useState(false);
```

- [ ] **Step 2: Add Refine button next to existing action buttons**

In the action buttons section (around lines 594-630), add a "Refine" button. Only show when `draftStatus === 'ready'` and `draftReply` exists:

```javascript
{message.draftStatus === 'ready' && message.draftReply && (
  <button
    onClick={() => setRefineOpen(true)}
    disabled={busy}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors font-medium disabled:opacity-40"
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192z" />
    </svg>
    Refine
  </button>
)}
```

- [ ] **Step 3: Add RefineDrawer instance and handler**

At the bottom of AirbnbMessageCard, before the closing fragment/div (around line 648), add:

```javascript
<RefineDrawer
  isOpen={refineOpen}
  onClose={() => setRefineOpen(false)}
  draft={message.draftReply || ''}
  context={{
    type: 'reply',
    guestName: message.guestName || message.fromName || 'Guest',
    bookingCode: message.bookingCode,
    inboundMessage: message.body || '',
  }}
  onAccept={async (acceptedDraft) => {
    const { doc: firestoreDoc, updateDoc } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    await updateDoc(firestoreDoc(db, 'airbnb_messages', message.id), {
      draftReply: acceptedDraft,
      draftStatus: 'ready',
    });
  }}
/>
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/messages/page.js
git commit -m "feat: wire RefineDrawer into reply draft cards on messages page"
```

---

### Task 9: Firestore Rules for Voice Profile

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add voice_profile to settings rules**

The existing settings rule at line 423-433 already covers `settings/{settingId}` with `allow write: if isAdmin()`. The `voice_profile` doc falls under this pattern — no rule changes needed.

Verify by reading the rule:
```
match /settings/{settingId} {
  allow read: if isStaff() || (hasAnyBookingCode() && settingId == 'property');
  allow write: if isAdmin();
}
```

`voice_profile` is a `settingId`, so admin can read/write. Staff can read. Guests cannot read (which is correct). No changes needed.

- [ ] **Step 2: Mark as verified — no commit needed**

---

### Task 10: Bootstrap Script

**Files:**
- Create: `scripts/seed-voice-profile.js`

- [ ] **Step 1: Create the bootstrap script**

```javascript
#!/usr/bin/env node
// scripts/seed-voice-profile.js
//
// Seeds the voice profile from historical sent messages.
// Usage: node scripts/seed-voice-profile.js [--apply]
//
// Without --apply, runs in dry-run mode (shows what would be saved).

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Anthropic = require('@anthropic-ai/sdk');

const serviceAccount = require('../service-account-key.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const client = new Anthropic();
const apply = process.argv.includes('--apply');

async function main() {
  console.log(`[seed-voice-profile] ${apply ? 'APPLY mode' : 'DRY-RUN mode'}\n`);

  // Load recent sent messages with edits
  const sentSnap = await db.collection('airbnb_messages')
    .where('draftStatus', '==', 'sent')
    .orderBy('sentAt', 'desc')
    .limit(20)
    .get();

  const withEdits = sentSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => m.editedReply && m.draftReply && m.editedReply.trim() !== m.draftReply.trim());

  console.log(`Found ${sentSnap.size} sent messages, ${withEdits.length} with edits\n`);

  // Extract rules from diffs
  const allRules = [];
  const examples = [];

  for (const msg of withEdits.slice(0, 10)) {
    console.log(`Processing ${msg.id}...`);
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: 'You analyze differences between an AI draft and a human-edited version to extract voice/style rules. Return a JSON array of concise style rules. Focus on word choices, tone, length, patterns. 1-5 rules max.',
        tools: [{
          name: 'style_rules',
          description: 'Extract style rules from diff',
          input_schema: {
            type: 'object',
            properties: {
              rules: { type: 'array', items: { type: 'string' } },
              isDistinctExample: { type: 'boolean' },
            },
            required: ['rules', 'isDistinctExample'],
          },
        }],
        tool_choice: { type: 'tool', name: 'style_rules' },
        messages: [{
          role: 'user',
          content: JSON.stringify({
            aiDraft: msg.draftReply,
            humanEdited: msg.editedReply,
            context: msg.source === 'welcome_draft' ? 'welcome' : 'reply',
          }),
        }],
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (toolUse) {
        allRules.push(...(toolUse.input.rules || []));
        if (toolUse.input.isDistinctExample && msg.editedReply.length >= 20) {
          examples.push({
            text: msg.editedReply,
            context: msg.source === 'welcome_draft' ? 'welcome' : 'reply',
            language: msg.editedReply.match(/[áéíóúñ¿¡]/i) ? 'es' : 'en',
            addedAt: new Date().toISOString(),
          });
        }
        console.log(`  Rules: ${toolUse.input.rules.join('; ')}`);
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  // Also grab top examples from recent sent messages (even without edits)
  const topSent = sentSnap.docs
    .map((d) => d.data())
    .filter((m) => (m.editedReply || m.draftReply)?.length >= 20)
    .slice(0, 5);

  for (const msg of topSent) {
    const text = msg.editedReply || msg.draftReply;
    if (!examples.find((e) => e.text === text)) {
      examples.push({
        text,
        context: msg.source === 'welcome_draft' ? 'welcome' : 'reply',
        language: text.match(/[áéíóúñ¿¡]/i) ? 'es' : 'en',
        addedAt: new Date().toISOString(),
      });
    }
  }

  // Dedup rules
  const seen = new Set();
  const uniqueRules = allRules.filter((r) => {
    const key = r.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);

  const finalExamples = examples.slice(0, 10);

  console.log(`\n--- RESULTS ---`);
  console.log(`Rules (${uniqueRules.length}):`);
  uniqueRules.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  console.log(`\nExamples (${finalExamples.length}):`);
  finalExamples.forEach((e, i) => console.log(`  ${i + 1}. [${e.context}/${e.language}] ${e.text.slice(0, 80)}...`));

  if (apply) {
    await db.collection('settings').doc('voice_profile').set({
      rules: uniqueRules,
      examples: finalExamples,
      updatedAt: new Date().toISOString(),
    });
    console.log('\nVoice profile saved to Firestore.');
  } else {
    console.log('\nDry-run complete. Use --apply to save.');
  }
}

main().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/seed-voice-profile.js
git commit -m "feat: bootstrap script to seed voice profile from message history"
```

---

### Task 11: Obsidian Change Notes

**Files:**
- Create: `/Users/jperez/dev/JulioOS/01 - Projects/Casa Coqui/Changes/Voice-Matched AI/2026-04-15 Voice-Matched AI.md`

- [ ] **Step 1: Create the Obsidian change note**

Write a comprehensive change note documenting all the work done in this feature. Include:
- Problem statement
- Architecture decisions
- Files created/modified
- How the voice profile works
- How implicit learning works
- How the refine drawer works
- How to bootstrap the profile
- How to test

- [ ] **Step 2: No commit needed (separate repo)**

---

### Task 12: Deploy Cloud Functions

- [ ] **Step 1: Deploy updated Cloud Functions**

```bash
cd functions && npm install && cd ..
firebase deploy --only functions:onAirbnbMessageCreated,functions:onAirbnbMessageSent
```

- [ ] **Step 2: Verify deployment**

Check Firebase console for the new `onAirbnbMessageSent` function.

---
