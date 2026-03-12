import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

const VALID_STATUSES = ['open', 'in-progress', 'done'];

// ---------------------------------------------------------------------------
// PATCH /api/maintenance/[id]
//
// Partially updates a maintenance request (status and/or notes).
//
// Request body:
//   { status?: 'open'|'in-progress'|'done', notes?: string }
//
// Returns:
//   { success: true, data: { id, ...updates } }
// ---------------------------------------------------------------------------
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, notes } = body;

    // Build the partial update — only include fields that were provided.
    const updates = {};

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          {
            success: false,
            error: `status must be one of: ${VALID_STATUSES.join(', ')}.`,
          },
          { status: 400 }
        );
      }
      updates.status = status;
    }

    if (notes !== undefined) {
      updates.notes = String(notes);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Provide at least one of: status, notes.' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();

    const docRef = adminDb.collection('maintenance').doc(id);

    // Verify the document exists before updating.
    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json(
        { success: false, error: `Maintenance request '${id}' not found.` },
        { status: 404 }
      );
    }

    await docRef.update(updates);

    return NextResponse.json({ success: true, data: { id, ...updates } });
  } catch (error) {
    console.error('[PATCH /api/maintenance/[id]] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update maintenance request.' },
      { status: 500 }
    );
  }
}
