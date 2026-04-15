'use strict';

/**
 * parse-airbnb-email — Lambda handler (Phase 4 — full implementation)
 *
 * Triggered by SES ReceiptRule after a raw email is saved to S3.
 * Reads the raw MIME email, classifies it, matches it to a Firestore booking,
 * and writes the result to `airbnb_messages` (or `airbnb_messages_quarantine`
 * if the message cannot be matched or is not a guest message).
 *
 * Event shape (SES → Lambda, invocation type: Event):
 *   event.Records[].ses.mail.messageId
 *   event.Records[].ses.receipt.action.bucketName
 *   event.Records[].ses.receipt.action.objectKey
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const { simpleParser } = require('mailparser');
const admin = require('firebase-admin');

// ---------------------------------------------------------------------------
// AWS clients (module-level — reused across warm invocations)
// ---------------------------------------------------------------------------

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// ---------------------------------------------------------------------------
// Firebase Admin — lazy initialisation, module-level cache
// ---------------------------------------------------------------------------

/** @type {import('firebase-admin').app.App | null} */
let firebaseApp = null;

/** @type {import('firebase-admin').firestore.Firestore | null} */
let db = null;

/**
 * Initialise (or return the cached) Firebase Admin app.
 * Service-account JSON is fetched once from Secrets Manager per container.
 */
async function getFirestore() {
  if (db) return db;

  const secretName =
    process.env.FIREBASE_SECRET_NAME || 'casa-coqui/firebase-service-account';

  const secretResponse = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );

  const serviceAccount = JSON.parse(secretResponse.SecretString);

  // Guard: only call initializeApp once per container lifetime
  if (!admin.apps.length) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    firebaseApp = admin.apps[0];
  }

  db = admin.firestore(firebaseApp);
  return db;
}

// ---------------------------------------------------------------------------
// Email classification
// ---------------------------------------------------------------------------

/**
 * @typedef {'guest_message' | 'payout' | 'review_request' | 'policy_update' | 'unknown'} MessageType
 */

/**
 * Classify an Airbnb email by its subject line.
 * Returns a MessageType string used to route the doc to the correct collection.
 *
 * @param {string} subject
 * @returns {MessageType}
 */
function classifyEmail(subject) {
  if (!subject) return 'unknown';

  const s = subject.toLowerCase();

  // Guest messages
  if (
    /new message from\b/i.test(subject) ||
    /responded to your message/i.test(subject) ||
    /sent you a message/i.test(subject) ||
    /message from your (host|guest)/i.test(subject)
  ) {
    return 'guest_message';
  }

  // Payout / earnings
  if (
    /your payout for/i.test(subject) ||
    /earnings summary/i.test(subject) ||
    /payout sent/i.test(subject) ||
    /payment sent/i.test(subject)
  ) {
    return 'payout';
  }

  // Review requests
  if (
    /review your guest/i.test(subject) ||
    /rate your (experience|stay|guest)/i.test(subject) ||
    /left you a review/i.test(subject) ||
    /write a review/i.test(subject)
  ) {
    return 'review_request';
  }

  // Policy / general Airbnb updates
  if (
    /policy update/i.test(subject) ||
    /terms of service/i.test(subject) ||
    /important update from airbnb/i.test(subject) ||
    /airbnb update/i.test(subject)
  ) {
    return 'policy_update';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Airbnb confirmation codes are 10-character alphanumeric strings starting
 * with HM (host-managed) or HB.  We also accept any all-caps code that looks
 * like HMABCD1234 or HBXYZ67890.
 *
 * @param {string} text
 * @returns {string | null}
 */
function extractConfirmationCode(text) {
  if (!text) return null;
  // e.g. HMABCD1234, HBXYZ12345
  const match = text.match(/\bH[MB][A-Z0-9]{8}\b/);
  return match ? match[0] : null;
}

/**
 * Extract the guest name from common Airbnb subject patterns:
 *   "New message from Jane Doe"
 *   "Jane Doe responded to your message"
 *   "Message from your guest, Jane Doe"
 *
 * @param {string} subject
 * @returns {string | null}
 */
function extractGuestNameFromSubject(subject) {
  if (!subject) return null;

  let m;

  // "New message from Jane Doe"
  m = subject.match(/^New message from (.+?)(?:\s*[-–]|$)/i);
  if (m) return m[1].trim();

  // "Jane Doe responded to your message"
  m = subject.match(/^(.+?)\s+responded to your message/i);
  if (m) return m[1].trim();

  // "Message from your guest, Jane Doe" or "Message from your host, Jane Doe"
  m = subject.match(/message from your (?:guest|host),?\s+(.+?)(?:\s*[-–]|$)/i);
  if (m) return m[1].trim();

  // "Jane Doe sent you a message"
  m = subject.match(/^(.+?)\s+sent you a message/i);
  if (m) return m[1].trim();

  return null;
}

// ---------------------------------------------------------------------------
// Booking match
// ---------------------------------------------------------------------------

/**
 * Try to find a Firestore booking document that matches either the
 * Airbnb confirmation code or (fallback) the guest name within an active
 * date range.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string | null} confirmationCode
 * @param {string | null} guestName
 * @param {Date} receivedAt
 * @returns {Promise<{ id: string, data: object } | null>}
 */
async function findMatchingBooking(firestore, confirmationCode, guestName, receivedAt) {
  const bookingsRef = firestore.collection('bookings');

  // Primary: exact confirmation code match
  if (confirmationCode) {
    const snap = await bookingsRef
      .where('airbnbConfirmationCode', '==', confirmationCode)
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      return { id: doc.id, data: doc.data() };
    }
  }

  // Fallback: guest name + email date falls within checkIn/checkOut
  if (guestName) {
    // Normalise: lowercase, trim
    const nameLower = guestName.toLowerCase().trim();

    // Fetch bookings where checkOut >= now (still active or future)
    const nowTs = admin.firestore.Timestamp.fromDate(receivedAt);
    const snap = await bookingsRef
      .where('checkOut', '>=', nowTs)
      .where('status', 'in', ['active', 'confirmed'])
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      const docGuestName = (data.guestName || data.primaryGuestName || '').toLowerCase().trim();

      if (docGuestName && docGuestName.includes(nameLower)) {
        // Also verify receivedAt >= checkIn to avoid early matches
        const checkInDate = data.checkIn?.toDate ? data.checkIn.toDate() : null;
        if (!checkInDate || receivedAt >= checkInDate) {
          return { id: doc.id, data };
        }
      }
    }
  }

  return null;
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

// ---------------------------------------------------------------------------
// S3 helper: stream → Buffer
// ---------------------------------------------------------------------------

/**
 * Read an S3 object body stream into a Buffer.
 *
 * @param {import('@aws-sdk/client-s3').GetObjectCommandOutput} s3Response
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(s3Response) {
  const chunks = [];
  for await (const chunk of s3Response.Body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * @param {import('aws-lambda').SESEvent} event
 */
exports.handler = async (event) => {
  console.log('parse-airbnb-email invoked', JSON.stringify({ recordCount: event.Records?.length }));

  let processedCount = 0;
  let quarantinedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const record of event.Records ?? []) {
    const mail = record.ses?.mail ?? {};
    const action = record.ses?.receipt?.action ?? {};

    const sesMessageId = mail.messageId ?? 'unknown';
    const bucketName = action.bucketName ?? process.env.EMAIL_BUCKET_NAME;
    const objectKey = action.objectKey ?? null;

    console.log('Processing record', { sesMessageId, bucketName, objectKey });

    if (!bucketName || !objectKey) {
      console.warn('Missing bucketName or objectKey — skipping record', { sesMessageId });
      skippedCount++;
      continue;
    }

    try {
      // ------------------------------------------------------------------
      // 1. Read raw email from S3
      // ------------------------------------------------------------------
      const s3Response = await s3.send(
        new GetObjectCommand({ Bucket: bucketName, Key: objectKey })
      );
      const rawBuffer = await streamToBuffer(s3Response);

      console.log('Email retrieved from S3', {
        sesMessageId,
        objectKey,
        sizeBytes: rawBuffer.length,
      });

      // ------------------------------------------------------------------
      // 2. Parse the MIME email
      // ------------------------------------------------------------------
      const parsed = await simpleParser(rawBuffer);

      const subject = parsed.subject || '';
      const fromName = parsed.from?.value?.[0]?.name || null;
      const fromAddress = parsed.from?.value?.[0]?.address || null;
      const bodyText = parsed.text || parsed.html || '';
      const receivedAt = parsed.date ? new Date(parsed.date) : new Date();
      // The RFC-2822 Message-ID header (different from SES messageId)
      const rfcMessageId = parsed.messageId || null;

      console.log('Email parsed', {
        subject,
        fromAddress,
        fromName,
        receivedAt: receivedAt.toISOString(),
        rfcMessageId,
        bodyLength: bodyText.length,
      });

      // ------------------------------------------------------------------
      // 3. Classify message type
      // ------------------------------------------------------------------
      const messageType = classifyEmail(subject);

      console.log('Email classified', { messageType, subject });

      // ------------------------------------------------------------------
      // 4. Extract confirmation code + guest name
      // ------------------------------------------------------------------
      const confirmationCode =
        extractConfirmationCode(subject) || extractConfirmationCode(bodyText);

      const guestName =
        extractGuestNameFromSubject(subject) || fromName || null;

      console.log('Extracted fields', { confirmationCode, guestName });

      // ------------------------------------------------------------------
      // 5. Get Firestore client
      // ------------------------------------------------------------------
      const firestore = await getFirestore();

      // ------------------------------------------------------------------
      // 6. Route non-guest-message emails straight to quarantine
      // ------------------------------------------------------------------
      if (messageType !== 'guest_message') {
        console.log('Non-guest message — routing to quarantine', { messageType });

        const alreadyQuarantined = await isDuplicate(
          firestore,
          'airbnb_messages_quarantine',
          objectKey,
          rfcMessageId
        );

        if (alreadyQuarantined) {
          console.log('Duplicate quarantine record — skipping', { objectKey, rfcMessageId });
          skippedCount++;
          continue;
        }

        await firestore.collection('airbnb_messages_quarantine').add({
          messageType,
          subject,
          fromName,
          fromAddress,
          body: bodyText.slice(0, 4000), // cap stored body
          receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
          rawEmailS3Key: objectKey,
          messageId: rfcMessageId,
          sesMessageId,
          airbnbConfirmationCode: confirmationCode,
          quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: `messageType:${messageType}`,
        });

        console.log('Written to airbnb_messages_quarantine', { messageType, objectKey });
        quarantinedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 7. Idempotency check against airbnb_messages
      // ------------------------------------------------------------------
      const alreadyProcessed = await isDuplicate(
        firestore,
        'airbnb_messages',
        objectKey,
        rfcMessageId
      );

      if (alreadyProcessed) {
        console.log('Duplicate airbnb_messages record — skipping', { objectKey, rfcMessageId });
        skippedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 8. Match to a booking
      // ------------------------------------------------------------------
      const booking = await findMatchingBooking(
        firestore,
        confirmationCode,
        guestName,
        receivedAt
      );

      if (!booking) {
        console.warn('No matching booking found — routing to quarantine', {
          confirmationCode,
          guestName,
        });

        // Idempotency for quarantine path too
        const alreadyQ = await isDuplicate(
          firestore,
          'airbnb_messages_quarantine',
          objectKey,
          rfcMessageId
        );

        if (!alreadyQ) {
          await firestore.collection('airbnb_messages_quarantine').add({
            messageType: 'guest_message',
            subject,
            fromName,
            fromAddress,
            body: bodyText.slice(0, 4000),
            receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
            rawEmailS3Key: objectKey,
            messageId: rfcMessageId,
            sesMessageId,
            airbnbConfirmationCode: confirmationCode,
            guestName,
            quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
            reason: 'no_matching_booking',
          });
        }

        quarantinedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 9. Write to airbnb_messages
      // ------------------------------------------------------------------
      const docData = {
        bookingId: booking.id,
        guestName: guestName || booking.data.guestName || null,
        direction: 'inbound',
        body: bodyText.slice(0, 8000), // generous cap for real messages
        receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
        rawEmailS3Key: objectKey,
        messageId: rfcMessageId,
        sesMessageId,
        airbnbConfirmationCode:
          confirmationCode || booking.data.airbnbConfirmationCode || null,
        subject,
        fromAddress,
        // Reply workflow fields — all null on ingest
        draftReply: null,
        draftStatus: 'pending',
        draftedAt: null,
        sentAt: null,
        editedReply: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = await firestore.collection('airbnb_messages').add(docData);

      console.log('Written to airbnb_messages', {
        docId: ref.id,
        bookingId: booking.id,
        confirmationCode,
        guestName: docData.guestName,
      });

      processedCount++;
    } catch (err) {
      // Log and continue — one bad record should not block subsequent records
      console.error('Failed to process email record', {
        sesMessageId,
        objectKey,
        error: err.message,
        stack: err.stack,
        code: err.Code ?? err.code,
      });
      errorCount++;
    }
  }

  const summary = {
    total: event.Records?.length ?? 0,
    processed: processedCount,
    quarantined: quarantinedCount,
    skipped: skippedCount,
    errors: errorCount,
  };

  console.log('parse-airbnb-email complete', summary);

  return {
    statusCode: 200,
    body: JSON.stringify(summary),
  };
};
