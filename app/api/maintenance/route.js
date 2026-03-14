import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole, requireAuth } from '@/lib/api-auth';
import { notifyAdminAndCohost } from '@/lib/staff-notifications';

const VALID_CATEGORIES = ['Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Other'];
const VALID_URGENCIES = ['low', 'medium', 'high'];

// ---------------------------------------------------------------------------
// GET /api/maintenance
//
// Returns all maintenance requests ordered by createdAt descending.
// Requires admin, cohost, or maintenance role.
//
// Returns:
//   { success: true, data: [...] }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin', 'cohost', 'maintenance']);
    if (authError) return authError;

    const snapshot = await adminDb
      .collection('maintenance')
      .orderBy('createdAt', 'desc')
      .get();

    const requests = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ success: true, data: requests });
  } catch (error) {
    console.error('[GET /api/maintenance] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch maintenance requests.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/maintenance
//
// Creates a new maintenance request.
//
// Request body:
//   { category, urgency?, description, photoUrl?, bookingCode }
//
// Returns:
//   { success: true, data: { id, ...request } }  — HTTP 201
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const body = await request.json();
    const { category, urgency, description, photoUrl, bookingCode } = body;

    // Required field validation.
    if (!category || !description || !bookingCode) {
      return NextResponse.json(
        { success: false, error: 'category, description, and bookingCode are required.' },
        { status: 400 }
      );
    }

    // Category validation.
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        {
          success: false,
          error: `category must be one of: ${VALID_CATEGORIES.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    // Urgency validation — default to 'medium' when omitted.
    const resolvedUrgency = urgency || 'medium';
    if (!VALID_URGENCIES.includes(resolvedUrgency)) {
      return NextResponse.json(
        {
          success: false,
          error: `urgency must be one of: ${VALID_URGENCIES.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    // If the caller is a guest, verify their bookingCode claim matches the request
    if (caller.bookingCode && caller.bookingCode !== bookingCode) {
      return NextResponse.json(
        { success: false, error: 'bookingCode does not match your authenticated session.' },
        { status: 403 }
      );
    }

    const doc = {
      category,
      urgency: resolvedUrgency,
      description: String(description).trim(),
      photoUrl: photoUrl || null,
      bookingCode,
      guestId: caller.uid,
      status: 'open',
      createdAt: new Date().toISOString(),
      notes: '',
    };

    const docRef = await adminDb.collection('maintenance').add(doc);

    // Fire-and-forget notification to admin + co-host
    const snippet = doc.description.length > 80
      ? doc.description.slice(0, 80) + '...'
      : doc.description;
    notifyAdminAndCohost({
      title: `Maintenance: ${doc.category} (${doc.urgency})`,
      body: snippet,
      type: 'maintenance',
      data: { requestId: docRef.id, category: doc.category, urgency: doc.urgency },
    }).catch((err) => console.error('[POST /api/maintenance] Notification error:', err));

    // Auto-create an assignment/task so admin sees it in the tasks view
    const now = new Date().toISOString();
    const assignment = {
      title: `Maintenance: ${doc.category}`,
      description: doc.description.substring(0, 500),
      assigneeId: null,
      assigneeName: 'Unassigned',
      assigneeRole: null,
      createdBy: caller.uid,
      createdByName: 'Guest',
      status: 'pending',
      priority: doc.urgency,
      dueDate: null,
      unit: null,
      completionNote: '',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      source: 'maintenance',
      maintenanceId: docRef.id,
      photoUrl: doc.photoUrl,
      bookingCode: doc.bookingCode,
      guestId: doc.guestId,
    };
    adminDb.collection('assignments').add(assignment)
      .catch((err) => console.error('[POST /api/maintenance] Assignment creation error:', err));

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...doc } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/maintenance] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create maintenance request.' },
      { status: 500 }
    );
  }
}
