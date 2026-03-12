import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { sendNotification } from '@/lib/notifications';
import { requireAuth } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/messages/notify
//
// Sends a push/SMS notification when a new message is sent.
// Determines recipient based on sender type:
//   - sender='guest' → notify admin
//   - sender='host'  → notify guest via bookingCode
//
// Request body:
//   { bookingCode: string, sender: 'guest'|'host', guestName?: string }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const body = await request.json();
    const { bookingCode, sender, guestName } = body;

    if (!bookingCode || !sender) {
      return NextResponse.json(
        { success: false, error: 'bookingCode and sender are required.' },
        { status: 400 }
      );
    }

    // Validate sender matches caller's role to prevent spoofing
    if (sender === 'host' && !caller.role) {
      return NextResponse.json(
        { success: false, error: 'Only staff can send as host.' },
        { status: 403 }
      );
    }
    if (sender === 'guest' && caller.role && !caller.bookingCode) {
      return NextResponse.json(
        { success: false, error: 'Staff cannot send as guest.' },
        { status: 403 }
      );
    }

    if (sender === 'guest') {
      // Notify admin — find admin FCM tokens or phone
      const adminUsersSnap = await adminDb
        .collection('users')
        .where('role', 'in', ['admin', 'cohost'])
        .get();

      const name = guestName || 'A guest';
      const title = 'New Message';
      const notifBody = `${name} sent you a message`;

      for (const userDoc of adminUsersSnap.docs) {
        const userData = userDoc.data();
        // Try FCM token first (admin tokens don't have bookingCode)
        const tokenSnap = await adminDb.collection('fcm_tokens').get();
        // For now, we log the notification — in production you'd match admin tokens
        // by user ID. This is a best-effort notification.
        if (userData.phone) {
          await sendNotification({ to: userData.phone, title, body: notifBody });
        }
      }

      return NextResponse.json({ success: true, data: { notified: 'admin' } });
    }

    if (sender === 'host') {
      // Notify guest — find guest by bookingCode
      const guestSnap = await adminDb
        .collection('guests')
        .where('bookingCode', '==', bookingCode)
        .limit(1)
        .get();

      if (guestSnap.empty) {
        return NextResponse.json({
          success: true,
          data: { notified: 'none', reason: 'No guest found for booking' },
        });
      }

      const guest = guestSnap.docs[0].data();
      const title = 'New Message from Host';
      const notifBody = 'Your host sent you a message';

      // Try FCM push first
      const tokenSnap = await adminDb
        .collection('fcm_tokens')
        .where('bookingCode', '==', bookingCode)
        .limit(1)
        .get();

      if (!tokenSnap.empty) {
        const { token } = tokenSnap.docs[0].data();
        const result = await sendNotification({ to: token, title, body: notifBody });
        if (result.success) {
          return NextResponse.json({ success: true, data: { notified: 'guest', method: 'push' } });
        }
      }

      // Fallback to SMS
      if (guest.phone) {
        await sendNotification({ to: guest.phone, title, body: notifBody });
        return NextResponse.json({ success: true, data: { notified: 'guest', method: 'sms' } });
      }

      return NextResponse.json({
        success: true,
        data: { notified: 'none', reason: 'No FCM token or phone for guest' },
      });
    }

    return NextResponse.json(
      { success: false, error: 'sender must be "guest" or "host".' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[POST /api/messages/notify] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send message notification.' },
      { status: 500 }
    );
  }
}
