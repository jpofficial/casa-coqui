export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { resend } from '@/lib/resend';

const MAX_MEMBERS = 6;

// ---------------------------------------------------------------------------
// POST /api/guests/invite — Send an invite to a new group member
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    if (!caller.bookingCode) {
      return NextResponse.json(
        { success: false, error: 'No booking associated with this account.' },
        { status: 403 }
      );
    }

    const { email, name } = await request.json();

    if (!email || !name) {
      return NextResponse.json(
        { success: false, error: 'email and name are required.' },
        { status: 400 }
      );
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address.' },
        { status: 400 }
      );
    }

    const bookingCode = caller.bookingCode;

    // Verify caller is the primary member
    const primarySnap = await adminDb
      .collection('booking_members')
      .where('bookingCode', '==', bookingCode)
      .where('role', '==', 'primary')
      .where('uid', '==', caller.uid)
      .limit(1)
      .get();

    if (primarySnap.empty) {
      return NextResponse.json(
        { success: false, error: 'Only the primary guest can invite members.' },
        { status: 403 }
      );
    }

    // Check for duplicate (same email + booking)
    const dupSnap = await adminDb
      .collection('booking_members')
      .where('bookingCode', '==', bookingCode)
      .where('email', '==', email.trim().toLowerCase())
      .limit(1)
      .get();

    if (!dupSnap.empty) {
      return NextResponse.json(
        { success: false, error: 'This email has already been invited.' },
        { status: 409 }
      );
    }

    // Check member count
    const allMembersSnap = await adminDb
      .collection('booking_members')
      .where('bookingCode', '==', bookingCode)
      .get();

    if (allMembersSnap.size >= MAX_MEMBERS) {
      return NextResponse.json(
        { success: false, error: `Maximum of ${MAX_MEMBERS} group members reached.` },
        { status: 400 }
      );
    }

    // Create booking_members doc
    const memberRef = await adminDb.collection('booking_members').add({
      bookingCode,
      role: 'member',
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: null,
      uid: null,
      status: 'pending',
      invitedBy: caller.uid,
      createdAt: new Date().toISOString(),
    });

    // Generate invite token
    const token = crypto.randomUUID();
    await adminDb.collection('invite_tokens').doc(token).set({
      bookingCode,
      email: email.trim().toLowerCase(),
      createdAt: new Date().toISOString(),
      used: false,
    });

    // Build invite link
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const inviteLink = `${appUrl}/g/${bookingCode}/join?token=${token}`;

    // Send invite email
    if (resend) {
      try {
        const firstName = name.trim().split(' ')[0];
        // Look up booking for stay details
        const bookingSnap = await adminDb
          .collection('bookings')
          .where('code', '==', bookingCode)
          .limit(1)
          .get();
        const bookingData = bookingSnap.empty ? null : bookingSnap.docs[0].data();

        const { error: emailError } = await resend.emails.send({
          from: 'Casa Coqui <hello@contact.casa-coqui.cc>',
          to: email.trim().toLowerCase(),
          subject: "You're invited to Casa Coqui!",
          html: buildInviteEmail({
            firstName,
            inviteLink,
            inviterName: primarySnap.docs[0].data().name,
            unit: bookingData?.unit,
            checkIn: bookingData?.checkInDate,
            checkOut: bookingData?.checkOutDate,
          }),
        });
        if (emailError) {
          console.error('[invite] Resend error:', emailError);
        }
      } catch (emailErr) {
        console.error('[invite] Email send error:', emailErr);
        // Don't fail the invite if email fails — the link still works
      }
    }

    return NextResponse.json(
      { success: true, data: { memberId: memberRef.id } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/guests/invite]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send invite.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/guests/invite — List all members for the caller's booking
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    if (!caller.bookingCode) {
      return NextResponse.json(
        { success: false, error: 'No booking associated with this account.' },
        { status: 403 }
      );
    }

    const snap = await adminDb
      .collection('booking_members')
      .where('bookingCode', '==', caller.bookingCode)
      .orderBy('createdAt', 'asc')
      .get();

    const members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ success: true, data: members });
  } catch (error) {
    console.error('[GET /api/guests/invite]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch members.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/guests/invite — Remove a pending member
// ---------------------------------------------------------------------------
export async function DELETE(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    if (!caller.bookingCode) {
      return NextResponse.json(
        { success: false, error: 'No booking associated with this account.' },
        { status: 403 }
      );
    }

    const { memberId } = await request.json();

    if (!memberId) {
      return NextResponse.json(
        { success: false, error: 'memberId is required.' },
        { status: 400 }
      );
    }

    // Verify caller is primary
    const primarySnap = await adminDb
      .collection('booking_members')
      .where('bookingCode', '==', caller.bookingCode)
      .where('role', '==', 'primary')
      .where('uid', '==', caller.uid)
      .limit(1)
      .get();

    if (primarySnap.empty) {
      return NextResponse.json(
        { success: false, error: 'Only the primary guest can remove members.' },
        { status: 403 }
      );
    }

    // Get the member doc
    const memberDoc = await adminDb.collection('booking_members').doc(memberId).get();
    if (!memberDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Member not found.' },
        { status: 404 }
      );
    }

    const memberData = memberDoc.data();
    if (memberData.bookingCode !== caller.bookingCode) {
      return NextResponse.json(
        { success: false, error: 'Member does not belong to your booking.' },
        { status: 403 }
      );
    }

    if (memberData.role === 'primary') {
      return NextResponse.json(
        { success: false, error: 'Cannot remove the primary guest.' },
        { status: 400 }
      );
    }

    // Delete the member doc
    await adminDb.collection('booking_members').doc(memberId).delete();

    // Invalidate any unused invite tokens for this email
    const tokenSnap = await adminDb
      .collection('invite_tokens')
      .where('bookingCode', '==', caller.bookingCode)
      .where('email', '==', memberData.email)
      .where('used', '==', false)
      .get();

    const batch = adminDb.batch();
    tokenSnap.docs.forEach((d) => batch.delete(d.ref));
    if (!tokenSnap.empty) await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/guests/invite]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to remove member.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Invite email template
// ---------------------------------------------------------------------------
function buildInviteEmail({ firstName, inviteLink, inviterName, unit, checkIn, checkOut }) {
  const stayInfo =
    checkIn && checkOut
      ? `<p style="margin:0;font-size:14px;color:#166534">${unit ? `${unit} · ` : ''}${checkIn} — ${checkOut}</p>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
          <tr>
            <td style="background:#166534;padding:24px 24px 20px;text-align:center">
              <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:700">Casa Coqui</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 12px">
              <h2 style="margin:0 0 8px;font-size:18px;color:#111827">Hi ${firstName}!</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
                ${inviterName || 'Your host'} has invited you to join their group at Casa Coqui. Tap the button below to verify your phone and access the guest portal.
              </p>
              ${stayInfo ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:8px;margin-bottom:20px"><tr><td style="padding:16px"><p style="margin:0 0 4px;font-size:12px;color:#15803d;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Stay Details</p>${stayInfo}</td></tr></table>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 28px" align="center">
              <a href="${inviteLink}" style="display:inline-block;background:#16a34a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:8px">
                Join the Group
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5">
                If the button doesn't work, copy and paste this link:<br>
                <a href="${inviteLink}" style="color:#16a34a;word-break:break-all">${inviteLink}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
              <p style="margin:0;font-size:11px;color:#9ca3af">Casa Coqui Guest Portal</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
