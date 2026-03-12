import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { resend } from '@/lib/resend';
import { requireRole } from '@/lib/api-auth';
import crypto from 'crypto';

export async function POST(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    // Parse and validate body
    const { email, role, displayName } = await request.json();

    if (!email || !role || !displayName) {
      return NextResponse.json(
        { success: false, error: 'email, role, and displayName are required' },
        { status: 400 }
      );
    }

    if (!['cohost', 'cleaner', 'maintenance'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Role must be cohost, cleaner, or maintenance' },
        { status: 400 }
      );
    }

    // Create Firebase Auth user with random temp password
    const tempPassword = crypto.randomBytes(16).toString('hex');
    let uid;
    try {
      const newUser = await adminAuth.createUser({
        email,
        password: tempPassword,
        displayName,
      });
      uid = newUser.uid;
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        return NextResponse.json(
          { success: false, error: 'A user with that email already exists' },
          { status: 409 }
        );
      }
      throw err;
    }

    // Set custom claims
    await adminAuth.setCustomUserClaims(uid, { role });

    // Write Firestore doc
    await adminDb.collection('users').doc(uid).set({
      email,
      role,
      displayName,
      status: 'pending',
      invitedBy: caller.email || 'admin',
      invitedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    // Generate password reset link
    const resetLink = await adminAuth.generatePasswordResetLink(email);

    // Send invite email
    let emailSent = false;
    try {
      const roleLabelMap = { cohost: 'Co-host', cleaner: 'Cleaner', maintenance: 'Maintenance' };
      const roleLabel = roleLabelMap[role] || role;
      const { error: emailError } = await resend.emails.send({
        from: 'Casa Coqui <hello@contact.casa-coqui.cc>',
        to: email,
        subject: "You've been invited to Casa Coqui",
        html: buildInviteEmail({ displayName, roleLabel, resetLink }),
      });
      if (emailError) {
        console.error('[invite] Email send error:', emailError);
      } else {
        emailSent = true;
      }
    } catch (emailErr) {
      console.error('[invite] Failed to send invite email:', emailErr);
    }

    return NextResponse.json({
      success: true,
      data: { uid, email, role, resetLink, emailSent },
    });
  } catch (err) {
    console.error('[invite] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function buildInviteEmail({ displayName, roleLabel, resetLink }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
          <tr>
            <td style="background:#1e40af;padding:24px 24px 20px;text-align:center">
              <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:700">Casa Coqui</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 12px">
              <h2 style="margin:0 0 8px;font-size:18px;color:#111827">Hi ${displayName},</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
                You've been invited to join the Casa Coqui team as a <strong>${roleLabel}</strong>. Click the button below to set your password and get started.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 28px" align="center">
              <a href="${resetLink}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:8px">
                Set Your Password
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${resetLink}" style="color:#2563eb;word-break:break-all">${resetLink}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
              <p style="margin:0;font-size:11px;color:#9ca3af">Casa Coqui Team Portal</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
