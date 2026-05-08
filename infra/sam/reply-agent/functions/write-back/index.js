'use strict';

// ---------------------------------------------------------------------------
// write-back — Phase 1 stub.
//
// Eventually: read the Firebase service account from Secrets Manager,
// initialize firebase-admin, then update airbnb_messages/{messageId} with
// the final draft (`draftReply`, `draftStatus: 'ready'` or 'escalated',
// `draftedAt`, etc.). For Phase 1, just logs what it WOULD have written.
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  const messageId = event?.message?.id || 'unknown';
  const finalDraft =
    event?.chainResult?.output?.final?.finalDraft?.reply ||
    event?.chainResult?.output?.final?.finalDraft ||
    '(no draft produced)';

  console.log('[write-back] would update airbnb_messages/' + messageId);
  console.log('[write-back] final draft:', String(finalDraft).slice(0, 200));

  return {
    messageId,
    draftStatus: 'ready',
    writtenAt: new Date().toISOString(),
  };
};
