#!/usr/bin/env node
/**
 * Cleanup Issue #1 verification synthetic doc + related artifacts.
 */
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({
  credential: admin.credential.cert(require(credsPath)),
});

const SYNTH_KEY = 'airbnb/synth-issue1-verify-2026-05-08';

(async () => {
  const fs = admin.firestore();
  const results = {};

  for (const col of ['airbnb_messages', 'airbnb_messages_quarantine']) {
    const snap = await fs.collection(col).where('rawEmailS3Key', '==', SYNTH_KEY).get();
    const batch = fs.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
    results[col] = snap.size;

    // Capture the doc ids before deletion (for agent_runs + staff_notifications)
    if (col === 'airbnb_messages') {
      results.docIds = snap.docs.map((d) => d.id);
    }
  }

  // Lock cleanup
  const crypto = require('crypto');
  const lockId = crypto.createHash('sha256').update(SYNTH_KEY).digest('hex').slice(0, 32);
  const lockRef = fs.collection('airbnb_processing_locks').doc(lockId);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists) {
    await lockRef.delete();
    results.airbnb_processing_locks = 1;
  } else {
    results.airbnb_processing_locks = 0;
  }

  // agent_runs + staff_notifications (best-effort by docId)
  let agentRuns = 0;
  let staffNotifs = 0;
  for (const docId of results.docIds || []) {
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

  console.log(JSON.stringify({ deleted: results }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(2);
});
