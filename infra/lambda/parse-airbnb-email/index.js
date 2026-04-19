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
const Anthropic = require('@anthropic-ai/sdk').default;
const { buildThreadKey } = require('./thread-key');

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

const crypto = require('crypto');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * @typedef {'reservation_confirmation' | 'guest_message' | 'payout' | 'review_request' | 'policy_update' | 'unknown'} MessageType
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

  // Reservation confirmations — check BEFORE guest messages
  if (
    /reservation confirmed/i.test(subject) ||
    /new booking confirmed/i.test(subject) ||
    /reservation request from/i.test(subject)
  ) {
    return 'reservation_confirmation';
  }

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
// Welcome message generation (mirrors functions/lib/welcome-ai.js)
// ---------------------------------------------------------------------------

/** @type {string | null} */
let cachedAnthropicKey = null;

/**
 * Fetch the Anthropic API key from Secrets Manager (cached per container).
 * @returns {Promise<string>}
 */
async function getAnthropicApiKey() {
  if (cachedAnthropicKey) return cachedAnthropicKey;

  const secretName = process.env.ANTHROPIC_SECRET_NAME || 'casa-coqui/anthropic-api-key';
  const resp = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  cachedAnthropicKey = resp.SecretString;
  return cachedAnthropicKey;
}

const WELCOME_SYSTEM_PROMPT = `You are drafting a welcome message for a short-term rental guest on behalf of Julio, the host of Casa Coqui in San Juan, Puerto Rico. Julio is warm, friendly, and helpful — not overly formal.

YOUR RULES:
1. Write in the guest's likely language. If the guest name suggests Spanish, write in Spanish. Otherwise default to English. If a language is explicitly requested, use that.
2. Keep the message concise — 3-4 short paragraphs max. Guests are reading this on their phone.
3. Start with a warm thank-you for booking and genuine excitement about hosting them.
4. The guest portal link is the KEY part of the message. Sell its value — tell the guest it has:
   - Step-by-step check-in instructions with photos
   - WiFi details, house rules, and property info
   - Laundry availability and parking details
   - Everything they need for a smooth stay
   Place the link on its own line so it's easy to tap. Emphasize it's quick and easy — no password needed, just tap the link.
5. Mention that you'll also send more info closer to their arrival date, and that all communication should stay here on Airbnb.
6. End with an invitation to reach out with questions. Sign off as "Julio".
7. Do NOT include specific check-in instructions, WiFi passwords, or door codes — those are in the guest portal.
8. Do NOT use generic hotel language. Sound like a real person, not a template.
9. Do NOT use emojis excessively — one or two max is fine.
10. If a template/example is provided, match its tone and structure closely.
11. Mention the unit name naturally if it has a friendly name.
12. Keep it under 200 words.`;

const WELCOME_TOOL = {
  name: 'welcome_message',
  description: 'Generate a personalized welcome message for an incoming guest',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The welcome message text' },
      language: { type: 'string', enum: ['en', 'es'], description: 'Language used' },
    },
    required: ['message', 'language'],
  },
};

/**
 * Generate a welcome message draft and update the booking doc.
 * Non-fatal: logs errors but does not throw.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string} bookingId
 * @param {object} booking - booking doc data
 * @param {object | null} settings - property settings
 */
async function generateWelcomeDraft(firestore, bookingId, booking, settings) {
  try {
    const apiKey = await getAnthropicApiKey();
    const client = new Anthropic({ apiKey });

    const checkIn = booking.checkInDate;
    const checkOut = booking.checkOutDate;
    const nightCount = checkIn && checkOut
      ? Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
      : null;

    const input = JSON.stringify({
      guest: { name: booking.guestName || 'Guest', confirmationCode: booking.airbnbConfirmationCode },
      stay: { unit: booking.unit, checkInDate: checkIn, checkOutDate: checkOut, nightCount },
      property: { name: settings?.propertyName || 'Casa Coqui', location: settings?.location || 'San Juan, Puerto Rico' },
      guestPortalLink: booking.guestLink || null,
    });

    const startTime = Date.now();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: WELCOME_SYSTEM_PROMPT,
      tools: [WELCOME_TOOL],
      tool_choice: { type: 'tool', name: 'welcome_message' },
      messages: [{ role: 'user', content: input }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) {
      console.error('Welcome AI did not return structured output');
      return;
    }

    const now = new Date().toISOString();
    await firestore.collection('bookings').doc(bookingId).update({
      welcomeStatus: 'ready',
      welcomeMessage: toolUse.input.message,
      welcomeDraftedAt: now,
    });

    // Log agent run for observability
    await firestore.collection('agent_runs').add({
      kind: 'welcome',
      refId: bookingId,
      model: 'claude-haiku-4-5-20251001',
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      latencyMs: Date.now() - startTime,
      prompt: input,
      response: JSON.stringify(toolUse.input),
      escalated: false,
      createdAt: now,
    });

    console.log('Welcome message generated', {
      bookingId,
      language: toolUse.input.language,
      latencyMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error('Welcome message generation failed', {
      bookingId,
      error: err.message,
    });
    // Record the failure so the admin UI can surface a Retry button.
    try {
      await firestore.collection('bookings').doc(bookingId).update({
        welcomeStatus: 'error',
        welcomeError: err.message ? String(err.message).slice(0, 500) : 'unknown',
      });
    } catch (updateErr) {
      console.error('Failed to persist welcome error state', updateErr.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Enrichment field extraction
// ---------------------------------------------------------------------------

/**
 * Extract fields used to enrich an existing booking. No date parsing — dates
 * come from ICS which is the authoritative source. Payout regex bounded to
 * avoid matching across unrelated dollar amounts (cleaning fee / service fee
 * / total) in Airbnb email bodies.
 */
function extractEnrichmentFields(subject, body) {
  const fields = {
    guestName: extractGuestNameFromSubject(subject),
    guestCount: null,
    payoutAmount: null,
    guestMessage: null,
  };

  const countMatch = body.match(/(\d+)\s+(?:adults?|guests?)/i);
  if (countMatch) fields.guestCount = parseInt(countMatch[1], 10);

  const payoutMatch = body.match(
    /(?:total|guest paid|you earn|payout)[^$]{0,200}\$([0-9,]+\.?\d*)/i
  );
  if (payoutMatch) {
    fields.payoutAmount = parseFloat(payoutMatch[1].replace(/,/g, ''));
  }

  const msgMatch = body.match(/"([^"]{20,})"/);
  if (msgMatch) fields.guestMessage = msgMatch[1].trim();

  return fields;
}

// ---------------------------------------------------------------------------
// Booking match
// ---------------------------------------------------------------------------

/**
 * Primary-match only: find a Firestore booking document whose
 * `airbnbConfirmationCode` equals the one extracted from the email. Dates
 * are NOT used for matching — ICS is the authoritative source for dates.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string | null} confirmationCode
 * @returns {Promise<{ id: string, data: object } | null>}
 */
async function findMatchingBooking(firestore, confirmationCode) {
  if (!confirmationCode) return null;
  const snap = await firestore
    .collection('bookings')
    .where('airbnbConfirmationCode', '==', confirmationCode)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
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
    if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
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
    // When Lambda is invoked async (EVENT), SES doesn't include the S3 action
    // details. Derive the object key from the prefix + SES message ID, which
    // is how the S3 action stores the raw email.
    const objectKey = action.objectKey ?? (sesMessageId !== 'unknown' ? `airbnb/${sesMessageId}` : null);

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
      // 5b. Dedupe across all three terminal collections before any side
      //     effect. SES → Lambda is at-least-once; a duplicate terminal
      //     record means we already processed this email successfully.
      // ------------------------------------------------------------------
      const [msgDup, quarDup] = await Promise.all([
        isDuplicate(firestore, 'airbnb_messages', objectKey, rfcMessageId),
        isDuplicate(firestore, 'airbnb_messages_quarantine', objectKey, rfcMessageId),
      ]);
      if (msgDup || quarDup) {
        console.log('duplicate — terminal record exists, skipping', {
          sesMessageId, objectKey,
        });
        skippedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 5c. Authoritative claim — .create() fails if lock doc exists (CAS).
      //     Crashed invocations leave locks at 'processing'; lockSweeper
      //     (Commit 4) flips them to 'reclaimable' after 5 min.
      // ------------------------------------------------------------------
      const claim = await claimTombstone(firestore, objectKey, rfcMessageId);
      if (!claim.claimed) {
        console.log('duplicate — lock held by another invocation', {
          sesMessageId, objectKey,
        });
        skippedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 6. Route reservation confirmations → enrich or quarantine
      //    Lambda NEVER creates bookings. ICS is the sole booking creator.
      //    (See docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md)
      // ------------------------------------------------------------------
      if (messageType === 'reservation_confirmation') {
        const matched = await findMatchingBooking(firestore, confirmationCode);
        const fields = extractEnrichmentFields(subject, bodyText);

        if (!matched) {
          await firestore.collection('airbnb_messages_quarantine').add({
            messageType: 'reservation_confirmation',
            reason: 'unmatched_awaiting_ics',
            status: 'pending',
            subject,
            body: bodyText.slice(0, 4000),
            receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
            rawEmailS3Key: objectKey,
            messageId: rfcMessageId,
            sesMessageId,
            airbnbConfirmationCode: confirmationCode || null,
            enrichmentFields: fields,
            quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log('reservation confirmation unmatched — quarantined', {
            airbnbConfirmationCode: confirmationCode,
          });
          quarantinedCount++;
          await markTombstoneCompleted(claim.lockRef);
          continue;
        }

        // Enrich — never overwrite existing non-null fields.
        const existing = matched.data;
        const genericNames = ['airbnb guest', 'guest', ''];
        const existingNameGeneric = genericNames.includes(
          (existing.guestName || '').toLowerCase().trim()
        );

        const updates = {};
        if (fields.guestName && existingNameGeneric) updates.guestName = fields.guestName;
        if (fields.guestCount && !existing.guestCount) updates.guestCount = fields.guestCount;
        if (fields.payoutAmount && !existing.payoutAmount) updates.payoutAmount = fields.payoutAmount;
        if (fields.guestMessage && !existing.guestMessage) updates.guestMessage = fields.guestMessage;

        if (Object.keys(updates).length > 0) {
          updates.lastEnrichedFromEmailAt = new Date().toISOString();
          await firestore.collection('bookings').doc(matched.id).update(updates);
          console.log('booking enriched from email', {
            bookingId: matched.id,
            fieldsUpdated: Object.keys(updates),
          });
        }

        processedCount++;
        await markTombstoneCompleted(claim.lockRef);
        continue;
      }

      // ------------------------------------------------------------------
      // 6b. Route other non-guest-message emails straight to quarantine
      // ------------------------------------------------------------------
      if (messageType !== 'guest_message') {
        console.log('Non-guest message — routing to quarantine', { messageType });

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
        await markTombstoneCompleted(claim.lockRef);
        continue;
      }

      // ------------------------------------------------------------------
      // 7. Match to a booking
      // ------------------------------------------------------------------
      const booking = await findMatchingBooking(firestore, confirmationCode);

      if (!booking) {
        console.warn('No matching booking found — writing as unmatched', {
          confirmationCode,
          guestName,
        });

        // Write to airbnb_messages with null bookingId so it appears in admin UI
        await firestore.collection('airbnb_messages').add({
          bookingId: null,
          guestName: guestName || null,
          direction: 'inbound',
          body: bodyText.slice(0, 8000),
          receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
          rawEmailS3Key: objectKey,
          messageId: rfcMessageId,
          sesMessageId,
          airbnbConfirmationCode: confirmationCode || null,
          subject,
          fromName,
          fromAddress,
          read: false,
          draftReply: null,
          draftStatus: 'pending',
          draftedAt: null,
          sentAt: null,
          editedReply: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          threadKey: buildThreadKey({
            bookingCode: null,
            senderEmail: fromAddress,
            senderName: guestName || fromName,
          }),
          source: 'inbound',
        });

        console.log('Written unmatched guest_message to airbnb_messages');

        // Also archive to quarantine for record-keeping
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

        processedCount++;
        await markTombstoneCompleted(claim.lockRef);
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
        threadKey: buildThreadKey({
          bookingCode: booking.data.code,
          senderEmail: fromAddress,
          senderName: guestName || booking.data.guestName || null,
        }),
        source: 'inbound',
      };

      const ref = await firestore.collection('airbnb_messages').add(docData);

      console.log('Written to airbnb_messages', {
        docId: ref.id,
        bookingId: booking.id,
        confirmationCode,
        guestName: docData.guestName,
      });

      processedCount++;
      await markTombstoneCompleted(claim.lockRef);
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

// Exports for unit tests. `exports.handler` remains the Lambda entrypoint.
module.exports.extractEnrichmentFields = extractEnrichmentFields;
