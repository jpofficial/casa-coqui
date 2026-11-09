'use strict';

/**
 * Staff push + in-app notification for the Lambda.
 */

const admin = require('firebase-admin');
const { getFirebaseApp } = require('./firestore');

// ---------------------------------------------------------------------------
// Minimal inline FCM push — mirrors lib/staff-notifications.js notifyAdminAndCohost.
// Keep in sync manually until extracted to a shared workspace package.
// Writes a staff_notifications doc per recipient + sends FCM to each of their
// fcm_tokens. Locale fallback: reads users/{uid}.locale, defaults 'en'.
// ---------------------------------------------------------------------------
async function notifyAdminAndCohost(firestore, { titleEn, titleEs, bodyEn, bodyEs, bodyParams = {}, type, data = {} }) {
  try {
    const usersSnap = await firestore
      .collection('users')
      .where('role', 'in', ['admin', 'cohost'])
      .where('status', '==', 'active')
      .get();

    if (usersSnap.empty) {
      console.warn('[lambda notifyAdminAndCohost] No active admin/cohost users found');
      return;
    }

    const interpolate = (tpl) =>
      Object.entries(bodyParams).reduce(
        (s, [k, v]) => s.replaceAll(`{${k}}`, v),
        tpl
      );

    const nowIso = new Date().toISOString();
    const messaging = admin.messaging(getFirebaseApp());

    await Promise.all(
      usersSnap.docs.map(async (userDoc) => {
        const uid = userDoc.id;
        const userData = userDoc.data() || {};
        const locale = userData.locale === 'es' ? 'es' : 'en';
        const pushTitle = locale === 'es' ? titleEs : titleEn;
        const pushBody = interpolate(locale === 'es' ? bodyEs : bodyEn);
        // Firestore doc stores English canonical copy.
        const docTitle = titleEn;
        const docBody = interpolate(bodyEn);

        // 1. FCM push to each of this user's tokens
        try {
          const tokenSnap = await firestore
            .collection('fcm_tokens')
            .where('staffId', '==', uid)
            .get();
          if (!tokenSnap.empty) {
            const pushData = {
              type,
              ...data,
              title: String(pushTitle),
              body: String(pushBody),
            };
            await Promise.all(
              tokenSnap.docs.map(async (tokDoc) => {
                const tkn = tokDoc.data().token;
                if (!tkn) return;
                try {
                  await messaging.send({ token: tkn, data: pushData });
                } catch (fcmErr) {
                  console.error(`[lambda notifyAdminAndCohost] FCM failed for ${uid}:`, fcmErr.message);
                }
              })
            );
          }
        } catch (tokErr) {
          console.error(`[lambda notifyAdminAndCohost] Token lookup failed for ${uid}:`, tokErr.message);
        }

        // 2. Always write in-app staff_notifications doc
        await firestore.collection('staff_notifications').add({
          recipientId: uid,
          title: docTitle,
          body: docBody,
          type,
          data,
          read: false,
          createdAt: nowIso,
        });
      })
    );
  } catch (err) {
    console.error('[lambda notifyAdminAndCohost] Error:', err.message);
  }
}

module.exports = { notifyAdminAndCohost };
