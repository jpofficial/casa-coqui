import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// GET /api/admin/team
//
// List staff members (non-admin, non-deactivated).
// Accessible by admin and cohost.
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin', 'cohost']);
    if (authError) return authError;

    const snap = await adminDb.collection('users').get();
    const members = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => m.status !== 'deactivated');

    return NextResponse.json({ success: true, data: members });
  } catch (error) {
    console.error('[GET /api/admin/team] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list team members.' },
      { status: 500 }
    );
  }
}
