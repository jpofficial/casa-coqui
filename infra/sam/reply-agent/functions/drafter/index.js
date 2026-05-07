'use strict';

// ---------------------------------------------------------------------------
// drafter — Step 2 of the AI chain.
//
// Writes the actual reply following the reasoner's strategy + voice rules.
//
// Contract:
//   Input:  { contextJson, voiceProfilePrompt, reasoner: { strategy }, config: { model }, message }
//   Output: { draft: { reply, language, shouldEscalate, escalateReason? }, tokens, appConfigVersion }
//   Errors: throws Error with name='AnthropicThrottle' on exhausted 429/529
//
// System prompt fetched from AppConfig via Lambda Extension at localhost:2772.
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

// --- AppConfig fetch (via Lambda Extension at localhost:2772) -------------
// Module-cached. AWS_APPCONFIG_EXTENSION_PRELOAD_LIST env var ensures the
// Extension fetches at Lambda init, so the first invocation already has
// the config in cache.
//
// Returns: { systemPromptText, appConfigVersion }
//   appConfigVersion is the Configuration-Version response header value,
//   threaded through the SFN result for forensic tracing.

let _appConfigCache = null;

async function fetchSystemPromptConfig() {
  if (_appConfigCache) return _appConfigCache;

  const app = process.env.APPCONFIG_APPLICATION;
  const env = process.env.APPCONFIG_ENVIRONMENT;
  const profile = process.env.APPCONFIG_PROFILE;
  if (!app || !env || !profile) {
    throw new Error('drafter: APPCONFIG_{APPLICATION,ENVIRONMENT,PROFILE} env vars not set');
  }

  const url = `http://localhost:2772/applications/${app}/environments/${env}/configurations/${profile}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`drafter: AppConfig fetch failed: ${res.status} ${res.statusText}`);
  }

  const appConfigVersion = res.headers.get('Configuration-Version') || 'unknown';
  const config = await res.json();

  if (!config.system_prompt_text) {
    throw new Error('drafter: AppConfig response missing system_prompt_text');
  }

  _appConfigCache = {
    systemPromptText: config.system_prompt_text,
    appConfigVersion,
  };
  return _appConfigCache;
}

// --- Prompt + tool (verbatim from functions/lib/reply-agent-chain.js) ------

function buildDrafterPrompt(voicePrompt, voiceProfilePrompt) {
  return `${voicePrompt}${voiceProfilePrompt || ''}

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

// --- Handler ----------------------------------------------------------------

exports.handler = async (event) => {
  const refId = event?.message?.id || null;
  const contextJson = event?.contextJson;
  const voiceProfilePrompt = event?.voiceProfilePrompt || '';
  const strategy = event?.reasoner?.strategy;
  const modelFromConfig = event?.config?.model || process.env.MODEL_NAME;

  if (!contextJson) throw new Error('drafter: missing contextJson in input');
  if (!strategy) throw new Error('drafter: missing reasoner.strategy in input');
  if (!modelFromConfig) throw new Error('drafter: model not available (event.config.model and MODEL_NAME both missing)');

  const [client, { systemPromptText, appConfigVersion }] = await Promise.all([
    getAnthropicClient(),
    fetchSystemPromptConfig(),
  ]);

  const drafterInput = `STRATEGY FROM REASONER:\n${JSON.stringify(strategy, null, 2)}\n\nCONTEXT:\n${contextJson}`;

  const response = await callWithBackoff(client, {
    model: modelFromConfig,
    max_tokens: 512,
    system: buildDrafterPrompt(systemPromptText, voiceProfilePrompt),
    tools: [DRAFTER_TOOL],
    tool_choice: { type: 'tool', name: 'guest_reply' },
    messages: [{ role: 'user', content: drafterInput }],
  }, { label: 'drafter', refId });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('drafter: no tool_use block in response');

  return {
    draft: block.input,
    tokens: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    },
    appConfigVersion,
  };
};

module.exports = { handler: exports.handler, callWithBackoff, fetchSystemPromptConfig };
