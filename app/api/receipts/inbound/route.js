import { NextResponse } from 'next/server';
import { adminDb, adminStorage } from '@/lib/firebase-admin';

// ---------------------------------------------------------------------------
// Attempts to parse a dollar amount from a string such as a subject line.
// Returns a number or null.
// ---------------------------------------------------------------------------
function parseAmount(text) {
  if (!text) return null;
  const match = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (match) {
    const parsed = parseFloat(match[1].replace(/,/g, ''));
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/receipts/inbound
// Webhook for inbound email receipt parsing (SendGrid/Mailgun multipart form).
// Processes each attachment, uploads to Firebase Storage, and creates Firestore docs.
//
// Expected multipart fields (SendGrid inbound parse format):
//   sender      — from address
//   subject     — email subject
//   attachments — count of attachments
//   attachment1, attachment2, ...  — file objects
//
// Returns:
//   { success: true, data: { count: <attachmentsProcessed> } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const formData = await request.formData();

    const sender = formData.get('sender') || formData.get('from') || '';
    const subject = formData.get('subject') || '';
    const attachmentCount = parseInt(formData.get('attachments') || '0', 10);

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uploadedAt = now.toISOString();

    // Try to parse an amount from the subject
    const amount = parseAmount(subject);

    let processedCount = 0;
    const bucket = adminStorage.bucket();

    // Process numbered attachments (attachment1, attachment2, ...)
    for (let i = 1; i <= Math.max(attachmentCount, 10); i++) {
      const file = formData.get(`attachment${i}`);
      if (!file) continue;

      const filename = file.name || `attachment-${i}-${Date.now()}`;
      const storagePath = `receipts/${month}/${filename}`;

      // Read file bytes
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const fileRef = bucket.file(storagePath);
      await fileRef.save(buffer, {
        metadata: { contentType: file.type || 'application/octet-stream' },
        resumable: false,
      });

      // Make the file publicly readable and get download URL
      await fileRef.makePublic();
      const storageUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

      // Create Firestore doc
      const receiptDoc = {
        filename,
        storageUrl,
        storagePath,
        uploadedAt,
        month,
        sender,
        subject,
        amount,
        contentType: file.type || 'application/octet-stream',
      };

      await adminDb.collection('receipts').add(receiptDoc);
      processedCount++;
    }

    return NextResponse.json({
      success: true,
      data: { count: processedCount },
    });
  } catch (error) {
    console.error('[POST /api/receipts/inbound]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process inbound receipt.' },
      { status: 500 }
    );
  }
}
