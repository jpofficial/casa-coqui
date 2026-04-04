import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization token' },
        { status: 401 }
      );
    }

    const token = authHeader.split('Bearer ')[1];
    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    const { bookingCode } = await request.json();
    if (!bookingCode) {
      return NextResponse.json(
        { success: false, error: 'bookingCode is required' },
        { status: 400 }
      );
    }

    // Verify the booking exists and is active
    const bookingsSnap = await adminDb
      .collection('bookings')
      .where('code', '==', bookingCode)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (bookingsSnap.empty) {
      return NextResponse.json(
        { success: false, error: 'No active booking found for this code' },
        { status: 404 }
      );
    }

    // Preserve staff role if user already has one — an admin/cohost who
    // accesses the guest portal should keep their staff claim.
    const existingUser = await adminAuth.getUser(decoded.uid);
    const existingClaims = existingUser.customClaims || {};
    const staffRoles = ['admin', 'cohost', 'cleaner', 'maintenance'];
    const isStaff = staffRoles.includes(existingClaims.role);

    // Preserve existing tier if already set (e.g. tier:2 from check-in)
    const existingTier = existingClaims.tier || 0;
    const tier = existingClaims.bookingCode === bookingCode ? Math.max(existingTier, 1) : 1;

    await adminAuth.setCustomUserClaims(decoded.uid, {
      bookingCode,
      role: isStaff ? existingClaims.role : 'guest',
      tier,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[set-claims] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to set claims' },
      { status: 500 }
    );
  }
}
