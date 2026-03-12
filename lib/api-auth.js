import { adminAuth, adminDb } from '@/lib/firebase-admin';

/**
 * Verifies the Bearer token from the request Authorization header and
 * returns the decoded Firebase user along with their Firestore role.
 *
 * @param {Request} request - Next.js request object
 * @returns {{ uid: string, email: string, role: string|null } | null}
 */
export async function verifyAuth(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get();
    const role = userDoc.exists ? userDoc.data().role : null;
    return {
      uid: decoded.uid,
      email: decoded.email || null,
      role,
      bookingCode: decoded.bookingCode || null,
    };
  } catch {
    return null;
  }
}

/**
 * Requires the caller to have one of the specified roles.
 * Returns a NextResponse error if auth fails, or the caller info on success.
 *
 * @param {Request} request
 * @param {string[]} allowedRoles - e.g. ['admin', 'cohost']
 * @returns {{ caller: object } | { error: NextResponse }}
 */
export async function requireRole(request, allowedRoles) {
  const { NextResponse } = await import('next/server');

  const caller = await verifyAuth(request);
  if (!caller) {
    return {
      error: NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      ),
    };
  }

  if (!allowedRoles.includes(caller.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: 'Insufficient permissions.' },
        { status: 403 }
      ),
    };
  }

  return { caller };
}

/**
 * Requires the caller to be authenticated (any role, including guests).
 * Returns a NextResponse error if auth fails, or the caller info on success.
 */
export async function requireAuth(request) {
  const { NextResponse } = await import('next/server');

  const caller = await verifyAuth(request);
  if (!caller) {
    return {
      error: NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      ),
    };
  }

  return { caller };
}
