'use strict';

// ---------------------------------------------------------------------------
// reviser — Phase 1 stub.
//
// Eventually: re-call the Drafter with evaluator feedback as additional
// context to produce a corrected draft. For Phase 1, returns a stub
// revised reply. (Won't be invoked in the stub flow because Evaluator
// returns passed=true, but defined here so the SFN graph is complete.)
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  const guestName = event?.message?.guestName || 'guest';
  console.log('[reviser] re-drafting for:', guestName);

  return {
    draft: {
      reply: `Hi ${guestName}! Thanks for the message — I'll respond soon. (Phase 1 stub, post-revision)`,
      language: 'en',
      shouldEscalate: false,
    },
    tokens: { input: 0, output: 0 },
  };
};
