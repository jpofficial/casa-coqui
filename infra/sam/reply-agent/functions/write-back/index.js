'use strict';

/**
 * WriteBack — persists SFN-generated draft to airbnb_messages/{id}.
 *
 * NON-DETERMINISM NOTE:
 * Two runs of the same inbound through this Lambda are NOT expected to produce
 * identical draftReply text — Anthropic LLM sampling is non-deterministic by design.
 * Idempotency here means "don't clobber host edits," NOT "produce the same output."
 *
 * The `editedReply` signal is the load-bearing invariant: if a host has edited the
 * draft, this Lambda MUST skip the write (returns { skipped: 'host_edit' }).
 * SFN Standard exactly-once guarantees the WriteBack state itself runs once per
 * execution, but a host-triggered regenerate creates a NEW execution whose
 * WriteBack would otherwise overwrite the human-curated text. See Decision 7.
 *
 * APPCONFIG_VERSION PRECEDENCE (Decision 17 v3.1):
 *   $.drafter.appConfigVersion (always present) → $.reviser.appConfigVersion (fallback)
 *
 * TOKENS (Decision 17 v3.1): Per-stage tokens summed in this Lambda, NOT in ASL.
 *   ai-chain.asl.json has NO top-level aggregation. Per-stage tokens live at
 *   $.reasoner.tokens, $.drafter.tokens, $.evaluator.tokens, $.reviser?.tokens.
 *
 *   inputTokens  = sum of $.reasoner.tokens.input + drafter + evaluator + (reviser ?? 0)
 *   outputTokens = same shape
 *   latencyMs    = Date.now() - event.executionStartTime  (proxy until Phase 3.1)
 *
 * EVENT SHAPE (F13 — ASL Payload):
 *   event.input               — the wrapped chain payload ($. from ASL)
 *   event.executionArn        — from $$.Execution.Id
 *   event.executionStartTime  — from $$.Execution.StartTime (ISO 8601)
 */

const admin = require('firebase-admin');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const SECRET_NAME = process.env.FIREBASE_SECRET_NAME || 'casa-coqui/firebase-service-account';

let _initialized = false;
async function initOnce() {
  if (_initialized) return;
  if (admin.apps && admin.apps.length > 0) {
    _initialized = true;
    return;
  }
  const sm = new SecretsManagerClient({ region: 'us-east-1' });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  const creds = JSON.parse(out.SecretString);
  admin.initializeApp({ credential: admin.credential.cert(creds) });
  _initialized = true;
}

function sumStageTokens(output) {
  const { reasoner, drafter, evaluator, reviser } = output || {};
  const inputTokens =
    (reasoner?.tokens?.input ?? 0) +
    (drafter?.tokens?.input ?? 0) +
    (evaluator?.tokens?.input ?? 0) +
    (reviser?.tokens?.input ?? 0);
  const outputTokens =
    (reasoner?.tokens?.output ?? 0) +
    (drafter?.tokens?.output ?? 0) +
    (evaluator?.tokens?.output ?? 0) +
    (reviser?.tokens?.output ?? 0);
  return { inputTokens, outputTokens };
}

function resolveAppConfigVersion(output) {
  // Decision 17 v3.1: drafter first, reviser fallback.
  return String(
    output?.drafter?.appConfigVersion ??
    output?.reviser?.appConfigVersion ??
    'unknown'
  );
}

exports.handler = async (event) => {
  await initOnce();

  // F13: event.input is the wrapped chain payload; event.executionArn /
  // event.executionStartTime come from ASL $$.Execution.Id / $$.Execution.StartTime.
  const input = event?.input || event;
  const messageId = input?.message?.id;
  if (!messageId) throw new Error('write-back: missing input.message.id');

  const chainOutput = input?.chainResult?.output || {};
  const draft = chainOutput?.drafter?.draft || chainOutput?.final?.finalDraft || {};
  const reply = draft.reply || draft;
  const rationale = draft.rationale || null;

  const appConfigVersion = resolveAppConfigVersion(chainOutput);
  const { inputTokens, outputTokens } = sumStageTokens(chainOutput);

  // F1: latencyMs = wall clock between execution start and WriteBack invocation.
  const startedMs = event?.executionStartTime
    ? new Date(event.executionStartTime).getTime()
    : Date.now();
  const latencyMs = Math.max(0, Date.now() - startedMs);

  const routedBy = input?._routedBy || 'rollout-routed';
  const executionArn = event?.executionArn || null;

  const ref = admin.firestore().collection('airbnb_messages').doc(messageId);
  const snap = await ref.get();
  if (snap.exists) {
    const cur = snap.data();
    if (cur.editedReply && String(cur.editedReply).length > 0) {
      console.log('writeback_skipped_host_edit', { messageId });
      return { skipped: 'host_edit', messageId };
    }
  }

  const draftStatus = (chainOutput?.evaluation?.escalated) ? 'escalated' : 'ready';

  await ref.update({
    draftReply: typeof reply === 'string' ? reply : JSON.stringify(reply),
    draftRationale: rationale,
    draftStatus,
    draftedAt: new Date(),
    '_agentRun.appConfigVersion': appConfigVersion,
    '_agentRun.routedBy': routedBy,
    '_agentRun.executionArn': executionArn,
    '_agentRun.inputTokens': inputTokens,
    '_agentRun.outputTokens': outputTokens,
    '_agentRun.latencyMs': latencyMs,
  });

  return { messageId, draftStatus, inputTokens, outputTokens, latencyMs };
};

module.exports.handler = exports.handler;
