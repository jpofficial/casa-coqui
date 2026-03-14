import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { sendDirectMessage } from '@/lib/notifications';

const VALID_STATUSES = ['open', 'in-progress', 'done'];

// ---------------------------------------------------------------------------
// PATCH /api/maintenance/[id]
//
// Partially updates a maintenance request.
// Requires admin, cohost, or maintenance role.
//
// Request body:
//   { status?, notes?, estimatedTime?, guestResponse? }
//
// When guestResponse or estimatedTime is set, a push notification is sent
// to the guest via their bookingCode.
//
// Returns:
//   { success: true, data: { id, ...updates } }
// ---------------------------------------------------------------------------
export async function PATCH(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin', 'cohost', 'maintenance']);
    if (authError) return authError;

    const { id } = await params;
    const body = await request.json();
    const { status, notes, estimatedTime, guestResponse } = body;

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

    if (estimatedTime !== undefined) {
      updates.estimatedTime = String(estimatedTime);
    }

    if (guestResponse !== undefined) {
      updates.guestResponse = String(guestResponse);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Provide at least one of: status, notes, estimatedTime, guestResponse.' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();

    // Track who responded and when if a guest-facing response is included
    if (guestResponse !== undefined || estimatedTime !== undefined) {
      updates.respondedAt = new Date().toISOString();
      updates.respondedBy = caller.uid;
    }

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

    // Notify the guest if a response or ETA was provided
    if (guestResponse !== undefined || estimatedTime !== undefined) {
      const maintenanceData = existing.data();
      const bookingCode = maintenanceData.bookingCode;

      if (bookingCode) {
        const parts = [];
        if (guestResponse) parts.push(guestResponse);
        if (estimatedTime) parts.push(`ETA: ${estimatedTime}`);
        const messageBody = parts.join(' — ');

        sendDirectMessage({
          bookingCode,
          title: 'Maintenance Update',
          body: messageBody,
        }).catch((err) => console.error('[PATCH /api/maintenance/[id]] Guest notification error:', err));
      }
    }

    return NextResponse.json({ success: true, data: { id, ...updates } });
  } catch (error) {
    console.error('[PATCH /api/maintenance/[id]] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update maintenance request.' },
      { status: 500 }
    );
  }
}
