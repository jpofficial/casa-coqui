import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { MACHINE_IDS, notifyWaitlist } from '@/lib/laundry';

const STAFF_ROLES = ['admin', 'cohost', 'cleaner', 'maintenance'];

// ---------------------------------------------------------------------------
// POST /api/laundry/attention
//
// Reports or clears a "needs_attention" state on a machine.
//
// Request body:
//   { machineId: 'washer' | 'dryer', action: 'report' | 'clear' }
//
// report — any authenticated user; ends any active session first
// clear  — staff only; resets to 'available' and notifies waitlist
//
// Returns:
//   200 { success: true, data: { machineId, status, updatedAt } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const body = await request.json();
    const { machineId, action } = body;

    if (!machineId) {
      return NextResponse.json(
        { success: false, error: 'machineId is required.' },
        { status: 400 }
      );
    }

    if (!MACHINE_IDS.includes(machineId)) {
      return NextResponse.json(
        { success: false, error: `machineId must be one of: ${MACHINE_IDS.join(', ')}.` },
        { status: 400 }
      );
    }

    if (!action || !['report', 'clear'].includes(action)) {
      return NextResponse.json(
        { success: false, error: "action must be 'report' or 'clear'." },
        { status: 400 }
      );
    }

    if (action === 'clear' && !STAFF_ROLES.includes(caller.role)) {
      return NextResponse.json(
        { success: false, error: 'Only staff can clear a machine attention flag.' },
        { status: 403 }
      );
    }

    const machineRef = adminDb.collection('laundry').doc(machineId);
    const updatedAt = new Date().toISOString();

    if (action === 'report') {
      // If the machine is in_use, cancel the active session first
      await adminDb.runTransaction(async (tx) => {
        const machineDoc = await tx.get(machineRef);
        const machine = machineDoc.exists ? machineDoc.data() : {};

        if (machine.status === 'in_use' && machine.activeSessionId) {
          const sessionRef = adminDb
            .collection('laundry_sessions')
            .doc(machine.activeSessionId);

          tx.update(sessionRef, {
            status: 'cancelled',
            endedAt: updatedAt,
            endedBy: caller.uid,
            endedByRole: caller.role || 'guest',
            endReason: 'attention_reported',
          });
        }

        tx.set(
          machineRef,
          {
            status: 'needs_attention',
            activeSessionId: null,
            sessionStartedAt: null,
            sessionExpiresAt: null,
            sessionOwnerId: null,
            sessionOwnerName: null,
            sessionBookingCode: null,
            updatedAt,
            updatedBy: caller.uid,
            updatedByRole: caller.role || 'guest',
          },
          { merge: true }
        );
      });

      return NextResponse.json({
        success: true,
        data: { machineId, status: 'needs_attention', updatedAt },
      });
    }

    // action === 'clear'
    await machineRef.set(
      {
        status: 'available',
        activeSessionId: null,
        sessionStartedAt: null,
        sessionExpiresAt: null,
        sessionOwnerId: null,
        sessionOwnerName: null,
        sessionBookingCode: null,
        updatedAt,
        updatedBy: caller.uid,
        updatedByRole: caller.role,
      },
      { merge: true }
    );

    // Notify waiting guests — fire-and-forget
    notifyWaitlist(adminDb, machineId).catch((err) => {
      console.error('[POST /api/laundry/attention] notifyWaitlist error:', err);
    });

    return NextResponse.json({
      success: true,
      data: { machineId, status: 'available', updatedAt },
    });
  } catch (error) {
    console.error('[POST /api/laundry/attention] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update machine attention status.' },
      { status: 500 }
    );
  }
}
