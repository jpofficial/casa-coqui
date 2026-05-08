import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// DELETE /api/community/[id]
//
// Soft-deletes a community post (sets deletedAt). Admin only.
// ---------------------------------------------------------------------------
export async function DELETE(request, { params }) {
  try {
    const { error: authError } = await requireRole(request, ['admin', 'cohost']);
    if (authError) return authError;

    const { id } = params;
    const docRef = adminDb.collection('community').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Post not found.' },
        { status: 404 }
      );
    }

    await docRef.update({
      deletedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/community/[id]]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete post.' },
      { status: 500 }
    );
  }
}
