import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { notifyStaff, notifyAdminAndCohost } from '@/lib/staff-notifications';

// Valid state machine transitions
const VALID_TRANSITIONS = {
  scheduled: ['acknowledged', 'declined'],
  acknowledged: ['en_route'],
  en_route: ['arrived'],
  arrived: ['before_photos'],
  before_photos: ['cleaning'],
  cleaning: ['after_photos'],
  after_photos: ['laundry_check'],
  laundry_check: ['completed'],
};

const TIMESTAMP_FIELDS = {
  acknowledged: 'acknowledgedAt',
  declined: 'declinedAt',
  en_route: 'enRouteAt',
  arrived: 'arrivedAt',
  before_photos: 'startedAt',
  completed: 'completedAt',
};

// ---------------------------------------------------------------------------
// PATCH /api/cleaning/jobs/[id]
//
// Updates a cleaning job status. Enforces state machine transitions.
// Admin can update any field. Cleaner can only update their own jobs.
// ---------------------------------------------------------------------------
export async function PATCH(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, [
      'admin', 'cleaner',
    ]);
    if (authError) return authError;

    const { id } = params;
    const body = await request.json();

    const docRef = adminDb.collection('cleaning_jobs').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Cleaning job not found.' },
        { status: 404 }
      );
    }

    const existing = docSnap.data();
    const isAdmin = caller.role === 'admin';
    const isAssignee = existing.assigneeId === caller.uid;

    if (!isAdmin && !isAssignee) {
      return NextResponse.json(
        { success: false, error: 'You can only update your own cleaning jobs.' },
        { status: 403 }
      );
    }

    const updates = {};
    const now = new Date().toISOString();

    // Handle status transition
    if (body.status) {
      if (!isAdmin) {
        // Cleaner must follow state machine
        const allowed = VALID_TRANSITIONS[existing.status] || [];
        if (!allowed.includes(body.status)) {
          return NextResponse.json(
            { success: false, error: `Cannot transition from '${existing.status}' to '${body.status}'.` },
            { status: 400 }
          );
        }
      }
      updates.status = body.status;

      // Auto-set timestamp for the transition
      const tsField = TIMESTAMP_FIELDS[body.status];
      if (tsField) {
        updates[tsField] = now;
      }
    }

    // Handle decline reason
    if (body.declineReason !== undefined) {
      updates.declineReason = String(body.declineReason).trim();
    }

    // Handle laundry fields
    if (body.laundryFound !== undefined) updates.laundryFound = Boolean(body.laundryFound);
    if (body.laundryNote !== undefined) updates.laundryNote = String(body.laundryNote).trim();
    if (body.laundryPhoto !== undefined) updates.laundryPhoto = body.laundryPhoto;

    // Admin-only fields
    if (isAdmin) {
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.turnoverNotes !== undefined) updates.turnoverNotes = body.turnoverNotes;
      if (body.sameDayArrival !== undefined) updates.sameDayArrival = Boolean(body.sameDayArrival);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update.' },
        { status: 400 }
      );
    }

    updates.updatedAt = now;
    await docRef.update(updates);

    // Notify admin/cohost on meaningful status changes (fire-and-forget).
    const cleanerName = existing.assigneeName || 'Cleaner';
    const unit = existing.unit;

    if (updates.status === 'acknowledged') {
      notifyAdminAndCohost({
        title: 'Cleaning Accepted',
        body: `${cleanerName} accepted cleaning for ${unit}`,
        type: 'cleaning_update',
        data: { jobId: id, status: 'acknowledged' },
      }).catch((err) => console.error('[PATCH /api/cleaning/jobs/[id]] Notify error:', err));
    }

    if (updates.status === 'declined') {
      const reason = updates.declineReason ? `: ${updates.declineReason}` : '';
      notifyAdminAndCohost({
        title: 'Cleaning Declined',
        body: `${cleanerName} cannot accept cleaning for ${unit}${reason}`,
        type: 'cleaning_update',
        data: { jobId: id, status: 'declined' },
      }).catch((err) => console.error('[PATCH /api/cleaning/jobs/[id]] Notify error:', err));
    }

    if (updates.status === 'arrived' || updates.status === 'completed') {
      const statusLabel = updates.status === 'arrived' ? 'arrived at' : 'completed';
      notifyAdminAndCohost({
        title: `Cleaning ${statusLabel}`,
        body: `${cleanerName} ${statusLabel} ${unit}`,
        type: 'cleaning_update',
        data: { jobId: id, status: updates.status },
      }).catch((err) => console.error('[PATCH /api/cleaning/jobs/[id]] Notify error:', err));
    }

    return NextResponse.json({ success: true, data: { id, ...updates } });
  } catch (error) {
    console.error('[PATCH /api/cleaning/jobs/[id]]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update cleaning job.' },
      { status: 500 }
    );
  }
}
