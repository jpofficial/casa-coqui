export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase-admin';

// Simple in-memory rate limiter (resets on cold start, acceptable for serverless)
const attempts = new Map();
const CODE_LOCK = new Map();
const MAX_PER_IP_MIN = 5;
const MAX_CODE_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getRateLimitKey(ip) {
  return crypto.createHash('sha256').update(ip || 'unknown').digest('hex').slice(0, 16);
}

function checkRateLimit(ip, code) {
  const now = Date.now();
  const ipKey = getRateLimitKey(ip);

  // Check code lock
  const codeLock = CODE_LOCK.get(code);
  if (codeLock && codeLock > now) {
    return { blocked: true, reason: 'Too many attempts. Try again later.' };
  }

  // Check IP rate
  const ipAttempts = attempts.get(ipKey) || [];
  const recent = ipAttempts.filter((t) => now - t < 60_000);
  if (recent.length >= MAX_PER_IP_MIN) {
    return { blocked: true, reason: 'Too many attempts. Try again later.' };
  }

  // Record attempt
  recent.push(now);
  attempts.set(ipKey, recent);

  return { blocked: false };
}

function recordFailure(code) {
  const key = `fail_${code}`;
  const count = (attempts.get(key) || 0) + 1;
  attempts.set(key, count);
  if (count >= MAX_CODE_FAILURES) {
    CODE_LOCK.set(code, Date.now() + LOCK_DURATION_MS);
    attempts.delete(key);
  }
}

// ---------------------------------------------------------------------------
// POST /api/guests/validate-token
//
// Validates a guest access token and sets Firebase custom claims.
//
// Request body: { code, accessToken }
// Returns: { success: true } or error
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';

    const { code, accessToken } = await request.json();

    if (!code || !accessToken) {
      return NextResponse.json(
        { success: false, error: 'code and accessToken are required.' },
        { status: 400 }
      );
    }

    // Rate limit check
    const rateCheck = checkRateLimit(ip, code);
    if (rateCheck.blocked) {
      return NextResponse.json(
        { success: false, error: rateCheck.reason },
        { status: 429 }
      );
    }

    // Look up booking by code
    const bookingSnap = await adminDb
      .collection('bookings')
      .where('code', '==', code)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (bookingSnap.empty) {
      recordFailure(code);
      return NextResponse.json(
        { success: false, error: 'No active booking found.' },
        { status: 404 }
      );
    }

    const bookingDoc = bookingSnap.docs[0];
    const booking = bookingDoc.data();

    // Check revocation
    if (booking.accessTokenRevokedAt) {
      return NextResponse.json(
        { success: false, error: 'This link has been revoked.' },
        { status: 401 }
      );
    }

    // Check token hash exists
    if (!booking.accessTokenHash) {
      recordFailure(code);
      return NextResponse.json(
        { success: false, error: 'Invalid access link.' },
        { status: 401 }
      );
    }

    // Defense-in-depth: check checkout date
    const today = new Date().toISOString().slice(0, 10);
    if (booking.checkOutDate && booking.checkOutDate < today) {
      return NextResponse.json(
        { success: false, error: 'This booking has expired.' },
        { status: 410 }
      );
    }

    // Hash the provided token and compare
    const providedHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    if (providedHash !== booking.accessTokenHash) {
      recordFailure(code);
      return NextResponse.json(
        { success: false, error: 'Invalid access token.' },
        { status: 401 }
      );
    }

    // Token is valid — now we need a Firebase Auth UID to set claims on.
    // The client should send an Authorization header if it already has an anonymous session.
    // If not, we create an anonymous custom token.
    const authHeader = request.headers.get('authorization');
    let uid;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
        uid = decoded.uid;
      } catch {
        // Token invalid — client should sign in anonymously and retry
        return NextResponse.json(
          { success: false, error: 'Invalid auth token. Sign in anonymously first.' },
          { status: 401 }
        );
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'Authorization header required. Sign in anonymously first.' },
        { status: 401 }
      );
    }

    // Preserve staff role if applicable
    const existingUser = await adminAuth.getUser(uid);
    const existingClaims = existingUser.customClaims || {};
    const staffRoles = ['admin', 'cohost', 'cleaner', 'maintenance'];
    const isStaff = staffRoles.includes(existingClaims.role);

    // Check if user already has tier:2 for this booking (checked in previously)
    const existingTier = (existingClaims.bookingCode === code && existingClaims.tier) || 0;

    await adminAuth.setCustomUserClaims(uid, {
      bookingCode: code,
      role: isStaff ? existingClaims.role : 'guest',
      tier: Math.max(existingTier, 1),
    });

    // Update guest_access_log
    const now = new Date().toISOString();
    const logRef = adminDb.collection('guest_access_log').doc(code);
    const logDoc = await logRef.get();

    if (logDoc.exists) {
      const logData = logDoc.data();
      const update = {
        lastSeenAt: now,
        accessCount: (logData.accessCount || 0) + 1,
      };
      // Only set linkOpenedAt on first successful validation
      if (!logData.linkOpenedAt) {
        update.linkOpenedAt = now;
      }
      await logRef.update(update);
    } else {
      // Backcompat: create log if it doesn't exist (pre-migration bookings)
      await logRef.set({
        bookingCode: code,
        inviteCreatedAt: booking.createdAt || now,
        linkCopiedAt: null,
        linkOpenedAt: now,
        portalViewedAt: null,
        checkedInAt: null,
        lastSeenAt: now,
        expiredAt: null,
        revokedAt: null,
        pushEnabled: false,
        accessCount: 1,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/guests/validate-token]', error);
    return NextResponse.json(
      { success: false, error: 'Token validation failed.' },
      { status: 500 }
    );
  }
}
