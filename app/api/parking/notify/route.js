import { NextResponse } from 'next/server';
import { broadcastToActiveGuests } from '@/lib/notifications';
import { requireAuth } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/parking/notify
//
// Triggers a generic parking alert broadcast. Any authenticated guest can call
// this after submitting a parking report. The broadcast message is fixed
// server-side so guests cannot craft arbitrary broadcasts.
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const result = await broadcastToActiveGuests({
      title: 'Parking Alert',
      body: 'An unfamiliar vehicle has been reported in the parking area. If this is your vehicle, please move it to your designated spot.',
      type: 'parking',
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Broadcast failed.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error('[POST /api/parking/notify] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send parking alert.' },
      { status: 500 }
    );
  }
}
