import { NextResponse } from 'next/server';
import { broadcastToActiveGuests } from '@/lib/notifications';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/notifications/broadcast
//
// Sends a mass notification to all active guests.
//
// Request body:
//   { title: string, message: string, type?: string }
//
// Returns:
//   { success: true, data: { total, push, sms, failed } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { title, message, type } = body;

    if (!title || !message) {
      return NextResponse.json(
        { success: false, error: 'title and message are required.' },
        { status: 400 }
      );
    }

    // Send to all active guests via FCM + SMS fallback.
    // broadcastToActiveGuests also persists a notification record to Firestore.
    const result = await broadcastToActiveGuests({
      title,
      body: message,
      type: type || 'general',
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Broadcast failed.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error('[POST /api/notifications/broadcast] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send broadcast.' },
      { status: 500 }
    );
  }
}
