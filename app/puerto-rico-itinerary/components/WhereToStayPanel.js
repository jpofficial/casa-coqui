'use client';
import CasaCoquiCard from './CasaCoquiCard';

const NEIGHBORHOODS = [
  {
    name: 'Old San Juan',
    pitch: 'Walkable cobblestones · 5 min to El Morro · historic, lively, no parking',
    price: '$$',
    type: 'mix: boutique hotels + Airbnbs',
  },
  {
    name: 'Condado',
    pitch: 'Beachfront hotels · upscale dining · 10 min Uber to OSJ',
    price: '$$$',
    type: 'big hotels (Marriott, Vanderbilt, La Concha)',
  },
  {
    name: 'Isla Verde',
    pitch: 'Resort feel · long beach · 15 min Uber to OSJ · airport-adjacent',
    price: '$$$$',
    type: 'resorts (Ritz, Fairmont)',
  },
  {
    name: 'Santurce',
    pitch: 'Art district · best restaurants · cheaper · 10 min Uber to OSJ',
    price: '$$',
    type: 'boutique + Airbnbs',
  },
];

export default function WhereToStayPanel({ bookingUrl, bookingUrlTierra, bookingUrlCielo, includeCard = true }) {
  return (
    <section className="mt-12">
      {includeCard && (
        <CasaCoquiCard
          bookingUrl={bookingUrl}
          bookingUrlTierra={bookingUrlTierra}
          bookingUrlCielo={bookingUrlCielo}
        />
      )}

      <div className="mx-5 mb-8 md:mx-0">
        <h2 className="mb-1 text-center font-display text-2xl font-bold text-coqui-900 lg:text-3xl">
          Where to stay in San Juan
        </h2>
        <p className="mb-6 text-center text-sm text-cafe-700 lg:text-base">
          A quick honest read on the main neighborhoods — Casa Coqui sits in the city with easy access to all of them.
        </p>

        <div className="space-y-3">
          {NEIGHBORHOODS.map((n) => (
            <div
              key={n.name}
              className={`rounded-2xl border p-4 ${
                n.is_casa_coqui
                  ? 'border-atardecer-300 bg-atardecer-50/50'
                  : 'border-cafe-100 bg-white'
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="font-display text-lg font-semibold text-coqui-900">
                  {n.name}
                  {n.is_casa_coqui && (
                    <span className="ml-2 inline-block rounded-full bg-atardecer-300 px-2 py-0.5 align-middle font-mono text-[10px] uppercase tracking-[0.08em] text-coqui-900">
                      ↑ Casa Coqui
                    </span>
                  )}
                </h3>
                <span className="font-mono text-sm text-cafe-700">{n.price}</span>
              </div>
              <p className="text-sm text-cafe-800">{n.pitch}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-cafe-600">
                {n.type}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
