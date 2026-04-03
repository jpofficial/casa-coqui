import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { notifyStaff, notifyAdminAndCohost } from '@/lib/staff-notifications';
import { nt } from '@/lib/notification-strings';

// Valid state machine transitions
const VALID_TRANSITIONS = {
  scheduled: ['acknowledged', 'declined'],
  acknowledged: ['en_route', 'arrived'],  // 'arrived' = compound "Start Cleaning" (skips en_route UX)
  en_route: ['arrived'],
  arrived: ['before_photos', 'cleaning'],  // 'cleaning' = compound (skips before_photos UX after photo upload)
  before_photos: ['cleaning'],
  cleaning: ['after_photos', 'laundry_check'],  // 'laundry_check' = compound (skips after_photos UX step)
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

// POST delegates to PATCH (cached clients may send POST with a body)
export async function POST(request, context) {
  return PATCH(request, context);
}

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

    // Admin-only archive/delete — bypass state machine
    const NON_DELETABLE = ['en_route', 'arrived', 'before_photos', 'cleaning', 'after_photos', 'laundry_check'];

    if (body.status === 'deleted' || body.status === 'archived') {
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: 'Only admin can archive or delete cleaning jobs.' },
          { status: 403 }
        );
      }
      if (body.status === 'deleted' && NON_DELETABLE.includes(existing.status)) {
        return NextResponse.json(
          { success: false, error: 'Cannot delete a cleaning job that is in progress.' },
          { status: 400 }
        );
      }
      updates.status = body.status;
      if (body.status === 'archived') {
        updates.archivedAt = now;
        updates.archivedBy = caller.uid;
      }
      if (body.status === 'deleted') {
        updates.deletedAt = now;
        updates.deletedBy = caller.uid;
      }
    } else if (body.status) {
      // Handle status transition via state machine
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

      // Compound transition: acknowledged → arrived (skips en_route UX)
      // Auto-set enRouteAt so the audit trail remains complete.
      if (existing.status === 'acknowledged' && body.status === 'arrived') {
        updates.enRouteAt = now;
      }

      // Compound transition: arrived → cleaning (skips before_photos UX after photo upload)
      // Auto-set startedAt so the audit trail remains complete.
      if (existing.status === 'arrived' && body.status === 'cleaning') {
        updates.startedAt = now;
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

      // Reassign cleaner
      if (body.assigneeId !== undefined) {
        const assigneeDoc = await adminDb.collection('users').doc(body.assigneeId).get();
        if (!assigneeDoc.exists) {
          return NextResponse.json(
            { success: false, error: 'Assignee not found.' },
            { status: 400 }
          );
        }
        const assigneeData = assigneeDoc.data();
        updates.assigneeId = body.assigneeId;
        updates.assigneeName = assigneeData.displayName || assigneeData.email;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update.' },
        { status: 400 }
      );
    }

    updates.updatedAt = now;
    await docRef.update(updates);

    // Auto-create forum post for status transitions
    if (updates.status && updates.status !== 'deleted' && updates.status !== 'archived') {
      const postBase = {
        type: 'status',
        sender: isAdmin ? 'host' : 'cleaner',
        senderId: caller.uid,
        senderName: isAdmin ? (caller.displayName || caller.email) : (existing.assigneeName || 'Cleaner'),
        text: null,
        imageUrls: [],
        laundryFound: null,
        createdAt: now,
      };

      // Compound transition: acknowledged → arrived — create en_route post first
      if (existing.status === 'acknowledged' && updates.status === 'arrived') {
        await docRef.collection('posts').add({ ...postBase, newStatus: 'en_route' });
      }

      // Compound transition: arrived → cleaning — create before_photos post first
      if (existing.status === 'arrived' && updates.status === 'cleaning') {
        await docRef.collection('posts').add({ ...postBase, newStatus: 'before_photos' });
      }

      // Compound transition: cleaning → laundry_check — create after_photos post first
      if (existing.status === 'cleaning' && updates.status === 'laundry_check') {
        await docRef.collection('posts').add({ ...postBase, newStatus: 'after_photos' });
      }

      const post = { ...postBase, newStatus: updates.status };
      // Attach decline reason if present
      if (updates.status === 'declined' && updates.declineReason) {
        post.text = updates.declineReason;
      }
      await docRef.collection('posts').add(post);

      // If laundry fields were set alongside a status change, add a laundry post too
      if (updates.laundryFound !== undefined) {
        await docRef.collection('posts').add({
          type: 'laundry',
          sender: isAdmin ? 'host' : 'cleaner',
          senderId: caller.uid,
          senderName: isAdmin ? (caller.displayName || caller.email) : (existing.assigneeName || 'Cleaner'),
          text: updates.laundryNote || null,
          imageUrls: updates.laundryPhoto ? [updates.laundryPhoto] : [],
          newStatus: null,
          laundryFound: updates.laundryFound,
          createdAt: now,
        });
      }
    }

    // Skip notifications for archive/delete — silent admin housekeeping.
    if (updates.status === 'deleted' || updates.status === 'archived') {
      return NextResponse.json({ success: true, data: { id, ...updates } });
    }

    // Notify admin/cohost on meaningful status changes.
    // Must be awaited — Vercel freezes serverless functions after response.
    const cleanerName = existing.assigneeName || 'Cleaner';
    const unit = existing.unit;

    if (updates.status === 'acknowledged') {
      console.log(`[PATCH cleaning/jobs/${id}] Triggering notification for acknowledged, cleaner=${cleanerName}, unit=${unit}`);
      try {
        const result = await notifyAdminAndCohost({
          title: nt('en', 'cleaningAccepted_title'),
          body: nt('en', 'cleaningAccepted_body', { name: cleanerName, unit }),
          type: 'cleaning_update',
          data: { jobId: id, status: 'acknowledged', targetPath: '/admin/cleaning' },
          localizer: (locale) => ({
            title: nt(locale, 'cleaningAccepted_title'),
            body: nt(locale, 'cleaningAccepted_body', { name: cleanerName, unit }),
          }),
        });
        console.log(`[PATCH cleaning/jobs/${id}] Notification result:`, JSON.stringify(result));
      } catch (err) {
        console.error(`[PATCH cleaning/jobs/${id}] Notify error (acknowledged):`, err);
      }
    }

    if (updates.status === 'declined') {
      const reason = updates.declineReason ? `: ${updates.declineReason}` : '';
      console.log(`[PATCH cleaning/jobs/${id}] Triggering notification for declined, cleaner=${cleanerName}, unit=${unit}`);
      try {
        const result = await notifyAdminAndCohost({
          title: nt('en', 'cleaningDeclined_title'),
          body: nt('en', 'cleaningDeclined_body', { name: cleanerName, unit }) + reason,
          type: 'cleaning_update',
          data: { jobId: id, status: 'declined', targetPath: '/admin/cleaning' },
          localizer: (locale) => ({
            title: nt(locale, 'cleaningDeclined_title'),
            body: nt(locale, 'cleaningDeclined_body', { name: cleanerName, unit }) + reason,
          }),
        });
        console.log(`[PATCH cleaning/jobs/${id}] Notification result:`, JSON.stringify(result));
      } catch (err) {
        console.error(`[PATCH cleaning/jobs/${id}] Notify error (declined):`, err);
      }
    }

    if (updates.status === 'arrived' || updates.status === 'completed') {
      const titleKey = updates.status === 'arrived' ? 'cleaningArrived_title' : 'cleaningCompleted_title';
      const statusLabelKey = updates.status === 'arrived' ? 'cleaningStatusLabel_arrived' : 'cleaningStatusLabel_completed';
      console.log(`[PATCH cleaning/jobs/${id}] Triggering notification for ${updates.status}, cleaner=${cleanerName}, unit=${unit}`);
      try {
        const result = await notifyAdminAndCohost({
          title: nt('en', titleKey),
          body: nt('en', 'cleaningStatus_body', { name: cleanerName, status: nt('en', statusLabelKey), unit }),
          type: 'cleaning_update',
          data: { jobId: id, status: updates.status, targetPath: '/admin/cleaning' },
          localizer: (locale) => ({
            title: nt(locale, titleKey),
            body: nt(locale, 'cleaningStatus_body', { name: cleanerName, status: nt(locale, statusLabelKey), unit }),
          }),
        });
        console.log(`[PATCH cleaning/jobs/${id}] Notification result:`, JSON.stringify(result));
      } catch (err) {
        console.error(`[PATCH cleaning/jobs/${id}] Notify error (${updates.status}):`, err);
      }
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
