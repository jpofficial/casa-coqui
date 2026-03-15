import { getMessaging } from 'firebase-admin/messaging';
import adminApp, { adminDb } from '@/lib/firebase-admin';
import { sendSMS } from '@/lib/twilio';
import { isStaleTokenError } from '@/lib/notifications';

const messaging = getMessaging(adminApp);

// ---------------------------------------------------------------------------
// notifyStaff
//
// Sends a notification to specific staff members by UID. Tries FCM push first,
// falls back to SMS if the staff member has a phone number on their user profile.
// Logs all notifications to the `staff_notifications` collection.
//
// @param {object} opts
//   staffIds  {string[]}  Array of staff user UIDs
//   title     {string}    Notification title
//   body      {string}    Notification body
//   type      {string}    Notification type (e.g. 'cleaning_update', 'assignment')
//   data      {object}    Optional extra data
//
// @returns {{ success: boolean, data?: { push, sms, failed } }}
// ---------------------------------------------------------------------------
export async function notifyStaff({ staffIds, title, body, type = 'staff', data = {}, pushOnly = false }) {
  try {
    if (!staffIds || staffIds.length === 0) {
      return { success: true, data: { push: 0, sms: 0, failed: 0 } };
    }

    let pushCount = 0;
    let smsCount = 0;
    let failedCount = 0;

    for (const uid of staffIds) {
      let method = 'none';

      // 1. Try FCM push — look for tokens registered by this staff member
      const tokenSnap = await adminDb
        .collection('fcm_tokens')
        .where('staffId', '==', uid)
        .get();

      let pushSent = false;
      if (!tokenSnap.empty) {
        for (const tokenDocSnap of tokenSnap.docs) {
          const token = tokenDocSnap.data().token;
          if (!token) continue;
          try {
            await messaging.send({
              token,
              notification: { title, body },
              data: { type, ...data },
            });
            pushSent = true;
            pushCount++;
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

      // 2. SMS fallback if push didn't work (skipped when pushOnly=true)
      if (!pushSent && !pushOnly) {
        const userDoc = await adminDb.collection('users').doc(uid).get();
        const userData = userDoc.exists ? userDoc.data() : null;
        if (userData?.phone) {
          try {
            const smsBody = `${title}: ${body}`.slice(0, 160);
            await sendSMS(userData.phone, smsBody);
            smsCount++;
            method = 'sms';
          } catch (smsErr) {
            console.error(`[notifyStaff] SMS failed for ${uid}:`, smsErr.message);
            failedCount++;
            method = 'failed';
          }
        } else {
          failedCount++;
          method = 'none';
        }
      } else if (!pushSent && pushOnly) {
        console.log(`[notifyStaff] pushOnly=true, no FCM token for ${uid} — skipping SMS`);
        failedCount++;
        method = 'none';
      }

      // 3. Log to staff_notifications collection
      await adminDb.collection('staff_notifications').add({
        recipientId: uid,
        title,
        body,
        type,
        method,
        read: false,
        data,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      success: true,
      data: { push: pushCount, sms: smsCount, failed: failedCount },
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
export async function notifyAdminAndCohost({ title, body, type = 'staff', data = {} }) {
  try {
    const usersSnap = await adminDb
      .collection('users')
      .where('role', 'in', ['admin', 'cohost'])
      .where('status', '==', 'active')
      .get();

    const staffIds = usersSnap.docs.map((d) => d.id);
    return notifyStaff({ staffIds, title, body, type, data });
  } catch (error) {
    console.error('[notifyAdminAndCohost] Error:', error);
    return { success: false, error: error.message };
  }
}
