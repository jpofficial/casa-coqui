'use strict';

// Seeds airbnb_messages/sample-001 with minimal scaffolding so the synthetic
// SFN test execution's WriteBack step (which uses ref.update()) can succeed.
// Idempotent — uses { merge: true }, safe to re-run.
//
// Usage:
//   node scripts/seed-sample-001.js

const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

(async () => {
  const ref = db.collection('airbnb_messages').doc('sample-001');

  await ref.set({
    id: 'sample-001',
    body: 'Hi! What time is checkout? And is there parking available for two cars?',
    guestName: 'Tester',
    bookingId: null,
    threadKey: 'sample-thread',
    direction: 'inbound',
    status: 'pending',
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    editedReply: '',
    _seedFixture: true,
  }, { merge: true });

  console.log('Seeded airbnb_messages/sample-001');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
