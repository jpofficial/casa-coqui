'use strict';

/**
 * parse-airbnb-email — Lambda entrypoint.
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
 *
 * Module layout (src/):
 *   classify.js        isAirbnbSender, classifyEmail
 *   extract.js         confirmation code, guest name (subject/HTML/plaintext), enrichment + resolution fields
 *   match.js           tiered booking match + active-stay-window tie-breaking
 *   thread.js          Reply-To tokens, v2 composite threadKey, RFC 5322 header refs
 *   idempotency.js     terminal-collection dedupe + tombstone lock
 *   firestore.js       lazy Firebase Admin bootstrap (Secrets Manager)
 *   notify.js          staff push + in-app notification
 *   s3.js              raw email fetch
 *   process-record.js  the per-record pipeline the handler loops over
 *
 * The pure helpers are re-exported below so the unit tests keep importing
 * them from `require('../index')`.
 */

const { processRecord } = require('./src/process-record');
const classify = require('./src/classify');
const extract = require('./src/extract');
const match = require('./src/match');
const thread = require('./src/thread');

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * @param {import('aws-lambda').SESEvent} event
 */
exports.handler = async (event) => {
  console.log('parse-airbnb-email invoked', JSON.stringify({ recordCount: event.Records?.length }));

  const counts = { processed: 0, quarantined: 0, skipped: 0, errors: 0 };

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
      counts.skipped++;
      continue;
    }

    try {
      await processRecord({ sesMessageId, bucketName, objectKey }, counts);
    } catch (err) {
      // Log and continue — one bad record should not block subsequent records
      console.error('Failed to process email record', {
        sesMessageId,
        objectKey,
        error: err.message,
        stack: err.stack,
        code: err.Code ?? err.code,
      });
      counts.errors++;
    }
  }

  const summary = {
    total: event.Records?.length ?? 0,
    processed: counts.processed,
    quarantined: counts.quarantined,
    skipped: counts.skipped,
    errors: counts.errors,
  };

  console.log('parse-airbnb-email complete', summary);

  return {
    statusCode: 200,
    body: JSON.stringify(summary),
  };
};


// Exports for unit tests. `exports.handler` remains the Lambda entrypoint.
module.exports.extractEnrichmentFields = extract.extractEnrichmentFields;
module.exports.classifyEmail = classify.classifyEmail;
module.exports.isAirbnbSender = classify.isAirbnbSender;
module.exports.extractGuestNameFromSubject = extract.extractGuestNameFromSubject;
module.exports.extractGuestNameFromBody = extract.extractGuestNameFromBody;
module.exports.resolveGuestNameWithLogging = extract.resolveGuestNameWithLogging;
module.exports.parseResolutionFields = extract.parseResolutionFields;
module.exports.normalizeName = match.normalizeName;
module.exports.isInActiveWindow = match.isInActiveWindow;
module.exports.midpointDistance = match.midpointDistance;
module.exports.tieBreak = match.tieBreak;
module.exports.WINDOW_PRE_DAYS = match.WINDOW_PRE_DAYS;
module.exports.WINDOW_POST_DAYS = match.WINDOW_POST_DAYS;
module.exports.matchByActiveWindow = match.matchByActiveWindow;
module.exports.findMatchingBooking = match.findMatchingBooking;
module.exports.extractHeaderRefs = thread.extractHeaderRefs;
module.exports.findParentMessageDocId = thread.findParentMessageDocId;
module.exports.extractAirbnbReplyToToken = thread.extractAirbnbReplyToToken;
module.exports.airbnbThreadKeyFromReplyTo = thread.airbnbThreadKeyFromReplyTo;
module.exports.extractStayWindowFromSubject = thread.extractStayWindowFromSubject;
module.exports.extractStayYearFromSubject = thread.extractStayYearFromSubject;
module.exports.deriveAirbnbThreadKey = thread.deriveAirbnbThreadKey;
