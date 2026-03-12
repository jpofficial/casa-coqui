import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

// ---------------------------------------------------------------------------
// PATCH /api/assignments/[id]
//
// Updates an assignment.
// Admin can update any field. Assignee can only update status and completionNote.
//
// Request body (any subset):
//   { status?, completionNote?, title?, description?, priority?, dueDate?, assigneeId? }
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
    const isAssignee = existing.assigneeId === caller.uid;

    if (!isAdmin && !isAssignee) {
      return NextResponse.json(
        { success: false, error: 'You can only update your own assignments.' },
        { status: 403 }
      );
    }

    const updates = {};
    const now = new Date().toISOString();

    if (isAdmin) {
      // Admin can update any field
      if (body.title !== undefined) updates.title = String(body.title).trim().substring(0, 120);
      if (body.description !== undefined) updates.description = String(body.description).trim().substring(0, 500);
      if (body.priority !== undefined) updates.priority = body.priority;
      if (body.dueDate !== undefined) updates.dueDate = body.dueDate;
      if (body.unit !== undefined) updates.unit = body.unit;
      if (body.status !== undefined) updates.status = body.status;
      if (body.completionNote !== undefined) updates.completionNote = body.completionNote;

      // If admin reassigns, update assignee info
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
      }
    } else {
      // Assignee can only update status and completionNote
      if (body.status !== undefined) updates.status = body.status;
      if (body.completionNote !== undefined) updates.completionNote = String(body.completionNote).trim().substring(0, 500);
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

    updates.updatedAt = now;
    await docRef.update(updates);

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
