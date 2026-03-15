/**
 * Centralized app URL resolution.
 *
 * Resolution order (server-side, with request):
 *   1. NEXT_PUBLIC_APP_URL env var (if set and not localhost in production)
 *   2. Request headers (x-forwarded-proto + host)
 *   3. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL (auto-provided by Vercel)
 *
 * Resolution order (no request / client-side):
 *   1. NEXT_PUBLIC_APP_URL env var
 *   2. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL
 *   3. localhost:3000 (development only)
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function isLocalhost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return url.includes('localhost') || url.includes('127.0.0.1');
  }
}

/**
 * Get the canonical app URL. Pass the incoming `Request` object when calling
 * from an API route so the helper can read request headers as a fallback.
 *
 * @param {Request} [request] - Optional incoming request (API routes)
 * @returns {string} Absolute base URL without trailing slash
 */
export function getAppUrl(request) {
  // 1. Explicit env var (highest priority)
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl && !(IS_PRODUCTION && isLocalhost(envUrl))) {
    return envUrl.replace(/\/+$/, '');
  }

  // 2. Derive from request headers (server-side API routes)
  if (request?.headers) {
    const host =
      (typeof request.headers.get === 'function'
        ? request.headers.get('x-forwarded-host') || request.headers.get('host')
        : request.headers['x-forwarded-host'] || request.headers['host']) || '';

    if (host && !(IS_PRODUCTION && isLocalhost(`http://${host}`))) {
      const proto =
        (typeof request.headers.get === 'function'
          ? request.headers.get('x-forwarded-proto')
          : request.headers['x-forwarded-proto']) || 'https';
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  }

  // 3. Vercel-provided env vars
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) {
    return `https://${vercelProd}`.replace(/\/+$/, '');
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl}`.replace(/\/+$/, '');
  }

  // 4. Development fallback (never in production)
  if (!IS_PRODUCTION) {
    return 'http://localhost:3000';
  }

  // Production with no resolvable URL — log a warning and fall back to the
  // canonical production domain so links are never broken. Fix by setting
  // NEXT_PUBLIC_APP_URL=https://casa-coqui.com in your Vercel environment.
  console.error(
    '[getAppUrl] CRITICAL: No production app URL could be resolved. ' +
      'Set NEXT_PUBLIC_APP_URL in your Vercel environment variables. ' +
      'Falling back to https://casa-coqui.com'
  );
  return 'https://casa-coqui.com';
}
