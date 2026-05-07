'use strict';

// ---------------------------------------------------------------------------
// reasoner — Phase 1 stub.
//
// Eventually: call Anthropic with REASONER_PROMPT + REASONER_TOOL to produce
// a structured response_strategy. For Phase 1, returns a fixed strategy.
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  console.log('[reasoner] message id:', event?.message?.id);

  return {
    strategy: {
      tone: 'friendly',
      actions: ['acknowledge', 'answer'],
      escalate: false,
    },
    tokens: { input: 0, output: 0 },
  };
};
