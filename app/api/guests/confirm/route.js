import { NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { verifyOTP } from '@/lib/twilio';

export async function POST(request) {
  try {
    const body = await request.json();
    const { phone, code, bookingCode } = body;

    if (!phone || !code || !bookingCode) {
      return NextResponse.json(
        { success: false, error: 'phone, code, and bookingCode are required' },
        { status: 400 }
      );
    }

    // Look up the stored OTP document
    const otpDocRef = adminDb.collection('otps').doc(phone);
    const otpDoc = await otpDocRef.get();

    if (!otpDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'No OTP found for this phone number. Please request a new code.' },
        { status: 404 }
      );
    }

    const otpData = otpDoc.data();

    // Confirm the booking code matches what was originally verified
    if (otpData.bookingCode !== bookingCode) {
      return NextResponse.json(
        { success: false, error: 'Booking code mismatch' },
        { status: 400 }
      );
    }

    // Validate the code and expiry
    const { valid, reason } = verifyOTP(code, otpData.code, otpData.expiresAt);

    if (!valid) {
      return NextResponse.json(
        { success: false, error: reason },
        { status: 401 }
      );
    }

    // Create or update the guest document in Firestore
    const guestId = `guest_${phone.replace(/\D/g, '')}`;
    const guestRef = adminDb.collection('guests').doc(guestId);
    await guestRef.set(
      {
        phone,
        bookingCode,
        lastVerifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // Issue a Firebase custom auth token so the client can sign in
    const token = await adminAuth.createCustomToken(guestId, {
      phone,
      bookingCode,
      role: 'guest',
    });

    // Delete the used OTP so it cannot be reused
    await otpDocRef.delete();

    return NextResponse.json({
      success: true,
      data: { token, guestId },
    });
  } catch (error) {
    console.error('[POST /api/guests/confirm] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to confirm OTP' },
      { status: 500 }
    );
  }
}
