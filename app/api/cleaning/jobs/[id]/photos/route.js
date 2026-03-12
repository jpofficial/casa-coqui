import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// POST /api/cleaning/jobs/[id]/photos
//
// Adds photo URLs to a cleaning job. Cleaner can add to own jobs.
//
// Request body:
//   { type: 'before' | 'after', urls: string[] }
// ---------------------------------------------------------------------------
export async function POST(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, [
      'admin', 'cleaner',
    ]);
    if (authError) return authError;

    const { id } = params;
    const body = await request.json();
    const { type, urls } = body;

    if (!type || !urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { success: false, error: 'type and urls (non-empty array) are required.' },
        { status: 400 }
      );
    }

    if (!['before', 'after'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'type must be "before" or "after".' },
        { status: 400 }
      );
    }

    const docRef = adminDb.collection('cleaning_jobs').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Cleaning job not found.' },
        { status: 404 }
      );
    }

    const existing = docSnap.data();
    if (caller.role !== 'admin' && existing.assigneeId !== caller.uid) {
      return NextResponse.json(
        { success: false, error: 'You can only add photos to your own cleaning jobs.' },
        { status: 403 }
      );
    }

    const field = type === 'before' ? 'beforePhotos' : 'afterPhotos';
    await docRef.update({
      [field]: FieldValue.arrayUnion(...urls),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, data: { type, added: urls.length } });
  } catch (error) {
    console.error('[POST /api/cleaning/jobs/[id]/photos]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add photos.' },
      { status: 500 }
    );
  }
}
