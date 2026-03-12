import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { sendOTP } from '@/lib/twilio';

export async function POST(request) {
  try {
    const body = await request.json();
    const { phone, bookingCode } = body;

    if (!phone || !bookingCode) {
      return NextResponse.json(
        { success: false, error: 'phone and bookingCode are required' },
        { status: 400 }
      );
    }

    // Validate the booking code exists and is active
    const bookingsRef = adminDb.collection('bookings');
    const snapshot = await bookingsRef
      .where('code', '==', bookingCode)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired booking code' },
        { status: 404 }
      );
    }

    // Generate and send OTP via Twilio
    const { otp, expiresAt } = await sendOTP(phone);

    // Store OTP in Firestore — server-only collection, not readable by clients
    const otpDocRef = adminDb.collection('otps').doc(phone);
    await otpDocRef.set({
      phone,
      code: otp,
      expiresAt: expiresAt.toISOString(),
      bookingCode,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, message: 'OTP sent' });
  } catch (error) {
    console.error('[POST /api/guests/verify] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send OTP' },
      { status: 500 }
    );
  }
}
