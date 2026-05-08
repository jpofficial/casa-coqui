#!/usr/bin/env node
/**
 * Cleanup Item 4 synthetic test docs across 5 collections + 2 S3 keys.
 */
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({ credential: admin.credential.cert(require(credsPath)) });

const SYNTH_KEYS = [
  'airbnb/synth-item4-parent-2026-05-08',
  'airbnb/synth-item4-child-2026-05-08',
];

(async () => {
  const fs = admin.firestore();
  const results = {};
  const docIds = [];

  for (const col of ['airbnb_messages', 'airbnb_messages_quarantine']) {
    const snap = await fs.collection(col).where('rawEmailS3Key', 'in', SYNTH_KEYS).get();
    const batch = fs.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
    results[col] = snap.size;
    if (col === 'airbnb_messages') {
      docIds.push(...snap.docs.map((d) => d.id));
    }
  }

  // Locks
  const crypto = require('crypto');
  const lockIds = SYNTH_KEYS.map((k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 32));
  let locksDeleted = 0;
  for (const lockId of lockIds) {
    const ref = fs.collection('airbnb_processing_locks').doc(lockId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      locksDeleted += 1;
    }
  }
  results.airbnb_processing_locks = locksDeleted;

  // agent_runs + staff_notifications
  let agentRuns = 0;
  let staffNotifs = 0;
  for (const docId of docIds) {
    const ar = await fs.collection('agent_runs').where('refId', '==', docId).get();
    const arBatch = fs.batch();
    ar.docs.forEach((d) => arBatch.delete(d.ref));
    if (!ar.empty) await arBatch.commit();
    agentRuns += ar.size;

    const sn = await fs.collection('staff_notifications').where('data.messageId', '==', docId).get();
    const snBatch = fs.batch();
    sn.docs.forEach((d) => snBatch.delete(d.ref));
    if (!sn.empty) await snBatch.commit();
    staffNotifs += sn.size;
  }
  results.agent_runs = agentRuns;
  results.staff_notifications = staffNotifs;

  console.log(JSON.stringify({ deleted: results, docIds }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(2);
});
