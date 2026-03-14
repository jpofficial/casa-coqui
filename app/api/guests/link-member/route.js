export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/guests/link-member
// Links an authenticated guest to their booking_members doc after check-in.
// Updates the primary member doc with uid, phone, name, email, status.
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const { bookingCode, name, email, phone, role } = await request.json();

    if (!bookingCode) {
      return NextResponse.json(
        { success: false, error: 'bookingCode is required.' },
        { status: 400 }
      );
    }

    // Verify the booking exists and is active
    const bookingSnap = await adminDb
      .collection('bookings')
      .where('code', '==', bookingCode)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (bookingSnap.empty) {
      return NextResponse.json(
        { success: false, error: 'No active booking found.' },
        { status: 404 }
      );
    }

    const memberRole = role || 'primary';

    // Find the matching member doc for this booking
    let queryRef = adminDb
      .collection('booking_members')
      .where('bookingCode', '==', bookingCode)
      .where('role', '==', memberRole);

    // For members, also match by email to find the right invite
    if (memberRole === 'member' && email) {
      queryRef = queryRef.where('email', '==', email);
    }

    const snap = await queryRef.limit(1).get();

    if (snap.empty) {
      // No member doc exists — create one (legacy booking or missing doc)
      await adminDb.collection('booking_members').add({
        bookingCode,
        role: memberRole,
        name: name || '',
        email: email || '',
        phone: phone || null,
        uid: caller.uid,
        status: 'verified',
        invitedBy: null,
        createdAt: new Date().toISOString(),
      });
    } else {
      // Update existing member doc
      await snap.docs[0].ref.update({
        uid: caller.uid,
        phone: phone || null,
        name: name || snap.docs[0].data().name,
        email: email || snap.docs[0].data().email,
        status: 'verified',
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/guests/link-member]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to link member.' },
      { status: 500 }
    );
  }
}
