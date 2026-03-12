import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// ---------------------------------------------------------------------------
// GET /api/notifications
//
// Returns the 50 most recent notification records (broadcasts + direct
// messages) ordered by createdAt descending.
//
// Returns:
//   { success: true, data: [...] }
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const snapshot = await adminDb
      .collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const notifications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ success: true, data: notifications });
  } catch (error) {
    console.error('[GET /api/notifications] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notifications.' },
      { status: 500 }
    );
  }
}
