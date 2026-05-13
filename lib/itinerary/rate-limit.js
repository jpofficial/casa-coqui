// Per-IP sliding-window rate limiter for itinerary endpoints.
//
// Lives in-memory on each Vercel Function instance. Because Fluid Compute
// reuses instances, the Map persists across requests on the same warm
// instance. Vercel can scale out horizontally — so this is best-effort
// per-instance, not a truly distributed counter.
//
// This is the FIRST line of defense. The CDK stack provides the SECOND
// (Lambda reservedConcurrency cap) which IS global — so even if Vercel
// scales out and bypasses these in-memory counts, the AWS-side ceiling
// holds and protects the cost surface.
//
// To upgrade to a distributed limiter when traffic warrants:
//   1. Add Upstash Redis via Vercel Marketplace
//   2. Replace the Map below with @upstash/ratelimit sliding-window
//   3. Same API surface — drop-in replacement.

const WINDOWS = new Map(); // ip -> { count, windowStartMs }

// Cleanup old entries periodically so the Map doesn't grow forever.
// Runs every Nth call; cheaper than setInterval (which doesn't work
// reliably in serverless anyway).
let callsSinceCleanup = 0;
function maybeCleanup(nowMs) {
  if (++callsSinceCleanup < 500) return;
  callsSinceCleanup = 0;
  for (const [ip, entry] of WINDOWS) {
    // Drop entries older than the longest window (1h) by a comfortable margin
    if (nowMs - entry.windowStartMs > 90 * 60 * 1000) {
      WINDOWS.delete(ip);
    }
  }
}

/**
 * Check + record an attempt. Returns { allowed: bool, remaining: int, retryAfterSec: int }.
 *
 * @param {string} key      Identifier — typically client IP from x-forwarded-for.
 * @param {number} limit    Max requests per window.
 * @param {number} windowMs Window length in milliseconds.
 */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  maybeCleanup(now);

  // Defensive: anonymous traffic without an IP shouldn't get a free pass.
  // Treat empty key as a shared bucket — slows down requests that lack IP.
  const bucket = key || 'anonymous';

  const entry = WINDOWS.get(bucket);
  if (!entry || now - entry.windowStartMs >= windowMs) {
    WINDOWS.set(bucket, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  if (entry.count >= limit) {
    const retryAfterSec = Math.ceil((entry.windowStartMs + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, retryAfterSec: 0 };
}

/**
 * Extract a client IP from a Next.js Request. Trusts the leftmost
 * x-forwarded-for value (Vercel sets this correctly; the chain after
 * is not trustable). Falls back to a Vercel-injected IP header, then
 * to 'unknown'.
 */
export function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}
