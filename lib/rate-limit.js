/**
 * Simple in-memory rate limiter for API routes.
 *
 * Each key tracks timestamps of recent requests. Old entries are pruned on
 * every call so the Map never grows unbounded. Resets on cold start, which
 * is acceptable for a small-scale property app.
 *
 * Usage:
 *   const limiter = createRateLimiter({ maxRequests: 5, windowMs: 15 * 60 * 1000 });
 *   const { limited } = limiter.check(userId);
 *   if (limited) return 429;
 */

export function createRateLimiter({ maxRequests, windowMs }) {
  const hits = new Map(); // key → [timestamps]

  return {
    /**
     * @param {string} key — typically a user UID
     * @returns {{ limited: boolean, remaining: number }}
     */
    check(key) {
      const now = Date.now();
      const cutoff = now - windowMs;

      // Get existing timestamps and prune old ones
      const timestamps = (hits.get(key) || []).filter((t) => t > cutoff);

      if (timestamps.length >= maxRequests) {
        hits.set(key, timestamps);
        return { limited: true, remaining: 0 };
      }

      timestamps.push(now);
      hits.set(key, timestamps);
      return { limited: false, remaining: maxRequests - timestamps.length };
    },
  };
}
