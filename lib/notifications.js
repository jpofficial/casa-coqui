import { getMessaging } from 'firebase-admin/messaging';
import adminApp, { adminDb } from '@/lib/firebase-admin';

const messaging = getMessaging(adminApp);

// Cooldown window for parking broadcast dedup (milliseconds).
const BROADCAST_COOLDOWN_MS = 10 * 60 * 1000;

// Dedup window for direct messages — suppresses identical notifications
// to the same guest within this window (milliseconds).
const DIRECT_DEDUP_MS = 30 * 1000;

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

  try {
    const cutoff = new Date(Date.now() - BROADCAST_COOLDOWN_MS).toISOString();
    const snap = await adminDb
      .collection('notifications')
      .where('type', '==', type)
      .where('createdAt', '>', cutoff)
      .limit(1)
      .get();

    return !snap.empty;
  } catch (err) {
    // If the composite index doesn't exist yet, log and allow the broadcast.
    console.error('[isBroadcastOnCooldown] Query failed (missing index?):', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// sendNotification
//
// Sends a single FCM push notification to one recipient.
//
// @param {object} opts
//   to    {string}  FCM token
//   title {string}  Notification title
//   body  {string}  Notification body
//   data  {object}  Optional key/value pairs forwarded with FCM messages
//
// @returns {{ success: boolean, method?: 'push', error?: string }}
// ---------------------------------------------------------------------------
export async function sendNotification({ to, title, body, data = {} }) {
  try {
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
      staleToken: isStaleTokenError(error),
    };
  }
}

// ---------------------------------------------------------------------------
// broadcastToActiveGuests
//
// Fetches all active bookings, resolves each guest's FCM tokens, sends FCM
// push to token holders, then logs the broadcast result in Firestore.
//
// @param {object} opts
//   title {string}  Notification title
//   body  {string}  Notification body
//   data  {object}  Optional FCM data payload
//
// @returns {{ success: boolean, data?: { total, push, failed }, error?: string }}
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
      return { success: true, data: { total: 0, push: 0, failed: 0 } };
    }

    const bookingCodes = bookingsSnap.docs.map((doc) => doc.data().code).filter(Boolean);

    // 2. Fetch all FCM tokens — keyed by bookingCode for quick lookup.
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

    // 3. Send FCM per bookingCode so each recipient gets their own deep-link
    //    path (e.g. /g/{theirCode}/parking) and opt-out prefs are respected.
    let pushCount = 0;
    let failedCount = 0;
    const staleDocIds = [];

    for (const code of bookingCodes) {
      const tokens = tokensByCode[code] || [];
      if (tokens.length === 0) continue;

      // Check if guest opted out of this notification category.
      const prefsDoc = await adminDb.collection('notification_prefs').doc(code).get();
      if (prefsDoc.exists && prefsDoc.data()[type] === false) {
        continue; // Guest opted out — skip push but broadcast doc still written below.
      }

      // FCM data values must be strings.
      const enrichedData = {};
      for (const [k, v] of Object.entries({ ...data, type, bookingCode: code })) {
        if (v != null) enrichedData[k] = String(v);
      }

      for (let i = 0; i < tokens.length; i += 500) {
        const chunk = tokens.slice(i, i + 500);
        const multicastResult = await messaging.sendEachForMulticast({
          tokens: chunk,
          notification: { title, body },
          data: enrichedData,
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

    const recipientCount = pushCount + failedCount;

    // 5. Log the broadcast to Firestore.
    const notificationDoc = {
      type,
      title,
      message: body,
      broadcast: true,
      category: type,
      readBy: [],
      createdAt: new Date().toISOString(),
      sentBy: 'admin',
      recipientCount,
      results: {
        push: pushCount,
        failed: failedCount,
      },
    };
    // Persist routing fields if provided by the caller.
    if (data.postId) notificationDoc.postId = data.postId;
    if (data.clickPath) notificationDoc.clickPath = data.clickPath;
    await adminDb.collection('notifications').add(notificationDoc);

    return {
      success: true,
      data: {
        total: recipientCount,
        push: pushCount,
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
// Uses FCM push only. If no token is registered, logs the notification to
// Firestore for in-app visibility and returns method: 'none'.
//
// @param {object} opts
//   bookingCode {string}  Booking code for the target guest
//   title       {string}  Notification title
//   body        {string}  Notification body
//   category    {string}  Notification category (default 'general')
//
// @returns {{ success: boolean, method?: 'push'|'none', error?: string }}
// ---------------------------------------------------------------------------
export async function sendDirectMessage({ bookingCode, title, body, category = 'general', sourceAction = '', sourceId = '' }) {
  try {
    // 0. Dedup check — suppress if an identical notification was sent recently.
    if (bookingCode && category && title) {
      try {
        const cutoff = new Date(Date.now() - DIRECT_DEDUP_MS).toISOString();
        const dupeSnap = await adminDb
          .collection('notifications')
          .where('bookingCode', '==', bookingCode)
          .where('category', '==', category)
          .where('title', '==', title)
          .where('createdAt', '>', cutoff)
          .limit(1)
          .get();

        if (!dupeSnap.empty) {
          console.log(`[sendDirectMessage] Suppressed duplicate — ${category}/${title} for ${bookingCode} (within ${DIRECT_DEDUP_MS / 1000}s window)`);
          return { success: true, method: 'suppressed' };
        }
      } catch (dedupeErr) {
        // If the composite index doesn't exist yet, log and proceed.
        console.error('[sendDirectMessage] Dedup query failed (missing index?):', dedupeErr.message);
      }
    }

    // 1. Look for an FCM token for this booking.
    const tokenSnap = await adminDb
      .collection('fcm_tokens')
      .where('bookingCode', '==', bookingCode)
      .limit(1)
      .get();

    let method = 'none';

    if (!tokenSnap.empty) {
      const tokenDoc = tokenSnap.docs[0];
      const { token } = tokenDoc.data();
      try {
        await messaging.send({
          token,
          notification: { title, body },
          data: { type: category, bookingCode },
        });
        method = 'push';
      } catch (fcmError) {
        console.error('[sendDirectMessage] FCM failed:', fcmError);
        if (isStaleTokenError(fcmError)) {
          tokenDoc.ref.delete().catch((err) => {
            console.error('[sendDirectMessage] Stale token cleanup error:', err);
          });
        }
      }
    }

    // 2. Log to Firestore (always — ensures in-app visibility).
    const notifDoc = {
      type: 'direct',
      bookingCode,
      title,
      message: body,
      broadcast: false,
      category,
      readBy: [],
      createdAt: new Date().toISOString(),
      method,
      status: method === 'push' ? 'sent' : 'in-app-only',
    };
    if (sourceAction) notifDoc.sourceAction = sourceAction;
    if (sourceId) notifDoc.sourceId = sourceId;

    await adminDb.collection('notifications').add(notifDoc);

    return { success: method === 'push', method };
  } catch (error) {
    console.error('[sendDirectMessage] Error:', error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// sendPushOnly
//
// Sends a push notification to a guest and logs to Firestore for in-app
// visibility. Used for Tier 2 (NOTIFY) events like laundry availability.
//
// @param {object} opts
//   bookingCode {string}  Booking code for the target guest
//   title       {string}  Notification title
//   body        {string}  Notification body
//   category    {string}  Notification category (default 'laundry')
//   data        {object}  Optional FCM data payload
//
// @returns {{ success: boolean, method?: 'push'|'none'|'suppressed', error?: string }}
// ---------------------------------------------------------------------------
export async function sendPushOnly({ bookingCode, title, body, category = 'laundry', data = {} }) {
  // Suppress Tier 2 notifications during quiet hours.
  if (isQuietHours()) {
    return { success: true, method: 'suppressed' };
  }

  let tokenDoc = null;
  let method = 'none';

  try {
    const tokenSnap = await adminDb
      .collection('fcm_tokens')
      .where('bookingCode', '==', bookingCode)
      .limit(1)
      .get();

    if (!tokenSnap.empty) {
      tokenDoc = tokenSnap.docs[0];
      const { token } = tokenDoc.data();
      try {
        await messaging.send({
          token,
          notification: { title, body },
          data,
        });
        method = 'push';
      } catch (fcmError) {
        console.error('[sendPushOnly] FCM error:', fcmError);
        if (isStaleTokenError(fcmError)) {
          tokenDoc.ref.delete().catch((err) => {
            console.error('[sendPushOnly] Stale token cleanup error:', err);
          });
        }
      }
    }

    // Log to Firestore for in-app visibility.
    await adminDb.collection('notifications').add({
      type: 'push',
      bookingCode,
      title,
      message: body,
      broadcast: false,
      category,
      readBy: [],
      createdAt: new Date().toISOString(),
      method,
      status: method === 'push' ? 'sent' : 'in-app-only',
    });

    return { success: true, method };
  } catch (error) {
    console.error('[sendPushOnly] Error:', error);
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
