#!/usr/bin/env node
/**
 * Find MATCHED inbound messages (bookingId set) with draftStatus='ready'
 * suitable for the Mark-as-Sent UI smoke test.
 */
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({ credential: admin.credential.cert(require(credsPath)) });

(async () => {
  const fs = admin.firestore();

  const snap = await fs.collection('airbnb_messages')
    .where('draftStatus', 'in', ['ready', 'escalated'])
    .get();

  const matched = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.direction === 'inbound' && d.bookingId)
    .sort((a, b) => {
      const aMs = a.receivedAt?.toMillis?.() || 0;
      const bMs = b.receivedAt?.toMillis?.() || 0;
      return bMs - aMs;
    });

  const unmatched = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.direction === 'inbound' && !d.bookingId).length;

  console.log(JSON.stringify({
    matched_ready_count: matched.length,
    unmatched_ready_count: unmatched,
    matched_candidates: matched.slice(0, 5).map((m) => ({
      docId: m.id,
      guestName: m.guestName,
      bookingId: m.bookingId,
      threadKey: m.threadKey,
      draftStatus: m.draftStatus,
      receivedAt: m.receivedAt?.toDate?.()?.toISOString?.() || m.receivedAt,
      draftPreview: (m.draftReply || '').slice(0, 80),
    })),
  }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(2);
});
