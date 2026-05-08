'use strict';

// ---------------------------------------------------------------------------
// rag-retrieve — Phase 1 stub.
//
// Eventually: vector search over the voice corpus (3,620 host_messages.jsonl
// entries embedded in voice_conversations Firestore vector index) to pull
// the most similar past conversations. For Phase 1, returns an empty match
// list so the chain runs without RAG context.
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  const messageBody = event?.message?.body || '';
  console.log('[rag-retrieve] message length:', messageBody.length);

  return {
    matches: [], // Phase 1: empty. Phase 1.5 will port the vector search.
    retrievedAt: new Date().toISOString(),
  };
};
