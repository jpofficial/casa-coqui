#!/usr/bin/env node
/**
 * Backfill airbnb_messages thread entries for bookings whose welcome was
 * marked sent BEFORE the dual-write was introduced. Also deletes orphan
 * welcome_draft docs whose referenced booking no longer exists.
 *
 * Dry-run by default. Pass --apply to commit.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json \
 *     node scripts/backfill-welcome-messages.js [--apply]
 */

const admin = require('firebase-admin');
const { buildThreadKey } = require('../lib/thread-key');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS before running this script.');
  process.exit(1);
}
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const db = admin.firestore();
const APPLY = process.argv.includes('--apply');
const FV = admin.firestore.FieldValue;

async function main() {
  // ---- 1. Backfill sent welcomes missing welcomeMessageId ----
  const bookingsSnap = await db
    .collection('bookings')
    .where('welcomeStatus', '==', 'sent')
    .get();

  let backfilled = 0;
  let skipped = 0;

  for (const bookingDoc of bookingsSnap.docs) {
    const b = { id: bookingDoc.id, ...bookingDoc.data() };
    if (b.welcomeMessageId) {
      skipped++;
      continue;
    }
    const text = b.welcomeSentText || b.welcomeMessage;
    if (!text) {
      console.log(`  ⚠  skipping ${b.id} (${b.guestName}) — no welcome text to restore`);
      skipped++;
      continue;
    }
    const threadKey = buildThreadKey({
      bookingCode: b.code,
      senderEmail: b.guestEmail || null,
      senderName: b.guestName || null,
    });
    console.log(
      `  ✚ backfill ${b.id} (${b.guestName || '-'}) threadKey=${threadKey} chars=${text.length}`
    );
    if (APPLY) {
      const msgRef = db.collection('airbnb_messages').doc();
      const ts = b.welcomeSentAt
        ? admin.firestore.Timestamp.fromDate(new Date(b.welcomeSentAt))
        : FV.serverTimestamp();
      await msgRef.set({
        bookingId: b.id,
        bookingCode: b.code || null,
        threadKey,
        guestName: b.guestName || null,
        senderEmail: b.guestEmail || null,
        source: 'welcome_draft',
        sender: 'host',
        read: true,
        direction: 'outbound',
        welcomeState: 'sent',
        text,
        sentAt: ts,
        createdAt: ts,
        receivedAt: ts,
      });
      await bookingDoc.ref.update({ welcomeMessageId: msgRef.id });
    }
    backfilled++;
  }

  console.log(
    `\nBackfill pass: ${backfilled} sent welcomes ${APPLY ? 'created' : 'would be created'}, ${skipped} skipped.\n`
  );

  // ---- 2. Delete orphan welcome_draft docs (booking no longer exists) ----
  const draftsSnap = await db
    .collection('airbnb_messages')
    .where('source', '==', 'welcome_draft')
    .get();

  let orphaned = 0;
  for (const draftDoc of draftsSnap.docs) {
    const d = draftDoc.data();
    if (!d.bookingId) continue;
    const bRef = db.collection('bookings').doc(d.bookingId);
    const bSnap = await bRef.get();
    const bookingStillReferences = bSnap.exists && bSnap.data().welcomeMessageId === draftDoc.id;
    if (!bSnap.exists || !bookingStillReferences) {
      console.log(
        `  ✖ orphan draft ${draftDoc.id} (${d.guestName || '-'}) — booking ${bSnap.exists ? 'exists but unlinked' : 'missing'}`
      );
      if (APPLY) await draftDoc.ref.delete();
      orphaned++;
    }
  }

  console.log(
    `\nOrphan cleanup pass: ${orphaned} drafts ${APPLY ? 'deleted' : 'would be deleted'}.\n`
  );

  if (!APPLY) console.log('(Dry run — re-run with --apply to commit.)');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
