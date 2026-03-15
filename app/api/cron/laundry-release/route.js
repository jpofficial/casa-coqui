import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { MACHINE_IDS, autoReleaseIfExpired } from '@/lib/laundry';

// ---------------------------------------------------------------------------
// GET /api/cron/laundry-release
//
// Vercel Cron endpoint — runs on a schedule (configure in vercel.json).
// Recommended schedule: every 10 minutes ("*/10 * * * *").
//
// Responsibilities:
//   1. Auto-release any expired laundry sessions for all machines.
//   2. Mark expired waitlist entries (expiresAt <= now, status 'waiting') as
//      'expired' so they don't clutter queries.
//
// Auth:
//   Requires Authorization: Bearer <CRON_SECRET> header.
//
// Returns:
//   { success: true, data: { released: number, expiredWaitlist: number } }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.CRON_SECRET;

    if (!expectedToken) {
      console.error('[GET /api/cron/laundry-release] CRON_SECRET env var is not set.');
      return NextResponse.json(
        { success: false, error: 'Server misconfiguration.' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized.' },
        { status: 401 }
      );
    }

    // 1. Auto-release expired machine sessions
    const releaseResults = await Promise.all(
      MACHINE_IDS.map((id) => autoReleaseIfExpired(adminDb, id))
    );

    const releasedCount = releaseResults.filter((r) => r.released).length;

    // 2. Expire stale waitlist entries
    const now = new Date().toISOString();

    const staleWaitlistSnap = await adminDb
      .collection('laundry_waitlist')
      .where('status', '==', 'waiting')
      .get();

    const expiredEntries = staleWaitlistSnap.docs.filter((doc) => {
      const { expiresAt } = doc.data();
      return expiresAt && expiresAt <= now;
    });

    let expiredWaitlistCount = 0;

    if (expiredEntries.length > 0) {
      // Batch update in chunks of 500 (Firestore batch limit)
      for (let i = 0; i < expiredEntries.length; i += 500) {
        const chunk = expiredEntries.slice(i, i + 500);
        const batch = adminDb.batch();
        chunk.forEach((doc) => {
          batch.update(doc.ref, { status: 'expired', updatedAt: now });
        });
        await batch.commit();
        expiredWaitlistCount += chunk.length;
      }
    }

    console.log(
      `[GET /api/cron/laundry-release] Released: ${releasedCount}, ` +
        `expired waitlist entries: ${expiredWaitlistCount}`
    );

    return NextResponse.json({
      success: true,
      data: {
        released: releasedCount,
        expiredWaitlist: expiredWaitlistCount,
        checkedAt: now,
      },
    });
  } catch (error) {
    console.error('[GET /api/cron/laundry-release] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Cron job failed.' },
      { status: 500 }
    );
  }
}
