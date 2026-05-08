#!/usr/bin/env node
/**
 * Find inbound messages with draftStatus='ready' (or 'escalated')
 * that you can practice Mark-as-Sent on.
 */
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({ credential: admin.credential.cert(require(credsPath)) });

(async () => {
  const fs = admin.firestore();

  // Single-field equality query (no composite index needed).
  // Filter direction + sort + limit in memory.
  const snap = await fs.collection('airbnb_messages')
    .where('draftStatus', 'in', ['ready', 'escalated'])
    .get();

  const inbounds = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.direction === 'inbound')
    .sort((a, b) => {
      const aMs = a.receivedAt?.toMillis?.() || 0;
      const bMs = b.receivedAt?.toMillis?.() || 0;
      return bMs - aMs;
    })
    .slice(0, 5);

  console.log(JSON.stringify({
    found: inbounds.length,
    candidates: inbounds.map((m) => ({
      docId: m.id,
      guestName: m.guestName,
      subject: (m.subject || '').slice(0, 80),
      draftStatus: m.draftStatus,
      threadKey: m.threadKey,
      bookingId: m.bookingId || null,
      receivedAt: m.receivedAt?.toDate?.()?.toISOString?.() || m.receivedAt,
      hasDraftReply: !!m.draftReply,
      draftPreview: (m.draftReply || '').slice(0, 100),
    })),
  }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(2);
});
