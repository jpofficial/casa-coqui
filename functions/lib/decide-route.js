'use strict';

// ---------------------------------------------------------------------------
// decideRoute — pure function. No side effects, no I/O.
//
// Given a messageId and the resolved feature-flag payload, returns the engine
// to use ('firebase' | 'aws-sfn') and a reason string for observability.
//
// Reason enum (mirrored in spec Decision 12 / WriteBack `_agentRun.routedBy`):
//   'rollout-routed'     — mode: aws-sfn AND hash < rollout_pct (SFN runs)
//   'rollout-gated'      — mode: aws-sfn AND hash >= rollout_pct (legacy runs)
//   'firebase-explicit'  — mode: firebase (legacy runs)
//   'legacy-fallback'    — flag missing or malformed (legacy runs)
//   'shadow-stub'        — mode: shadow (legacy runs; caller warn-logs)
//
// Hash is sha256(messageId).readUInt32BE(0) % 100 — deterministic so the same
// message always routes the same way (Decision 4).
// ---------------------------------------------------------------------------

const crypto = require('crypto');

function hashMessageId(messageId) {
  const h = crypto.createHash('sha256').update(String(messageId)).digest();
  return h.readUInt32BE(0) % 100;
}

function decideRoute({ messageId, flag }) {
  if (!flag || typeof flag !== 'object' || !flag.mode) {
    return { engine: 'firebase', reason: 'legacy-fallback' };
  }
  const mode = flag.mode;
  const rolloutPct = Number.isFinite(flag.rollout_pct) ? flag.rollout_pct : 0;

  if (mode === 'firebase') {
    return { engine: 'firebase', reason: 'firebase-explicit' };
  }
  if (mode === 'shadow') {
    return { engine: 'firebase', reason: 'shadow-stub' };
  }
  if (mode === 'aws-sfn') {
    const bucket = hashMessageId(messageId);
    if (bucket < rolloutPct) {
      return { engine: 'aws-sfn', reason: 'rollout-routed' };
    }
    return { engine: 'firebase', reason: 'rollout-gated' };
  }
  // Unknown mode — fail closed.
  return { engine: 'firebase', reason: 'legacy-fallback' };
}

module.exports = { decideRoute, hashMessageId };
