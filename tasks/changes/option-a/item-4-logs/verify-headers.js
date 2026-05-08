#!/usr/bin/env node
/**
 * Verify Item 4 synthetic test docs in Firestore.
 *
 * Expected after the parent + child .eml are injected via the Lambda:
 *   - Parent doc: inReplyTo=null, references=[], replyToId=null
 *   - Child doc:  inReplyTo='<synth-item4-parent-...>',
 *                 references=['<synth-item4-parent-...>'],
 *                 replyToId=<parent's Firestore doc id>
 */
const admin = require('firebase-admin');
const path = require('path');

const credsPath = path.resolve(__dirname, '../../../../casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json');
admin.initializeApp({ credential: admin.credential.cert(require(credsPath)) });

const PARENT_KEY = 'airbnb/synth-item4-parent-2026-05-08';
const CHILD_KEY = 'airbnb/synth-item4-child-2026-05-08';

(async () => {
  const fs = admin.firestore();

  const [parentSnap, childSnap] = await Promise.all([
    fs.collection('airbnb_messages').where('rawEmailS3Key', '==', PARENT_KEY).get(),
    fs.collection('airbnb_messages').where('rawEmailS3Key', '==', CHILD_KEY).get(),
  ]);

  if (parentSnap.empty || childSnap.empty) {
    console.log(JSON.stringify({
      found: { parent: !parentSnap.empty, child: !childSnap.empty },
      hint: 'Run the s3 cp + lambda invoke for both .eml files first.',
    }, null, 2));
    process.exit(1);
  }

  const parent = { id: parentSnap.docs[0].id, ...parentSnap.docs[0].data() };
  const child = { id: childSnap.docs[0].id, ...childSnap.docs[0].data() };

  const verdict = {
    parent: {
      docId: parent.id,
      inReplyTo: parent.inReplyTo,
      references: parent.references,
      replyToId: parent.replyToId,
      messageId: parent.messageId,
      threadKey: parent.threadKey,
    },
    child: {
      docId: child.id,
      inReplyTo: child.inReplyTo,
      references: child.references,
      replyToId: child.replyToId,
      messageId: child.messageId,
      threadKey: child.threadKey,
    },
    checks: {
      parent_inReplyTo_is_null: parent.inReplyTo === null,
      parent_references_is_empty_array: Array.isArray(parent.references) && parent.references.length === 0,
      parent_replyToId_is_null: parent.replyToId === null,
      child_inReplyTo_set: child.inReplyTo === '<synth-item4-parent-2026-05-08@airbnb.com>',
      child_references_has_parent: Array.isArray(child.references) &&
        child.references.includes('<synth-item4-parent-2026-05-08@airbnb.com>'),
      child_replyToId_resolves_to_parent: child.replyToId === parent.id,
    },
  };

  const allPass = Object.values(verdict.checks).every(Boolean);
  console.log(JSON.stringify({ ...verdict, allPass }, null, 2));
  process.exit(allPass ? 0 : 1);
})().catch((err) => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(2);
});
