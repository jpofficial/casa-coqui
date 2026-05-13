import { getItinerary, getActivitiesByIds } from '@/lib/itinerary/dynamodb';

export const runtime = 'nodejs';

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

  return Response.json({ ...itinerary, days: hydrated });
}
