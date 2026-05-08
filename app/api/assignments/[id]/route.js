import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { sendDirectMessage } from '@/lib/notifications';
import { notifyAdminAndCohost } from '@/lib/staff-notifications';
import { nt, getGuestLocale } from '@/lib/notification-strings';

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled', 'archived'];

// Map assignment statuses to maintenance statuses
const ASSIGNMENT_TO_MAINTENANCE_STATUS = {
  pending: 'open',
  in_progress: 'in-progress',
  completed: 'done',
  cancelled: 'done',
  archived: 'archived',
};

// ---------------------------------------------------------------------------
// PATCH /api/assignments/[id]
//
// Updates an assignment.
// Admin can update any field. Assignee can only update status and completionNote.
// For maintenance-sourced tasks, syncs status to the linked maintenance doc
// and supports guestResponse/estimatedTime fields.
//
// Request body (any subset):
//   { status?, completionNote?, title?, description?, priority?, dueDate?,
//     assigneeId?, guestResponse?, estimatedTime? }
// ---------------------------------------------------------------------------
export async function PATCH(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, [
      'admin', 'cohost', 'cleaner', 'maintenance',
    ]);
    if (authError) return authError;

    const { id } = params;
    const body = await request.json();

    // Fetch existing assignment
    const docRef = adminDb.collection('assignments').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Assignment not found.' },
        { status: 404 }
      );
    }

    const existing = docSnap.data();
    const isAdmin = caller.role === 'admin';
    const isCohost = caller.role === 'cohost';
    const isAssignee = existing.assigneeId === caller.uid;

    if (!isAdmin && !isCohost && !isAssignee) {
      return NextResponse.json(
        { success: false, error: 'You can only update your own assignments.' },
        { status: 403 }
      );
    }

    const updates = {};
    const now = new Date().toISOString();

    if (isAdmin || isCohost) {
      // Admin and cohost can update most fields
      if (body.title !== undefined) updates.title = String(body.title).trim().substring(0, 120);
      if (body.description !== undefined) updates.description = String(body.description).trim().substring(0, 500);
      if (body.priority !== undefined) updates.priority = body.priority;
      if (body.dueDate !== undefined) updates.dueDate = body.dueDate;
      if (body.unit !== undefined) updates.unit = body.unit;
      if (body.status !== undefined) updates.status = body.status;
      if (body.completionNote !== undefined) updates.completionNote = body.completionNote;
      if (body.guestResponse !== undefined) updates.guestResponse = String(body.guestResponse);
      if (body.estimatedTime !== undefined) updates.estimatedTime = String(body.estimatedTime);
      if (body.estimatedMinutes !== undefined) {
        const parsed = Number(body.estimatedMinutes);
        if (body.estimatedMinutes === null) {
          updates.estimatedMinutes = null;
        } else if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1440) {
          return NextResponse.json(
            { success: false, error: 'estimatedMinutes must be an integer between 1 and 1440.' },
            { status: 400 }
          );
        } else {
          updates.estimatedMinutes = parsed;
        }
      }

      // If admin reassigns, update assignee info and clear ack
      if (body.assigneeId && body.assigneeId !== existing.assigneeId) {
        const newAssignee = await adminDb.collection('users').doc(body.assigneeId).get();
        if (!newAssignee.exists) {
          return NextResponse.json(
            { success: false, error: 'New assignee not found.' },
            { status: 404 }
          );
        }
        const assigneeData = newAssignee.data();
        updates.assigneeId = body.assigneeId;
        updates.assigneeName = assigneeData.displayName || assigneeData.email;
        updates.assigneeRole = assigneeData.role;
        // Clear acknowledgement — new assignee hasn't seen the task yet
        updates.assigneeAckedAt = null;
        updates.assigneeAckedBy = null;
      }
    } else {
      // Assignee can only update status, completionNote, and guest-facing fields
      if (body.status !== undefined) updates.status = body.status;
      if (body.completionNote !== undefined) updates.completionNote = String(body.completionNote).trim().substring(0, 500);
      if (body.guestResponse !== undefined) updates.guestResponse = String(body.guestResponse);
      if (body.estimatedTime !== undefined) updates.estimatedTime = String(body.estimatedTime);
    }

    // minutesSpent — available to admin, cohost, and assignee
    if (body.minutesSpent !== undefined) {
      if (body.minutesSpent === null) {
        updates.minutesSpent = null;
        updates.hoursEnteredBy = null;
        updates.hoursEnteredByName = null;
        updates.hoursEnteredAt = null;
      } else {
        const parsed = Number(body.minutesSpent);
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1440) {
          return NextResponse.json(
            { success: false, error: 'minutesSpent must be an integer between 1 and 1440.' },
            { status: 400 }
          );
        }
        updates.minutesSpent = parsed;
        updates.hoursEnteredAt = now;
        updates.hoursEnteredBy = caller.uid;
        // Resolve caller display name
        let callerDisplayName = caller.email || 'Staff';
        try {
          const callerDoc = await adminDb.collection('users').doc(caller.uid).get();
          if (callerDoc.exists) {
            callerDisplayName = callerDoc.data().displayName || callerDoc.data().name || callerDoc.data().email || 'Staff';
          }
        } catch (_) { /* fallback */ }
        updates.hoursEnteredByName = callerDisplayName;
      }
    }

    // Track who responded when guest-facing fields are set
    if (body.guestResponse !== undefined || body.estimatedTime !== undefined) {
      updates.respondedAt = now;
      updates.respondedBy = caller.uid;
    }

    // Validate status if being updated
    if (updates.status && !VALID_STATUSES.includes(updates.status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}.` },
        { status: 400 }
      );
    }

    // Set completedAt timestamp when marking completed
    if (updates.status === 'completed' && existing.status !== 'completed') {
      updates.completedAt = now;
    }
    // Clear completedAt if reopening
    if (updates.status && updates.status !== 'completed' && existing.status === 'completed') {
      updates.completedAt = null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update.' },
        { status: 400 }
      );
    }

    // Handle acknowledgement — co-host signals "I saw my task"
    const pendingNotifications = [];

    if (body.acknowledge === true) {
      if (caller.uid !== existing.assigneeId) {
        return NextResponse.json(
          { success: false, error: 'Only the assignee can acknowledge a task.' },
          { status: 403 }
        );
      }
      updates.assigneeAckedAt = now;
      updates.assigneeAckedBy = caller.uid;

      // Look up caller name for notification copy
      let callerName = 'Staff';
      try {
        const callerDoc = await adminDb.collection('users').doc(caller.uid).get();
        if (callerDoc.exists) {
          callerName = callerDoc.data().displayName || callerDoc.data().name || callerDoc.data().email || 'Staff';
        }
      } catch (_) { /* fallback */ }

      pendingNotifications.push(
        notifyAdminAndCohost({
          title: 'Task Acknowledged',
          body: `${callerName} acknowledged: ${existing.title}`,
          type: 'assignment',
          data: { assignmentId: id, targetPath: '/admin/assignments', sourceAction: 'assignment_acknowledged', sourceId: id },
          localizer: (locale) => ({
            title: nt(locale, 'taskAcknowledged_title'),
            body: nt(locale, 'taskAcknowledged_body', { name: callerName, taskTitle: existing.title }),
          }),
        }).catch((err) => console.error('[PATCH /api/assignments] Ack notification error:', err))
      );
    }

    updates.updatedAt = now;
    await docRef.update(updates);

    // Sync to linked maintenance doc (fire-and-forget)
    if (existing.source === 'maintenance' && existing.maintenanceId) {
      const maintenanceUpdates = { updatedAt: now };

      // Sync status
      if (updates.status) {
        maintenanceUpdates.status = ASSIGNMENT_TO_MAINTENANCE_STATUS[updates.status] || updates.status;
      }

      // Sync guest response fields
      if (updates.guestResponse !== undefined) maintenanceUpdates.guestResponse = updates.guestResponse;
      if (updates.estimatedTime !== undefined) maintenanceUpdates.estimatedTime = updates.estimatedTime;
      if (updates.respondedAt) {
        maintenanceUpdates.respondedAt = updates.respondedAt;
        maintenanceUpdates.respondedBy = updates.respondedBy;
      }

      adminDb.collection('maintenance').doc(existing.maintenanceId).update(maintenanceUpdates)
        .catch((err) => console.error('[PATCH /api/assignments] Maintenance sync error:', err));

      // Notify guest if response/ETA was provided
      if ((body.guestResponse || body.estimatedTime) && existing.bookingCode) {
        const parts = [];
        if (body.guestResponse) parts.push(body.guestResponse);
        if (body.estimatedTime) parts.push(`ETA: ${body.estimatedTime}`);

        const guestLocale = await getGuestLocale(existing.bookingCode);
        await sendDirectMessage({
          bookingCode: existing.bookingCode,
          title: nt(guestLocale, 'maintenanceUpdate_title'),
          body: parts.join(' — '),  // user-written content, keep as-is
          category: 'maintenance',
          sourceAction: 'assignment_response',
          sourceId: existing.maintenanceId,
        }).catch((err) => console.error('[PATCH /api/assignments] Guest notification error:', err));
      }
    }

    // Await all pending notifications — Vercel kills unawaited promises
    if (pendingNotifications.length > 0) {
      await Promise.all(pendingNotifications);
    }

    return NextResponse.json({ success: true, data: { id, ...updates } });
  } catch (error) {
    console.error('[PATCH /api/assignments/[id]]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update assignment.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/assignments/[id]
//
// Deletes an assignment. Admin only.
// ---------------------------------------------------------------------------
export async function DELETE(request, { params }) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { id } = params;
    const docRef = adminDb.collection('assignments').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Assignment not found.' },
        { status: 404 }
      );
    }

    await docRef.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/assignments/[id]]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete assignment.' },
      { status: 500 }
    );
  }
}
