'use strict';

/**
 * At-most-once processing: terminal-collection dedupe plus a Firestore
 * tombstone lock (create() CAS, transactional reclaim of stale locks).
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ---------------------------------------------------------------------------
// Idempotency check
// ---------------------------------------------------------------------------

/**
 * Return true if a doc already exists in the given collection that matches
 * either the rawEmailS3Key or the messageId header.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string} collection
 * @param {string} rawEmailS3Key
 * @param {string | null} messageId
 * @returns {Promise<boolean>}
 */
async function isDuplicate(firestore, collection, rawEmailS3Key, messageId) {
  const colRef = firestore.collection(collection);

  // Check by S3 key (most reliable — one object = one email)
  const byKey = await colRef
    .where('rawEmailS3Key', '==', rawEmailS3Key)
    .limit(1)
    .get();
  if (!byKey.empty) return true;

  // Check by Message-ID header
  if (messageId) {
    const byMsgId = await colRef
      .where('messageId', '==', messageId)
      .limit(1)
      .get();
    if (!byMsgId.empty) return true;
  }

  return false;
}

/**
 * Claim a processing lock for this email. Returns { claimed: bool, lockRef }.
 *
 * Fast path: .create() is the Firestore primitive that fails with
 * ALREADY_EXISTS if the doc exists — gives us CAS on first claim.
 *
 * Slow path (lock exists): runTransaction gives CAS on the read-then-
 * conditional-write reclaim of stale locks. Firestore auto-retries the
 * transaction on contention; concurrent reclaimers serialize.
 */

// Firestore admin SDK surfaces Firestore errors with numeric gRPC status codes.
// 6 = ALREADY_EXISTS. If the SDK ever switches to string codes like
// 'already-exists', checking both keeps claimTombstone correct.
const FIRESTORE_ALREADY_EXISTS_CODES = [6, 'already-exists'];

function isAlreadyExistsError(err) {
  return FIRESTORE_ALREADY_EXISTS_CODES.includes(err.code);
}

async function claimTombstone(firestore, objectKey, rfcMessageId) {
  const lockId = sha256(objectKey).slice(0, 32);
  const lockRef = firestore.collection('airbnb_processing_locks').doc(lockId);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    await lockRef.create({
      rawEmailS3Key: objectKey,
      messageId: rfcMessageId || null,
      status: 'processing',
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimedBy: process.env.AWS_LAMBDA_REQUEST_ID || 'unknown',
      expiresAt,
    });
    return { claimed: true, lockRef };
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
  }

  return await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = snap.data() || {};
    const claimedAtMs = data.claimedAt?.toMillis?.() || 0;
    const staleThresholdMs = Date.now() - 5 * 60 * 1000;
    const isStale =
      (data.status === 'processing' && claimedAtMs < staleThresholdMs) ||
      data.status === 'reclaimable';

    if (!isStale) return { claimed: false, lockRef };

    tx.update(lockRef, {
      status: 'processing',
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimedBy: process.env.AWS_LAMBDA_REQUEST_ID || 'unknown',
      reclaimedFrom: data.claimedBy || 'unknown',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return { claimed: true, lockRef };
  });
}

async function markTombstoneCompleted(lockRef) {
  await lockRef.update({
    status: 'completed',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

module.exports = {
  isDuplicate,
  claimTombstone,
  markTombstoneCompleted,
  isAlreadyExistsError,
  FIRESTORE_ALREADY_EXISTS_CODES,
};
