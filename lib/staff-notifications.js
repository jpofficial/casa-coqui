import { getMessaging } from 'firebase-admin/messaging';
import adminApp, { adminDb } from '@/lib/firebase-admin';
import { isStaleTokenError } from '@/lib/notifications';

const messaging = getMessaging(adminApp);

// ---------------------------------------------------------------------------
// notifyStaff
//
// Sends a notification to specific staff members by UID via FCM push.
// Logs all notifications to the `staff_notifications` collection.
//
// @param {object} opts
//   staffIds  {string[]}  Array of staff user UIDs
//   title     {string}    Notification title (fallback / Firestore doc)
//   body      {string}    Notification body  (fallback / Firestore doc)
//   type      {string}    Notification type (e.g. 'cleaning_update', 'assignment')
//   data      {object}    Optional extra data
//   localizer {function}  Optional (locale) => ({ title, body }) for per-staff
//                          push localization. Firestore doc stores English.
//
// @returns {{ success: boolean, data?: { push, failed } }}
// ---------------------------------------------------------------------------
export async function notifyStaff({ staffIds, title, body, type = 'staff', data = {}, localizer }) {
  try {
    if (!staffIds || staffIds.length === 0) {
      return { success: true, data: { push: 0, failed: 0 } };
    }

    // Process all staff members in parallel — sequential processing caused
    // multi-minute delays that exceeded Vercel's serverless execution window.
    const results = await Promise.all(
      staffIds.map(async (uid) => {
        let method = 'none';
        let pushSent = false;

        // Resolve per-staff locale for push content.
        let pushTitle = title;
        let pushBody = body;
        if (localizer) {
          try {
            const userDoc = await adminDb.collection('users').doc(uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            const savedLocale = userData.locale;
            const staffLocale = savedLocale === 'es' || savedLocale === 'en'
              ? savedLocale
              : (userData.role === 'cleaner' ? 'es' : 'en');
            const localized = localizer(staffLocale);
            pushTitle = localized.title;
            pushBody = localized.body;
          } catch (localeErr) {
            console.error(`[notifyStaff] Locale lookup failed for ${uid}:`, localeErr.message);
          }
        }

        try {
          // 1. Try FCM push — look for tokens registered by this staff member
          const tokenSnap = await adminDb
            .collection('fcm_tokens')
            .where('staffId', '==', uid)
            .get();

          if (!tokenSnap.empty) {
            for (const tokenDocSnap of tokenSnap.docs) {
              const token = tokenDocSnap.data().token;
              if (!token) continue;
              try {
                const pushData = { type, ...data, title: String(pushTitle), body: String(pushBody) };
                await messaging.send({
                  token,
                  data: pushData,
                });
                pushSent = true;
                method = 'push';
                break; // One successful push is enough per user
              } catch (fcmErr) {
                console.error(`[notifyStaff] FCM failed for ${uid}:`, fcmErr.message);
                if (isStaleTokenError(fcmErr)) {
                  tokenDocSnap.ref.delete().catch((delErr) => {
                    console.error(`[notifyStaff] Stale token cleanup error:`, delErr);
                  });
                }
              }
            }
          }
        } catch (tokenErr) {
          console.error(`[notifyStaff] Token lookup failed for ${uid}:`, tokenErr.message);
        }

        // 2. Always log to staff_notifications — even if push failed
        const staffNotifDoc = {
          recipientId: uid,
          title,
          body,
          type,
          method,
          read: false,
          data,
          createdAt: new Date().toISOString(),
        };
        if (data.sourceAction) staffNotifDoc.sourceAction = data.sourceAction;
        if (data.sourceId || data.requestId) staffNotifDoc.sourceId = data.sourceId || data.requestId;

        await adminDb.collection('staff_notifications').add(staffNotifDoc);

        return { pushSent };
      })
    );

    const pushCount = results.filter((r) => r.pushSent).length;
    const failedCount = results.filter((r) => !r.pushSent).length;

    return {
      success: true,
      data: { push: pushCount, failed: failedCount },
    };
  } catch (error) {
    console.error('[notifyStaff] Error:', error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// notifyAdminAndCohost
//
// Convenience helper — finds all admin and cohost users and sends them a
// notification. Used for cleaning updates, issue reports, etc.
//
// @param {object} opts  Same as notifyStaff (minus staffIds)
// ---------------------------------------------------------------------------
export async function notifyAdminAndCohost({ title, body, type = 'staff', data = {}, localizer }) {
  try {
    const usersSnap = await adminDb
      .collection('users')
      .where('role', 'in', ['admin', 'cohost'])
      .where('status', '==', 'active')
      .get();

    const staffIds = usersSnap.docs.map((d) => d.id);
    return notifyStaff({ staffIds, title, body, type, data, localizer });
  } catch (error) {
    console.error('[notifyAdminAndCohost] Error:', error);
    return { success: false, error: error.message };
  }
}
