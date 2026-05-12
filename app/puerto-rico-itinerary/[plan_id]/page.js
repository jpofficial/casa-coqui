import DayCard from '../components/DayCard';
import WhereToStayPanel from '../components/WhereToStayPanel';
import TipJar from '../components/TipJar';
import { casaCoquiFits } from '@/lib/itinerary/persona-fit';
import { getItinerary, getActivitiesByIds } from '@/lib/itinerary/dynamodb';

export const dynamic = 'force-dynamic';

async function fetchPlan(plan_id) {
  // Direct DDB read from the server component. Skipping an internal
  // /api round-trip avoids Vercel Deployment Protection 401s on previews
  // and removes an unnecessary network hop in production.
  try {
    const itinerary = await getItinerary(plan_id);
    if (!itinerary) return null;
    const allIds = (itinerary.days || []).flatMap((d) =>
      (d.items || []).map((i) => i.activity_id)
    );
    const activities = await getActivitiesByIds([...new Set(allIds)]);
    const byId = Object.fromEntries(activities.map((a) => [a.activity_id, a]));
    return {
      ...itinerary,
      days: (itinerary.days || []).map((d) => ({
        ...d,
        items: (d.items || []).map((it) => ({
          ...it,
          activity: byId[it.activity_id] || null,
        })),
      })),
    };
  } catch (err) {
    console.error('[itinerary page] fetchPlan failed', { plan_id, err: err?.message });
    return null;
  }
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

  const numDays = plan.num_days || (plan.days || []).length;

  return (
    <main className="min-h-screen bg-cafe-50">
      <div className="mx-auto max-w-md md:max-w-2xl lg:max-w-3xl">
        <header className="px-5 pt-12 pb-4 text-center lg:pt-20 lg:pb-8">
          <p className="mb-1 font-mono text-xs uppercase tracking-[0.1em] text-caribe-700 lg:text-sm">
            Your trip · {numDays} days
          </p>
          <h1 className="font-display text-3xl font-bold text-coqui-900 lg:text-6xl">
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

        {(() => {
          const { fit } = casaCoquiFits(plan);
          const bookingUrl = process.env.CASA_COQUI_BOOKING_URL || '/bookings';
          return (
            <WhereToStayPanel
              bookingUrl={bookingUrl}
              includeCard={fit}
            />
          );
        })()}

        <TipJar bmcUsername={process.env.NEXT_PUBLIC_BMC_USERNAME} />

        <footer className="px-5 py-8 text-center text-xs text-cafe-600">
          plan_id: {plan.plan_id}
          {plan.ttl_epoch && ` · expires in ${Math.floor((plan.ttl_epoch * 1000 - Date.now()) / 86400000)} days`}
        </footer>
      </div>
    </main>
  );
}
