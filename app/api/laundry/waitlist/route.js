import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { MACHINE_IDS } from '@/lib/laundry';
import { sendPushOnly } from '@/lib/notifications';
import { nt, getGuestLocale } from '@/lib/notification-strings';

const waitlistLimiter = createRateLimiter({ maxRequests: 5, windowMs: 15 * 60 * 1000 });

// ---------------------------------------------------------------------------
// GET /api/laundry/waitlist
//
// Returns the caller's active waitlist subscriptions.
//
// Returns:
//   200 { success: true, data: { washer: entry | null, dryer: entry | null } }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const snap = await adminDb
      .collection('laundry_waitlist')
      .where('guestId', '==', caller.uid)
      .where('status', '==', 'waiting')
      .get();

    const result = { washer: null, dryer: null };

    snap.docs.forEach((doc) => {
      const entry = { id: doc.id, ...doc.data() };
      if (entry.machineId === 'washer') result.washer = entry;
      if (entry.machineId === 'dryer') result.dryer = entry;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[GET /api/laundry/waitlist] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch waitlist subscriptions.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/laundry/waitlist
//
// Subscribes the caller to be notified when a machine becomes available.
//
// Request body:
//   { machineId: 'washer' | 'dryer' }
//
// Returns:
//   201 { success: true, data: { id, machineId, status, expiresAt } }
//   409 if machine is already available
//   200 (with existing entry) if already on waitlist (idempotent)
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    // Rate limit: 5 waitlist joins per 15 minutes
    const { limited } = waitlistLimiter.check(caller.uid);
    if (limited) {
      return NextResponse.json(
        { success: false, error: 'Too many waitlist requests. Please wait a moment.' },
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

    // Check machine is actually in use (no point waiting if it's free)
    const machineDoc = await adminDb.collection('laundry').doc(machineId).get();
    const machine = machineDoc.exists ? machineDoc.data() : { status: 'available' };

    if (machine.status !== 'in_use') {
      return NextResponse.json(
        { success: false, error: 'Machine is already available — no need to join the waitlist.' },
        { status: 409 }
      );
    }

    // Idempotency — return existing entry if already waiting
    const existingSnap = await adminDb
      .collection('laundry_waitlist')
      .where('guestId', '==', caller.uid)
      .where('machineId', '==', machineId)
      .where('status', '==', 'waiting')
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existing = { id: existingSnap.docs[0].id, ...existingSnap.docs[0].data() };
      return NextResponse.json({ success: true, data: existing });
    }

    const createdAt = new Date().toISOString();
    // Waitlist entries expire after 4 hours
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    const newEntry = {
      machineId,
      guestId: caller.uid,
      bookingCode: caller.bookingCode || null,
      status: 'waiting',
      createdAt,
      notifiedAt: null,
      expiresAt,
    };

    const docRef = await adminDb.collection('laundry_waitlist').add(newEntry);

    // Notify the session owner that a guest is waiting (fire-and-forget).
    // Only send on the first waiter to avoid spamming the owner.
    if (machine.sessionBookingCode) {
      const otherWaitersSnap = await adminDb
        .collection('laundry_waitlist')
        .where('machineId', '==', machineId)
        .where('status', '==', 'waiting')
        .get();

      // If this is the only waiting entry, it's the first waiter — notify the owner
      if (otherWaitersSnap.size === 1) {
        const guestLocale = await getGuestLocale(machine.sessionBookingCode);
        const machineName = nt(guestLocale, `laundryMachine_${machineId}`);
        const title = nt(guestLocale, 'laundryRequest_title', { machine: machineName });
        const body = nt(guestLocale, 'laundryRequest_body', { machine: machineName.toLowerCase() });
        sendPushOnly({
          bookingCode: machine.sessionBookingCode,
          title,
          body,
          data: { type: 'laundry_waiting', machineId },
        }).catch((err) => {
          console.error('[POST /api/laundry/waitlist] Owner notify error:', err);
        });
      }
    }

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...newEntry } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/laundry/waitlist] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to join waitlist.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/laundry/waitlist
//
// Removes the caller from a machine's waitlist.
//
// Request body:
//   { machineId: 'washer' | 'dryer' }
//
// Returns:
//   200 { success: true, data: { machineId, status: 'cancelled' } }
// ---------------------------------------------------------------------------
export async function DELETE(request) {
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

    const snap = await adminDb
      .collection('laundry_waitlist')
      .where('guestId', '==', caller.uid)
      .where('machineId', '==', machineId)
      .where('status', '==', 'waiting')
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json(
        { success: false, error: 'No active waitlist entry found for this machine.' },
        { status: 404 }
      );
    }

    const updatedAt = new Date().toISOString();
    await snap.docs[0].ref.update({ status: 'cancelled', updatedAt });

    return NextResponse.json({
      success: true,
      data: { machineId, status: 'cancelled' },
    });
  } catch (error) {
    console.error('[DELETE /api/laundry/waitlist] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to remove waitlist subscription.' },
      { status: 500 }
    );
  }
}
