import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/airbnb-messages/[id]/mark-sent
 *
 * Marks an inbound airbnb_messages doc's AI-draft as sent AND creates a
 * separate outbound_draft doc representing the reply as a first-class
 * message in the thread. Both writes happen in one Firestore batch.
 *
 * Body: { editedReply: string }
 * Auth: admin or cohost.
 *
 * Idempotency: if inbound.draftStatus is already 'sent', returns success
 * with alreadySent=true and skips the outbound creation.
 */
export async function POST(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin', 'cohost']);
    if (authError) return authError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const editedReply = String(body?.editedReply || '').trim();

    if (!editedReply) {
      return NextResponse.json(
        { success: false, error: 'editedReply is required' },
        { status: 400 }
      );
    }

    const inboundRef = adminDb.collection('airbnb_messages').doc(id);
    const inboundSnap = await inboundRef.get();
    if (!inboundSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Message not found' },
        { status: 404 }
      );
    }

    const inbound = inboundSnap.data();

    // Idempotency: if already sent, no-op (avoid duplicate outbound docs).
    if (inbound.draftStatus === 'sent') {
      return NextResponse.json({
        success: true,
        alreadySent: true,
        outboundId: null,
      });
    }

    if (inbound.direction !== 'inbound') {
      return NextResponse.json(
        { success: false, error: 'Only inbound messages can be marked sent' },
        { status: 400 }
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = adminDb.batch();

    // 1. Update inbound doc (preserves onAirbnbMessageSent voice-learning trigger).
    batch.update(inboundRef, {
      draftStatus: 'sent',
      sentAt: now,
      editedReply,
      sentBy: caller.uid,
    });

    // 2. Create outbound doc representing what host actually said.
    const outboundRef = adminDb.collection('airbnb_messages').doc();
    batch.set(outboundRef, {
      direction: 'outbound_draft',
      draftStatus: 'sent',
      body: editedReply,
      editedReply,
      draftReply: inbound.draftReply || null,
      threadKey: inbound.threadKey,
      bookingId: inbound.bookingId || null,
      bookingCode: inbound.bookingCode || null,
      airbnbConfirmationCode: inbound.airbnbConfirmationCode || null,
      guestName: inbound.guestName || null,
      sentAt: now,
      receivedAt: now,
      createdAt: now,
      source: 'reply-mark-sent',
      inboundMessageId: id,
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      outboundId: outboundRef.id,
    });
  } catch (err) {
    console.error('[mark-sent] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
