import { nanoid } from 'nanoid';
import { FALLBACK_PLAN } from '@/lib/itinerary/fallback-template';
import { ItinerarySchema } from '@/lib/itinerary/schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const body = await request.json();
  if (!Array.isArray(body.interests) || body.interests.length === 0)
    return Response.json({ error: 'interests_required' }, { status: 400 });
  if (!Number.isInteger(body.num_days) || body.num_days < 1 || body.num_days > 14)
    return Response.json({ error: 'invalid_num_days' }, { status: 400 });

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
      console.error('AI output schema violation:', validated.error.format());
      throw new Error('schema_mismatch');
    }
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error('generate fallback triggered:', err.message);
    return Response.json(
      { plan_id: `fb-${nanoid(8)}`, ...FALLBACK_PLAN, _fallback_reason: err.message },
      { status: 200 }
    );
  }
}
