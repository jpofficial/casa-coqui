/**
 * Reply Agent — Chain Strategy (reason → draft → evaluate → revise)
 *
 * 3-4 focused Haiku calls:
 *   1. Reasoner: classify situation, analyze RAG, plan strategy
 *   2. Drafter: write reply following the strategy + voice rules
 *   3. Evaluator: checklist + voice score + RAG consistency
 *   4. Reviser (if needed): rewrite with evaluator feedback
 *
 * DUPLICATED from lib/reply-agent-chain.js — keep in sync until extracted to a workspace package.
 *
 * CommonJS version for Firebase Cloud Functions runtime.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic();
const MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// Step 1: Reasoner — classify + plan
// ---------------------------------------------------------------------------

const REASONER_PROMPT = `You are analyzing an inbound Airbnb guest message for Julio, the host of Casa Coqui in San Juan, Puerto Rico.

Your job is to classify the situation and plan the ideal response strategy based on how Julio has handled similar messages in the past.

Analyze the message and any RAG-retrieved past conversations, then output a strategy.`;

const REASONER_TOOL = {
  name: 'response_strategy',
  description: 'Plan how Julio should respond to this guest message',
  input_schema: {
    type: 'object',
    properties: {
      situationType: {
        type: 'string',
        enum: [
          'hot_water', 'ac_issue', 'no_water', 'power_outage',
          'parking_someone_in_spot', 'parking_cant_park', 'parking_general',
          'lockout', 'code_not_working',
          'washer_dryer', 'wifi',
          'check_in_time', 'early_checkout', 'late_checkout',
          'car_rental', 'distance_question', 'recommendation',
          'complaint', 'refund_request',
          'guest_apologizing', 'guest_thanking',
          'general_question', 'general_issue', 'other',
        ],
        description: 'The type of situation the guest is describing',
      },
      guestEmotion: {
        type: 'string',
        enum: ['neutral', 'frustrated', 'apologetic', 'grateful', 'urgent'],
        description: 'The guest emotional state based on their message',
      },
      shouldAskClarifyingQuestion: {
        type: 'boolean',
        description: 'Should Julio ask a question before giving a solution?',
      },
      clarifyingQuestion: {
        type: 'string',
        description: 'What clarifying question should Julio ask (if applicable)',
      },
      keyInfoToInclude: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific information points the reply should contain',
      },
      ragMatchToFollow: {
        type: 'integer',
        description: 'Which RAG match (1, 2, or 3) best models how Julio should respond. 0 if none are relevant.',
      },
      ragReasoning: {
        type: 'string',
        description: 'Why this RAG match is the best model, and what specific phrasing/approach to mirror from it',
      },
      shouldEscalate: {
        type: 'boolean',
        description: 'Does this need human review? (refunds, complaints, legal, pricing disputes)',
      },
      escalateReason: {
        type: 'string',
        description: 'Why escalation is needed (if applicable)',
      },
      toneNotes: {
        type: 'string',
        description: 'Specific tone guidance: how casual, should there be an apology, sign-off style, emoji or not',
      },
      language: {
        type: 'string',
        enum: ['en', 'es'],
        description: 'Language the reply should be in',
      },
      targetWordCount: {
        type: 'integer',
        description: 'Target word count for the reply (median is 26, max 133)',
      },
    },
    required: [
      'situationType', 'guestEmotion', 'shouldAskClarifyingQuestion',
      'keyInfoToInclude', 'ragMatchToFollow', 'ragReasoning',
      'shouldEscalate', 'toneNotes', 'language', 'targetWordCount',
    ],
  },
};

// ---------------------------------------------------------------------------
// Step 2: Drafter — write the reply following the strategy
// ---------------------------------------------------------------------------

function buildDrafterPrompt(voicePrompt) {
  return `${voicePrompt}

IMPORTANT: You have been given a STRATEGY from the reasoner. Follow it exactly:
- Use the specified language
- Include the key information points listed
- If a clarifying question is specified, ask it
- Mirror the RAG match indicated in the strategy
- Match the tone notes
- Hit the target word count (±10 words)
- If escalation is flagged, set shouldEscalate to true`;
}

const DRAFTER_TOOL = {
  name: 'guest_reply',
  description: 'Write the reply following the strategy',
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
      shouldEscalate: { type: 'boolean' },
      escalateReason: { type: 'string' },
    },
    required: ['reply', 'language', 'shouldEscalate'],
  },
};

// ---------------------------------------------------------------------------
// Step 3: Evaluator — checklist + voice + consistency
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
      passed: {
        type: 'boolean',
        description: 'Does the draft pass all hard rules and score 7+ on voice?',
      },
      hardRuleFailures: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of hard rules that failed (empty if all passed)',
      },
      voiceScore: {
        type: 'integer',
        description: 'Voice accuracy score 1-10 (7+ is passing)',
      },
      voiceFeedback: {
        type: 'string',
        description: 'Specific feedback on what sounds off and how to fix it',
      },
      ragConsistent: {
        type: 'boolean',
        description: 'Is the draft consistent with how Julio handled similar RAG matches?',
      },
      ragFeedback: {
        type: 'string',
        description: 'Specific feedback on RAG consistency issues',
      },
      revisedReply: {
        type: 'string',
        description: 'If the draft failed, provide a corrected version here. Empty if passed.',
      },
    },
    required: ['passed', 'hardRuleFailures', 'voiceScore', 'voiceFeedback', 'ragConsistent', 'ragFeedback'],
  },
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

async function generateReplyChain({ message, contextJson, voicePrompt, relevantConversations }) {
  const startTime = Date.now();
  const steps = [];

  // --- Step 1: Reason ---
  const reasonerInput = contextJson;
  const reasonerResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: REASONER_PROMPT,
    tools: [REASONER_TOOL],
    tool_choice: { type: 'tool', name: 'response_strategy' },
    messages: [{ role: 'user', content: reasonerInput }],
  });

  const strategyBlock = reasonerResponse.content.find((b) => b.type === 'tool_use');
  if (!strategyBlock) throw new Error('Reasoner did not return a strategy');
  const strategy = strategyBlock.input;

  steps.push({
    step: 'reason',
    model: MODEL,
    inputTokens: reasonerResponse.usage?.input_tokens || 0,
    outputTokens: reasonerResponse.usage?.output_tokens || 0,
    result: strategy,
  });

  // --- Step 2: Draft ---
  const drafterInput = `STRATEGY FROM REASONER:\n${JSON.stringify(strategy, null, 2)}\n\nCONTEXT:\n${contextJson}`;
  const drafterResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: buildDrafterPrompt(voicePrompt),
    tools: [DRAFTER_TOOL],
    tool_choice: { type: 'tool', name: 'guest_reply' },
    messages: [{ role: 'user', content: drafterInput }],
  });

  const draftBlock = drafterResponse.content.find((b) => b.type === 'tool_use');
  if (!draftBlock) throw new Error('Drafter did not return a reply');
  let draft = draftBlock.input;

  steps.push({
    step: 'draft',
    model: MODEL,
    inputTokens: drafterResponse.usage?.input_tokens || 0,
    outputTokens: drafterResponse.usage?.output_tokens || 0,
    result: { reply: draft.reply, wordCount: draft.reply.split(/\s+/).length },
  });

  // --- Step 3: Evaluate ---
  const ragContext = (relevantConversations || []).map((c, i) => ({
    match: i + 1,
    guestAsked: c.guestMessage,
    julioReplied: c.hostReply,
    similarity: c.distance != null ? (1 - c.distance).toFixed(2) : null,
  }));

  const evalInput = JSON.stringify({
    draft: draft.reply,
    wordCount: draft.reply.split(/\s+/).length,
    strategy,
    ragMatches: ragContext,
    guestMessage: message.body,
    guestName: message.guestName,
  });

  const evalResponse = await client.messages.create({
    model: MODEL,
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
    model: MODEL,
    inputTokens: evalResponse.usage?.input_tokens || 0,
    outputTokens: evalResponse.usage?.output_tokens || 0,
    result: {
      passed: evaluation.passed,
      voiceScore: evaluation.voiceScore,
      hardRuleFailures: evaluation.hardRuleFailures,
      ragConsistent: evaluation.ragConsistent,
    },
  });

  // --- Step 4: Revise (if needed) ---
  if (!evaluation.passed && evaluation.revisedReply) {
    draft = { ...draft, reply: evaluation.revisedReply };
    steps.push({ step: 'revise', source: 'evaluator_inline', result: { reply: evaluation.revisedReply } });
  } else if (!evaluation.passed) {
    // Re-draft with feedback
    const reviseInput = `ORIGINAL DRAFT: ${draft.reply}\n\nEVALUATOR FEEDBACK:\n- Voice score: ${evaluation.voiceScore}/10\n- Voice feedback: ${evaluation.voiceFeedback}\n- Hard rule failures: ${(evaluation.hardRuleFailures || []).join(', ') || 'none'}\n- RAG consistent: ${evaluation.ragConsistent}\n- RAG feedback: ${evaluation.ragFeedback}\n\nSTRATEGY:\n${JSON.stringify(strategy, null, 2)}\n\nCONTEXT:\n${contextJson}\n\nRewrite the reply addressing ALL the feedback above.`;

    const reviseResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: buildDrafterPrompt(voicePrompt),
      tools: [DRAFTER_TOOL],
      tool_choice: { type: 'tool', name: 'guest_reply' },
      messages: [{ role: 'user', content: reviseInput }],
    });

    const reviseBlock = reviseResponse.content.find((b) => b.type === 'tool_use');
    if (reviseBlock) {
      draft = reviseBlock.input;
      steps.push({
        step: 'revise',
        model: MODEL,
        inputTokens: reviseResponse.usage?.input_tokens || 0,
        outputTokens: reviseResponse.usage?.output_tokens || 0,
        result: { reply: draft.reply, wordCount: draft.reply.split(/\s+/).length },
      });
    }
  }

  const totalTokens = steps.reduce((sum, s) => sum + (s.inputTokens || 0) + (s.outputTokens || 0), 0);

  return {
    reply: draft.reply,
    language: draft.language || strategy.language || 'en',
    shouldEscalate: draft.shouldEscalate || strategy.shouldEscalate || false,
    escalateReason: draft.escalateReason || strategy.escalateReason || null,
    _agentRun: {
      kind: 'reply',
      strategy: 'chain',
      refId: message.id || null,
      model: MODEL,
      steps,
      totalTokens,
      latencyMs: Date.now() - startTime,
      voiceScore: evaluation.voiceScore,
      ragConsistent: evaluation.ragConsistent,
      escalated: draft.shouldEscalate || strategy.shouldEscalate || false,
      createdAt: new Date().toISOString(),
    },
  };
}

module.exports = { generateReplyChain };
