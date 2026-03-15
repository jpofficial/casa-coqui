import { getMessaging } from 'firebase-admin/messaging';
import adminApp, { adminDb } from '@/lib/firebase-admin';
import { sendSMS } from '@/lib/twilio';

const messaging = getMessaging(adminApp);

// Phone number pattern — any string starting with '+' is treated as a phone number.
const PHONE_RE = /^\+/;

// Cooldown window for parking broadcast dedup (milliseconds).
const BROADCAST_COOLDOWN_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// isStaleTokenError
//
// Returns true if an FCM error indicates the registration token is no longer
// valid and should be deleted from Firestore.
// ---------------------------------------------------------------------------
export function isStaleTokenError(error) {
  const code = error?.code || error?.errorInfo?.code || '';
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token'
  );
}

// ---------------------------------------------------------------------------
// isBroadcastOnCooldown
//
// Checks whether a broadcast of the given type was sent within the cooldown
// window. Currently only applies to 'parking' broadcasts.
// ---------------------------------------------------------------------------
async function isBroadcastOnCooldown(type) {
  if (type !== 'parking') return false;

  const cutoff = new Date(Date.now() - BROADCAST_COOLDOWN_MS).toISOString();
  const snap = await adminDb
    .collection('notifications')
    .where('type', '==', type)
    .where('createdAt', '>', cutoff)
    .limit(1)
    .get();

  return !snap.empty;
}

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
    return {
      success: false,
      error: error.message,
      staleToken: !PHONE_RE.test(to) && isStaleTokenError(error),
    };
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
export async function broadcastToActiveGuests({ title, body, type = 'general', data = {} }) {
  try {
    // 0. Cooldown check — suppress duplicate parking broadcasts.
    if (await isBroadcastOnCooldown(type)) {
      console.log(`[broadcastToActiveGuests] Suppressed — ${type} broadcast on cooldown`);
      return { success: true, suppressed: true };
    }

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
    const tokenDocIds = {};  // token string → Firestore doc ID (for stale cleanup)
    const tokensSnap = await adminDb.collection('fcm_tokens').get();
    tokensSnap.docs.forEach((doc) => {
      const { bookingCode, token } = doc.data();
      if (bookingCode && token) {
        if (!tokensByCode[bookingCode]) tokensByCode[bookingCode] = [];
        tokensByCode[bookingCode].push(token);
        tokenDocIds[token] = doc.id;
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
      const staleDocIds = [];

      for (let i = 0; i < fcmTokens.length; i += 500) {
        const chunk = fcmTokens.slice(i, i + 500);
        const multicastResult = await messaging.sendEachForMulticast({
          tokens: chunk,
          notification: { title, body },
          data,
        });
        pushCount += multicastResult.successCount;
        failedCount += multicastResult.failureCount;

        // Identify stale tokens for cleanup.
        multicastResult.responses.forEach((resp, idx) => {
          if (resp.error && isStaleTokenError(resp.error)) {
            const docId = tokenDocIds[chunk[idx]];
            if (docId) staleDocIds.push(docId);
          }
        });
      }

      // Fire-and-forget: delete stale token docs.
      if (staleDocIds.length > 0) {
        console.log(`[broadcastToActiveGuests] Cleaning ${staleDocIds.length} stale token(s)`);
        const batch = adminDb.batch();
        for (const docId of staleDocIds) {
          batch.delete(adminDb.collection('fcm_tokens').doc(docId));
        }
        batch.commit().catch((err) => {
          console.error('[broadcastToActiveGuests] Stale token cleanup error:', err);
        });
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
      type,
      title,
      message: body,
      createdAt: new Date().toISOString(),
      sentBy: 'admin',
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
      const tokenDoc = tokenSnap.docs[0];
      const { token } = tokenDoc.data();
      try {
        await messaging.send({
          token,
          notification: { title, body },
        });
        method = 'push';
        sendResult = { success: true, method: 'push' };
      } catch (fcmError) {
        console.error('[sendDirectMessage] FCM failed, falling back to SMS:', fcmError);
        if (isStaleTokenError(fcmError)) {
          tokenDoc.ref.delete().catch((err) => {
            console.error('[sendDirectMessage] Stale token cleanup error:', err);
          });
        }
        // Fall through to SMS.
      }
    }

    if (method === 'sms') {
      if (!guest.phone) {
        await adminDb.collection('notifications').add({
          type: 'direct',
          bookingCode,
          title,
          message: body,
          createdAt: new Date().toISOString(),
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
      message: body,
      createdAt: new Date().toISOString(),
      method,
      status: 'sent',
    });

    return sendResult;
  } catch (error) {
    console.error('[sendDirectMessage] Error:', error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// sendPushOnly
//
// Sends a push-only notification to a guest. No SMS fallback.
// Used for Tier 2 (NOTIFY) events like laundry availability.
//
// @param {object} opts
//   bookingCode {string}  Booking code for the target guest
//   title       {string}  Notification title
//   body        {string}  Notification body
//   data        {object}  Optional FCM data payload
//
// @returns {{ success: boolean, method?: 'push'|'none', error?: string }}
// ---------------------------------------------------------------------------
export async function sendPushOnly({ bookingCode, title, body, data = {} }) {
  // Suppress Tier 2 notifications during quiet hours.
  if (isQuietHours()) {
    return { success: true, method: 'suppressed' };
  }

  let tokenDoc = null;

  try {
    const tokenSnap = await adminDb
      .collection('fcm_tokens')
      .where('bookingCode', '==', bookingCode)
      .limit(1)
      .get();

    if (tokenSnap.empty) {
      return { success: true, method: 'none' };
    }

    tokenDoc = tokenSnap.docs[0];
    const { token } = tokenDoc.data();
    await messaging.send({
      token,
      notification: { title, body },
      data,
    });

    return { success: true, method: 'push' };
  } catch (error) {
    console.error('[sendPushOnly] Error:', error);
    if (tokenDoc && isStaleTokenError(error)) {
      tokenDoc.ref.delete().catch((err) => {
        console.error('[sendPushOnly] Stale token cleanup error:', err);
      });
    }
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// isQuietHours
//
// Returns true if the current time in Puerto Rico (UTC-4) is between
// 10 PM and 8 AM. Used to defer Tier 2 notifications.
// ---------------------------------------------------------------------------
export function isQuietHours() {
  const now = new Date();
  const prHour = (now.getUTCHours() - 4 + 24) % 24;
  return prHour >= 22 || prHour < 8;
}
