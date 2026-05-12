import DayCard from '../components/DayCard';

async function fetchPlan(plan_id) {
  // Server-side fetch — runs in the same Vercel Function
  const baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/plan/${plan_id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function ItineraryPage({ params }) {
  const plan = await fetchPlan(params.plan_id);

  if (!plan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cafe-50 text-center">
        <div>
          <h2 className="font-display text-2xl font-bold text-coqui-900">
            That itinerary isn&apos;t here anymore.
          </h2>
          <p className="mt-2 text-cafe-700">
            Anonymous itineraries expire after 90 days.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-cafe-50">
      <header className="px-5 pt-12 pb-4 text-center">
        <p className="mb-1 font-mono text-xs uppercase tracking-[0.1em] text-caribe-700">
          Your trip · {plan.num_days} days
        </p>
        <h1 className="font-display text-3xl font-bold text-coqui-900">
          San Juan, planned.
        </h1>
      </header>

      {plan.is_fallback && (
        <div className="mx-5 mb-4 rounded-xl border border-atardecer-200 bg-atardecer-50 p-3 text-center text-sm text-atardecer-700">
          🌅 We had a hiccup. Showing our default 5-day plan — try again in a minute for a personalized one.
        </div>
      )}

      {(plan.days || []).map((day) => (
        <DayCard key={day.day_num} day={day} plan_id={plan.plan_id} />
      ))}

      <footer className="px-5 py-8 text-center text-xs text-cafe-600">
        plan_id: {plan.plan_id} · expires in {Math.floor((plan.ttl_epoch * 1000 - Date.now()) / 86400000)} days
      </footer>
    </main>
  );
}
