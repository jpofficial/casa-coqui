import { getItinerary, getActivitiesByIds } from '@/lib/itinerary/dynamodb';

export const runtime = 'nodejs';

// Fields safe to return to anyone with a plan_id. Anything else (free-text
// self-disclosure, internal flags) MUST stay out — plan_ids are only
// 10 chars of nanoid, treated as a low-entropy share token, not a secret.
const PUBLIC_FIELDS = ['plan_id', 'num_days', 'traveler_type', 'pace', 'days', 'interests'];

export async function GET(_request, { params }) {
  const { plan_id } = params;
  const itinerary = await getItinerary(plan_id);
  if (!itinerary) return Response.json({ error: 'not_found' }, { status: 404 });

  // Hydrate activity_ids → full activity records
  const allIds = (itinerary.days || []).flatMap((d) => (d.items || []).map((i) => i.activity_id));
  const activities = await getActivitiesByIds([...new Set(allIds)]);
  const byId = Object.fromEntries(activities.map((a) => [a.activity_id, a]));

  const hydrated = (itinerary.days || []).map((d) => ({
    ...d,
    items: (d.items || []).map((it) => ({ ...it, activity: byId[it.activity_id] || null })),
  }));

  // Whitelist response fields — never spread the raw itinerary; that would
  // leak the user's free-text self-disclosure to anyone with the plan_id.
  const payload = Object.fromEntries(
    PUBLIC_FIELDS.map((k) => [k, k === 'days' ? hydrated : itinerary[k]])
  );

  return Response.json(payload);
}
