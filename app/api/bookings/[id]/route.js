import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// PATCH /api/bookings/[id]
// Cancels a booking (soft delete). Sets status to 'cancelled' and records
// who cancelled it and when. The guest link becomes unusable because guest
// verification checks status === 'active'.
//
// Requires admin role.
// ---------------------------------------------------------------------------
export async function PATCH(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { id } = await params;
    const docRef = adminDb.collection('bookings').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json(
        { success: false, error: 'Booking not found.' },
        { status: 404 }
      );
    }

    const booking = doc.data();

    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Booking is already cancelled.' },
        { status: 400 }
      );
    }

    await docRef.update({
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledBy: caller.uid,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/bookings/[id]]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel booking.' },
      { status: 500 }
    );
  }
}
