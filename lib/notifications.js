import { getMessaging } from 'firebase-admin/messaging';
import adminApp, { adminDb } from '@/lib/firebase-admin';
import { sendSMS } from '@/lib/twilio';

const messaging = getMessaging(adminApp);

// Phone number pattern — any string starting with '+' is treated as a phone number.
const PHONE_RE = /^\+/;

// ---------------------------------------------------------------------------
// sendNotification
//
// Sends a single notification to one recipient.
//
// @param {object} opts
//   to    {string}  FCM token OR E.164 phone number (e.g. '+17875551234')
//   title {string}  Notification title
//   body  {string}  Notification body
//   data  {object}  Optional key/value pairs forwarded with FCM messages
//
// @returns {{ success: boolean, method?: 'push'|'sms', error?: string }}
// ---------------------------------------------------------------------------
export async function sendNotification({ to, title, body, data = {} }) {
  try {
    if (PHONE_RE.test(to)) {
      // SMS path — keep under 160 characters for single-segment pricing.
      const smsBody = `${title}: ${body}`.slice(0, 160);
      await sendSMS(to, smsBody);
      return { success: true, method: 'sms' };
    }

    // FCM push path.
    await messaging.send({
      token: to,
      notification: { title, body },
      data,
    });
    return { success: true, method: 'push' };
  } catch (error) {
    console.error('[sendNotification] Error:', error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// broadcastToActiveGuests
//
// Fetches all active bookings, resolves each guest's FCM tokens and phone
// number, sends FCM push to token holders and SMS to guests without a token,
// then logs the broadcast result in Firestore.
//
// @param {object} opts
//   title {string}  Notification title
//   body  {string}  Notification body
//   data  {object}  Optional FCM data payload
//
// @returns {{ success: boolean, data?: { total, push, sms, failed }, error?: string }}
// ---------------------------------------------------------------------------
export async function broadcastToActiveGuests({ title, body, data = {} }) {
  try {
    // 1. Fetch all active bookings.
    const bookingsSnap = await adminDb
      .collection('bookings')
      .where('status', '==', 'active')
      .get();

    if (bookingsSnap.empty) {
      return { success: true, data: { total: 0, push: 0, sms: 0, failed: 0 } };
    }

    const bookingCodes = bookingsSnap.docs.map((doc) => doc.data().code).filter(Boolean);

    // 2. Fetch guest profiles for all active bookings.
    // Firestore 'in' queries support up to 30 values; chunk if needed.
    const guestDocs = [];
    for (let i = 0; i < bookingCodes.length; i += 30) {
      const chunk = bookingCodes.slice(i, i + 30);
      const snap = await adminDb
        .collection('guests')
        .where('bookingCode', 'in', chunk)
        .get();
      snap.docs.forEach((doc) => guestDocs.push(doc.data()));
    }

    // 3. Fetch all FCM tokens — keyed by bookingCode for quick lookup.
    const tokensByCode = {};
    const tokensSnap = await adminDb.collection('fcm_tokens').get();
    tokensSnap.docs.forEach((doc) => {
      const { bookingCode, token } = doc.data();
      if (bookingCode && token) {
        if (!tokensByCode[bookingCode]) tokensByCode[bookingCode] = [];
        tokensByCode[bookingCode].push(token);
      }
    });

    // 4. Build recipient lists.
    const fcmTokens = [];   // All FCM tokens to push to.
    const smsTargets = [];  // Phone numbers for guests without any FCM token.

    for (const guest of guestDocs) {
      const tokens = tokensByCode[guest.bookingCode] || [];
      if (tokens.length > 0) {
        fcmTokens.push(...tokens);
      } else if (guest.phone) {
        smsTargets.push(guest.phone);
      }
    }

    let pushCount = 0;
    let smsCount = 0;
    let failedCount = 0;

    // 5. Send FCM multicast.
    if (fcmTokens.length > 0) {
      // sendEachForMulticast supports up to 500 tokens per call.
      for (let i = 0; i < fcmTokens.length; i += 500) {
        const chunk = fcmTokens.slice(i, i + 500);
        const multicastResult = await messaging.sendEachForMulticast({
          tokens: chunk,
          notification: { title, body },
          data,
        });
        pushCount += multicastResult.successCount;
        failedCount += multicastResult.failureCount;
      }
    }

    // 6. Send SMS fallback.
    const smsBody = `${title}: ${body}`.slice(0, 160);
    for (const phone of smsTargets) {
      try {
        await sendSMS(phone, smsBody);
        smsCount++;
      } catch (smsError) {
        console.error('[broadcastToActiveGuests] SMS failed for', phone, smsError);
        failedCount++;
      }
    }

    const recipientCount = pushCount + smsCount + failedCount;

    // 7. Log the broadcast to Firestore.
    await adminDb.collection('notifications').add({
      type: 'broadcast',
      title,
      body,
      sentAt: new Date().toISOString(),
      recipientCount,
      results: {
        push: pushCount,
        sms: smsCount,
        failed: failedCount,
      },
    });

    return {
      success: true,
      data: {
        total: recipientCount,
        push: pushCount,
        sms: smsCount,
        failed: failedCount,
      },
    };
  } catch (error) {
    console.error('[broadcastToActiveGuests] Error:', error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// sendDirectMessage
//
// Sends a notification to a single guest identified by their booking code.
// Prefers FCM push; falls back to SMS if no token is registered.
//
// @param {object} opts
//   bookingCode {string}  Booking code for the target guest
//   title       {string}  Notification title
//   body        {string}  Notification body
//
// @returns {{ success: boolean, method?: 'push'|'sms', error?: string }}
// ---------------------------------------------------------------------------
export async function sendDirectMessage({ bookingCode, title, body }) {
  try {
    // 1. Find the guest profile.
    const guestSnap = await adminDb
      .collection('guests')
      .where('bookingCode', '==', bookingCode)
      .limit(1)
      .get();

    if (guestSnap.empty) {
      return { success: false, error: `No guest found for bookingCode: ${bookingCode}` };
    }

    const guest = guestSnap.docs[0].data();

    // 2. Look for an FCM token for this booking.
    const tokenSnap = await adminDb
      .collection('fcm_tokens')
      .where('bookingCode', '==', bookingCode)
      .limit(1)
      .get();

    let method = 'sms';
    let sendResult;

    if (!tokenSnap.empty) {
      const { token } = tokenSnap.docs[0].data();
      try {
        await messaging.send({
          token,
          notification: { title, body },
        });
        method = 'push';
        sendResult = { success: true, method: 'push' };
      } catch (fcmError) {
        console.error('[sendDirectMessage] FCM failed, falling back to SMS:', fcmError);
        // Fall through to SMS.
      }
    }

    if (method === 'sms') {
      if (!guest.phone) {
        await adminDb.collection('notifications').add({
          type: 'direct',
          bookingCode,
          title,
          body,
          sentAt: new Date().toISOString(),
          method: 'none',
          status: 'failed',
          error: 'No FCM token and no phone number on file.',
        });
        return { success: false, error: 'No FCM token and no phone number on file.' };
      }

      const smsBody = `${title}: ${body}`.slice(0, 160);
      await sendSMS(guest.phone, smsBody);
      sendResult = { success: true, method: 'sms' };
    }

    // 3. Log to Firestore.
    await adminDb.collection('notifications').add({
      type: 'direct',
      bookingCode,
      title,
      body,
      sentAt: new Date().toISOString(),
      method,
      status: 'sent',
    });

    return sendResult;
  } catch (error) {
    console.error('[sendDirectMessage] Error:', error);
    return { success: false, error: error.message };
  }
}
