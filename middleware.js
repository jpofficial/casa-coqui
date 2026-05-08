import { NextResponse } from 'next/server';

/**
 * Next.js edge middleware for route protection.
 *
 * Checks for a `session` cookie on all /admin/* routes (except /admin/login).
 * This is a defense-in-depth layer — the real auth check happens in the admin
 * layout (client-side) and in API route handlers (server-side).
 *
 * The session cookie is set by the useAuth hook on login and cleared on logout.
 * It contains no sensitive data — it simply signals "this browser has an active
 * Firebase Auth session" so the middleware can gate access at the edge.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only protect /admin/* routes (except login page)
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const session = request.cookies.get('casa-coqui-session');

    if (!session?.value) {
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
