'use strict';

// ---------------------------------------------------------------------------
// aws-sfn-bridge — wraps StartExecution against the casa-coqui-reply-draft SM.
//
// Builds SFN input matching the shape consumed by reply-draft.asl.json's
// AIChainExecution state ($.message, $.contextJson, $.voicePrompt, etc. —
// see infra/sam/reply-agent/samples/full-input.json).
//
// AC #16: thread is sliced to last 20 (parity with JS chain's .slice(-20)).
//
// Emits BridgeRouteSuccesses / BridgeRouteFailures.
// On error: emits failure metric AND re-throws — caller (functions/index.js)
// catches and falls back to legacy chain.
//
// SECURITY (Decision 18 / F14):
// This module is for the Cloud Function runtime ONLY. The ESLint
// no-restricted-imports rule blocks app/ imports. The Vercel-side
// regenerate API constructs its own inline SFNClient — see
// app/api/airbnb-messages/[id]/regenerate/route.js.
// ---------------------------------------------------------------------------

const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
const { emitBridgeMetric } = require('./bridge-metrics');

let _client = null;
function getClient() {
  if (_client) return _client;
  _client = new SFNClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

async function startReplyDraftExecution({
  message,
  contextJson,
  voicePrompt,
  voiceProfilePrompt,
  relevantConversations,
  thread,
  routedBy,
  appConfigVersion,
}) {
  const stateMachineArn = process.env.REPLY_DRAFT_STATE_MACHINE_ARN;
  if (!stateMachineArn) throw new Error('aws-sfn-bridge: REPLY_DRAFT_STATE_MACHINE_ARN not set');

  // Spec AC #16 — context window parity (.slice(-20)).
  const trimmedThread = Array.isArray(thread) ? thread.slice(-20) : [];

  const input = {
    message: {
      id: message.id,
      body: message.body,
      guestName: message.guestName || null,
      threadKey: message.threadKey || null,
    },
    contextJson,
    voicePrompt: voicePrompt || '',
    voiceProfilePrompt: voiceProfilePrompt || '',
    relevantConversations: relevantConversations || [],
    thread: trimmedThread,
    _routedBy: routedBy,
    _appConfigVersion: appConfigVersion || 'unknown',
  };

  try {
    const out = await getClient().send(new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify(input),
    }));
    await emitBridgeMetric('BridgeRouteSuccesses');
    return { executionArn: out.executionArn, startDate: out.startDate };
  } catch (e) {
    await emitBridgeMetric('BridgeRouteFailures');
    throw e;
  }
}

module.exports = { startReplyDraftExecution };
