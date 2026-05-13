import { rateLimit, clientIp } from '@/lib/itinerary/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Refine is per-day rebuild — cheaper than full generate but still a Bedrock
// call. Cap at 20/hr per IP to allow legitimate iteration on a multi-day trip
// without enabling abuse.
const REFINE_LIMIT = 20;
const REFINE_WINDOW_MS = 60 * 60 * 1000;

// Same sanitizer used in /generate. Inlined here to avoid a separate import
// dependency on a tiny string transform.
function sanitizeFreeText(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, 1000);
  let prev;
  do { prev = s; s = s.replace(/<[^>]*>?/g, ''); } while (s !== prev);
  s = s.replace(/\bon\w+\s*=\s*(['"]?)[^'">\s]*\1/gi, '');
  s = s.replace(/javascript:/gi, '');
  s = s.replace(/data:[^,;]*;?base64/gi, '');
  s = s.replace(/\b(human|assistant|system)\s*:/gi, '$1');
  s = s.replace(/<\|[a-z_]+\|>/gi, '');
  s = s.replace(/^#{2,}\s*/gm, '');
  s = s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  s = s.replace(/[  ]/g, '\n');
  s = s.replace(/[​-‏‪-‮⁦-⁩﻿]/g, '');
  return s.trim();
}

export async function POST(request) {
  const ip = clientIp(request);
  const limit = rateLimit(ip, REFINE_LIMIT, REFINE_WINDOW_MS);
  if (!limit.allowed) {
    return Response.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'retry-after': String(limit.retryAfterSec),
          'x-ratelimit-limit': String(REFINE_LIMIT),
          'x-ratelimit-remaining': '0',
        },
      }
    );
  }

  const body = await request.json();
  if (!body.plan_id || !body.day_num || !body.user_request)
    return Response.json({ error: 'missing_fields' }, { status: 400 });

  // Sanitize free-text — refine takes a user_request field that goes into Bedrock.
  body.user_request = sanitizeFreeText(body.user_request);
  if (!body.user_request) {
    return Response.json({ error: 'invalid_user_request' }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${process.env.MI_ITINERARIO_API_URL}/refine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('refine failed:', err.message);
    return Response.json({ error: 'refine_unavailable' }, { status: 503 });
  }
}
