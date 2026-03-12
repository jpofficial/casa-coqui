import { NextResponse } from 'next/server';
import { sendDirectMessage } from '@/lib/notifications';

// ---------------------------------------------------------------------------
// POST /api/notifications/direct
//
// Sends a direct message to a specific guest.
//
// Request body:
//   { bookingCode: string, title: string, message: string }
//
// Returns:
//   { success: true, data: { method: 'push'|'sms' } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const body = await request.json();
    const { bookingCode, title, message } = body;

    if (!bookingCode || !title || !message) {
      return NextResponse.json(
        { success: false, error: 'bookingCode, title, and message are required.' },
        { status: 400 }
      );
    }

    const result = await sendDirectMessage({ bookingCode, title, body: message });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Direct message failed.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[POST /api/notifications/direct] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send direct message.' },
      { status: 500 }
    );
  }
}
