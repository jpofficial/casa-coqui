import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireRole } from '@/lib/api-auth';

const VALID_CATEGORIES = ['damage', 'missing', 'repair', 'other'];

// ---------------------------------------------------------------------------
// POST /api/cleaning/jobs/[id]/issues
//
// Reports an issue during cleaning. Cleaner can report on own jobs.
//
// Request body:
//   { category: string, description?: string, photoUrl?: string }
// ---------------------------------------------------------------------------
export async function POST(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, [
      'admin', 'cleaner',
    ]);
    if (authError) return authError;

    const { id } = params;
    const body = await request.json();
    const { category, description, photoUrl } = body;

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'category is required.' },
        { status: 400 }
      );
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { success: false, error: `category must be one of: ${VALID_CATEGORIES.join(', ')}.` },
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
        { success: false, error: 'You can only report issues on your own cleaning jobs.' },
        { status: 403 }
      );
    }

    const issue = {
      category,
      description: description ? String(description).trim() : '',
      photoUrl: photoUrl || null,
      reportedAt: new Date().toISOString(),
      reportedBy: caller.uid,
    };

    await docRef.update({
      issues: FieldValue.arrayUnion(issue),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, data: issue }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/cleaning/jobs/[id]/issues]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to report issue.' },
      { status: 500 }
    );
  }
}
