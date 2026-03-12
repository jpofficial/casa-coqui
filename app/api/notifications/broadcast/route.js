import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { broadcastToActiveGuests } from '@/lib/notifications';

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
    const body = await request.json();
    const { title, message, type } = body;

    if (!title || !message) {
      return NextResponse.json(
        { success: false, error: 'title and message are required.' },
        { status: 400 }
      );
    }

    // Send to all active guests via FCM + SMS fallback.
    const result = await broadcastToActiveGuests({ title, body: message });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Broadcast failed.' },
        { status: 500 }
      );
    }

    // Persist a human-readable record of the broadcast request.
    await adminDb.collection('notifications').add({
      type: 'broadcast',
      title,
      message,
      notificationType: type || 'general',
      createdAt: new Date().toISOString(),
      sentBy: 'admin',
    });

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error('[POST /api/notifications/broadcast] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send broadcast.' },
      { status: 500 }
    );
  }
}
