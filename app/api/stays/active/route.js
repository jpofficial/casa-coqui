import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// GET /api/stays/active
//
// Returns sanitized active and upcoming stays for operational use.
// Designed for co-host view — excludes booking codes, guest links, and
// sensitive guest details.
//
// Requires admin or cohost role.
//
// Returns:
//   { success: true, data: [...stays] }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin', 'cohost']);
    if (authError) return authError;

    const snapshot = await adminDb
      .collection('bookings')
      .where('status', '==', 'active')
      .get();

    const stays = snapshot.docs.map((doc) => {
      const data = doc.data();
      // Extract only first name for privacy
      const guestFirstName = data.guestName
        ? data.guestName.split(' ')[0]
        : 'Guest';

      return {
        id: doc.id,
        unit: data.unit,
        guestFirstName,
        checkInDate: data.checkInDate,
        checkOutDate: data.checkOutDate,
        status: data.status,
        checkedIn: data.checkedIn || false,
      };
    });

    stays.sort((a, b) => (b.checkInDate || '').localeCompare(a.checkInDate || ''));

    return NextResponse.json({ success: true, data: stays });
  } catch (error) {
    console.error('[GET /api/stays/active]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch active stays.' },
      { status: 500 }
    );
  }
}
