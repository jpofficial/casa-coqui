#!/usr/bin/env node
/**
 * Query Firestore for the most recent synthetic test docs.
 */
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({
  credential: admin.credential.cert(require(credsPath)),
});

(async () => {
  const snap = await admin.firestore()
    .collection('airbnb_messages')
    .where('rawEmailS3Key', 'in', [
      'airbnb/synth-smoke-tier-fallback-2026-05-08',
      'airbnb/synth-smoke-tier-fallback-v2-2026-05-08',
    ])
    .get();

  if (snap.empty) {
    console.log(JSON.stringify({ found: 0 }));
    process.exit(1);
  }

  const docs = snap.docs.map((d) => {
    const x = d.data();
    return {
      docId: d.id,
      threadKey: x.threadKey,
      bookingId: x.bookingId,
      airbnbConfirmationCode: x.airbnbConfirmationCode,
      direction: x.direction,
      guestName: x.guestName,
      fromAddress: x.fromAddress,
      subject: x.subject,
      draftStatus: x.draftStatus,
      receivedAt: x.receivedAt?.toDate?.()?.toISOString?.() || x.receivedAt,
      rawEmailS3Key: x.rawEmailS3Key,
    };
  });
  console.log(JSON.stringify(docs, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(2);
});
