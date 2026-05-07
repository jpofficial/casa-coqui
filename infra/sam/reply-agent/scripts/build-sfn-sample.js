'use strict';

// ---------------------------------------------------------------------------
// build-sfn-sample.js
//
// Pulls a real airbnb_messages doc + booking + thread + voice samples +
// settings + voice_profile from Firestore, reconstructs the contextJson +
// voicePrompt + voiceProfilePrompt + relevantConversations the chain Lambdas
// expect, sanitizes guest PII, and writes infra/sam/reply-agent/samples/full-input.json.
//
// Usage:
//   node scripts/build-sfn-sample.js <messageId>
//
// Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a Firebase service account
// JSON, OR running on a machine where firebase-admin can pick up default creds.
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

// Reuse the canonical input builder + system prompt to guarantee parity with prod
const { buildReplyInput, SYSTEM_PROMPT } = require(path.resolve(__dirname, '../../../../functions/lib/reply-ai'));
const { buildThreadKey } = require(path.resolve(__dirname, '../../../../functions/lib/thread-key'));

const messageId = process.argv[2];
if (!messageId) {
  console.error('Usage: node scripts/build-sfn-sample.js <messageId>');
  process.exit(1);
}

admin.initializeApp();
const db = admin.firestore();

(async () => {
  // 1. Message
  const msgDoc = await db.collection('airbnb_messages').doc(messageId).get();
  if (!msgDoc.exists) throw new Error(`message ${messageId} not found`);
  const message = { id: messageId, ...msgDoc.data() };

  // 2. Booking
  let booking = null;
  if (message.bookingId) {
    const b = await db.collection('bookings').doc(message.bookingId).get();
    if (b.exists) booking = { id: b.id, ...b.data() };
  }

  // 3. Thread
  const threadKey = message.threadKey || buildThreadKey({
    bookingCode: message.bookingCode || null,
    senderEmail: message.senderEmail || message.fromAddress || null,
    senderName: message.guestName || message.fromName || null,
  });
  let thread = [];
  if (threadKey && threadKey !== 'unknown') {
    const tSnap = await db.collection('airbnb_messages')
      .where('threadKey', '==', threadKey).orderBy('receivedAt', 'asc').limit(10).get();
    thread = tSnap.docs.filter((d) => d.id !== messageId).map((d) => d.data());
  }

  // 4. Voice samples
  const vSnap = await db.collection('airbnb_messages')
    .where('direction', '==', 'outbound_draft').where('draftStatus', '==', 'sent')
    .orderBy('sentAt', 'desc').limit(50).get();
  const voiceSamples = vSnap.docs.map((d) => d.data());

  // 5. Settings
  const sDoc = await db.collection('settings').doc('property').get();
  const settings = sDoc.exists ? sDoc.data() : {};

  // 6. Voice profile
  const vpDoc = await db.collection('settings').doc('voice_profile').get();
  const voiceProfile = vpDoc.exists ? vpDoc.data() : { rules: [], examples: [] };

  let voiceProfilePrompt = '';
  if (voiceProfile.rules?.length || voiceProfile.examples?.length) {
    voiceProfilePrompt = '\n\n## VOICE PROFILE — Learned from host corrections\n';
    if (voiceProfile.rules?.length) {
      voiceProfilePrompt += '\nSTYLE RULES (follow these exactly):\n';
      voiceProfile.rules.forEach((rule, i) => { voiceProfilePrompt += `${i + 1}. ${rule}\n`; });
    }
    if (voiceProfile.examples?.length) {
      voiceProfilePrompt += '\nEXAMPLE MESSAGES (match this tone and style):\n';
      voiceProfile.examples.forEach((ex, i) => {
        voiceProfilePrompt += `\n--- Example ${i + 1} (${ex.context || 'general'}, ${ex.language || 'en'}) ---\n${ex.text}\n`;
      });
    }
  }

  // 7. RAG: skipped (would need OpenAI embeddings). Use empty list — chain runs
  //    without RAG context, evaluator handles empty matches gracefully.
  const relevantConversations = [];

  const contextJson = buildReplyInput({
    message, thread, booking, settings, voiceSamples, relevantConversations,
  });

  // 8. Sanitize: replace guest name with "Tester", strip senderEmail
  const sanitizedMessage = {
    id: 'sample-001',
    body: message.body,
    guestName: 'Tester',
    bookingId: message.bookingId || null,
    threadKey: 'sample-thread',
  };

  const output = {
    message: sanitizedMessage,
    contextJson,
    voicePrompt: SYSTEM_PROMPT,
    voiceProfilePrompt,
    relevantConversations,
  };

  const outPath = path.resolve(__dirname, '../samples/full-input.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath} (${(JSON.stringify(output).length / 1024).toFixed(1)} KB)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
