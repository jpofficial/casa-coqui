import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// GET /api/stays/active
//
// Returns enriched active stays with check-in details, unread message counts,
// open maintenance counts, and night calculations.
//
// Role-based response:
//   admin:  full details (guest name, email, phone, bookingCode, guestLink)
//   cohost: sanitized (first name only, no sensitive fields)
//
// Returns:
//   { success: true, data: [...stays] }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin', 'cohost']);
    if (authError) return authError;

    const isAdmin = caller.role === 'admin';

    // 1. Fetch active bookings
    const bookingsSnap = await adminDb
      .collection('bookings')
      .where('status', '==', 'active')
      .get();

    if (bookingsSnap.empty) {
      return NextResponse.json({ success: true, data: [] });
    }

    const allBookings = bookingsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Defense-in-depth: filter out stays past checkout (Cloud Function updates status at 2 AM)
    const PROPERTY_TZ = 'America/Puerto_Rico';
    const todayPR = new Intl.DateTimeFormat('en-CA', {
      timeZone: PROPERTY_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    const stale = allBookings.filter(b => b.checkOutDate < todayPR);
    if (stale.length > 0) {
      console.warn(`[GET /api/stays/active] Filtered ${stale.length} stale booking(s) awaiting expireLinks:`,
        stale.map(b => ({ code: b.code, checkOut: b.checkOutDate })));
    }

    const bookings = allBookings.filter(b => b.checkOutDate >= todayPR);

    if (bookings.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 2. Fetch check-in details for each booking code
    const codes = bookings.map((b) => b.code).filter(Boolean);
    const checkinMap = {};
    if (codes.length > 0) {
      const checkinPromises = codes.map((code) =>
        adminDb.collection('checkins').doc(code).get()
      );
      const checkinDocs = await Promise.all(checkinPromises);
      for (const doc of checkinDocs) {
        if (doc.exists) {
          checkinMap[doc.id] = doc.data();
        }
      }
    }

    // 3. Fetch unread guest messages (sender == 'guest', read == false)
    //    Query all guest messages, filter unread in JS to avoid composite index
    const unreadMap = {};
    const msgSnap = await adminDb
      .collection('messages')
      .where('sender', '==', 'guest')
      .get();
    for (const doc of msgSnap.docs) {
      const data = doc.data();
      if (data.read === false && data.bookingCode) {
        unreadMap[data.bookingCode] = (unreadMap[data.bookingCode] || 0) + 1;
      }
    }

    // 4. Fetch open/in-progress maintenance requests
    const maintMap = {};
    const maintSnap = await adminDb
      .collection('maintenance')
      .where('status', 'in', ['open', 'in-progress'])
      .get();
    for (const doc of maintSnap.docs) {
      const data = doc.data();
      if (data.bookingCode) {
        maintMap[data.bookingCode] = (maintMap[data.bookingCode] || 0) + 1;
      }
    }

    // 5. Fetch FCM push token counts per booking code
    const pushCountMap = {};
    if (codes.length > 0) {
      for (let i = 0; i < codes.length; i += 30) {
        const batch = codes.slice(i, i + 30);
        const tokenSnap = await adminDb
          .collection('fcm_tokens')
          .where('bookingCode', 'in', batch)
          .get();
        for (const doc of tokenSnap.docs) {
          const data = doc.data();
          if (data.bookingCode) {
            pushCountMap[data.bookingCode] = (pushCountMap[data.bookingCode] || 0) + 1;
          }
        }
      }
    }

    // 6. Fetch booking members (primary + invited guests) per booking code
    const membersMap = {};
    if (codes.length > 0) {
      // Firestore 'in' supports max 30
      for (let i = 0; i < codes.length; i += 30) {
        const batch = codes.slice(i, i + 30);
        const membersSnap = await adminDb
          .collection('booking_members')
          .where('bookingCode', 'in', batch)
          .get();
        for (const doc of membersSnap.docs) {
          const data = doc.data();
          if (!membersMap[data.bookingCode]) membersMap[data.bookingCode] = [];
          membersMap[data.bookingCode].push({
            name: data.name || null,
            role: data.role || 'invited',
            status: data.status || 'pending',
            checkedInAt: data.checkedInAt || null,
            firstPortalVisitAt: data.firstPortalVisitAt || null,
          });
        }
      }
    }

    // 6. Build enriched stay objects
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const stays = bookings.map((b) => {
      const code = b.code || '';
      const checkin = checkinMap[code] || {};

      // Night calculations
      const nightCount = getNightCount(b.checkInDate, b.checkOutDate);
      const nightsRemaining = getNightCount(todayStr, b.checkOutDate);

      const stay = {
        id: b.id,
        unit: b.unit,
        guestFirstName: b.guestName ? b.guestName.split(' ')[0] : 'Guest',
        checkInDate: b.checkInDate,
        checkOutDate: b.checkOutDate,
        status: b.status,
        checkedIn: b.checkedIn || !!checkinMap[code]?.checkedIn,
        checkedInAt: b.checkedInAt || checkinMap[code]?.checkedInAt || null,
        nightCount,
        nightsRemaining,
        arrivalTime: checkin.arrivalTime || null,
        guestCount: checkin.guestCount || null,
        specialRequests: checkin.specialRequests || null,
        unreadMessageCount: unreadMap[code] || 0,
        openMaintenanceCount: maintMap[code] || 0,
        members: membersMap[code] || [],
        pushTokenCount: pushCountMap[code] || 0,
      };

      // Admin-only fields
      if (isAdmin) {
        stay.guestName = b.guestName || 'Guest';
        stay.guestEmail = b.guestEmail || checkin.email || null;
        stay.phone = checkin.phone || null;
        stay.bookingCode = code;
        stay.guestLink = b.guestLink || null;
        stay.hasVehicle = checkin.hasVehicle || null;
        stay.vehicle = checkin.vehicle || null;
      }

      return stay;
    });

    // Sort by unit (alphabetical), then checkInDate ascending within each unit
    stays.sort((a, b) => {
      const unitCmp = (a.unit || '').localeCompare(b.unit || '');
      if (unitCmp !== 0) return unitCmp;
      return (a.checkInDate || '').localeCompare(b.checkInDate || '');
    });

    return NextResponse.json({ success: true, data: stays });
  } catch (error) {
    console.error('[GET /api/stays/active]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch active stays.' },
      { status: 500 }
    );
  }
}

function getNightCount(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const [y1, m1, d1] = checkIn.split('-').map(Number);
  const [y2, m2, d2] = checkOut.split('-').map(Number);
  const a = new Date(y1, m1 - 1, d1);
  const b = new Date(y2, m2 - 1, d2);
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}
