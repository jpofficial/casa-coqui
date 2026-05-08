import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { SESSION_DURATIONS, MACHINE_IDS } from '@/lib/laundry';

const sessionLimiter = createRateLimiter({ maxRequests: 6, windowMs: 60 * 60 * 1000 });

// ---------------------------------------------------------------------------
// POST /api/laundry/start
//
// Starts a new laundry session for the authenticated guest.
//
// Request body:
//   { machineId: 'washer' | 'dryer' }
//
// Returns:
//   201 { success: true, data: { sessionId, machineId, startedAt, expiresAt,
//                                durationMinutes, remainingSeconds } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    // Guests must have a bookingCode (set via custom claim by /api/guests/set-claims)
    if (!caller.bookingCode) {
      return NextResponse.json(
        { success: false, error: 'Only guests with an active booking may start a session.' },
        { status: 403 }
      );
    }

    // Rate limit: 6 session starts per hour per user
    const { limited } = sessionLimiter.check(caller.uid);
    if (limited) {
      return NextResponse.json(
        { success: false, error: 'Too many session starts. Please wait before trying again.' },
        { status: 429 }
      );
    }

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

    // Look up the guest's display name (first word only for privacy)
    let ownerName = 'Guest';
    try {
      const guestSnap = await adminDb
        .collection('guests')
        .where('bookingCode', '==', caller.bookingCode)
        .limit(1)
        .get();

      if (!guestSnap.empty) {
        const guestData = guestSnap.docs[0].data();
        const fullName = guestData.name || guestData.firstName || '';
        ownerName = fullName.split(' ')[0] || 'Guest';
      }
    } catch (nameError) {
      console.error('[POST /api/laundry/start] Failed to look up guest name:', nameError);
      // Non-fatal — continue with default name
    }

    const durationMinutes = SESSION_DURATIONS[machineId];
    const machineRef = adminDb.collection('laundry').doc(machineId);
    let sessionId = null;
    let startedAt = null;
    let expiresAt = null;

    await adminDb.runTransaction(async (tx) => {
      const machineDoc = await tx.get(machineRef);
      const machine = machineDoc.exists ? machineDoc.data() : { status: 'available' };
      const now = new Date().toISOString();

      // Auto-release expired session within the transaction
      if (machine.status === 'in_use') {
        if (machine.sessionExpiresAt && machine.sessionExpiresAt <= now) {
          // Mark the old session as expired
          if (machine.activeSessionId) {
            const oldSessionRef = adminDb
              .collection('laundry_sessions')
              .doc(machine.activeSessionId);
            tx.update(oldSessionRef, {
              status: 'completed',
              endedAt: now,
              endedBy: 'system',
              endedByRole: 'system',
              endReason: 'expired',
            });
          }
          // Fall through — treat machine as available
        } else {
          // Session is still active — cannot start
          throw Object.assign(new Error('Machine is currently in use.'), { statusCode: 409 });
        }
      }

      if (machine.status === 'needs_attention') {
        throw Object.assign(new Error('Machine needs attention and cannot be started.'), {
          statusCode: 409,
        });
      }

      // Build the new session
      startedAt = new Date().toISOString();
      expiresAt = new Date(
        new Date(startedAt).getTime() + durationMinutes * 60 * 1000
      ).toISOString();

      const newSessionRef = adminDb.collection('laundry_sessions').doc();
      sessionId = newSessionRef.id;

      tx.set(newSessionRef, {
        machineId,
        status: 'active',
        startedAt,
        expiresAt,
        durationMinutes,
        ownerId: caller.uid,
        ownerName,
        bookingCode: caller.bookingCode,
        endedAt: null,
        endedBy: null,
        endedByRole: null,
        endReason: null,
        createdAt: startedAt,
      });

      tx.set(
        machineRef,
        {
          status: 'in_use',
          activeSessionId: sessionId,
          sessionStartedAt: startedAt,
          sessionExpiresAt: expiresAt,
          sessionOwnerId: caller.uid,
          sessionOwnerName: ownerName,
          sessionBookingCode: caller.bookingCode,
          updatedAt: startedAt,
          updatedBy: caller.uid,
          updatedByRole: caller.role || 'guest',
        },
        { merge: true }
      );
    });

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          sessionId,
          machineId,
          startedAt,
          expiresAt,
          durationMinutes,
          remainingSeconds,
          ownerName,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error.statusCode === 409) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    console.error('[POST /api/laundry/start] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start laundry session.' },
      { status: 500 }
    );
  }
}
