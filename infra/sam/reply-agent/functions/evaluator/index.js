'use strict';

// ---------------------------------------------------------------------------
// evaluator — Phase 1 stub.
//
// Eventually: call Anthropic with EVALUATOR_PROMPT + EVALUATOR_TOOL to score
// the draft against voice rules + RAG consistency, optionally producing a
// revisedReply inline. For Phase 1, returns passed=true so the chain skips
// the Reviser branch.
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  console.log('[evaluator] draft length:', event?.drafter?.draft?.reply?.length || 0);

  return {
    evaluation: {
      passed: true,
      voiceScore: 8,
      ragConsistent: true,
      hardRuleFailures: [],
      // revisedReply intentionally absent — chain will go to ChainSucceeded
    },
    tokens: { input: 0, output: 0 },
  };
};
