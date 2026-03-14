export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { resend } from '@/lib/resend';
import { requireRole } from '@/lib/api-auth';
import { getAppUrl } from '@/lib/url';
import crypto from 'crypto';

export async function POST(request) {
  try {
    const { caller, error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    if (!resend) {
      return NextResponse.json(
        { success: false, error: 'Email service not configured' },
        { status: 500 }
      );
    }

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

    // Prevent self-invite
    if (email.toLowerCase() === (caller.email || '').toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'You cannot invite yourself' },
        { status: 400 }
      );
    }

    // Create Firebase Auth user, or re-invite if they already exist
    const tempPassword = crypto.randomBytes(16).toString('hex');
    let uid;
    let isExisting = false;
    try {
      const newUser = await adminAuth.createUser({
        email,
        password: tempPassword,
        displayName,
      });
      uid = newUser.uid;
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        // Look up the existing user and update their role
        const existingUser = await adminAuth.getUserByEmail(email);
        uid = existingUser.uid;
        isExisting = true;
        // Update display name if provided
        await adminAuth.updateUser(uid, { displayName });
      } else {
        throw err;
      }
    }

    // Set custom claims (new or updated role)
    await adminAuth.setCustomUserClaims(uid, { role });

    // Generate password reset link so they can set/reset their password
    const appUrl = getAppUrl(request);
    const actionCodeSettings = {
      url: `${appUrl}/admin/login`,
      handleCodeInApp: false,
    };
    const resetLink = await adminAuth.generatePasswordResetLink(email, actionCodeSettings);

    // Send invite email
    let emailSent = false;
    let emailErrorMsg = null;
    try {
      const roleLabelMap = { cohost: 'Co-host', cleaner: 'Cleaner', maintenance: 'Maintenance' };
      const roleLabel = roleLabelMap[role] || role;
      const { error: emailError } = await resend.emails.send({
        from: 'Casa Coqui <hello@contact.casa-coqui.cc>',
        to: email,
        subject: isExisting
          ? "Your Casa Coqui role has been updated"
          : "You've been invited to Casa Coqui",
        html: buildInviteEmail({ displayName, roleLabel, resetLink }),
      });
      if (emailError) {
        console.error('[invite] Email send error:', emailError);
        emailErrorMsg = emailError.message || 'Email delivery failed';
      } else {
        emailSent = true;
      }
    } catch (emailErr) {
      console.error('[invite] Failed to send invite email:', emailErr);
      emailErrorMsg = emailErr.message || 'Email delivery failed';
    }

    // Write or update Firestore doc
    const now = new Date().toISOString();
    const userDocRef = adminDb.collection('users').doc(uid);
    const existingDoc = await userDocRef.get();

    if (existingDoc.exists) {
      // Update existing doc — preserve createdAt, bump invite count
      const prev = existingDoc.data();
      await userDocRef.update({
        role,
        displayName,
        status: 'pending',
        onboardingComplete: false,
        emailSent,
        emailError: emailErrorMsg,
        inviteAttempts: (prev.inviteAttempts || 0) + 1,
        lastInviteAt: now,
      });
    } else {
      await userDocRef.set({
        email,
        role,
        displayName,
        status: 'pending',
        onboardingComplete: false,
        invitedBy: caller.email || 'admin',
        invitedAt: now,
        createdAt: now,
        emailSent,
        emailError: emailErrorMsg,
        inviteAttempts: 1,
        lastInviteAt: now,
      });
    }

    return NextResponse.json({
      success: true,
      data: { uid, email, role, resetLink, emailSent, emailError: emailErrorMsg, reinvited: isExisting },
    });
  } catch (err) {
    console.error('[invite] Error:', err?.code || err?.name, err?.message, err?.stack);

    // Surface actionable error messages instead of generic 500
    let userMessage = 'Internal server error';
    if (err?.code === 'auth/unauthorized-continue-uri') {
      userMessage = 'Firebase rejected the continue URL. Ensure your app domain is whitelisted in Firebase Console > Authentication > Settings > Authorized domains.';
    } else if (err?.code === 'auth/invalid-email') {
      userMessage = 'The email address is invalid.';
    } else if (err?.code === 'auth/operation-not-allowed') {
      userMessage = 'Email/password accounts are not enabled in Firebase. Enable them in Firebase Console > Authentication > Sign-in method.';
    } else if (err?.code?.startsWith?.('auth/')) {
      userMessage = `Firebase Auth error: ${err.message || err.code}`;
    } else if (err?.message) {
      userMessage = `Server error: ${err.message}`;
    }

    return NextResponse.json(
      { success: false, error: userMessage },
      { status: 500 }
    );
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildInviteEmail({ displayName, roleLabel, resetLink }) {
  const safeName = escapeHtml(displayName);
  const safeRole = escapeHtml(roleLabel);
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
              <h2 style="margin:0 0 8px;font-size:18px;color:#111827">Hi ${safeName},</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
                You've been invited to join the Casa Coqui team as a <strong>${safeRole}</strong>. Click the button below to set your password and get started.
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
