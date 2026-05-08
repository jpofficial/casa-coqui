/**
 * Reply Agent AI — drafts responses to inbound Airbnb guest messages in Julio's voice.
 *
 * DUPLICATED from lib/reply-ai.js — keep in sync until extracted to a workspace package.
 *
 * CommonJS version for Firebase Cloud Functions runtime.
 * Uses ANTHROPIC_API_KEY from environment (set via firebase functions:secrets:set).
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const { filterRAGResults } = require('./rag-filter');
const { createWithBackoff } = require('./anthropic-with-backoff');

// SDK retries disabled — anthropic-with-backoff.js owns retry policy with
// explicit exponential backoff + jitter and observable log lines.
const client = new Anthropic({ maxRetries: 0 });
const MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// System prompt — reply in Julio's voice
// ---------------------------------------------------------------------------
// SYSTEM_PROMPT is loaded from the shared seed file used by both the
// legacy JS chain (this file) and AppConfig (Phase 2). Single source
// of truth eliminates drift during the Phase 2 → Phase 3 transition.
// We only consume system_prompt_text — the other fields (version,
// hard_bans, language_distribution) are AppConfig validator concerns.

const fs = require('fs');
const path = require('path');
const _seedPath = path.resolve(__dirname, '../../infra/sam/reply-agent/config/system-prompt.seed.json');
const SYSTEM_PROMPT = JSON.parse(fs.readFileSync(_seedPath, 'utf-8')).system_prompt_text;

// ---------------------------------------------------------------------------
// Tool schema — structured reply output
// ---------------------------------------------------------------------------

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
        description: 'The language the reply was written in',
      },
      shouldEscalate: {
        type: 'boolean',
        description: 'True if this message needs human review (refunds, complaints, legal, scheduling conflicts)',
      },
      escalateReason: {
        type: 'string',
        description: 'Why this needs escalation (only if shouldEscalate is true)',
      },
    },
    required: ['reply', 'language', 'shouldEscalate'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReplyInput({ message, thread, booking, settings, voiceSamples, relevantConversations }) {
  const input = {
    inboundMessage: {
      from: message.guestName || 'Guest',
      body: message.body,
      receivedAt: message.receivedAt || null,
    },
    booking: booking
      ? {
          guestName: booking.guestName,
          unit: booking.unit,
          checkInDate: booking.checkInDate,
          checkOutDate: booking.checkOutDate,
          confirmationCode: booking.airbnbConfirmationCode || null,
        }
      : null,
    property: {
      name: settings?.propertyName || 'Casa Coqui',
      location: settings?.location || 'San Juan, Puerto Rico',
    },
  };

  if (thread && thread.length > 0) {
    input.conversationHistory = thread.slice(-5).map((msg) => ({
      direction: msg.direction,
      body: msg.direction === 'outbound_draft' ? (msg.editedReply || msg.draftReply || msg.body) : msg.body,
      timestamp: msg.receivedAt || msg.sentAt || null,
    }));
  }

  if (voiceSamples && voiceSamples.length > 0) {
    input.voiceSamples = voiceSamples.slice(0, 10).map((s) => s.editedReply || s.draftReply);
  }

  if (relevantConversations && relevantConversations.length > 0) {
    const filtered = filterRAGResults(relevantConversations);
    input.relevantPastConversations = filtered.map((c) => ({
      guestAsked: c.guestMessage,
      julioReplied: c.hostReply,
      similarity: c.distance != null ? (1 - c.distance).toFixed(2) : null,
    }));
  }

  return JSON.stringify(input, null, 0);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a reply to an inbound Airbnb guest message.
 *
 * @param {Object} params
 * @param {Object} params.message - The inbound message { guestName, body, receivedAt }
 * @param {Object[]} params.thread - Previous messages in this conversation thread
 * @param {Object} params.booking - Matched booking data (or null)
 * @param {Object} params.settings - Property settings
 * @param {Object[]} params.voiceSamples - Past sent replies for voice matching
 * @returns {Promise<{ reply: string, language: string, shouldEscalate: boolean, escalateReason: string|null }>}
 */
async function generateReply({ message, thread, booking, settings, voiceSamples, relevantConversations, voiceProfilePrompt }) {
  const startTime = Date.now();
  const userMessage = buildReplyInput({ message, thread, booking, settings, voiceSamples, relevantConversations });

  const systemWithVoice = SYSTEM_PROMPT + (voiceProfilePrompt || '');

  const response = await createWithBackoff(client, {
    model: MODEL,
    max_tokens: 512,
    system: systemWithVoice,
    tools: [REPLY_TOOL],
    tool_choice: { type: 'tool', name: 'guest_reply' },
    messages: [{ role: 'user', content: userMessage }],
  }, { label: 'single-shot', refId: message.id });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('AI did not return a structured reply');
  }

  const result = {
    reply: toolUse.input.reply || '',
    language: toolUse.input.language || 'en',
    shouldEscalate: toolUse.input.shouldEscalate || false,
    escalateReason: toolUse.input.escalateReason || null,
  };

  result._agentRun = {
    kind: 'reply',
    refId: message.id || null,
    model: MODEL,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    latencyMs: Date.now() - startTime,
    prompt: userMessage,
    response: JSON.stringify(toolUse.input),
    escalated: result.shouldEscalate,
    createdAt: new Date().toISOString(),
  };

  return result;
}

module.exports = { generateReply, buildReplyInput, SYSTEM_PROMPT };
