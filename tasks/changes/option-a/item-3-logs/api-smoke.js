#!/usr/bin/env node
/**
 * Item 3 API smoke — fully synthetic, no real guest data touched.
 *
 * Steps:
 * 1. Create a synthetic inbound airbnb_messages doc (direction='inbound',
 *    draftStatus='ready', draftReply='<test draft>') with a unique
 *    `source: 'item3-smoke-synthetic'` marker.
 * 2. Mint a Firebase custom token for an admin user; exchange for an
 *    ID token via Firebase Auth REST.
 * 3. POST /api/airbnb-messages/{synth-doc-id}/mark-sent on production with
 *    the ID token.
 * 4. Verify: API returned outboundId, the outbound doc has the right
 *    shape + threadKey + inboundMessageId, the inbound flipped to 'sent'.
 * 5. Cleanup: delete the inbound + outbound + any spawned agent_runs /
 *    staff_notifications. NO real guest data left modified.
 *
 * Usage:
 *   node tasks/changes/option-a/item-3-logs/api-smoke.js [--prod-url=URL]
 *   Default URL: https://casacoqui.com
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
const serviceAccount = require(credsPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const args = process.argv.slice(2);
const PROD_URL =
  (args.find((a) => a.startsWith('--prod-url=')) || '').split('=')[1] ||
  process.env.PROD_URL ||
  'https://www.casa-coqui.cc';

const envContent = fs.readFileSync(
  path.resolve(__dirname, '../../../../.env.local'),
  'utf-8'
);
const apiKeyMatch = envContent.match(/NEXT_PUBLIC_FIREBASE_API_KEY=([^\s\n]+)/);
if (!apiKeyMatch) {
  console.error('ERROR: NEXT_PUBLIC_FIREBASE_API_KEY not found in .env.local');
  process.exit(2);
}
const FIREBASE_API_KEY = apiKeyMatch[1];

(async () => {
  const fsdb = admin.firestore();
  let synthInboundId = null;
  let synthOutboundId = null;

  try {
    // 1. Create synthetic inbound doc.
    console.log('[1/6] Creating synthetic inbound doc...');
    const synthThreadKey = 'name:item3-smoke-synthetic-bot|y:2026';
    const synthDraft = 'Synthetic draft for Item 3 API smoke test. Not a real reply.';
    const inboundRef = await fsdb.collection('airbnb_messages').add({
      direction: 'inbound',
      draftStatus: 'ready',
      draftReply: synthDraft,
      body: 'Synthetic inbound body for Item 3 smoke',
      threadKey: synthThreadKey,
      bookingId: null,
      bookingCode: null,
      airbnbConfirmationCode: null,
      guestName: 'Item3 Smoke Bot',
      fromAddress: 'express@airbnb.com',
      fromName: 'Airbnb',
      subject: 'Synthetic test for Item 3',
      receivedAt: admin.firestore.Timestamp.now(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      messageId: '<item3-smoke-synthetic-2026-05-08@airbnb.com>',
      source: 'item3-smoke-synthetic',
    });
    synthInboundId = inboundRef.id;
    console.log(`      synthetic inbound id=${synthInboundId}`);

    // 2. Mint admin token.
    console.log('[2/6] Minting admin token...');
    const usersSnap = await fsdb
      .collection('users')
      .where('role', '==', 'admin')
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (usersSnap.empty) throw new Error('no active admin user found');
    const adminUid = usersSnap.docs[0].id;
    const adminEmail = usersSnap.docs[0].data().email || '<no email>';
    const customToken = await admin.auth().createCustomToken(adminUid);
    console.log(`      uid=${adminUid} email=${adminEmail}`);

    // 3. Exchange for ID token.
    console.log('[3/6] Exchanging for ID token...');
    const exchangeRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      }
    );
    if (!exchangeRes.ok) {
      const err = await exchangeRes.text();
      throw new Error(`token exchange failed (${exchangeRes.status}): ${err}`);
    }
    const { idToken } = await exchangeRes.json();
    console.log(`      ID token len=${idToken.length}`);

    // 4. Call the API route.
    const editedReply = synthDraft + ' [edited via smoke test]';
    console.log(`[4/6] POST ${PROD_URL}/api/airbnb-messages/${synthInboundId}/mark-sent`);
    const apiRes = await fetch(
      `${PROD_URL}/api/airbnb-messages/${synthInboundId}/mark-sent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ editedReply }),
      }
    );
    const apiBody = await apiRes.json().catch(() => ({}));
    console.log(`      HTTP ${apiRes.status}`);
    console.log(`      response: ${JSON.stringify(apiBody)}`);
    if (!apiRes.ok || !apiBody.success) throw new Error('API call failed');
    synthOutboundId = apiBody.outboundId;

    // 5. Verify the resulting docs.
    console.log('[5/6] Verifying doc shapes...');
    const updatedInbound = (await inboundRef.get()).data();
    const outboundDoc = (await fsdb.collection('airbnb_messages').doc(synthOutboundId).get()).data();

    const checks = {
      api_returned_outboundId: !!synthOutboundId,
      inbound_flipped_to_sent: updatedInbound.draftStatus === 'sent',
      inbound_editedReply_set: updatedInbound.editedReply === editedReply,
      outbound_direction_correct: outboundDoc.direction === 'outbound_draft',
      outbound_status_sent: outboundDoc.draftStatus === 'sent',
      outbound_threadKey_matches: outboundDoc.threadKey === synthThreadKey,
      outbound_body_correct: outboundDoc.body === editedReply,
      outbound_inboundMessageId_set: outboundDoc.inboundMessageId === synthInboundId,
      outbound_source_correct: outboundDoc.source === 'reply-mark-sent',
    };
    const allPass = Object.values(checks).every(Boolean);
    console.log(JSON.stringify({ checks, allPass }, null, 2));

    // 6. Cleanup (always, even if checks failed).
    console.log('[6/6] Cleaning up synthetic docs...');
    await cleanup(fsdb, synthInboundId, synthOutboundId);

    if (!allPass) process.exit(1);
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    if (synthInboundId || synthOutboundId) {
      console.log('[cleanup] removing synth artifacts after error...');
      await cleanup(fsdb, synthInboundId, synthOutboundId).catch((e) =>
        console.error('cleanup error:', e.message)
      );
    }
    process.exit(2);
  }
})();

async function cleanup(fsdb, inboundId, outboundId) {
  const ids = [inboundId, outboundId].filter(Boolean);
  let msgsDeleted = 0;
  let agentRunsDeleted = 0;
  let staffNotifsDeleted = 0;

  for (const id of ids) {
    await fsdb.collection('airbnb_messages').doc(id).delete().catch(() => {});
    msgsDeleted += 1;
    const ar = await fsdb.collection('agent_runs').where('refId', '==', id).get();
    const arBatch = fsdb.batch();
    ar.docs.forEach((d) => arBatch.delete(d.ref));
    if (!ar.empty) await arBatch.commit();
    agentRunsDeleted += ar.size;
    const sn = await fsdb
      .collection('staff_notifications')
      .where('data.messageId', '==', id)
      .get();
    const snBatch = fsdb.batch();
    sn.docs.forEach((d) => snBatch.delete(d.ref));
    if (!sn.empty) await snBatch.commit();
    staffNotifsDeleted += sn.size;
  }
  console.log(
    `      cleanup: ${msgsDeleted} airbnb_messages, ${agentRunsDeleted} agent_runs, ${staffNotifsDeleted} staff_notifications`
  );
}
