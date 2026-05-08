export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// PATCH /api/guests/vehicle
// Allows a guest to update their vehicle info after initial check-in.
// ---------------------------------------------------------------------------
export async function PATCH(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const bookingCode = caller.bookingCode;
    if (!bookingCode) {
      return NextResponse.json(
        { success: false, error: 'No booking associated with this account.' },
        { status: 400 }
      );
    }

    const { hasVehicle, vehicle } = await request.json();

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

    await adminDb.collection('checkins').doc(bookingCode).update({
      hasVehicle: resolvedHasVehicle,
      vehicle: resolvedVehicle,
      vehicleUpdatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/guests/vehicle]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update vehicle info.' },
      { status: 500 }
    );
  }
}
