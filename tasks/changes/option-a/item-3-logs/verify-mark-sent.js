#!/usr/bin/env node
/**
 * Verify recent reply-mark-sent outbound docs in production Firestore.
 *
 * Usage:
 *   node tasks/changes/option-a/item-3-logs/verify-mark-sent.js
 *
 * Confirms (per Plan Step 3.3 acceptance criteria):
 *   - At least 1 doc with source='reply-mark-sent' exists
 *   - direction='outbound_draft', draftStatus='sent'
 *   - threadKey matches the inboundMessageId's threadKey
 *   - inboundMessageId resolves to a real doc with draftStatus='sent'
 */
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({ credential: admin.credential.cert(require(credsPath)) });

(async () => {
  const fs = admin.firestore();
  // Single-field equality only (no composite index required).
  // Sort + limit in memory after retrieval.
  const snap = await fs.collection('airbnb_messages')
    .where('source', '==', 'reply-mark-sent')
    .get();

  if (snap.empty) {
    console.log(JSON.stringify({
      found: 0,
      status: 'no reply-mark-sent docs yet',
      hint: 'Use the admin Messages UI to mark a message as sent, then re-run.',
    }, null, 2));
    process.exit(1);
  }

  // Sort by createdAt desc in memory, take 5 most recent.
  const sortedDocs = [...snap.docs].sort((a, b) => {
    const aMs = a.data().createdAt?.toMillis?.() || 0;
    const bMs = b.data().createdAt?.toMillis?.() || 0;
    return bMs - aMs;
  }).slice(0, 5);

  const results = [];
  for (const doc of sortedDocs) {
    const d = doc.data();
    let inbound = null;
    let inboundExists = false;
    if (d.inboundMessageId) {
      const inboundSnap = await fs.collection('airbnb_messages').doc(d.inboundMessageId).get();
      inboundExists = inboundSnap.exists;
      inbound = inboundExists ? inboundSnap.data() : null;
    }

    const verdict = {
      outboundId: doc.id,
      threadKey: d.threadKey,
      direction: d.direction,
      draftStatus: d.draftStatus,
      bodyPreview: (d.body || '').slice(0, 100),
      bookingId: d.bookingId,
      bookingCode: d.bookingCode,
      guestName: d.guestName,
      source: d.source,
      sentBy: d.sentBy || null,
      inboundMessageId: d.inboundMessageId,
      inboundExists,
      inboundDraftStatus: inbound?.draftStatus,
      inboundThreadKey: inbound?.threadKey,
      threadKeyMatch: d.threadKey === inbound?.threadKey,
    };
    results.push(verdict);
  }

  console.log(JSON.stringify({
    found: results.length,
    verdicts: results,
    summary: {
      allDirectionCorrect: results.every((r) => r.direction === 'outbound_draft'),
      allStatusCorrect: results.every((r) => r.draftStatus === 'sent'),
      allThreadKeysMatch: results.every((r) => r.threadKeyMatch),
      allInboundsExist: results.every((r) => r.inboundExists),
      allInboundsSent: results.every((r) => r.inboundDraftStatus === 'sent'),
    },
  }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(2);
});
