'use strict';

// ---------------------------------------------------------------------------
// reasoner — Step 1 of the AI chain.
//
// Calls Anthropic with REASONER_PROMPT + REASONER_TOOL to produce a structured
// response_strategy that downstream chain steps follow.
//
// Contract:
//   Input:  { contextJson: string, message: { id, ... } }
//   Output: { strategy: object, tokens: { input, output } }
//   Errors: throws Error with name='AnthropicThrottle' on exhausted 429/529
//           (caught by ai-chain.asl.json Retry block: ErrorEquals: [AnthropicThrottle])
//
// SOURCE OF TRUTH for prompts/tools: functions/lib/reply-agent-chain.js (lines
// 28-109 for REASONER). Copied verbatim here. Until Phase 3 deletes the JS
// path, both must stay in sync if prompts change.
// ---------------------------------------------------------------------------

const Anthropic = require('@anthropic-ai/sdk').default;
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// --- Throttle wrapper -------------------------------------------------------
// Adapted from functions/lib/anthropic-with-backoff.js. Two changes from the
// source:
//   1. On retry-budget exhaustion, re-throw with name='AnthropicThrottle' so
//      SFN ASL Retry can match the specific error type.
//   2. SDK retries already disabled at client construction (maxRetries: 0).

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

// --- Cached client ----------------------------------------------------------
// Module-scoped caches survive warm invocations. Cold start pays:
//   ~50ms  SecretsManagerClient construct
//   ~200-400ms first GetSecretValueCommand
//   ~50ms  Anthropic client construct

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

// --- Handler ----------------------------------------------------------------

exports.handler = async (event) => {
  const refId = event?.message?.id || null;
  const contextJson = event?.contextJson;
  if (!contextJson) throw new Error('reasoner: missing contextJson in input');
  if (!process.env.MODEL_NAME) throw new Error('reasoner: MODEL_NAME env var not set');

  const client = await getAnthropicClient();

  const response = await callWithBackoff(client, {
    model: process.env.MODEL_NAME,
    max_tokens: 1024,
    system: REASONER_PROMPT,
    tools: [REASONER_TOOL],
    tool_choice: { type: 'tool', name: 'response_strategy' },
    messages: [{ role: 'user', content: contextJson }],
  }, { label: 'reasoner', refId });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('reasoner: no tool_use block in response');

  return {
    strategy: block.input,
    tokens: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    },
  };
};

// Exported for unit tests.
module.exports = { handler: exports.handler, callWithBackoff, isRetryable, backoffDelayMs };
