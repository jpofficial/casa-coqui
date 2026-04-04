export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/guests/checkin
// Saves guest doc + checkin doc + links booking_members, all server-side.
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const {
      bookingCode, fullName, email, phone, arrivalTime, guestCount,
      specialRequests, hasVehicle, vehicle,
    } = await request.json();

    if (!bookingCode || !fullName || !email || !arrivalTime) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields.' },
        { status: 400 }
      );
    }

    // Validate hasVehicle when provided
    const validVehicleOptions = ['yes', 'no', 'unsure'];
    if (hasVehicle != null && !validVehicleOptions.includes(hasVehicle)) {
      return NextResponse.json(
        { success: false, error: 'hasVehicle must be one of: yes, no, unsure.' },
        { status: 400 }
      );
    }

    const resolvedHasVehicle = hasVehicle || null;
    const resolvedVehicle = hasVehicle === 'yes' && vehicle
      ? { make: vehicle.make || null, model: vehicle.model || null, color: vehicle.color || null, plate: vehicle.plate || null }
      : null;

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
      hasVehicle: resolvedHasVehicle,
      vehicle: resolvedVehicle,
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
      hasVehicle: resolvedHasVehicle,
      vehicle: resolvedVehicle,
      bookingCode,
      checkedIn: true,
      checkedInAt: now,
    });

    // Update the bookings doc so admin dashboard reflects check-in
    const bookingSnap = await adminDb
      .collection('bookings')
      .where('code', '==', bookingCode)
      .limit(1)
      .get();
    if (!bookingSnap.empty) {
      await bookingSnap.docs[0].ref.update({ checkedIn: true, checkedInAt: now });
    }

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
        checkedInAt: now,
      });
    } else {
      await memberSnap.docs[0].ref.update({
        uid: guestId,
        phone: phone || null,
        name: fullName,
        email,
        status: 'verified',
        checkedInAt: now,
      });
    }

    // Upgrade to Tier 2 — check-in form completion is the step-up verification
    try {
      const existingUser = await adminAuth.getUser(guestId);
      const claims = existingUser.customClaims || {};
      if ((claims.tier || 0) < 2) {
        await adminAuth.setCustomUserClaims(guestId, { ...claims, tier: 2 });
      }
    } catch (tierErr) {
      console.error('[POST /api/guests/checkin] Tier upgrade failed:', tierErr);
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
