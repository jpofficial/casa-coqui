import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import crypto from 'crypto';

export async function POST(request) {
  try {
    // Verify caller is admin
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization token' },
        { status: 401 }
      );
    }

    const token = authHeader.split('Bearer ')[1];
    let callerClaims;
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      // Check role from Firestore
      const callerDoc = await adminDb.collection('users').doc(decoded.uid).get();
      callerClaims = callerDoc.exists ? callerDoc.data() : null;
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    if (callerClaims?.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Only admins can invite team members' },
        { status: 403 }
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

    if (!['cohost', 'cleaner'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Role must be cohost or cleaner' },
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
      invitedBy: callerClaims.email || 'admin',
      invitedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    // Generate password reset link
    const resetLink = await adminAuth.generatePasswordResetLink(email);

    return NextResponse.json({
      success: true,
      data: { uid, email, role, resetLink },
    });
  } catch (err) {
    console.error('[invite] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
