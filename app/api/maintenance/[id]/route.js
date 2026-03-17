import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { sendDirectMessage } from '@/lib/notifications';
import { notifyAdminAndCohost } from '@/lib/staff-notifications';

const VALID_STATUSES = ['open', 'acknowledged', 'in-progress', 'done'];

// ---------------------------------------------------------------------------
// PATCH /api/maintenance/[id]
//
// Partially updates a maintenance request.
// Requires admin, cohost, or maintenance role.
//
// Request body:
//   { status?, notes?, estimatedTime?, guestResponse? }
//
// Workflow notifications:
//   - status → 'acknowledged': notifies admin/cohost + guest
//   - estimatedTime provided: notifies admin/cohost + guest
//   - status → 'done': notifies guest
//   - guestResponse provided: notifies guest
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

    const now = new Date().toISOString();
    updates.updatedAt = now;

    // Track acknowledgement
    if (updates.status === 'acknowledged') {
      updates.acknowledgedAt = now;
      updates.acknowledgedBy = caller.uid;
    }

    // Track who responded and when if a guest-facing response is included
    if (guestResponse !== undefined || estimatedTime !== undefined) {
      updates.respondedAt = now;
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

    const maintenanceData = existing.data();
    const bookingCode = maintenanceData.bookingCode;
    const category = maintenanceData.category;

    // --- Staff + guest follow-up notifications ---
    // All notifications must be awaited — Vercel freezes serverless functions
    // after the response is sent, killing pending async work.

    // Look up the caller's display name for notification copy
    let callerName = 'Staff';
    try {
      const callerDoc = await adminDb.collection('users').doc(caller.uid).get();
      if (callerDoc.exists) {
        callerName = callerDoc.data().name || callerDoc.data().email || 'Staff';
      }
    } catch (_) { /* fallback to 'Staff' */ }

    const pendingNotifications = [];

    // When co-host/maintenance acknowledges — notify admin/cohost team
    if (updates.status === 'acknowledged') {
      pendingNotifications.push(
        notifyAdminAndCohost({
          title: 'Maintenance Acknowledged',
          body: `${callerName} acknowledged the ${category} request`,
          type: 'maintenance_update',
          data: { requestId: id, category, action: 'acknowledged' },
        }).catch((err) => console.error('[PATCH /api/maintenance] Ack staff notification error:', err))
      );

      // Notify guest that their request has been received
      if (bookingCode) {
        const guestBody = estimatedTime
          ? `Your ${category} request has been received. ETA: ${estimatedTime}`
          : `Your ${category} request has been received and a team member is looking into it.`;

        pendingNotifications.push(
          sendDirectMessage({
            bookingCode,
            title: 'Maintenance Update',
            body: guestBody,
            category: 'maintenance',
          }).catch((err) => console.error('[PATCH /api/maintenance] Ack guest notification error:', err))
        );
      }
    }

    // When ETA is provided (without ack — e.g. updating ETA on an already-acknowledged request)
    if (estimatedTime !== undefined && updates.status !== 'acknowledged') {
      pendingNotifications.push(
        notifyAdminAndCohost({
          title: 'Maintenance ETA Set',
          body: `${callerName} set ETA: ${estimatedTime} for ${category} request`,
          type: 'maintenance_update',
          data: { requestId: id, category, action: 'eta_set', estimatedTime },
        }).catch((err) => console.error('[PATCH /api/maintenance] ETA staff notification error:', err))
      );
    }

    // Notify the guest if a response or ETA was provided (non-ack cases — ack
    // case already handled above with better copy)
    if (updates.status !== 'acknowledged') {
      if (guestResponse !== undefined || estimatedTime !== undefined) {
        if (bookingCode) {
          const parts = [];
          if (guestResponse) parts.push(guestResponse);
          if (estimatedTime) parts.push(`ETA: ${estimatedTime}`);
          const messageBody = parts.join(' — ');

          pendingNotifications.push(
            sendDirectMessage({
              bookingCode,
              title: 'Maintenance Update',
              body: messageBody,
              category: 'maintenance',
            }).catch((err) => console.error('[PATCH /api/maintenance] Guest notification error:', err))
          );
        }
      }
    }

    await Promise.all(pendingNotifications);

    return NextResponse.json({ success: true, data: { id, ...updates } });
  } catch (error) {
    console.error('[PATCH /api/maintenance/[id]] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update maintenance request.' },
      { status: 500 }
    );
  }
}
