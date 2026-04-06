import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { notifyStaff } from '@/lib/staff-notifications';
import { nt } from '@/lib/notification-strings';
import { cascadeCleaningJobDates } from '@/lib/booking-cleaning-cascade';

// ---------------------------------------------------------------------------
// PATCH /api/bookings/[id]
//
// Updates a booking. Supports:
//   1. Field edits: guestName, guestEmail, unit, unitId, checkInDate, checkOutDate
//   2. Cancellation: { status: 'cancelled' }
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
    const body = await request.json().catch(() => ({}));

    // ── Cancellation flow ──────────────────────────────────────────────
    if (body.status === 'cancelled') {
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

      // Cascade: cancel associated cleaning jobs
      const cascadeStatuses = ['scheduled', 'acknowledged', 'declined'];
      const jobsSnap = await adminDb
        .collection('cleaning_jobs')
        .where('bookingId', '==', id)
        .get();

      const batch = adminDb.batch();
      const affectedCleaners = new Map();

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
    }

    // ── Field edits ────────────────────────────────────────────────────
    const updates = {};
    const now = new Date().toISOString();

    if (body.guestName !== undefined) updates.guestName = String(body.guestName).trim();
    if (body.guestEmail !== undefined) updates.guestEmail = String(body.guestEmail).trim().toLowerCase();
    if (body.unit !== undefined) updates.unit = String(body.unit).trim();
    if (body.unitId !== undefined) updates.unitId = String(body.unitId).trim();
    if (body.checkInDate !== undefined) updates.checkInDate = String(body.checkInDate).trim();
    if (body.checkOutDate !== undefined) updates.checkOutDate = String(body.checkOutDate).trim();

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update.' },
        { status: 400 }
      );
    }

    // Validate dates if either changed
    const effectiveCheckIn = updates.checkInDate || booking.checkInDate;
    const effectiveCheckOut = updates.checkOutDate || booking.checkOutDate;
    if (effectiveCheckOut <= effectiveCheckIn) {
      return NextResponse.json(
        { success: false, error: 'Check-out date must be after check-in date.' },
        { status: 400 }
      );
    }

    // Overlap check if unit or dates changed
    if (updates.unit || updates.checkInDate || updates.checkOutDate) {
      const effectiveUnit = updates.unit || booking.unit;
      const overlapSnap = await adminDb
        .collection('bookings')
        .where('unit', '==', effectiveUnit)
        .where('status', '==', 'active')
        .get();

      for (const overlapDoc of overlapSnap.docs) {
        if (overlapDoc.id === id) continue; // skip self
        const other = overlapDoc.data();
        if (effectiveCheckIn < other.checkOutDate && effectiveCheckOut > other.checkInDate) {
          return NextResponse.json(
            { success: false, error: `Dates overlap with an existing booking on ${effectiveUnit}.` },
            { status: 400 }
          );
        }
      }
    }

    updates.updatedAt = now;
    await docRef.update(updates);

    // Cascade checkout date changes to linked cleaning jobs
    if (updates.checkOutDate && updates.checkOutDate !== booking.checkOutDate) {
      await cascadeCleaningJobDates({
        bookingId: id,
        newCheckOutDate: updates.checkOutDate,
        oldCheckOutDate: booking.checkOutDate,
        unit: updates.unit || booking.unit,
        guestName: updates.guestName || booking.guestName,
      }).catch((err) => console.error('[PATCH /api/bookings] Cascade error:', err));
    }

    return NextResponse.json({ success: true, data: { id, ...updates } });
  } catch (error) {
    console.error('[PATCH /api/bookings/[id]]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update booking.' },
      { status: 500 }
    );
  }
}
