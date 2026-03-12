import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// PATCH /api/admin/team/[uid]
//
// Update a team member's role.
//
// Request body: { role: 'cohost'|'cleaner'|'maintenance' }
// ---------------------------------------------------------------------------
export async function PATCH(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { uid } = await params;
    const { role } = await request.json();

    if (!['cohost', 'cleaner', 'maintenance'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Role must be cohost, cleaner, or maintenance.' },
        { status: 400 }
      );
    }

    // Update Firebase Auth custom claims
    await adminAuth.setCustomUserClaims(uid, { role });

    // Update Firestore user doc
    await adminDb.collection('users').doc(uid).update({
      role,
      updatedAt: new Date().toISOString(),
      updatedBy: caller.email || caller.uid,
    });

    return NextResponse.json({ success: true, data: { uid, role } });
  } catch (error) {
    console.error('[PATCH /api/admin/team/[uid]] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update team member.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/team/[uid]
//
// Deactivate a team member (disables auth, marks Firestore doc).
// ---------------------------------------------------------------------------
export async function DELETE(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { uid } = await params;

    // Prevent self-deletion
    if (uid === caller.uid) {
      return NextResponse.json(
        { success: false, error: 'You cannot remove yourself.' },
        { status: 400 }
      );
    }

    // Don't allow removing other admins
    const targetDoc = await adminDb.collection('users').doc(uid).get();
    if (targetDoc.exists && targetDoc.data().role === 'admin') {
      return NextResponse.json(
        { success: false, error: 'Cannot remove an admin user.' },
        { status: 403 }
      );
    }

    // Disable Firebase Auth user
    await adminAuth.updateUser(uid, { disabled: true });

    // Update Firestore doc
    await adminDb.collection('users').doc(uid).update({
      status: 'deactivated',
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: caller.email || caller.uid,
    });

    return NextResponse.json({ success: true, data: { uid, status: 'deactivated' } });
  } catch (error) {
    console.error('[DELETE /api/admin/team/[uid]] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to remove team member.' },
      { status: 500 }
    );
  }
}
