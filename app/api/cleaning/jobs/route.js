import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { notifyStaff } from '@/lib/staff-notifications';

// ---------------------------------------------------------------------------
// GET /api/cleaning/jobs
//
// Returns cleaning jobs. Admin/cohost see all; cleaner sees only own jobs.
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { caller, error: authError } = await requireRole(request, [
      'admin', 'cohost', 'cleaner',
    ]);
    if (authError) return authError;

    let query;
    if (caller.role === 'cleaner') {
      query = adminDb
        .collection('cleaning_jobs')
        .where('assigneeId', '==', caller.uid)
        .orderBy('scheduledDate', 'desc');
    } else {
      query = adminDb
        .collection('cleaning_jobs')
        .orderBy('scheduledDate', 'desc');
    }

    const snapshot = await query.get();
    const jobs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ success: true, data: jobs });
  } catch (error) {
    console.error('[GET /api/cleaning/jobs]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cleaning jobs.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/cleaning/jobs
//
// Creates a new cleaning job. Admin only.
//
// Request body:
//   { unit, scheduledDate, checkoutTime?, assigneeId, notes?, turnoverNotes?,
//     sameDayArrival?, bookingId? }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { unit, scheduledDate, checkoutTime, assigneeId, notes, turnoverNotes, sameDayArrival, bookingId } = body;

    if (!unit || !scheduledDate || !assigneeId) {
      return NextResponse.json(
        { success: false, error: 'unit, scheduledDate, and assigneeId are required.' },
        { status: 400 }
      );
    }

    // Verify assignee is an active cleaner
    const assigneeDoc = await adminDb.collection('users').doc(assigneeId).get();
    if (!assigneeDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Assignee not found.' },
        { status: 404 }
      );
    }
    const assigneeData = assigneeDoc.data();

    const now = new Date().toISOString();
    const job = {
      unit,
      scheduledDate,
      checkoutTime: checkoutTime || '11:00 AM',
      assigneeId,
      assigneeName: assigneeData.displayName || assigneeData.email,
      bookingId: bookingId || null,
      status: 'scheduled',
      notes: notes || '',
      turnoverNotes: turnoverNotes || '',
      sameDayArrival: Boolean(sameDayArrival),
      beforePhotos: [],
      afterPhotos: [],
      issues: [],
      laundryFound: null,
      laundryNote: '',
      laundryPhoto: null,
      acknowledgedAt: null,
      enRouteAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      createdBy: caller.uid,
    };

    const docRef = await adminDb.collection('cleaning_jobs').add(job);

    // Notify the assigned cleaner (fire-and-forget).
    notifyStaff({
      staffIds: [assigneeId],
      title: 'New Cleaning Assignment',
      body: `${unit} on ${scheduledDate} (checkout ${job.checkoutTime})`,
      type: 'cleaning_assignment',
      data: { jobId: docRef.id, unit, scheduledDate },
    }).catch((err) => console.error('[POST /api/cleaning/jobs] Notify error:', err));

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...job } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/cleaning/jobs]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create cleaning job.' },
      { status: 500 }
    );
  }
}
