/**
 * Reply Agent — Think Strategy (extended thinking + evaluate)
 *
 * 2-3 calls:
 *   1. Sonnet with extended thinking: reason + draft in one call
 *   2. Haiku evaluator: checklist + voice score + RAG consistency
 *   3. Haiku reviser (if needed): rewrite with feedback
 *
 * DUPLICATED from lib/reply-agent-think.js — keep in sync until extracted to a workspace package.
 *
 * CommonJS version for Firebase Cloud Functions runtime.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic();
const THINK_MODEL = 'claude-sonnet-4-5-20250929';
const EVAL_MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// Step 1: Sonnet with extended thinking — reason + draft
// ---------------------------------------------------------------------------

function buildThinkPrompt(voicePrompt) {
  return `${voicePrompt}

BEFORE writing the reply, think carefully about:
1. What type of situation is this? (parking, hot water, lockout, general question, etc.)
2. What is the guest's emotional state? (frustrated, neutral, apologetic, urgent)
3. Look at the RELEVANT PAST CONVERSATIONS — which one best matches this situation? What specific approach did Julio take? What phrasing did he use?
4. Should you ask a clarifying question first, or can you answer directly?
5. What specific information should the reply contain?
6. What should the reply NOT contain? (no hedging, no AI phrases, no invented details)
7. What's the right tone, opener, and sign-off for this specific message?
8. Target word count (median is 26, keep it short)

Then write the reply that Julio would actually send.`;
}

const REPLY_TOOL = {
  name: 'guest_reply',
  description: 'Generate a reply to an Airbnb guest message',
  input_schema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'The reply text, ready to copy-paste into Airbnb',
      },
      language: {
        type: 'string',
        enum: ['en', 'es'],
      },
      shouldEscalate: {
        type: 'boolean',
        description: 'True if this message needs human review (refunds, complaints, legal)',
      },
      escalateReason: { type: 'string' },
    },
    required: ['reply', 'language', 'shouldEscalate'],
  },
};

// ---------------------------------------------------------------------------
// Step 2: Evaluator (same as chain strategy)
// ---------------------------------------------------------------------------

const EVALUATOR_PROMPT = `You are evaluating an Airbnb host reply draft for voice accuracy and quality.

The host is Julio from Casa Coqui, San Juan, Puerto Rico. You have his real voice stats and the RAG-retrieved past conversations showing how he actually handles similar situations.

Evaluate the draft against these criteria:

HARD RULES (pass/fail):
1. Word count: target is 26 (median), must be under 133 (90th percentile)
2. No banned AI phrases: "I hope this message finds you well", "I'd be more than happy to", "Please don't hesitate", "Absolutely!", "Certainly!", "Kindly", "Let me help you get these sorted", "Looking forward to getting this fixed"
3. No em-dashes (—), no bullet points, no headers in casual replies
4. No "my team" / "our staff" / "our technician" — should be "my friend" or "our cleaner"
5. Guest addressed by first name
6. Correct language (matches guest's language)
7. No invented policies, prices, or details
8. PROPERTY FACTS — the draft MUST NOT:
   - Mention Julio's car, a Ford Focus, renting a vehicle from the host, or quote any rental price from Julio (in ANY language). Only external rental companies are allowed.
   - Include traffic disclaimers or hedging on travel times (e.g., "during traffic hours", "could be 30-35 minutes"). Give distances confidently.
   If the draft violates ANY property fact, it MUST fail regardless of voice score.

VOICE SCORE (1-10):
- Does it sound like a real text message from Julio, not a polished AI email?
- Are the openers/closers consistent with his real patterns?
- Is the emoji usage appropriate (only 7.5% of real messages have any)?

RAG CONSISTENCY:
- Does the draft align with how Julio actually handled similar situations in the RAG matches?
- If RAG shows Julio asks a clarifying question first, does the draft do the same?
- If RAG shows a specific phrasing Julio uses, is the draft consistent?`;

const EVALUATOR_TOOL = {
  name: 'evaluation',
  description: 'Evaluate the draft reply',
  input_schema: {
    type: 'object',
    properties: {
      passed: { type: 'boolean' },
      hardRuleFailures: { type: 'array', items: { type: 'string' } },
      voiceScore: { type: 'integer' },
      voiceFeedback: { type: 'string' },
      ragConsistent: { type: 'boolean' },
      ragFeedback: { type: 'string' },
      propertyFactViolations: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of property fact violations (car rental mention, traffic hedging, etc.). Empty if none.',
      },
      revisedReply: { type: 'string', description: 'Corrected version if draft failed. Empty if passed.' },
    },
    required: ['passed', 'hardRuleFailures', 'voiceScore', 'voiceFeedback', 'ragConsistent', 'ragFeedback', 'propertyFactViolations'],
  },
};

// Reuse drafter tool for revisions
const DRAFTER_TOOL = {
  name: 'guest_reply',
  description: 'Rewrite the reply addressing evaluator feedback',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      language: { type: 'string', enum: ['en', 'es'] },
      shouldEscalate: { type: 'boolean' },
      escalateReason: { type: 'string' },
    },
    required: ['reply', 'language', 'shouldEscalate'],
  },
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

async function generateReplyThink({ message, contextJson, voicePrompt, relevantConversations }) {
  const startTime = Date.now();
  const steps = [];

  // --- Step 1: Think + Draft (Sonnet with extended thinking) ---
  // Extended thinking can't be used with tool_choice, so we use text output
  // and parse the reply from the response.
  const thinkPromptWithFormat = buildThinkPrompt(voicePrompt) + `

OUTPUT FORMAT: After thinking, output ONLY the reply text that Julio would send. Nothing else — no explanation, no quotes around it, no "Here's my draft:". Just the raw message text.

After the reply, on a new line starting with "META:", include: language (en/es), escalate (true/false), and reason if escalating. Example:
META: en, false
or
META: en, true, refund request needs human review`;

  const thinkResponse = await client.messages.create({
    model: THINK_MODEL,
    max_tokens: 16000,
    thinking: {
      type: 'enabled',
      budget_tokens: 8000,
    },
    system: thinkPromptWithFormat,
    messages: [{ role: 'user', content: contextJson }],
  });

  // Extract thinking and text
  const thinkingBlock = thinkResponse.content.find((b) => b.type === 'thinking');
  const textBlock = thinkResponse.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Think model did not return text');

  // Parse reply and meta from text output
  const fullText = textBlock.text.trim();
  const metaMatch = fullText.match(/\nMETA:\s*(.+)$/i);
  const replyText = metaMatch ? fullText.slice(0, metaMatch.index).trim() : fullText;
  const metaLine = metaMatch ? metaMatch[1].trim() : 'en, false';
  const metaParts = metaLine.split(',').map(s => s.trim());

  let draft = {
    reply: replyText,
    language: metaParts[0] || 'en',
    shouldEscalate: metaParts[1] === 'true',
    escalateReason: metaParts.length > 2 ? metaParts.slice(2).join(',').trim() : null,
  };

  steps.push({
    step: 'think_and_draft',
    model: THINK_MODEL,
    inputTokens: thinkResponse.usage?.input_tokens || 0,
    outputTokens: thinkResponse.usage?.output_tokens || 0,
    thinking: thinkingBlock?.thinking || null,
    result: { reply: draft.reply, wordCount: draft.reply.split(/\s+/).length },
  });

  // --- Step 2: Evaluate (Haiku) ---
  const ragContext = (relevantConversations || []).map((c, i) => ({
    match: i + 1,
    guestAsked: c.guestMessage,
    julioReplied: c.hostReply,
    similarity: c.distance != null ? (1 - c.distance).toFixed(2) : null,
  }));

  const evalInput = JSON.stringify({
    draft: draft.reply,
    wordCount: draft.reply.split(/\s+/).length,
    ragMatches: ragContext,
    guestMessage: message.body,
    guestName: message.guestName,
  });

  const evalResponse = await client.messages.create({
    model: EVAL_MODEL,
    max_tokens: 1024,
    system: EVALUATOR_PROMPT,
    tools: [EVALUATOR_TOOL],
    tool_choice: { type: 'tool', name: 'evaluation' },
    messages: [{ role: 'user', content: evalInput }],
  });

  const evalBlock = evalResponse.content.find((b) => b.type === 'tool_use');
  if (!evalBlock) throw new Error('Evaluator did not return an evaluation');
  const evaluation = evalBlock.input;

  steps.push({
    step: 'evaluate',
    model: EVAL_MODEL,
    inputTokens: evalResponse.usage?.input_tokens || 0,
    outputTokens: evalResponse.usage?.output_tokens || 0,
    result: {
      passed: evaluation.passed,
      voiceScore: evaluation.voiceScore,
      hardRuleFailures: evaluation.hardRuleFailures,
      ragConsistent: evaluation.ragConsistent,
    },
  });

  // --- Step 3: Revise if needed (Haiku) ---
  if (!evaluation.passed && evaluation.revisedReply) {
    draft = { ...draft, reply: evaluation.revisedReply };
    steps.push({ step: 'revise', source: 'evaluator_inline', result: { reply: evaluation.revisedReply } });
  } else if (!evaluation.passed) {
    const reviseInput = `ORIGINAL DRAFT: ${draft.reply}\n\nEVALUATOR FEEDBACK:\n- Voice score: ${evaluation.voiceScore}/10\n- Voice feedback: ${evaluation.voiceFeedback}\n- Hard rule failures: ${(evaluation.hardRuleFailures || []).join(', ') || 'none'}\n- RAG consistent: ${evaluation.ragConsistent}\n- RAG feedback: ${evaluation.ragFeedback}\n\nCONTEXT:\n${contextJson}\n\nRewrite the reply addressing ALL the feedback above.`;

    const reviseResponse = await client.messages.create({
      model: EVAL_MODEL,
      max_tokens: 512,
      system: voicePrompt,
      tools: [DRAFTER_TOOL],
      tool_choice: { type: 'tool', name: 'guest_reply' },
      messages: [{ role: 'user', content: reviseInput }],
    });

    const reviseBlock = reviseResponse.content.find((b) => b.type === 'tool_use');
    if (reviseBlock) {
      draft = reviseBlock.input;
      steps.push({
        step: 'revise',
        model: EVAL_MODEL,
        inputTokens: reviseResponse.usage?.input_tokens || 0,
        outputTokens: reviseResponse.usage?.output_tokens || 0,
        result: { reply: draft.reply, wordCount: draft.reply.split(/\s+/).length },
      });
    }
  }

  const totalTokens = steps.reduce((sum, s) => sum + (s.inputTokens || 0) + (s.outputTokens || 0), 0);

  return {
    reply: draft.reply,
    language: draft.language || 'en',
    shouldEscalate: draft.shouldEscalate || false,
    escalateReason: draft.escalateReason || null,
    _agentRun: {
      kind: 'reply',
      strategy: 'think',
      refId: message.id || null,
      model: THINK_MODEL,
      steps,
      totalTokens,
      latencyMs: Date.now() - startTime,
      voiceScore: evaluation.voiceScore,
      ragConsistent: evaluation.ragConsistent,
      thinking: thinkingBlock?.thinking || null,
      escalated: draft.shouldEscalate || false,
      createdAt: new Date().toISOString(),
    },
  };
}

module.exports = { generateReplyThink };
