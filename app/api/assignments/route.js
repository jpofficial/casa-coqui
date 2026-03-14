import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

// ---------------------------------------------------------------------------
// GET /api/assignments
//
// Returns assignments. Admin sees all; other staff see only their own.
// Requires any staff role.
//
// Returns:
//   { success: true, data: [...assignments] }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { caller, error: authError } = await requireRole(request, [
      'admin', 'cohost', 'cleaner', 'maintenance',
    ]);
    if (authError) return authError;

    let query;
    if (caller.role === 'admin' || caller.role === 'cohost') {
      // Admin and cohost see all assignments (including unassigned maintenance tasks)
      query = adminDb.collection('assignments').orderBy('createdAt', 'desc');
    } else {
      query = adminDb
        .collection('assignments')
        .where('assigneeId', '==', caller.uid)
        .orderBy('createdAt', 'desc');
    }

    const snapshot = await query.get();
    const assignments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ success: true, data: assignments });
  } catch (error) {
    console.error('[GET /api/assignments]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch assignments.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/assignments
//
// Creates a new assignment/task. Admin only.
//
// Request body:
//   { title, description?, assigneeId, dueDate?, priority?, unit? }
//
// Returns:
//   { success: true, data: { id, ...assignment } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { title, description, assigneeId, dueDate, priority, unit, photoUrl } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: 'title is required.' },
        { status: 400 }
      );
    }

    if (title.length > 120) {
      return NextResponse.json(
        { success: false, error: 'title must be 120 characters or fewer.' },
        { status: 400 }
      );
    }

    const resolvedPriority = priority || 'medium';
    if (!VALID_PRIORITIES.includes(resolvedPriority)) {
      return NextResponse.json(
        { success: false, error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}.` },
        { status: 400 }
      );
    }

    // Resolve assignee info (optional — null for auto-generated tasks)
    let assigneeName = 'Unassigned';
    let assigneeRole = null;
    if (assigneeId) {
      const assigneeDoc = await adminDb.collection('users').doc(assigneeId).get();
      if (!assigneeDoc.exists) {
        return NextResponse.json(
          { success: false, error: 'Assignee not found.' },
          { status: 404 }
        );
      }
      const assigneeData = assigneeDoc.data();
      if (assigneeData.status === 'deactivated') {
        return NextResponse.json(
          { success: false, error: 'Cannot assign to a deactivated user.' },
          { status: 400 }
        );
      }
      assigneeName = assigneeData.displayName || assigneeData.email;
      assigneeRole = assigneeData.role;
    }

    const now = new Date().toISOString();
    const assignment = {
      title: String(title).trim(),
      description: description ? String(description).trim().substring(0, 500) : '',
      assigneeId: assigneeId || null,
      assigneeName,
      assigneeRole,
      createdBy: caller.uid,
      createdByName: caller.email,
      status: 'pending',
      priority: resolvedPriority,
      dueDate: dueDate || null,
      unit: unit || null,
      photoUrl: photoUrl || null,
      completionNote: '',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // Include extra fields for maintenance-sourced tasks
    if (body.source === 'maintenance') {
      assignment.source = 'maintenance';
      assignment.maintenanceId = body.maintenanceId || null;
      assignment.photoUrl = body.photoUrl || null;
      assignment.bookingCode = body.bookingCode || null;
      assignment.guestId = body.guestId || null;
    }

    const docRef = await adminDb.collection('assignments').add(assignment);

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...assignment } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/assignments]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create assignment.' },
      { status: 500 }
    );
  }
}
