import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// GET /api/admin/push-debug
// Diagnostic endpoint — checks FCM token, user doc, prefs for the authenticated admin.
export async function GET(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin', 'cohost']);
    if (authError) return authError;

    const uid = caller.uid;
    const results = {};

    // 1. User doc
    const userDoc = await adminDb.collection('users').doc(uid).get();
    results.userDoc = userDoc.exists
      ? { role: userDoc.data().role, status: userDoc.data().status, locale: userDoc.data().locale }
      : 'NOT FOUND';

    // 2. FCM tokens for this staffId
    const tokenSnap = await adminDb
      .collection('fcm_tokens')
      .where('staffId', '==', uid)
      .get();
    results.fcmTokensByStaffId = tokenSnap.docs.map((d) => ({
      id: d.id.slice(0, 12) + '...',
      staffId: d.data().staffId,
      platform: d.data().platform,
      updatedAt: d.data().updatedAt,
    }));

    // 3. Any orphan tokens (no staffId) — check all tokens for this device
    const allTokenSnap = await adminDb.collection('fcm_tokens').get();
    results.totalTokenDocs = allTokenSnap.size;
    results.orphanTokens = allTokenSnap.docs
      .filter((d) => !d.data().staffId && !d.data().bookingCode)
      .map((d) => ({
        id: d.id.slice(0, 12) + '...',
        fields: Object.keys(d.data()),
        updatedAt: d.data().updatedAt,
      }));

    // 4. Notification prefs
    const prefDoc = await adminDb.collection('staff_notification_prefs').doc(uid).get();
    results.notifPrefs = prefDoc.exists ? prefDoc.data() : 'NO PREFS DOC (all enabled by default)';

    // 5. Recent staff_notifications for this user (last 5)
    const recentNotifs = await adminDb
      .collection('staff_notifications')
      .where('recipientId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    results.recentNotifications = recentNotifs.docs.map((d) => ({
      type: d.data().type,
      method: d.data().method,
      title: d.data().title,
      createdAt: d.data().createdAt,
    }));

    return NextResponse.json({ success: true, data: { uid, ...results } });
  } catch (error) {
    console.error('[push-debug]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
