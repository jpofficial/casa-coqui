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
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('proxy /generate failed:', err);
    return Response.json({ error: 'upstream_unavailable' }, { status: 502 });
  }
}
