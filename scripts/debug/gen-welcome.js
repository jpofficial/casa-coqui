'use strict';

const admin = require('firebase-admin');
const { generateWelcomeMessage } = require('../../functions/lib/welcome-ai');

const BOOKING_ID = process.argv[2] || 'F3QBFHNRzJbxAX8x7e1C';

if (!admin.apps.length) {
  const sa = require('../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

(async () => {
  const doc = await db.collection('bookings').doc(BOOKING_ID).get();
  if (!doc.exists) { console.log('Booking not found'); process.exit(1); }
  const booking = { id: doc.id, ...doc.data() };
  console.log('Generating welcome for:', booking.guestName, '-', booking.unit);

  const settings = (await db.doc('settings/property').get()).data() || {};
  const result = await generateWelcomeMessage({ booking, settings });

  await doc.ref.update({
    welcomeStatus: 'ready',
    welcomeMessage: result.message,
    welcomeDraftedAt: new Date().toISOString(),
  });

  if (result._agentRun) {
    result._agentRun.refId = doc.id;
    await db.collection('agent_runs').add(result._agentRun);
  }

  console.log('\nWelcome message generated!');
  console.log('Language:', result.language);
  console.log('\n---\n' + result.message + '\n---');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
