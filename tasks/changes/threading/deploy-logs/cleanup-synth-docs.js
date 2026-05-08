#!/usr/bin/env node
/**
 * One-shot cleanup: deletes synthetic test docs + quarantine + processing locks
 * created by the Task 7 smoke verification.
 */
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({
  credential: admin.credential.cert(require(credsPath)),
});

const SYNTH_KEYS = [
  'airbnb/synth-smoke-tier-fallback-2026-05-08',
  'airbnb/synth-smoke-tier-fallback-v2-2026-05-08',
];

(async () => {
  const fs = admin.firestore();
  const collections = ['airbnb_messages', 'airbnb_messages_quarantine', 'agent_runs', 'staff_notifications'];
  const results = {};

  // Delete from airbnb_messages + airbnb_messages_quarantine by rawEmailS3Key
  for (const col of ['airbnb_messages', 'airbnb_messages_quarantine']) {
    const snap = await fs.collection(col).where('rawEmailS3Key', 'in', SYNTH_KEYS).get();
    const batch = fs.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
    results[col] = snap.size;
  }

  // Delete processing locks (lock id = sha256(objectKey).slice(0,32))
  const crypto = require('crypto');
  const lockIds = SYNTH_KEYS.map((k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 32));
  let lockDeleted = 0;
  for (const lockId of lockIds) {
    const ref = fs.collection('airbnb_processing_locks').doc(lockId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      lockDeleted += 1;
    }
  }
  results.airbnb_processing_locks = lockDeleted;

  // Delete agent_runs and staff_notifications by referenced messageId (synthetic doc ids)
  // Best-effort: query by refId
  const synthDocIds = ['NqsHflGSlzgcF6Xsx3Hi', 'vUwlb3ipD2fOS4QpE2l8'];
  let agentRunsDeleted = 0;
  for (const docId of synthDocIds) {
    const snap = await fs.collection('agent_runs').where('refId', '==', docId).get();
    const batch = fs.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
    agentRunsDeleted += snap.size;
  }
  results.agent_runs = agentRunsDeleted;

  let staffNotifsDeleted = 0;
  for (const docId of synthDocIds) {
    const snap = await fs.collection('staff_notifications').where('data.messageId', '==', docId).get();
    const batch = fs.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
    staffNotifsDeleted += snap.size;
  }
  results.staff_notifications = staffNotifsDeleted;

  console.log(JSON.stringify({ deleted: results }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(2);
});
