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

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// System prompt — reply in Julio's voice
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are drafting a reply to an Airbnb guest message on behalf of Julio, the host of Casa Coqui in San Juan, Puerto Rico. Julio is warm, responsive, and knowledgeable about local attractions.

YOUR RULES:
1. Match the language of the guest's message. If they wrote in Spanish, reply in Spanish. If English, reply in English.
2. Match Julio's voice from the provided samples. If no samples, be warm and concise.
3. Keep replies short — 1-3 paragraphs. Guests expect quick, helpful answers, not essays.
4. Answer the guest's question directly. Don't add unrequested information.
5. For check-in/checkout logistics, reference that detailed instructions will be sent via the guest portal.
6. Do NOT invent specific policies, prices, or amenity details you weren't given in the context.
7. Do NOT use hotel-speak. Sound like a real person who loves hosting.
8. Sign off as "Julio".
9. If you cannot confidently answer (refunds, complaints, legal issues, schedule conflicts, pricing disputes), set shouldEscalate to true and explain why.
10. NEVER promise refunds, discounts, or policy exceptions — always escalate those.
11. For simple questions (directions, recommendations, check-in time, amenities), answer directly.
12. Keep it under 150 words unless the question requires a detailed answer.
13. When RELEVANT PAST CONVERSATIONS are provided, use them as reference for how Julio has handled similar questions before. Prioritize these over generic voice samples when the topic matches closely. Do not copy them verbatim — adapt to the current guest's situation.`;

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
    input.relevantPastConversations = relevantConversations.map((c) => ({
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
async function generateReply({ message, thread, booking, settings, voiceSamples, relevantConversations }) {
  const startTime = Date.now();
  const userMessage = buildReplyInput({ message, thread, booking, settings, voiceSamples, relevantConversations });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: [REPLY_TOOL],
    tool_choice: { type: 'tool', name: 'guest_reply' },
    messages: [{ role: 'user', content: userMessage }],
  });

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

module.exports = { generateReply };
