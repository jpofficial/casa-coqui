export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const body = await request.json();
  if (!body.plan_id || !body.day_num || !body.user_request)
    return Response.json({ error: 'missing_fields' }, { status: 400 });

  const upstream = await fetch(`${process.env.MI_ITINERARIO_API_URL}/refine`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json' } });
}
