/**
 * Welcome Message AI Generator — drafts personalized welcome messages for new bookings.
 *
 * DUPLICATED from lib/welcome-ai.js — keep in sync until extracted to a workspace package.
 *
 * CommonJS version for Firebase Cloud Functions runtime.
 * Uses ANTHROPIC_API_KEY from environment (set via firebase functions:secrets:set).
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// System prompt — Julio's voice as an Airbnb host
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are drafting a welcome message for a short-term rental guest on behalf of Julio, the host of Casa Coqui in San Juan, Puerto Rico. Julio is warm, friendly, and helpful — not overly formal.

YOUR RULES:
1. Write in the guest's likely language. If the guest name suggests Spanish, write in Spanish. Otherwise default to English. If a language is explicitly requested, use that.
2. Keep the message concise — 3-4 short paragraphs max. Guests are reading this on their phone.
3. Start with a warm thank-you for booking and genuine excitement about hosting them.
4. The guest portal link is the KEY part of the message. Sell its value — tell the guest it has:
   - Step-by-step check-in instructions with photos
   - WiFi details, house rules, and property info
   - Laundry availability and parking details
   - Everything they need for a smooth stay
   Place the link on its own line so it's easy to tap. Emphasize it's quick and easy — no password needed, just tap the link.
5. Mention that you'll also send more info closer to their arrival date, and that all communication should stay here on Airbnb.
6. End with an invitation to reach out with questions. Sign off as "Julio".
7. Do NOT include specific check-in instructions, WiFi passwords, or door codes — those are in the guest portal.
8. Do NOT use generic hotel language. Sound like a real person, not a template.
9. Do NOT use emojis excessively — one or two max is fine.
10. If a template/example is provided, match its tone and structure closely.
11. Mention the unit name naturally if it has a friendly name.
12. Keep it under 200 words.`;

// ---------------------------------------------------------------------------
// Tool schema — structured welcome message output
// ---------------------------------------------------------------------------

const WELCOME_TOOL = {
  name: 'welcome_message',
  description: 'Generate a personalized welcome message for an incoming guest',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The welcome message text, ready to copy-paste into Airbnb',
      },
      language: {
        type: 'string',
        enum: ['en', 'es'],
        description: 'The language the message was written in',
      },
    },
    required: ['message', 'language'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWelcomeInput({ booking, settings, template }) {
  const input = {
    guest: {
      name: booking.guestName || 'Guest',
      confirmationCode: booking.airbnbConfirmationCode || null,
    },
    stay: {
      unit: booking.unit || null,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      nightCount: daysBetween(booking.checkInDate, booking.checkOutDate),
    },
    property: {
      name: settings?.propertyName || 'Casa Coqui',
      location: settings?.location || 'San Juan, Puerto Rico',
    },
    guestPortalLink: booking.guestLink || null,
  };

  if (template) {
    input.template = template;
  }

  return JSON.stringify(input, null, 0);
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const msPerDay = 86400000;
  return Math.round((new Date(b) - new Date(a)) / msPerDay);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a welcome message for a new booking.
 *
 * @param {Object} params
 * @param {Object} params.booking - Booking doc data
 * @param {Object} params.settings - Property settings
 * @param {string|null} params.template - Optional example message to match tone
 * @returns {Promise<{ message: string, language: string }>}
 */
async function generateWelcomeMessage({ booking, settings, template }) {
  const startTime = Date.now();
  const userMessage = buildWelcomeInput({ booking, settings, template });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: [WELCOME_TOOL],
    tool_choice: { type: 'tool', name: 'welcome_message' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('AI did not return a structured welcome message');
  }

  const result = {
    message: toolUse.input.message || '',
    language: toolUse.input.language || 'en',
  };

  // Build agent_runs log entry (caller writes to Firestore)
  result._agentRun = {
    kind: 'welcome',
    refId: booking.id || null,
    model: MODEL,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    latencyMs: Date.now() - startTime,
    prompt: userMessage,
    response: JSON.stringify(toolUse.input),
    escalated: false,
    createdAt: new Date().toISOString(),
  };

  return result;
}

module.exports = { generateWelcomeMessage };
