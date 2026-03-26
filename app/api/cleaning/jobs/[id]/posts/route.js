import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { notifyAdminAndCohost, notifyStaff } from '@/lib/staff-notifications';
import { nt } from '@/lib/notification-strings';

// ---------------------------------------------------------------------------
// GET /api/cleaning/jobs/[id]/posts
//
// Returns all forum posts for a cleaning job, ordered by createdAt asc.
// ---------------------------------------------------------------------------
export async function GET(request, { params }) {
  try {
    const { error: authError } = await requireRole(request, [
      'admin', 'cohost', 'cleaner',
    ]);
    if (authError) return authError;

    const { id } = params;

    const snap = await adminDb
      .collection('cleaning_jobs')
      .doc(id)
      .collection('posts')
      .orderBy('createdAt', 'asc')
      .get();

    const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ success: true, data: posts });
  } catch (error) {
    console.error('[GET /api/cleaning/jobs/[id]/posts]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch posts.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/cleaning/jobs/[id]/posts
//
// Creates a forum post (message, photo, etc). Sends notifications.
//
// Request body:
//   { text?: string, imageUrls?: string[], sendViaWhatsApp?: boolean }
// ---------------------------------------------------------------------------
export async function POST(request, { params }) {
  try {
    const { caller, error: authError } = await requireRole(request, [
      'admin', 'cohost', 'cleaner',
    ]);
    if (authError) return authError;

    const { id } = params;
    const body = await request.json();
    const { text, imageUrls } = body;

    if (!text && (!imageUrls || imageUrls.length === 0)) {
      return NextResponse.json(
        { success: false, error: 'text or imageUrls required.' },
        { status: 400 }
      );
    }

    // Verify job exists
    const jobDoc = await adminDb.collection('cleaning_jobs').doc(id).get();
    if (!jobDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Cleaning job not found.' },
        { status: 404 }
      );
    }

    const job = jobDoc.data();
    const isAdmin = ['admin', 'cohost'].includes(caller.role);
    const isAssignee = job.assigneeId === caller.uid;

    if (!isAdmin && !isAssignee) {
      return NextResponse.json(
        { success: false, error: 'You can only post to your own cleaning jobs.' },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    const post = {
      type: 'message',
      sender: isAdmin ? 'host' : 'cleaner',
      senderId: caller.uid,
      senderName: caller.displayName || caller.email || 'Staff',
      text: text ? String(text).trim() : null,
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      newStatus: null,
      laundryFound: null,
      createdAt: now,
    };

    const postRef = await adminDb
      .collection('cleaning_jobs')
      .doc(id)
      .collection('posts')
      .add(post);

    // Notify the other party
    const unit = job.unit || '';
    if (isAdmin) {
      // Admin posted → notify cleaner
      if (job.assigneeId) {
        await notifyStaff({
          staffIds: [job.assigneeId],
          title: nt('en', 'forumReply_title'),
          body: text ? text.slice(0, 100) : nt('en', 'sentPhoto'),
          type: 'cleaning_update',
          data: { jobId: id, unit, targetPath: '/admin/cleaning' },
          localizer: (locale) => ({
            title: nt(locale, 'forumReply_title'),
            body: text ? text.slice(0, 100) : nt(locale, 'sentPhoto'),
          }),
        }).catch((err) => console.error('[posts] notify cleaner error:', err));
      }
    } else {
      // Cleaner posted → notify admin/cohost
      const cleanerName = job.assigneeName || 'Cleaner';
      await notifyAdminAndCohost({
        title: nt('en', 'forumMessage_title', { name: cleanerName }),
        body: text ? text.slice(0, 100) : nt('en', 'sentPhoto'),
        type: 'cleaning_update',
        data: { jobId: id, unit, targetPath: '/admin/cleaning' },
        localizer: (locale) => ({
          title: nt(locale, 'forumMessage_title', { name: cleanerName }),
          body: text ? text.slice(0, 100) : nt(locale, 'sentPhoto'),
        }),
      }).catch((err) => console.error('[posts] notify admin error:', err));
    }

    return NextResponse.json(
      { success: true, data: { id: postRef.id, ...post } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/cleaning/jobs/[id]/posts]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create post.' },
      { status: 500 }
    );
  }
}
