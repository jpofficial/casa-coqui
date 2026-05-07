'use strict';

// ---------------------------------------------------------------------------
// drafter — Phase 1 stub.
//
// Eventually: call Anthropic with DRAFTER_PROMPT (voice-tuned) + DRAFTER_TOOL.
// For Phase 1, returns a fixed draft echoing the guest message length.
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  const guestName = event?.message?.guestName || 'guest';
  console.log('[drafter] guest:', guestName);

  return {
    draft: {
      reply: `Hi ${guestName}! Thanks for the message — I'll get back to you shortly. (Phase 1 stub)`,
      language: 'en',
      shouldEscalate: false,
    },
    tokens: { input: 0, output: 0 },
  };
};
