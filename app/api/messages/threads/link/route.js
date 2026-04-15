import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/messages/threads/link
//
// Migrate an unmatched thread (threadKey starts with 'email:' or 'name:') to
// a real booking's thread key. Updates every airbnb_messages doc in the
// thread so it joins the booking's conversation.
//
// Body: { fromThreadKey: string, bookingId: string }
// ---------------------------------------------------------------------------

export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json().catch(() => ({}));
    const { fromThreadKey, bookingId } = body;

    if (!fromThreadKey || !bookingId) {
      return NextResponse.json(
        { success: false, error: 'fromThreadKey and bookingId are required.' },
        { status: 400 }
      );
    }

    const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Booking not found.' },
        { status: 404 }
      );
    }
    const booking = { id: bookingDoc.id, ...bookingDoc.data() };
    const newKey = booking.code;

    if (!newKey) {
      return NextResponse.json(
        { success: false, error: 'Booking is missing a code.' },
        { status: 400 }
      );
    }

    const snap = await adminDb
      .collection('airbnb_messages')
      .where('threadKey', '==', fromThreadKey)
      .get();

    if (snap.empty) {
      return NextResponse.json({ success: true, data: { migrated: 0 } });
    }

    // Batch in chunks of 500.
    let migrated = 0;
    let batch = adminDb.batch();
    let batchCount = 0;
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        threadKey: newKey,
        bookingId: booking.id,
        bookingCode: newKey,
      });
      batchCount++;
      migrated++;
      if (batchCount >= 500) {
        await batch.commit();
        batch = adminDb.batch();
        batchCount = 0;
      }
    }
    if (batchCount > 0) await batch.commit();

    return NextResponse.json({ success: true, data: { migrated, newThreadKey: newKey } });
  } catch (error) {
    console.error('[POST /api/messages/threads/link]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to link thread.' },
      { status: 500 }
    );
  }
}
