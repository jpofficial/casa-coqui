import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { sendDirectMessage } from '@/lib/notifications';
import { notifyAdminAndCohost } from '@/lib/staff-notifications';
import { nt, getGuestLocale, maintCategory } from '@/lib/notification-strings';

const VALID_STATUSES = ['open', 'acknowledged', 'in-progress', 'done', 'completed', 'archived', 'deleted'];

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

    // Admin-only guard for delete
    if (updates.status === 'deleted') {
      if (caller.role !== 'admin') {
        return NextResponse.json(
          { success: false, error: 'Only admin can delete maintenance requests.' },
          { status: 403 }
        );
      }
      updates.deletedAt = now;
      updates.deletedBy = caller.uid;
    }

    // Track completion
    if (updates.status === 'done' || updates.status === 'completed') {
      updates.completedAt = now;
      updates.completedBy = caller.uid;
    }

    // Track archival
    if (updates.status === 'archived') {
      updates.archivedAt = now;
      updates.archivedBy = caller.uid;
    }

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
    // Skip notifications for delete/archive — silent admin housekeeping.
    if (updates.status === 'deleted' || updates.status === 'archived') {
      return NextResponse.json({ success: true, data: { id, ...updates } });
    }

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
          data: { requestId: id, category, action: 'acknowledged', sourceAction: 'maintenance_acknowledged', sourceId: id },
          localizer: (locale) => ({
            title: nt(locale, 'maintenanceAcknowledged_title'),
            body: nt(locale, 'maintenanceAcknowledged_body', {
              name: callerName,
              category: maintCategory(locale, category),
            }),
          }),
        }).catch((err) => console.error('[PATCH /api/maintenance] Ack staff notification error:', err))
      );

      // Notify guest that their request has been received
      if (bookingCode) {
        pendingNotifications.push(
          (async () => {
            const guestLocale = await getGuestLocale(bookingCode);
            const guestTitle = nt(guestLocale, 'maintenanceUpdate_title');
            const guestBody = estimatedTime
              ? nt(guestLocale, 'maintenanceReceived_body', {
                  category: maintCategory(guestLocale, category),
                  eta: estimatedTime,
                })
              : nt(guestLocale, 'maintenanceReceivedNoEta_body', {
                  category: maintCategory(guestLocale, category),
                });
            return sendDirectMessage({
              bookingCode,
              title: guestTitle,
              body: guestBody,
              category: 'maintenance',
              sourceAction: 'maintenance_acknowledged',
              sourceId: id,
            });
          })().catch((err) => console.error('[PATCH /api/maintenance] Ack guest notification error:', err))
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
          data: { requestId: id, category, action: 'eta_set', estimatedTime, sourceAction: 'maintenance_eta_set', sourceId: id },
          localizer: (locale) => ({
            title: nt(locale, 'maintenanceEtaSet_title'),
            body: nt(locale, 'maintenanceEtaSet_body', {
              name: callerName,
              eta: estimatedTime,
              category: maintCategory(locale, category),
            }),
          }),
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
            (async () => {
              const guestLocale = await getGuestLocale(bookingCode);
              return sendDirectMessage({
                bookingCode,
                title: nt(guestLocale, 'maintenanceUpdate_title'),
                body: messageBody,  // user-written content, keep as-is
                category: 'maintenance',
                sourceAction: 'maintenance_response',
                sourceId: id,
              });
            })().catch((err) => console.error('[PATCH /api/maintenance] Guest notification error:', err))
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
