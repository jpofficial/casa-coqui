'use strict';

// ---------------------------------------------------------------------------
// evaluator — Step 3 of the AI chain.
//
// Scores the draft against hard rules (word count, banned phrases, property
// facts) + voice (1-10) + RAG consistency. May produce a revisedReply inline,
// which ai-chain.asl.json's EvaluationGate Choice state routes to
// UseEvaluatorRevision instead of calling Reviser.
//
// Contract:
//   Input:  { drafter: { draft }, relevantConversations, message,
//             voiceProfilePrompt, reasoner: { strategy } }
//   Output: { evaluation: { passed, hardRuleFailures, voiceScore, voiceFeedback,
//                           ragConsistent, ragFeedback, propertyFactViolations,
//                           revisedReply? }, tokens }
//   Errors: throws Error with name='AnthropicThrottle' on exhausted 429/529
//
// SOURCE OF TRUTH for prompts/tools: functions/lib/reply-agent-chain.js
// (lines 153-225 for EVALUATOR). Copied verbatim here.
// ---------------------------------------------------------------------------

const Anthropic = require('@anthropic-ai/sdk').default;
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// --- Throttle wrapper (BYTE-IDENTICAL to reasoner/index.js) ----------------
const THROTTLE_ERROR_NAME = 'AnthropicThrottle';
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

function isRetryable(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? null;
  if (status === 429) return true;
  if (status === 529) return true;
  if (status >= 500 && status < 600) return true;
  const code = err.code || err.cause?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') return true;
  return false;
}

function backoffDelayMs(attempt) {
  const exponential = Math.pow(2, attempt) * BASE_DELAY_MS;
  const jitter = Math.random() * BASE_DELAY_MS;
  return Math.min(exponential + jitter, MAX_DELAY_MS);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callWithBackoff(client, params, opts = {}) {
  const label = opts.label || 'anthropic';
  const refId = opts.refId || '';
  const sleepFn = opts.sleepFn || sleep;

  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      lastErr = err;
      const status = err.status ?? err.statusCode ?? null;

      if (!isRetryable(err)) {
        console.warn(`[${label}${refId ? ' ' + refId : ''}] Non-retryable (status=${status}): ${err.message}`);
        throw err;
      }

      if (attempt + 1 >= MAX_ATTEMPTS) {
        console.error(`[${label}${refId ? ' ' + refId : ''}] Retry budget exhausted (status=${status}): ${err.message}`);
        const throttleErr = new Error(err.message);
        throttleErr.name = THROTTLE_ERROR_NAME;
        throttleErr.cause = err;
        throw throttleErr;
      }

      const delay = backoffDelayMs(attempt);
      console.warn(`[${label}${refId ? ' ' + refId : ''}] Attempt ${attempt + 1}/${MAX_ATTEMPTS} failed (status=${status}). Retrying in ${Math.round(delay)}ms.`);
      await sleepFn(delay);
    }
  }
  throw lastErr;
}

// --- Cached client (BYTE-IDENTICAL to reasoner/index.js) -------------------
const sm = new SecretsManagerClient({});
let _secretValue = null;
let _anthropicClient = null;

async function getAnthropicClient() {
  if (_anthropicClient) return _anthropicClient;
  if (!_secretValue) {
    const secretId = process.env.ANTHROPIC_SECRET_NAME;
    if (!secretId) throw new Error('ANTHROPIC_SECRET_NAME env var not set');
    const out = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
    // Secret can be either a JSON object {apiKey: "..."} or a raw string.
    let parsed = out.SecretString;
    try { parsed = JSON.parse(out.SecretString); } catch (_) { /* raw string */ }
    _secretValue = (parsed && typeof parsed === 'object' && parsed.apiKey) ? parsed.apiKey : out.SecretString;
  }
  _anthropicClient = new Anthropic({ apiKey: _secretValue, maxRetries: 0 });
  return _anthropicClient;
}

// --- Prompt + tool (verbatim from functions/lib/reply-agent-chain.js) ------

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
      propertyFactViolations: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of property fact violations (car rental mention, traffic hedging, etc.). Empty if none.',
      },
      revisedReply: {
        type: 'string',
        description: 'If the draft failed, provide a corrected version here. Empty if passed.',
      },
    },
    required: ['passed', 'hardRuleFailures', 'voiceScore', 'voiceFeedback', 'ragConsistent', 'ragFeedback', 'propertyFactViolations'],
  },
};

// --- Handler ----------------------------------------------------------------

exports.handler = async (event) => {
  const refId = event?.message?.id || null;
  const draft = event?.drafter?.draft;
  const strategy = event?.reasoner?.strategy;
  const message = event?.message;
  const voiceProfilePrompt = event?.voiceProfilePrompt || '';
  const relevantConversations = event?.relevantConversations || [];

  if (!draft) throw new Error('evaluator: missing drafter.draft in input');
  if (!strategy) throw new Error('evaluator: missing reasoner.strategy in input');
  if (!message) throw new Error('evaluator: missing message in input');
  const modelFromConfig = event?.config?.model || process.env.MODEL_NAME;
  if (!modelFromConfig) throw new Error('evaluator: model not available (event.config.model and MODEL_NAME both missing)');

  const client = await getAnthropicClient();

  const ragContext = relevantConversations.map((c, i) => ({
    match: i + 1,
    guestAsked: c.guestMessage,
    julioReplied: c.hostReply,
    similarity: c.distance != null ? (1 - c.distance).toFixed(2) : null,
  }));

  const evalInputObj = {
    draft: draft.reply,
    wordCount: draft.reply.split(/\s+/).length,
    strategy,
    ragMatches: ragContext,
    guestMessage: message.body,
    guestName: message.guestName,
  };

  const evalInput = JSON.stringify(evalInputObj) +
    (voiceProfilePrompt ? `\n\nADDITIONAL VOICE RULES TO CHECK AGAINST:\n${voiceProfilePrompt}` : '');

  const response = await callWithBackoff(client, {
    model: modelFromConfig,
    max_tokens: 1024,
    system: EVALUATOR_PROMPT,
    tools: [EVALUATOR_TOOL],
    tool_choice: { type: 'tool', name: 'evaluation' },
    messages: [{ role: 'user', content: evalInput }],
  }, { label: 'evaluator', refId });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('evaluator: no tool_use block in response');

  return {
    evaluation: block.input,
    tokens: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    },
  };
};

module.exports = { handler: exports.handler, callWithBackoff };
