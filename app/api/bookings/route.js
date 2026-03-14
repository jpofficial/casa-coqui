import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { nanoid } from 'nanoid';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// GET /api/bookings
// Returns all bookings sorted by createdAt descending.
// Requires admin role.
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const snapshot = await adminDb
      .collection('bookings')
      .orderBy('createdAt', 'desc')
      .get();

    const bookings = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ success: true, data: bookings });
  } catch (error) {
    console.error('[GET /api/bookings]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch bookings.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/bookings
// Creates a new booking with a unique guest link code.
//
// Request body:
//   { unit, guestName, checkInDate, checkOutDate }
//
// Returns:
//   { success: true, data: { id, code, guestLink, ...booking } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { unit, guestName = '', guestEmail = '', checkInDate, checkOutDate } = body;

    // Validate required fields
    if (!unit || !checkInDate || !checkOutDate) {
      return NextResponse.json(
        { success: false, error: 'unit, checkInDate, and checkOutDate are required.' },
        { status: 400 }
      );
    }

    if (checkOutDate <= checkInDate) {
      return NextResponse.json(
        { success: false, error: 'checkOutDate must be after checkInDate.' },
        { status: 400 }
      );
    }

    // Check for overlapping active bookings on the same unit.
    // Two bookings overlap when: existingCheckIn < newCheckOut AND existingCheckOut > newCheckIn
    const activeForUnit = await adminDb
      .collection('bookings')
      .where('unit', '==', unit)
      .where('status', '==', 'active')
      .get();

    const overlap = activeForUnit.docs.some((d) => {
      const b = d.data();
      return b.checkInDate < checkOutDate && b.checkOutDate > checkInDate;
    });

    if (overlap) {
      return NextResponse.json(
        { success: false, error: `${unit} already has an active booking for those dates.` },
        { status: 409 }
      );
    }

    const code = nanoid(10);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const guestLink = `${appUrl}/g/${code}`;

    const booking = {
      code,
      unit,
      guestName: String(guestName).trim(),
      guestEmail: String(guestEmail).trim().toLowerCase(),
      checkInDate,
      checkOutDate,
      status: 'active',
      checkedIn: false,
      createdAt: new Date().toISOString(),
      guestLink,
    };

    const docRef = await adminDb.collection('bookings').add(booking);

    // Create primary booking_members doc for the guest
    await adminDb.collection('booking_members').add({
      bookingCode: code,
      role: 'primary',
      name: booking.guestName,
      email: booking.guestEmail,
      phone: null,
      uid: null,
      status: 'pending',
      invitedBy: null,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...booking } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/bookings]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create booking.' },
      { status: 500 }
    );
  }
}
