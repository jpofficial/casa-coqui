/**
 * Backfill airbnb_resolutions from quarantined / unmatched emails.
 *
 * Reads docs from airbnb_messages_quarantine that look like resolution requests
 * (subject contains "Reimbursement Request", "Host damage protection", "AirCover",
 * "Resolution Center", or a CLSF-#### claim ID), parses their fields, and upserts
 * into airbnb_resolutions keyed by claimId.
 *
 * Usage:
 *   node scripts/migrations/backfill-airbnb-resolutions.js              # dry-run
 *   node scripts/migrations/backfill-airbnb-resolutions.js --apply      # actually write
 */

'use strict';

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const {
  classifyEmail,
  parseResolutionFields,
} = require('../../infra/lambda/parse-airbnb-email/index');

const dryRun = !process.argv.includes('--apply');

const envPath = resolve(__dirname, '..', '..', '.env.local');
const envFile = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) continue;
  env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
}
const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);

  const snap = await db.collection('airbnb_messages_quarantine').get();
  console.log(`Quarantine docs: ${snap.size}`);

  let candidates = 0;
  let upserted = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const subject = data.subject || '';
    const bodyText = data.body || '';

    // Classify with the live classifier — picks up resolution_request patterns.
    const cls = classifyEmail(subject);
    if (cls !== 'resolution_request') continue;
    candidates++;

    const fields = parseResolutionFields({ subject, bodyText });
    if (!fields.claimId) {
      console.warn(`  SKIP ${doc.id} — classifier matched but no claimId in subject/body`);
      skipped++;
      continue;
    }

    const claimId = fields.claimId;
    const confirmationCode = fields.confirmationCode || data.airbnbConfirmationCode || null;

    const targetRef = db.collection('airbnb_resolutions').doc(claimId);
    const existing = await targetRef.get();

    console.log(
      `  ${existing.exists ? 'UPDATE' : 'CREATE'} airbnb_resolutions/${claimId}`,
      `(quarantine doc ${doc.id})`
    );
    console.log(`    subject: ${subject.slice(0, 100)}`);
    console.log(`    confirmationCode: ${confirmationCode || '(none)'}`);
    console.log(`    resolutionUrl: ${fields.resolutionUrl || '(none)'}`);

    if (dryRun) continue;

    const payload = {
      claimId,
      confirmationCode,
      bookingId: null, // not resolved by backfill — Lambda does that on next live email
      subject,
      fromName: data.fromName || null,
      fromAddress: data.fromAddress || null,
      receivedAt: data.receivedAt || Timestamp.now(),
      resolutionUrl: fields.resolutionUrl,
      bodyText: bodyText.slice(0, 16000),
      rawEmailS3Key: data.rawEmailS3Key || null,
      messageId: data.messageId || null,
      sesMessageId: data.sesMessageId || null,
      updatedAt: FieldValue.serverTimestamp(),
      backfilledFromQuarantine: doc.id,
    };
    if (!existing.exists) {
      payload.status = 'open';
      payload.createdAt = FieldValue.serverTimestamp();
      payload.adminNotifiedAt = null;
    }

    await targetRef.set(payload, { merge: true });
    upserted++;
  }

  console.log('---');
  console.log(`Candidates (resolution_request in quarantine): ${candidates}`);
  console.log(`Upserted: ${upserted}`);
  console.log(`Skipped (no claimId): ${skipped}`);
  if (dryRun) console.log('No writes performed (dry run). Re-run with --apply.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
