import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { createRateLimiter } from '@/lib/rate-limit';

const laundryLimiter = createRateLimiter({ maxRequests: 10, windowMs: 15 * 60 * 1000 });

const MACHINE_IDS = ['washer', 'dryer'];
const VALID_STATUSES = ['available', 'in_use', 'needs_attention'];

const DEFAULT_MACHINE = (id) => ({
  id,
  status: 'available',
  updatedAt: null,
  updatedBy: null,
});

// ---------------------------------------------------------------------------
// GET /api/laundry
//
// Returns the current status of both laundry machines.
//
// Returns:
//   { success: true, data: { washer: {...}, dryer: {...} } }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { error: authError } = await requireAuth(request);
    if (authError) return authError;

    const [washerDoc, dryerDoc] = await Promise.all([
      adminDb.collection('laundry').doc('washer').get(),
      adminDb.collection('laundry').doc('dryer').get(),
    ]);

    const washer = washerDoc.exists
      ? { id: 'washer', ...washerDoc.data() }
      : DEFAULT_MACHINE('washer');

    const dryer = dryerDoc.exists
      ? { id: 'dryer', ...dryerDoc.data() }
      : DEFAULT_MACHINE('dryer');

    return NextResponse.json({ success: true, data: { washer, dryer } });
  } catch (error) {
    console.error('[GET /api/laundry] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch laundry status.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/laundry
//
// Updates the status of a laundry machine.
//
// Request body:
//   { machineId: 'washer'|'dryer', status: 'available'|'in_use'|'needs_attention' }
//
// Returns:
//   { success: true, data: { machineId, status } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    // Rate limit: 10 updates per 15 minutes per user
    const { limited } = laundryLimiter.check(caller.uid);
    if (limited) {
      return NextResponse.json(
        { success: false, error: 'Too many updates. Please wait a few minutes.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { machineId, status } = body;

    if (!machineId || !status) {
      return NextResponse.json(
        { success: false, error: 'machineId and status are required.' },
        { status: 400 }
      );
    }

    if (!MACHINE_IDS.includes(machineId)) {
      return NextResponse.json(
        { success: false, error: `machineId must be one of: ${MACHINE_IDS.join(', ')}.` },
        { status: 400 }
      );
    }

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        {
          success: false,
          error: `status must be one of: ${VALID_STATUSES.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    await adminDb
      .collection('laundry')
      .doc(machineId)
      .set(
        {
          status,
          updatedAt: new Date().toISOString(),
          updatedBy: 'api',
        },
        { merge: true }
      );

    return NextResponse.json({ success: true, data: { machineId, status } });
  } catch (error) {
    console.error('[POST /api/laundry] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update laundry status.' },
      { status: 500 }
    );
  }
}
