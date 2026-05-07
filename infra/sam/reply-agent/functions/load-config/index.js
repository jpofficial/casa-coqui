'use strict';

// ---------------------------------------------------------------------------
// load-config — Phase 1 stub.
//
// Eventually: read prompts + model knobs from SSM Parameter Store and
// AppConfig (Phase 2) at workflow start. For now: return hardcoded defaults
// so the rest of the workflow has well-shaped input.
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  console.log('[load-config] event keys:', Object.keys(event || {}));

  return {
    model: process.env.MODEL_NAME || 'claude-haiku-4-5-20251001',
    temperature: 1.0,
    maxTokens: 1024,
    prompts: {
      reasoner: 'STUB reasoner system prompt — to be loaded from AppConfig in Phase 2',
      drafter: 'STUB drafter system prompt — to be loaded from AppConfig in Phase 2',
      evaluator: 'STUB evaluator system prompt — to be loaded from AppConfig in Phase 2',
    },
    loadedAt: new Date().toISOString(),
  };
};
