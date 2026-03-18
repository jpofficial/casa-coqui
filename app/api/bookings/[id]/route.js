import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { notifyStaff } from '@/lib/staff-notifications';
import { nt } from '@/lib/notification-strings';

// ---------------------------------------------------------------------------
// PATCH /api/bookings/[id]
// Cancels a booking (soft delete). Sets status to 'cancelled' and records
// who cancelled it and when. The guest link becomes unusable because guest
// verification checks status === 'active'.
//
// Requires admin role.
// ---------------------------------------------------------------------------
export async function PATCH(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { id } = await params;
    const docRef = adminDb.collection('bookings').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json(
        { success: false, error: 'Booking not found.' },
        { status: 404 }
      );
    }

    const booking = doc.data();

    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Booking is already cancelled.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    await docRef.update({
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy: caller.uid,
    });

    // ── Cascade: cancel associated cleaning jobs ──
    // Skip jobs that are physically in-progress (en_route through laundry_check)
    const cascadeStatuses = ['scheduled', 'acknowledged', 'declined'];
    const jobsSnap = await adminDb
      .collection('cleaning_jobs')
      .where('bookingId', '==', id)
      .get();

    const batch = adminDb.batch();
    const affectedCleaners = new Map(); // assigneeId → [unit]

    for (const jobDoc of jobsSnap.docs) {
      const job = jobDoc.data();
      if (!cascadeStatuses.includes(job.status)) continue;

      batch.update(jobDoc.ref, {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: caller.uid,
      });

      if (job.assigneeId) {
        const units = affectedCleaners.get(job.assigneeId) || [];
        units.push(job.unit);
        affectedCleaners.set(job.assigneeId, units);
      }
    }

    if (affectedCleaners.size > 0) {
      await batch.commit();

      // Notify each affected cleaner
      for (const [staffId, units] of affectedCleaners) {
        const unitList = units.join(', ');
        await notifyStaff({
          staffIds: [staffId],
          title: nt('en', 'cleaningCancelled_title'),
          body: nt('en', 'cleaningCancelled_body', { unit: unitList }),
          type: 'cleaning_update',
          data: { targetPath: '/admin/cleaning' },
          localizer: (locale) => ({
            title: nt(locale, 'cleaningCancelled_title'),
            body: nt(locale, 'cleaningCancelled_body', { unit: unitList }),
          }),
        }).catch((err) => console.error('[PATCH /api/bookings] Notify cleaner error:', err));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/bookings/[id]]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel booking.' },
      { status: 500 }
    );
  }
}
