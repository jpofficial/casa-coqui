import { nanoid } from 'nanoid';
import { FALLBACK_PLAN } from '@/lib/itinerary/fallback-template';
import { ItinerarySchema } from '@/lib/itinerary/schema';
import { rateLimit, clientIp } from '@/lib/itinerary/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Per-IP cap. 5 generations/hr is comfortably above legitimate use
// (most users build one itinerary) but caps cost-amplification at
// ~$0.05 per IP per hour at current Bedrock pricing.
const GEN_LIMIT = 5;
const GEN_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Defense-in-depth sanitizer for free-text input.
// Layer 1 of 2 (Lambda has an independent backstop).
//
// - Hard cap: 1000 chars (client caps at 500; this is the server backstop).
// - Repeated tag-strip until stable — defeats `<img<x>src=x onerror=…>`
//   bypass where one pass leaves a partial tag intact.
// - Belt-and-suspenders strip of on* handlers and javascript:/data:base64 URIs
//   in case any tag fragment survives.
// - Strip ASCII control chars (keep \n, \t).
// - Normalize unicode line/paragraph separators (U+2028, U+2029).
// - Strip zero-width + bidi-override chars used to hide payloads from review.
// - Strip LLM role markers ("Human:", "Assistant:", "<|im_*|>") that could
//   pivot the model's context in the downstream Bedrock prompt.
//
// Does NOT detect general prompt-injection text by content matching —
// that's handled in the Lambda by wrapping input in nonce-delimited
// <user_input> tags with explicit untrusted-data framing.
function sanitizeFreeText(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, 1000);

  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>?/g, '');
  } while (s !== prev);

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
  // Rate limit BEFORE parsing body — body parsing is cheap but we want the
  // 429 path to spend the absolute minimum on an attacker.
  const ip = clientIp(request);
  const limit = rateLimit(ip, GEN_LIMIT, GEN_WINDOW_MS);
  if (!limit.allowed) {
    return Response.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'retry-after': String(limit.retryAfterSec),
          'x-ratelimit-limit': String(GEN_LIMIT),
          'x-ratelimit-remaining': '0',
        },
      }
    );
  }

  const body = await request.json();
  if (!Array.isArray(body.interests) || body.interests.length === 0)
    return Response.json({ error: 'interests_required' }, { status: 400 });
  if (!Number.isInteger(body.num_days) || body.num_days < 1 || body.num_days > 14)
    return Response.json({ error: 'invalid_num_days' }, { status: 400 });

  if (body.special_requests) {
    body.special_requests = sanitizeFreeText(body.special_requests);
    if (!body.special_requests) delete body.special_requests;
  }

  try {
    const upstream = await fetch(`${process.env.MI_ITINERARIO_API_URL}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const text = await upstream.text();
    const parsed = JSON.parse(text);
    const validated = ItinerarySchema.safeParse(parsed);
    if (!validated.success) {
      console.error(
        'AI output schema violation:',
        JSON.stringify(validated.error.issues, null, 2)
      );
      console.error(
        'AI raw output (first 1500 chars):',
        JSON.stringify(parsed).slice(0, 1500)
      );
      throw new Error('schema_mismatch');
    }
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    // Do not echo internal error text to the client — generic message only.
    console.error('generate fallback triggered:', err.message);
    return Response.json(
      { plan_id: `fb-${nanoid(8)}`, ...FALLBACK_PLAN, _fallback_reason: 'generation_unavailable' },
      { status: 200 }
    );
  }
}
