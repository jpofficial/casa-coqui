import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { MACHINE_IDS, notifyWaitlist } from '@/lib/laundry';

const STAFF_ROLES = ['admin', 'cohost', 'cleaner', 'maintenance'];

// ---------------------------------------------------------------------------
// POST /api/laundry/end
//
// Ends an active laundry session early. The caller must be the session owner
// or a staff member.
//
// Request body:
//   { machineId: 'washer' | 'dryer' }
//
// Returns:
//   200 { success: true, data: { machineId, status: 'available', endedAt } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const body = await request.json();
    const { machineId } = body;

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

    const machineRef = adminDb.collection('laundry').doc(machineId);
    const machineDoc = await machineRef.get();

    if (!machineDoc.exists || machineDoc.data().status !== 'in_use') {
      return NextResponse.json(
        { success: false, error: 'Machine is not currently in use.' },
        { status: 409 }
      );
    }

    const machine = machineDoc.data();
    const isOwner = machine.sessionOwnerId === caller.uid;
    const isStaff = STAFF_ROLES.includes(caller.role);

    if (!isOwner && !isStaff) {
      return NextResponse.json(
        { success: false, error: 'You can only end your own session.' },
        { status: 403 }
      );
    }

    const endReason = isStaff && !isOwner ? 'staff_override' : 'manual';
    const endedAt = new Date().toISOString();
    const activeSessionId = machine.activeSessionId;

    await adminDb.runTransaction(async (tx) => {
      const freshMachineDoc = await tx.get(machineRef);

      if (!freshMachineDoc.exists || freshMachineDoc.data().status !== 'in_use') {
        throw Object.assign(new Error('Machine is not currently in use.'), { statusCode: 409 });
      }

      // Reset machine to available
      tx.update(machineRef, {
        status: 'available',
        activeSessionId: null,
        sessionStartedAt: null,
        sessionExpiresAt: null,
        sessionOwnerId: null,
        sessionOwnerName: null,
        sessionBookingCode: null,
        updatedAt: endedAt,
        updatedBy: caller.uid,
        updatedByRole: caller.role || 'guest',
      });

      // Close the session document
      if (activeSessionId) {
        const sessionRef = adminDb.collection('laundry_sessions').doc(activeSessionId);
        tx.update(sessionRef, {
          status: 'completed',
          endedAt,
          endedBy: caller.uid,
          endedByRole: caller.role || 'guest',
          endReason,
        });
      }
    });

    // Notify waiting guests — fire-and-forget
    notifyWaitlist(adminDb, machineId).catch((err) => {
      console.error('[POST /api/laundry/end] notifyWaitlist error:', err);
    });

    return NextResponse.json({
      success: true,
      data: { machineId, status: 'available', endedAt, endReason },
    });
  } catch (error) {
    if (error.statusCode === 409) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    console.error('[POST /api/laundry/end] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to end laundry session.' },
      { status: 500 }
    );
  }
}
