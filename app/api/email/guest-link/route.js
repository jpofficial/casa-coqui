import { NextResponse } from 'next/server';
import { resend } from '@/lib/resend';

export async function POST(request) {
  try {
    const { guestEmail, guestName, guestLink, checkInDate, checkOutDate, unit } =
      await request.json();

    if (!guestEmail || !guestLink) {
      return NextResponse.json(
        { success: false, error: 'guestEmail and guestLink are required' },
        { status: 400 }
      );
    }

    const firstName = guestName ? guestName.split(' ')[0] : 'Guest';
    const formattedCheckIn = formatDatePretty(checkInDate);
    const formattedCheckOut = formatDatePretty(checkOutDate);

    const { error } = await resend.emails.send({
      from: 'Casa Coqui <onboarding@resend.dev>',
      to: guestEmail,
      subject: 'Your Casa Coqui Stay — Guest Portal Access',
      html: buildGuestEmail({
        firstName,
        guestLink,
        checkIn: formattedCheckIn,
        checkOut: formattedCheckOut,
        unit,
      }),
    });

    if (error) {
      console.error('[email/guest-link] Resend error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[email/guest-link] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to send email' },
      { status: 500 }
    );
  }
}

function formatDatePretty(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function buildGuestEmail({ firstName, guestLink, checkIn, checkOut, unit }) {
  const stayDetails =
    checkIn && checkOut
      ? `<tr>
            <td style="padding:0 0 20px">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:8px">
                <tr>
                  <td style="padding:16px">
                    <p style="margin:0 0 4px;font-size:12px;color:#15803d;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Stay Details</p>
                    ${unit ? `<p style="margin:0 0 4px;font-size:14px;color:#166534">${unit}</p>` : ''}
                    <p style="margin:0;font-size:14px;color:#166534">${checkIn} — ${checkOut}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
          <!-- Header -->
          <tr>
            <td style="background:#166534;padding:24px 24px 20px;text-align:center">
              <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:700">Casa Coqui</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 24px 12px">
              <h2 style="margin:0 0 8px;font-size:18px;color:#111827">Welcome, ${firstName}!</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
                Your guest portal is ready. Use the link below to access check-in details, house rules, WiFi info, and more.
              </p>
              ${stayDetails}
              <!-- CTA Button -->
              <tr>
                <td style="padding:0 24px 28px" align="center">
                  <a href="${guestLink}" style="display:inline-block;background:#16a34a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:8px">
                    Access Your Guest Portal
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding:0 24px 24px">
                  <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <a href="${guestLink}" style="color:#16a34a;word-break:break-all">${guestLink}</a>
                  </p>
                </td>
              </tr>
            </td>
          </tr>
          <!-- Footer -->
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
