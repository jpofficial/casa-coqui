/**
 * Welcome Message AI Generator — Next.js wrapper.
 *
 * Shares its prompt, tool schema, input builder and result shaping with the
 * Cloud Functions generator through lib/welcome-ai-core.js (single source,
 * see scripts/sync-shared.js). What is specific to this wrapper: it appends
 * the host voice profile to the system prompt. Used by
 * app/api/bookings/[id]/welcome and app/api/admin/sync-ics.
 */

import Anthropic from '@anthropic-ai/sdk';
import { loadVoiceProfile, buildVoiceProfilePrompt } from '@/lib/voice-profile';
import {
  SYSTEM_PROMPT,
  buildWelcomeInput,
  buildWelcomeRequest,
  parseWelcomeResponse,
} from '@/lib/welcome-ai-core';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

/**
 * Generate a welcome message for a new booking.
 *
 * @param {Object} params
 * @param {Object} params.booking - Booking doc data (guestName, unit, checkInDate, checkOutDate, etc.)
 * @param {Object} params.settings - Property settings (propertyName, location)
 * @param {string|null} params.template - Optional example message to match tone
 * @returns {Promise<{ message: string, language: string }>}
 */
export async function generateWelcomeMessage({ booking, settings, template }) {
  const startTime = Date.now();
  const userMessage = buildWelcomeInput({ booking, settings, template });

  // Load voice profile for style injection
  const profile = await loadVoiceProfile();
  const voiceFragment = buildVoiceProfilePrompt(profile);
  const systemWithVoice = SYSTEM_PROMPT + voiceFragment;

  const response = await client.messages.create(
    buildWelcomeRequest({ system: systemWithVoice, userMessage })
  );

  return parseWelcomeResponse(response, { booking, userMessage, startTime });
}
