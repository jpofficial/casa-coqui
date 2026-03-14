export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/guests/checkin
// Saves guest doc + checkin doc + links booking_members, all server-side.
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const { bookingCode, fullName, email, phone, arrivalTime, guestCount, specialRequests } = await request.json();

    if (!bookingCode || !fullName || !email || !arrivalTime) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields.' },
        { status: 400 }
      );
    }

    const guestId = caller.uid;
    const now = new Date().toISOString();

    // Save guest document
    await adminDb.collection('guests').doc(guestId).set({
      fullName,
      email,
      phone: phone || null,
      arrivalTime,
      guestCount: guestCount || 1,
      specialRequests: specialRequests || null,
      bookingCode,
      createdAt: now,
      uid: guestId,
    });

    // Save checkin document
    await adminDb.collection('checkins').doc(bookingCode).set({
      guestId,
      fullName,
      email,
      phone: phone || null,
      arrivalTime,
      guestCount: guestCount || 1,
      specialRequests: specialRequests || null,
      bookingCode,
      checkedIn: true,
      checkedInAt: now,
    });

    // Link booking_members
    const memberSnap = await adminDb
      .collection('booking_members')
      .where('bookingCode', '==', bookingCode)
      .where('role', '==', 'primary')
      .limit(1)
      .get();

    if (memberSnap.empty) {
      await adminDb.collection('booking_members').add({
        bookingCode,
        role: 'primary',
        name: fullName,
        email,
        phone: phone || null,
        uid: guestId,
        status: 'verified',
        invitedBy: null,
        createdAt: now,
      });
    } else {
      await memberSnap.docs[0].ref.update({
        uid: guestId,
        phone: phone || null,
        name: fullName,
        email,
        status: 'verified',
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/guests/checkin]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save check-in.' },
      { status: 500 }
    );
  }
}
