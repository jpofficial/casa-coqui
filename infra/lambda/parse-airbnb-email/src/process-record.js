'use strict';

/**
 * Per-record pipeline: S3 → MIME parse → dedupe/lock → classify → extract →
 * route (enrich booking / resolution case / quarantine / airbnb_messages).
 *
 * This is the body of the former monolithic handler loop, moved verbatim.
 * `counts` is the handler's running summary; this function increments it
 * exactly where the original loop did and returns instead of `continue`-ing.
 * Any thrown error is caught (and counted) by the handler.
 */

const admin = require('firebase-admin');
const { simpleParser } = require('mailparser');

const { PARSER_VERSION } = require('./constants');
const { s3, GetObjectCommand, streamToBuffer } = require('./s3');
const { getFirestore } = require('./firestore');
const { notifyAdminAndCohost } = require('./notify');
const { isAirbnbSender, classifyEmail } = require('./classify');
const {
  parseResolutionFields,
  extractConfirmationCode,
  resolveGuestNameWithLogging,
  extractEnrichmentFields,
} = require('./extract');
const { findMatchingBooking } = require('./match');
const {
  extractAirbnbReplyToToken,
  deriveAirbnbThreadKey,
  extractHeaderRefs,
  findParentMessageDocId,
} = require('./thread');
const { isDuplicate, claimTombstone, markTombstoneCompleted } = require('./idempotency');

/**
 * @param {{ sesMessageId: string, bucketName: string, objectKey: string }} record
 * @param {{ processed: number, quarantined: number, skipped: number, errors: number }} counts
 */
async function processRecord({ sesMessageId, bucketName, objectKey }, counts) {
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
  const { inReplyTo, references } = extractHeaderRefs(parsed);
  // Per-thread Reply-To token from Airbnb (e.g. <token>@reply.airbnb.com).
  // v2: kept as a debug field on the Firestore doc only — no longer
  // load-bearing for threading because Airbnb rotates Reply-To per email.
  // See deriveAirbnbThreadKey for the canonical v2 threadKey derivation.
  const replyToToken = extractAirbnbReplyToToken(parsed);

  console.log('Email parsed', {
    subject,
    fromAddress,
    fromName,
    receivedAt: receivedAt.toISOString(),
    rfcMessageId,
    bodyLength: bodyText.length,
  });

  // ------------------------------------------------------------------
  // 3. Get Firestore client (hoisted — needed for dedupe + claim below)
  // ------------------------------------------------------------------
  const firestore = await getFirestore();

  // ------------------------------------------------------------------
  // 3b. Dedupe across all three terminal collections before any side
  //     effect. SES → Lambda is at-least-once; a duplicate terminal
  //     record means we already processed this email successfully.
  //
  //     Hoisted above classify/extract so the at-most-once guarantee
  //     holds even if a classifier/extractor is ever changed to do I/O.
  // ------------------------------------------------------------------
  const [msgDup, quarDup] = await Promise.all([
    isDuplicate(firestore, 'airbnb_messages', objectKey, rfcMessageId),
    isDuplicate(firestore, 'airbnb_messages_quarantine', objectKey, rfcMessageId),
  ]);
  if (msgDup || quarDup) {
    console.log('duplicate — terminal record exists, skipping', {
      sesMessageId, objectKey,
    });
    counts.skipped++;
    return;
  }

  // ------------------------------------------------------------------
  // 3c. Authoritative claim — .create() fails if lock doc exists (CAS).
  //     Crashed invocations leave locks at 'processing'; lockSweeper
  //     (Commit 4) flips them to 'reclaimable' after 5 min.
  // ------------------------------------------------------------------
  const claim = await claimTombstone(firestore, objectKey, rfcMessageId);
  if (!claim.claimed) {
    console.log('duplicate — lock held by another invocation', {
      sesMessageId, objectKey,
    });
    counts.skipped++;
    return;
  }

  // ------------------------------------------------------------------
  // 3d. Short-circuit non-Airbnb senders. The Gmail forward address is
  //     also catching marketing mail (Reddit, Lyft, MoveOn, etc.). These
  //     never need to enter the booking-match path — quarantine and move on.
  // ------------------------------------------------------------------
  if (!isAirbnbSender(fromAddress)) {
    await firestore.collection('airbnb_messages_quarantine').add({
      messageType: 'non_airbnb',
      subject,
      fromName,
      fromAddress,
      body: bodyText.slice(0, 2000),
      receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
      rawEmailS3Key: objectKey,
      messageId: rfcMessageId,
      sesMessageId,
      parserVersion: PARSER_VERSION,
      quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
      reason: 'non_airbnb_sender',
    });
    console.log('Non-Airbnb sender — quarantined', { fromAddress });
    counts.quarantined++;
    await markTombstoneCompleted(claim.lockRef);
    return;
  }

  // Resolve inReplyTo to a parent Firestore doc id (best-effort; null if not found).
  const replyToId = await findParentMessageDocId(firestore, inReplyTo);

  // ------------------------------------------------------------------
  // 4. Classify message type
  // ------------------------------------------------------------------
  const messageType = classifyEmail(subject);

  console.log('Email classified', { messageType, subject });

  // ------------------------------------------------------------------
  // 5. Extract confirmation code + guest name
  //
  //    Guest name resolution (Fix 1, 2026-05-09):
  //      1) subject regex   (e.g. "New message from Jane Doe")
  //      2) HTML body       (alt="Jane" + <h2>Jane</h2> + Booker anchor)
  //      3) plaintext body  (indented uppercase line + Booker line)
  //      4) sentinel        ('Unknown sender' — never `fromName`, which
  //                          is always literally "Airbnb" for Airbnb mail)
  //
  //    `fromName` is preserved on the doc as `fromDisplayName` for
  //    forensics but no longer leaks into guestName.
  // ------------------------------------------------------------------
  const confirmationCode =
    extractConfirmationCode(subject) || extractConfirmationCode(bodyText);

  const fromDisplayName = fromName;
  const { guestName, source: guestNameSource } = resolveGuestNameWithLogging({
    subject,
    html: parsed.html,
    text: parsed.text,
    sesMessageId,
    objectKey,
    fromDisplayName,
  });

  console.log('Extracted fields', {
    confirmationCode,
    guestName,
    guestNameSource,
    fromDisplayName,
  });

  // ------------------------------------------------------------------
  // 6. Route reservation confirmations → enrich or quarantine
  //    Lambda NEVER creates bookings. ICS is the sole booking creator.
  //    (See docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md)
  // ------------------------------------------------------------------
  if (messageType === 'reservation_confirmation') {
    const matched = await findMatchingBooking(firestore, {
      confirmationCode,
      fromAddress,
      guestName,
      receivedAt,
    });
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
        parserVersion: PARSER_VERSION,
        quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('reservation confirmation unmatched — quarantined', {
        airbnbConfirmationCode: confirmationCode,
      });
      counts.quarantined++;
      await markTombstoneCompleted(claim.lockRef);
      return;
    }

    // Enrich — never overwrite existing non-null fields.
    const existing = matched.data;
    const genericNames = ['airbnb guest', 'guest', ''];
    const existingNameGeneric = genericNames.includes(
      (existing.guestName || '').toLowerCase().trim()
    );

    // Capture before the update: used to gate first-enrichment push.
    const firstEnrichment = !existing.lastEnrichedFromEmailAt;

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

      // Near-real-time staff push on first enrichment only.
      // Idempotent — gated on lastEnrichedFromEmailAt (unset before this write).
      if (firstEnrichment) {
        const guestName = updates.guestName || existing.guestName || 'Guest';
        await notifyAdminAndCohost(firestore, {
          titleEn: 'Airbnb email received',
          titleEs: 'Email de Airbnb recibido',
          bodyEn: 'Booking details enriched from email for {guestName}',
          bodyEs: 'Detalles de reserva enriquecidos por email para {guestName}',
          bodyParams: { guestName },
          type: 'booking_enriched',
          data: { bookingId: matched.id, targetPath: '/admin/bookings' },
        });
      }
    }

    counts.processed++;
    await markTombstoneCompleted(claim.lockRef);
    return;
  }

  // ------------------------------------------------------------------
  // 6b. Route resolution requests (AirCover / Resolution Center cases) to
  //     dedicated airbnb_resolutions collection, keyed by claimId so
  //     follow-up emails on the same case upsert into one doc.
  // ------------------------------------------------------------------
  if (messageType === 'resolution_request') {
    const fields = parseResolutionFields({ subject, bodyText });
    const claimId = fields.claimId;

    if (!claimId) {
      // Couldn't extract a claim ID — fall through to quarantine for triage
      console.warn('resolution_request without parseable claimId — quarantining', {
        subject,
        objectKey,
      });
    } else {
      const resCode = fields.confirmationCode || confirmationCode || null;
      const docRef = firestore.collection('airbnb_resolutions').doc(claimId);
      const existing = await docRef.get();
      const isFirstArrival = !existing.exists;

      // Best-effort booking match — same lookup as guest messages.
      let bookingId = null;
      if (resCode) {
        const matched = await findMatchingBooking(firestore, {
          confirmationCode: resCode,
          fromAddress,
          guestName,
          receivedAt,
        });
        if (matched) bookingId = matched.id;
      }

      const nowTs = admin.firestore.FieldValue.serverTimestamp();
      const payload = {
        claimId,
        confirmationCode: resCode,
        bookingId,
        subject,
        fromName,
        fromAddress,
        receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
        resolutionUrl: fields.resolutionUrl,
        bodyText: bodyText.slice(0, 16000), // cap; chatbot will get the full text from S3 later
        rawEmailS3Key: objectKey,
        messageId: rfcMessageId,
        sesMessageId,
        parserVersion: PARSER_VERSION,
        updatedAt: nowTs,
      };

      if (isFirstArrival) {
        payload.status = 'open';
        payload.createdAt = nowTs;
        payload.adminNotifiedAt = null;
      }

      await docRef.set(payload, { merge: true });
      console.log('airbnb_resolutions upserted', { claimId, isFirstArrival, objectKey });

      // Notify admin/cohost only on first arrival of a claim.
      // Subsequent emails for the same claim update the doc silently.
      if (isFirstArrival) {
        await notifyAdminAndCohost(firestore, {
          titleEn: 'Airbnb resolution case opened',
          titleEs: 'Caso de resolución de Airbnb abierto',
          bodyEn: 'Claim {claimId} from resolutions@airbnb.com{bookingPart}',
          bodyEs: 'Reclamo {claimId} de resolutions@airbnb.com{bookingPart}',
          bodyParams: {
            claimId,
            bookingPart: resCode ? ` — booking ${resCode}` : '',
          },
          type: 'resolution_request',
          data: {
            claimId,
            confirmationCode: resCode || '',
            bookingId: bookingId || '',
            resolutionUrl: fields.resolutionUrl || '',
            targetPath: '/admin/resolutions',
          },
        });
        await docRef.update({ adminNotifiedAt: nowTs });
      }

      counts.processed++;
      await markTombstoneCompleted(claim.lockRef);
      return;
    }
  }

  // ------------------------------------------------------------------
  // 6c. Route other non-guest-message emails straight to quarantine
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
      parserVersion: PARSER_VERSION,
      quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
      reason: `messageType:${messageType}`,
    });

    console.log('Written to airbnb_messages_quarantine', { messageType, objectKey });
    counts.quarantined++;
    await markTombstoneCompleted(claim.lockRef);
    return;
  }

  // ------------------------------------------------------------------
  // 7. Match to a booking
  // ------------------------------------------------------------------
  const booking = await findMatchingBooking(firestore, {
    confirmationCode,
    fromAddress,
    guestName,
    receivedAt,
  });

  if (!booking) {
    console.warn('No matching booking found — writing as unmatched', {
      confirmationCode,
      guestName,
    });

    // v2 composite threadKey — bookingId is null on the unmatched path, so
    // the derivation falls through to the guestName+stayWindow path
    // (or 'unknown' when no name was extracted).
    const senderNameForKey = guestNameSource === 'sentinel' ? null : guestName;
    const {
      threadKey: unmatchedThreadKey,
      threadKeyPath: unmatchedThreadKeyPath,
    } = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: senderNameForKey,
      subject,
      receivedAt,
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
      inReplyTo,
      references,
      replyToId,
      sesMessageId,
      airbnbConfirmationCode: confirmationCode || null,
      subject,
      fromName,
      fromDisplayName,
      fromAddress,
      read: false,
      draftReply: null,
      draftStatus: 'pending',
      draftedAt: null,
      sentAt: null,
      editedReply: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      threadKey: unmatchedThreadKey,
      replyToToken,
      parserVersion: PARSER_VERSION,
      source: 'inbound',
    });

    console.log('Written unmatched guest_message to airbnb_messages', {
      threadKey: unmatchedThreadKey,
      threadKeyPath: unmatchedThreadKeyPath,
    });

    // Also archive to quarantine for record-keeping
    await firestore.collection('airbnb_messages_quarantine').add({
      messageType: 'guest_message',
      subject,
      fromName,
      fromDisplayName,
      fromAddress,
      body: bodyText.slice(0, 4000),
      receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
      rawEmailS3Key: objectKey,
      messageId: rfcMessageId,
      inReplyTo,
      references,
      replyToId,
      sesMessageId,
      airbnbConfirmationCode: confirmationCode,
      guestName,
      threadKey: unmatchedThreadKey,
      replyToToken,
      parserVersion: PARSER_VERSION,
      quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
      reason: 'no_matching_booking',
    });

    counts.processed++;
    await markTombstoneCompleted(claim.lockRef);
    return;
  }

  // ------------------------------------------------------------------
  // 9. Write to airbnb_messages
  // ------------------------------------------------------------------
  const { threadKey: matchedThreadKey, threadKeyPath: matchedThreadKeyPath } =
    deriveAirbnbThreadKey({
      bookingId: booking.id,
      guestName: guestName || booking.data.guestName || null,
      subject,
      receivedAt,
    });

  const docData = {
    bookingId: booking.id,
    guestName: guestName || booking.data.guestName || null,
    direction: 'inbound',
    body: bodyText.slice(0, 8000), // generous cap for real messages
    receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
    rawEmailS3Key: objectKey,
    messageId: rfcMessageId,
    inReplyTo,
    references,
    replyToId,
    sesMessageId,
    airbnbConfirmationCode:
      confirmationCode || booking.data.airbnbConfirmationCode || null,
    subject,
    fromAddress,
    fromDisplayName,
    // Reply workflow fields — all null on ingest
    draftReply: null,
    draftStatus: 'pending',
    draftedAt: null,
    sentAt: null,
    editedReply: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    threadKey: matchedThreadKey,
    replyToToken,
    parserVersion: PARSER_VERSION,
    source: 'inbound',
  };

  const ref = await firestore.collection('airbnb_messages').add(docData);

  console.log('Written to airbnb_messages', {
    docId: ref.id,
    bookingId: booking.id,
    confirmationCode,
    guestName: docData.guestName,
    threadKey: matchedThreadKey,
    threadKeyPath: matchedThreadKeyPath,
  });

  counts.processed++;
  await markTombstoneCompleted(claim.lockRef);
  return;
}

module.exports = { processRecord };
