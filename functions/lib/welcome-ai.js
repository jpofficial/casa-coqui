/**
 * Welcome Message AI Generator — Cloud Functions wrapper.
 *
 * Shares its prompt, tool schema, input builder and result shaping with the
 * Next.js generator through welcome-ai-core.js (a generated copy of
 * lib/welcome-ai-core.js — see scripts/sync-shared.js). What is specific to
 * this wrapper: the terminal-state guard below. Used by icsSync.js and
 * scripts/debug/gen-welcome.js.
 *
 * Uses ANTHROPIC_API_KEY from environment (set via firebase functions:secrets:set).
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const {
  SYSTEM_PROMPT,
  buildWelcomeInput,
  buildWelcomeRequest,
  parseWelcomeResponse,
} = require('./welcome-ai-core');

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// ---------------------------------------------------------------------------
// Terminal-state guard — per 2026-04-15 welcome-drafts spec §5.1
// ---------------------------------------------------------------------------
// `pending` and `error` should regenerate — `error` is welcomeSweeper's retry
// signal. Any other status is terminal and must not be overwritten.
const TERMINAL_WELCOME_STATES = new Set([
  'ready', 'sent', 'skipped', 'snoozed',
]);

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
  // 'pending' and 'error' should regenerate — 'error' is welcomeSweeper's
  // retry signal. The `&& booking.welcomeStatus` short-circuit permits
  // seed-script bookings (scripts/seed/seed-data.js, scripts/seed/seed-test-bookings.js)
  // that never initialized the field.
  if (booking.welcomeStatus && TERMINAL_WELCOME_STATES.has(booking.welcomeStatus)) {
    console.log('welcome generation skipped — terminal state', {
      bookingId: booking.id,
      welcomeStatus: booking.welcomeStatus,
    });
    return { message: booking.welcomeMessage || null, language: null, skipped: true };
  }

  const startTime = Date.now();
  const userMessage = buildWelcomeInput({ booking, settings, template });

  const response = await client.messages.create(
    buildWelcomeRequest({ system: SYSTEM_PROMPT, userMessage })
  );

  return parseWelcomeResponse(response, { booking, userMessage, startTime });
}

module.exports = { generateWelcomeMessage, TERMINAL_WELCOME_STATES };
