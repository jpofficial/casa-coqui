import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { nanoid } from 'nanoid';
import { requireRole } from '@/lib/api-auth';
import { getAppUrl } from '@/lib/url';
import { notifyStaff } from '@/lib/staff-notifications';
import { nt } from '@/lib/notification-strings';

// ---------------------------------------------------------------------------
// GET /api/bookings
// Returns all bookings sorted by createdAt descending.
// Requires admin role.
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const snapshot = await adminDb
      .collection('bookings')
      .orderBy('createdAt', 'desc')
      .get();

    const bookings = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ success: true, data: bookings });
  } catch (error) {
    console.error('[GET /api/bookings]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch bookings.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/bookings
// Creates a new booking with a unique guest link code.
//
// Request body:
//   { unit, guestName, checkInDate, checkOutDate }
//
// Returns:
//   { success: true, data: { id, code, guestLink, ...booking } }
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { unit, unitId = null, guestName = '', guestEmail = '', checkInDate, checkOutDate } = body;

    // Validate required fields
    if (!unit || !checkInDate || !checkOutDate) {
      return NextResponse.json(
        { success: false, error: 'unit, checkInDate, and checkOutDate are required.' },
        { status: 400 }
      );
    }

    if (checkOutDate <= checkInDate) {
      return NextResponse.json(
        { success: false, error: 'checkOutDate must be after checkInDate.' },
        { status: 400 }
      );
    }

    // Check for overlapping active bookings on the same unit.
    // Two bookings overlap when: existingCheckIn < newCheckOut AND existingCheckOut > newCheckIn
    const activeForUnit = await adminDb
      .collection('bookings')
      .where('unit', '==', unit)
      .where('status', '==', 'active')
      .get();

    const overlap = activeForUnit.docs.some((d) => {
      const b = d.data();
      return b.checkInDate < checkOutDate && b.checkOutDate > checkInDate;
    });

    if (overlap) {
      return NextResponse.json(
        { success: false, error: `${unit} already has an active booking for those dates.` },
        { status: 409 }
      );
    }

    const code = nanoid(10);
    const appUrl = getAppUrl(request);

    // Generate 256-bit cryptographic access token for secure guest link
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    const guestLink = `${appUrl}/g/${code}?t=${accessToken}`;
    const now = new Date().toISOString();

    const booking = {
      code,
      unit,
      ...(unitId && { unitId }),
      guestName: String(guestName).trim(),
      guestEmail: String(guestEmail).trim().toLowerCase(),
      checkInDate,
      checkOutDate,
      status: 'active',
      checkedIn: false,
      source: 'manual',
      externalId: null,
      lastSyncedAt: null,
      syncHash: null,
      createdAt: now,
      guestLink,
      accessTokenHash,
      accessTokenCreatedAt: now,
      accessTokenRevokedAt: null,
    };

    const docRef = await adminDb.collection('bookings').add(booking);

    // Create primary booking_members doc for the guest
    await adminDb.collection('booking_members').add({
      bookingCode: code,
      role: 'primary',
      name: booking.guestName,
      email: booking.guestEmail,
      phone: null,
      uid: null,
      status: 'pending',
      invitedBy: null,
      createdAt: now,
    });

    // Create guest access log for lifecycle tracking
    await adminDb.collection('guest_access_log').doc(code).set({
      bookingCode: code,
      inviteCreatedAt: now,
      linkCopiedAt: null,
      linkOpenedAt: null,
      portalViewedAt: null,
      checkedInAt: null,
      lastSeenAt: null,
      expiredAt: null,
      revokedAt: null,
      pushEnabled: false,
      accessCount: 0,
    });

    // ── Auto-create checkout cleaning job ────────────────────────────────
    // Find the first active cleaner. If exactly one exists, create a
    // cleaning job for checkout day and notify them.
    let cleaningJobId = null;
    try {
      const cleanerSnap = await adminDb
        .collection('users')
        .where('role', '==', 'cleaner')
        .where('status', '==', 'active')
        .get();

      if (cleanerSnap.size >= 1) {
        // Assign to the first cleaner, notify all active cleaners
        const cleanerDoc = cleanerSnap.docs[0];
        const cleanerData = cleanerDoc.data();
        const cleanerUid = cleanerDoc.id;
        const allCleanerUids = cleanerSnap.docs.map((d) => d.id);

        const job = {
          unit,
          scheduledDate: checkOutDate,
          checkoutTime: '11:00 AM',
          assigneeId: cleanerUid,
          assigneeName: cleanerData.displayName || cleanerData.email,
          bookingId: docRef.id,
          status: 'scheduled',
          source: 'manual',
          manualOverride: false,
          notes: guestName ? `Guest: ${guestName}` : '',
          turnoverNotes: '',
          sameDayArrival: false,
          beforePhotos: [],
          afterPhotos: [],
          issues: [],
          laundryFound: null,
          laundryNote: '',
          laundryPhoto: null,
          acknowledgedAt: null,
          enRouteAt: null,
          arrivedAt: null,
          startedAt: null,
          completedAt: null,
          createdAt: new Date().toISOString(),
          createdBy: 'system',
        };

        const jobRef = await adminDb.collection('cleaning_jobs').add(job);
        cleaningJobId = jobRef.id;

        const title = nt('en', 'newCleaningAssignment_title');
        const body = nt('en', 'cleaningAssignment_body', { unit, date: checkOutDate, time: job.checkoutTime });
        await notifyStaff({
          staffIds: allCleanerUids,
          title,
          body,
          type: 'cleaning_assignment',
          data: { jobId: jobRef.id, unit, scheduledDate: checkOutDate, targetPath: '/admin/cleaning' },
          localizer: (locale) => ({
            title: nt(locale, 'newCleaningAssignment_title'),
            body: nt(locale, 'cleaningAssignment_body', { unit, date: checkOutDate, time: job.checkoutTime }),
          }),
        }).catch((err) => console.error('[POST /api/bookings] Cleaning notify error:', err));
      }
    } catch (cleaningErr) {
      // Non-fatal: booking was created successfully, log and continue
      console.error('[POST /api/bookings] Auto-create cleaning job error:', cleaningErr);
    }

    return NextResponse.json(
      { success: true, data: { id: docRef.id, cleaningJobId, ...booking } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/bookings]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create booking.' },
      { status: 500 }
    );
  }
}
