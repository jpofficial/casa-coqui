export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// ---------------------------------------------------------------------------
// POST /api/guests/claim-invite — Validate and claim an invite token
//
// Body: { token }
// No auth required (the token itself is the auth).
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'token is required.' },
        { status: 400 }
      );
    }

    // Look up the token
    const tokenDoc = await adminDb.collection('invite_tokens').doc(token).get();

    if (!tokenDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired invite link.' },
        { status: 404 }
      );
    }

    const tokenData = tokenDoc.data();

    if (tokenData.used) {
      return NextResponse.json(
        { success: false, error: 'This invite link has already been used.' },
        { status: 410 }
      );
    }

    // Verify the booking is still active
    const bookingSnap = await adminDb
      .collection('bookings')
      .where('code', '==', tokenData.bookingCode)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (bookingSnap.empty) {
      return NextResponse.json(
        { success: false, error: 'This booking is no longer active.' },
        { status: 410 }
      );
    }

    // Mark token as used
    await adminDb.collection('invite_tokens').doc(token).update({ used: true });

    // Look up the member doc for name/email pre-fill
    const memberSnap = await adminDb
      .collection('booking_members')
      .where('bookingCode', '==', tokenData.bookingCode)
      .where('email', '==', tokenData.email)
      .where('role', '==', 'member')
      .limit(1)
      .get();

    const memberData = memberSnap.empty ? null : memberSnap.docs[0].data();

    return NextResponse.json({
      success: true,
      data: {
        bookingCode: tokenData.bookingCode,
        email: tokenData.email,
        name: memberData?.name || '',
      },
    });
  } catch (error) {
    console.error('[POST /api/guests/claim-invite]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to validate invite.' },
      { status: 500 }
    );
  }
}
