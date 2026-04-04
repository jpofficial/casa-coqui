export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// POST /api/guests/track-copy
// Records when admin copies a guest link (linkCopiedAt in guest_access_log).
export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin', 'cohost']);
    if (authError) return authError;

    const { bookingCode } = await request.json();
    if (!bookingCode) {
      return NextResponse.json({ success: false, error: 'bookingCode required' }, { status: 400 });
    }

    const logRef = adminDb.collection('guest_access_log').doc(bookingCode);
    const logDoc = await logRef.get();

    const now = new Date().toISOString();
    if (logDoc.exists) {
      await logRef.update({ linkCopiedAt: now });
    } else {
      await logRef.set({
        bookingCode,
        inviteCreatedAt: now,
        linkCopiedAt: now,
        linkOpenedAt: null,
        portalViewedAt: null,
        checkedInAt: null,
        lastSeenAt: null,
        expiredAt: null,
        revokedAt: null,
        pushEnabled: false,
        accessCount: 0,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/guests/track-copy]', err);
    return NextResponse.json({ success: false, error: 'Failed to track' }, { status: 500 });
  }
}
