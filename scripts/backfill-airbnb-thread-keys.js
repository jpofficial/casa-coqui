#!/usr/bin/env node
/**
 * One-time backfill: re-key legacy `airbnb_messages` documents that were
 * written by the old parser (bug: `guestName` set to literal "Airbnb" /
 * `threadKey` collapsed to `name:airbnb|y:YYYY` or `email:express@airbnb.com`).
 *
 * For every match, re-fetches the raw email from S3, re-runs `simpleParser`,
 * re-extracts the Reply-To token + body-side guestName, and updates the doc:
 *   - threadKey         → "airbnb:<32-hex>" when Reply-To is from
 *                         @reply.airbnb.com, otherwise rebuilt via buildThreadKey
 *   - guestName         → extracted from subject/HTML/plaintext, or
 *                         'Unknown sender' sentinel when extraction fails
 *   - fromDisplayName   → preserved (was usually "Airbnb")
 *   - replyToToken      → opaque per-thread token (forensics only)
 *   - airbnbThreadKey   → mirrors threadKey when Reply-To is Airbnb-keyed
 *   - parserVersion     → '2026-05-09'
 *
 * Idempotent: uses .update() (not .add()). Safe to re-run.
 *
 * !! IMPORTANT — DO NOT RUN WITHOUT EXPLICIT APPROVAL !!
 *
 * This script is checked in for review only. The user wants to inspect the
 * full diff before invoking it against any environment. Default mode is
 * DRY-RUN; the --apply flag is required to write anything.
 *
 * Usage:
 *   node scripts/backfill-airbnb-thread-keys.js            # dry run
 *   node scripts/backfill-airbnb-thread-keys.js --apply    # writes
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing to an admin-SDK service-
 * account JSON, AND AWS credentials (default chain) with read on the SES raw
 * email S3 bucket.
 *
 * Env:
 *   GOOGLE_APPLICATION_CREDENTIALS  (Firebase Admin)
 *   AWS_REGION                       defaults to us-east-1
 *
 * The S3 bucket name is read off each doc's rawEmailS3Key field — but the
 * SES rule writes objects to a single bucket; if your env differs, set
 * SES_RAW_BUCKET and we'll prefer it over per-doc inference.
 */

'use strict';

const admin = require('firebase-admin');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { simpleParser } = require('mailparser');
const { buildThreadKey } = require('../infra/lambda/parse-airbnb-email/thread-key');
const {
  extractAirbnbReplyToToken,
  airbnbThreadKeyFromReplyTo,
  extractGuestNameFromSubject,
  extractGuestNameFromBody,
} = require('../infra/lambda/parse-airbnb-email/index');

const PARSER_VERSION = '2026-05-09';
const APPLY = process.argv.includes('--apply');
const BUCKET_OVERRIDE = process.env.SES_RAW_BUCKET || null;

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

function streamToBuffer(s3Response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    s3Response.Body.on('data', (c) => chunks.push(c));
    s3Response.Body.on('error', reject);
    s3Response.Body.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function shouldRekey(data) {
  if (!data) return false;
  if (data.parserVersion === PARSER_VERSION) return false; // already migrated
  const tk = data.threadKey || '';
  if (typeof tk !== 'string') return false;
  if (tk.startsWith('name:airbnb')) return true;
  if (tk === 'email:express@airbnb.com') return true;
  if (tk.startsWith('email:') && tk.endsWith('@airbnb.com')) return true;
  if (data.guestName === 'Airbnb') return true;
  return false;
}

async function rekeyDoc(db, doc) {
  const data = doc.data();
  const objectKey = data.rawEmailS3Key;
  if (!objectKey) {
    return { id: doc.id, skipped: true, reason: 'no_rawEmailS3Key' };
  }

  const bucket = BUCKET_OVERRIDE;
  if (!bucket) {
    return { id: doc.id, skipped: true, reason: 'no_bucket_configured' };
  }

  const s3Response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey })
  );
  const rawBuffer = await streamToBuffer(s3Response);
  const parsed = await simpleParser(rawBuffer);

  const fromName = parsed.from?.value?.[0]?.name || null;
  const fromAddress = parsed.from?.value?.[0]?.address || null;
  const subject = parsed.subject || '';
  const receivedAt = parsed.date ? new Date(parsed.date) : new Date();

  const replyToToken = extractAirbnbReplyToToken(parsed);
  const airbnbThreadKey = airbnbThreadKeyFromReplyTo(parsed);

  const subjectName = extractGuestNameFromSubject(subject);
  const bodyName = subjectName ? null : extractGuestNameFromBody(parsed.html, parsed.text);
  const extractedName = subjectName || bodyName;
  const guestName = extractedName || 'Unknown sender';

  const newThreadKey = airbnbThreadKey || buildThreadKey({
    bookingCode: data.bookingId ? data.airbnbConfirmationCode || null : null,
    senderEmail: fromAddress,
    senderName: extractedName,
    receivedAt,
  });

  const updates = {
    threadKey: newThreadKey,
    guestName,
    fromDisplayName: fromName,
    replyToToken,
    airbnbThreadKey,
    parserVersion: PARSER_VERSION,
  };

  return {
    id: doc.id,
    skipped: false,
    before: {
      threadKey: data.threadKey,
      guestName: data.guestName,
    },
    after: updates,
  };
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      'Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase Admin service-account JSON.'
    );
    process.exit(1);
  }
  if (!BUCKET_OVERRIDE) {
    console.warn(
      '[warn] SES_RAW_BUCKET env not set — script cannot fetch raw emails. ' +
        'Pass --dry-run friendly: still scans, but every match will be skipped.'
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp(); // ADC — uses GOOGLE_APPLICATION_CREDENTIALS
  }
  const db = admin.firestore();

  console.log(`Mode: ${APPLY ? 'APPLY (writes!)' : 'DRY RUN (no writes)'}`);
  console.log(`Scanning airbnb_messages...`);

  const snap = await db.collection('airbnb_messages').get();
  console.log(`Loaded ${snap.size} docs`);

  let scanned = 0;
  let candidates = 0;
  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of snap.docs) {
    scanned++;
    if (!shouldRekey(doc.data())) continue;
    candidates++;

    try {
      const result = await rekeyDoc(db, doc);
      if (result.skipped) {
        skipped++;
        console.log(`[skip] ${doc.id}: ${result.reason}`);
        continue;
      }

      console.log(`[plan] ${doc.id}`);
      console.log('       before:', JSON.stringify(result.before));
      console.log('       after :', JSON.stringify({
        threadKey: result.after.threadKey,
        guestName: result.after.guestName,
        airbnbThreadKey: result.after.airbnbThreadKey,
      }));

      if (APPLY) {
        await db.collection('airbnb_messages').doc(doc.id).update(result.after);
        written++;
      }
    } catch (err) {
      errors++;
      console.error(`[err ] ${doc.id}: ${err.message}`);
    }
  }

  console.log('---');
  console.log(`Scanned    : ${scanned}`);
  console.log(`Candidates : ${candidates}`);
  console.log(`Written    : ${written}`);
  console.log(`Skipped    : ${skipped}`);
  console.log(`Errors     : ${errors}`);
  console.log(APPLY ? 'APPLIED — done.' : 'DRY RUN complete. Re-run with --apply to write.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
