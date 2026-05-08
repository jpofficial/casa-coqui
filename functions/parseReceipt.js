'use strict';

// ---------------------------------------------------------------------------
// parseReceipt.js
//
// HTTP-triggered Cloud Function.
// Receives an inbound-email webhook from SendGrid Inbound Parse (or Mailgun
// Routes) as multipart/form-data, extracts attachments, uploads them to
// Firebase Cloud Storage, and creates a Firestore document per attachment
// in the `receipts` collection.
//
// SendGrid Inbound Parse fields used:
//   from      — sender email address
//   subject   — email subject line
//   text      — plain-text body
//   html      — HTML body (fallback for amount extraction)
//   attachment-info — JSON map of attachment metadata (SendGrid)
//   attachment{N}   — raw file buffers (SendGrid)
//
// Firestore document shape (receipts/{auto-id}):
//   filename    {string}  original attachment filename
//   storageUrl  {string}  signed download URL (7-day expiry) or public URL
//   uploadedAt  {string}  ISO 8601 timestamp
//   month       {string}  YYYY-MM derived from upload date
//   sender      {string}  from field
//   subject     {string}  email subject
//   amount      {number|null}  first dollar amount found, or null
// ---------------------------------------------------------------------------

const Busboy = require('busboy');
const { db, storage } = require('./firebaseInit');

// Regex that matches common dollar-amount patterns in email text.
// Examples matched: $12.34  $1,234.56  $99  USD 12.34
const AMOUNT_RE = /\$\s?([\d,]+(?:\.\d{1,2})?)|USD\s?([\d,]+(?:\.\d{1,2})?)/i;

/**
 * Extracts the first dollar amount found in the given text.
 * Returns a Number or null if nothing is found.
 *
 * @param {string} text
 * @returns {number|null}
 */
function extractAmount(text) {
  if (!text) return null;
  const match = text.match(AMOUNT_RE);
  if (!match) return null;
  // match[1] is the group after '$', match[2] is the group after 'USD'
  const raw = (match[1] || match[2] || '').replace(/,/g, '');
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parses multipart/form-data from an incoming HTTP request into a plain object.
 * Returns:
 *   fields      {Object}  key/value text fields
 *   attachments {Array}   [{ fieldname, filename, mimetype, buffer }]
 *
 * @param {import('firebase-functions/v2/https').Request} req
 * @returns {Promise<{ fields: Object, attachments: Array }>}
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const attachments = [];

    const bb = Busboy({ headers: req.headers });

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (fieldname, fileStream, info) => {
      const { filename, mimeType } = info;
      const chunks = [];

      fileStream.on('data', (chunk) => chunks.push(chunk));
      fileStream.on('end', () => {
        attachments.push({
          fieldname,
          filename: filename || fieldname,
          mimetype: mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
        });
      });
      fileStream.on('error', reject);
    });

    bb.on('finish', () => resolve({ fields, attachments }));
    bb.on('error', reject);

    // Cloud Functions v2 expose the raw body; pipe it through busboy.
    if (req.rawBody) {
      bb.end(req.rawBody);
    } else {
      req.pipe(bb);
    }
  });
}

/**
 * Main Cloud Function handler — exported for use in index.js.
 *
 * @param {import('firebase-functions/v2/https').Request}  req
 * @param {import('firebase-functions/v2/https').Response} res
 */
async function parseReceiptHandler(req, res) {
  // Only accept POST requests from the email service webhook.
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  console.log('[parseReceipt] Inbound email webhook received');

  let fields = {};
  let attachments = [];

  try {
    const parsed = await parseMultipart(req);
    fields = parsed.fields;
    attachments = parsed.attachments;
  } catch (parseErr) {
    console.error('[parseReceipt] Failed to parse multipart body:', parseErr);
    res.status(400).json({ success: false, error: 'Failed to parse request body' });
    return;
  }

  const sender = fields.from || fields.sender || 'unknown';
  const subject = fields.subject || '';
  const bodyText = fields.text || fields.body || fields.html || '';

  console.log(`[parseReceipt] From: ${sender} | Subject: "${subject}" | Attachments: ${attachments.length}`);

  // Attempt dollar-amount extraction from subject first, then body.
  const amount = extractAmount(subject) ?? extractAmount(bodyText);

  if (amount !== null) {
    console.log(`[parseReceipt] Extracted amount: $${amount}`);
  }

  // Build month string from current UTC date (property is UTC-4 / America/Puerto_Rico
  // but month-level granularity is the same for billing purposes).
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const bucket = storage.bucket();
  let processedCount = 0;
  const results = [];

  for (const attachment of attachments) {
    const { filename, mimetype, buffer } = attachment;

    // Sanitize filename: strip directory traversal characters.
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `receipts/${month}/${safeName}`;

    console.log(`[parseReceipt] Processing attachment: "${safeName}" (${mimetype}, ${buffer.length} bytes)`);

    try {
      // Upload buffer to Cloud Storage.
      const file = bucket.file(storagePath);
      await file.save(buffer, {
        metadata: {
          contentType: mimetype,
          metadata: {
            sender,
            subject,
            uploadedAt: now.toISOString(),
          },
        },
      });

      // Generate a signed URL valid for 7 days.
      // If the bucket is publicly accessible, getPublicUrl() can be used instead.
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days in ms
      });

      // Write Firestore receipt document.
      const docRef = await db.collection('receipts').add({
        filename: safeName,
        storageUrl: signedUrl,
        uploadedAt: now.toISOString(),
        month,
        sender,
        subject,
        amount: amount ?? null,
      });

      console.log(`[parseReceipt] Stored receipt doc ${docRef.id} for "${safeName}"`);
      processedCount++;
      results.push({ filename: safeName, docId: docRef.id, storageUrl: signedUrl });
    } catch (attachErr) {
      // Log and continue — one bad attachment should not block the rest.
      console.error(`[parseReceipt] Failed to process attachment "${safeName}":`, attachErr);
      results.push({ filename: safeName, error: attachErr.message });
    }
  }

  // If the email had no attachments, still record the email itself as a receipt.
  if (attachments.length === 0) {
    console.log('[parseReceipt] No attachments found — recording email metadata only');
    try {
      const docRef = await db.collection('receipts').add({
        filename: null,
        storageUrl: null,
        uploadedAt: now.toISOString(),
        month,
        sender,
        subject,
        amount: amount ?? null,
      });
      console.log(`[parseReceipt] Stored email-only receipt doc ${docRef.id}`);
      processedCount++;
      results.push({ filename: null, docId: docRef.id });
    } catch (emailErr) {
      console.error('[parseReceipt] Failed to store email-only receipt:', emailErr);
    }
  }

  console.log(`[parseReceipt] Done — processed ${processedCount} item(s)`);
  res.status(200).json({ success: true, processed: processedCount, results });
}

module.exports = { parseReceiptHandler };
