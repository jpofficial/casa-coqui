export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { resend } from '@/lib/resend';
import { getAppUrl } from '@/lib/url';
import { MAX_MEMBERS } from '@/lib/constants';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// POST /api/guests/invite — Send invites to one or more guests (bulk)
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) {
      console.log('[POST /api/guests/invite] Auth failed');
      return authError;
    }

    console.log('[POST /api/guests/invite] caller:', { uid: caller.uid, bookingCode: caller.bookingCode, role: caller.role });

    if (!caller.bookingCode) {
      return NextResponse.json(
        { success: false, error: 'No booking associated with this account.' },
        { status: 403 }
      );
    }

    const { emails } = await request.json();

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { success: false, error: 'emails array is required.' },
        { status: 400 }
      );
    }

    // Normalize & deduplicate
    const normalized = [...new Set(
      emails.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')).filter(Boolean)
    )];

    // Validate formats
    const invalid = normalized.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length > 0 && normalized.length === invalid.length) {
      return NextResponse.json(
        { success: false, error: 'No valid email addresses provided.' },
        { status: 400 }
      );
    }
    const validEmails = normalized.filter((e) => EMAIL_RE.test(e));

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

    // Fetch existing members for duplicate check + count
    const existingSnap = await adminDb
      .collection('booking_members')
      .where('bookingCode', '==', bookingCode)
      .get();

    const existingEmails = new Set(existingSnap.docs.map((d) => d.data().email));
    const duplicates = validEmails.filter((e) => existingEmails.has(e));
    const newEmails = validEmails.filter((e) => !existingEmails.has(e));

    const spotsAvailable = MAX_MEMBERS - existingSnap.size;
    const toInvite = newEmails.slice(0, Math.max(0, spotsAvailable));
    const capped = newEmails.slice(spotsAvailable);

    if (toInvite.length === 0) {
      const reason = duplicates.length > 0
        ? 'All emails have already been invited.'
        : `Group is full (${MAX_MEMBERS} members maximum).`;
      return NextResponse.json(
        { success: false, error: reason, data: { duplicates, capped } },
        { status: 409 }
      );
    }

    // Look up booking data + inviter name once
    const bookingSnap = await adminDb
      .collection('bookings')
      .where('code', '==', bookingCode)
      .limit(1)
      .get();
    const bookingData = bookingSnap.empty ? null : bookingSnap.docs[0].data();
    const inviterName = primarySnap.docs[0].data().name;
    const appUrl = getAppUrl(request);

    // Process each email
    const results = [];
    for (const email of toInvite) {
      try {
        // Create booking_members doc
        const memberRef = await adminDb.collection('booking_members').add({
          bookingCode,
          role: 'member',
          name: null,
          email,
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
          email,
          createdAt: new Date().toISOString(),
          used: false,
        });

        const inviteLink = `${appUrl}/g/${bookingCode}/join?token=${token}`;

        // Send invite email
        let emailSent = false;
        let emailErrorMsg = null;
        if (resend) {
          try {
            const { error: emailError } = await resend.emails.send({
              from: 'Casa Coqui <hello@contact.casa-coqui.cc>',
              to: email,
              subject: "You're invited to Casa Coqui!",
              html: buildInviteEmail({
                inviteLink,
                inviterName,
                unit: bookingData?.unit,
                checkIn: bookingData?.checkInDate,
                checkOut: bookingData?.checkOutDate,
              }),
            });
            if (emailError) {
              console.error('[invite] Resend error:', emailError);
              emailErrorMsg = emailError.message || 'Email delivery failed';
            } else {
              emailSent = true;
            }
          } catch (emailErr) {
            console.error('[invite] Email send error:', emailErr);
            emailErrorMsg = emailErr.message || 'Email delivery failed';
          }
        } else {
          emailErrorMsg = 'Email service not configured';
        }

        // Persist email delivery status and invite link on the member doc
        await memberRef.update({
          emailSent,
          emailError: emailErrorMsg,
          inviteLink,
          sentAt: new Date().toISOString(),
        });

        results.push({ email, memberId: memberRef.id, emailSent, emailError: emailErrorMsg, inviteLink });
      } catch (err) {
        console.error(`[invite] Failed for ${email}:`, err);
        results.push({ email, error: 'Failed to process invite.' });
      }
    }

    const sent = results.filter((r) => !r.error).length;

    return NextResponse.json(
      { success: true, data: { sent, duplicates, capped, results } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/guests/invite]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send invites.' },
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
      .get();

    const members = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

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
function buildInviteEmail({ inviteLink, inviterName, unit, checkIn, checkOut }) {
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
            <td style="background:linear-gradient(135deg, #166534 0%, #15803d 100%);padding:28px 24px 24px;text-align:center">
              <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700;letter-spacing:0.02em">Casa Coqu&iacute;</h1>
              <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:0.1em;text-transform:uppercase">Guest Portal</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 12px">
              <h2 style="margin:0 0 8px;font-size:18px;color:#111827">You're invited!</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
                ${inviterName || 'Your host'} has invited you to join their stay at <strong>Casa Coqu&iacute;</strong>. You'll get your own access to the guest portal with check-in details, house info, and more.
              </p>
              ${stayInfo ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:8px;margin-bottom:20px"><tr><td style="padding:16px"><p style="margin:0 0 4px;font-size:12px;color:#15803d;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Your Stay</p>${stayInfo}</td></tr></table>` : ''}
              <p style="margin:0 0 4px;font-size:13px;color:#6b7280;line-height:1.5">
                Tap the button below to confirm your details and get access. Once you're in, you'll receive real-time updates and notifications for your stay.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 28px" align="center">
              <a href="${inviteLink}" style="display:inline-block;background:#16a34a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:10px;box-shadow:0 2px 8px rgba(22,163,74,0.3)">
                Accept Invitation
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
              <p style="margin:0;font-size:11px;color:#9ca3af">Casa Coqu&iacute; &middot; Puerto Rico</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
