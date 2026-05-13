// User-initiated PII removal.
//
// Anonymous-product threat model: the URL IS the ownership token, same
// pattern as Pastebin, anonymous Imgur uploads, etc. Anyone holding a
// plan_id can delete it. Acceptable for v1 because:
//   - 10-char nanoid = ~60 bits entropy; enumeration is computationally
//     infeasible (~10^18 namespace).
//   - Shared URLs are an explicit trust act by the original creator.
//   - The free-text "special_requests" field can contain PII (dietary
//     constraints, anniversaries, etc.), so the ability to delete is a
//     hard privacy requirement that beats the share-link abuse risk.
//
// When Plan 7 (AI Companion) adds persistent identity, this endpoint
// will be extended to require the auth claim to match the itinerary's
// guest_id field.
//
// Rate-limited: 10 deletes/IP/hr. Generous enough for "I changed my
// mind, regenerate" patterns; tight enough to make enumeration-style
// griefing expensive.

import { deleteItinerary } from '@/lib/itinerary/dynamodb';
import { rateLimit, clientIp } from '@/lib/itinerary/rate-limit';

export const runtime = 'nodejs';

const DELETE_LIMIT = 10;
const DELETE_WINDOW_MS = 60 * 60 * 1000;

async function handleDelete(request, { params }) {
  const ip = clientIp(request);
  const limit = rateLimit(ip, DELETE_LIMIT, DELETE_WINDOW_MS);
  if (!limit.allowed) {
    return Response.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'retry-after': String(limit.retryAfterSec),
          'x-ratelimit-limit': String(DELETE_LIMIT),
          'x-ratelimit-remaining': '0',
        },
      }
    );
  }

  const plan_id = params?.plan_id;
  if (!plan_id || typeof plan_id !== 'string' || plan_id.length < 4 || plan_id.length > 32) {
    return Response.json({ error: 'invalid_plan_id' }, { status: 400 });
  }

  try {
    const { deleted } = await deleteItinerary(plan_id);
    if (!deleted) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    // AccessDeniedException, ProvisionedThroughputExceededException, etc.
    // Do NOT echo err.message to the client — could leak AWS internals.
    console.error('delete itinerary failed:', err?.message || err);
    return Response.json({ error: 'delete_unavailable' }, { status: 503 });
  }
}

// Accept both DELETE (RESTful) and POST (some clients/CSPs block DELETE).
export async function DELETE(request, ctx) {
  return handleDelete(request, ctx);
}

export async function POST(request, ctx) {
  return handleDelete(request, ctx);
}
