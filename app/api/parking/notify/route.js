import { NextResponse } from 'next/server';
import { broadcastToActiveGuests } from '@/lib/notifications';
import { requireAuth } from '@/lib/api-auth';
import { nt } from '@/lib/notification-strings';

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
      title: nt('en', 'parkingAlert_title'),
      body: nt('en', 'parkingAlert_body'),
      type: 'parking',
      localizer: (locale) => ({
        title: nt(locale, 'parkingAlert_title'),
        body: nt(locale, 'parkingAlert_body'),
      }),
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
