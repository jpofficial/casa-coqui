import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { sendNotification } from '@/lib/notifications';
import { notifyAdminAndCohost } from '@/lib/staff-notifications';
import { requireAuth } from '@/lib/api-auth';
import { nt, getGuestLocale } from '@/lib/notification-strings';

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
      // Notify all admin + cohost staff members via push.
      const title = nt('en', 'newMessage_title');
      const notifBody = nt('en', 'newMessage_body', {
        guestName: guestName || nt('en', 'newMessage_defaultGuest'),
      });

      const result = await notifyAdminAndCohost({
        title,
        body: notifBody,
        type: 'message',
        data: { bookingCode },
        localizer: (locale) => ({
          title: nt(locale, 'newMessage_title'),
          body: nt(locale, 'newMessage_body', {
            guestName: guestName || nt(locale, 'newMessage_defaultGuest'),
          }),
        }),
      });

      return NextResponse.json({
        success: true,
        data: { notified: 'admin', ...result.data },
      });
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
      const guestLocale = await getGuestLocale(bookingCode);
      const title = nt(guestLocale, 'newMessageFromHost_title');
      const notifBody = nt(guestLocale, 'newMessageFromHost_body');

      // Try FCM push first
      const tokenSnap = await adminDb
        .collection('fcm_tokens')
        .where('bookingCode', '==', bookingCode)
        .limit(1)
        .get();

      if (!tokenSnap.empty) {
        const tokenDoc = tokenSnap.docs[0];
        const { token } = tokenDoc.data();
        const result = await sendNotification({
          to: token,
          title,
          body: notifBody,
          data: { type: 'message', bookingCode },
        });
        if (result.success) {
          // Write in-app notification record
          await adminDb.collection('notifications').add({
            type: 'direct',
            bookingCode,
            title,
            message: notifBody,
            broadcast: false,
            category: 'message',
            readBy: [],
            createdAt: new Date().toISOString(),
            method: 'push',
            status: 'sent',
          });
          return NextResponse.json({ success: true, data: { notified: 'guest', method: 'push' } });
        }
        // Clean up stale token
        if (result.staleToken) {
          await tokenDoc.ref.delete().catch((err) => {
            console.error('[messages/notify] Stale token cleanup error:', err);
          });
        }
      }

      // No FCM token (or push failed) — write in-app-only notification
      await adminDb.collection('notifications').add({
        type: 'direct',
        bookingCode,
        title,
        message: notifBody,
        broadcast: false,
        category: 'message',
        readBy: [],
        createdAt: new Date().toISOString(),
        method: 'none',
        status: 'in-app-only',
      });

      return NextResponse.json({
        success: true,
        data: { notified: 'guest', method: 'in-app-only' },
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
