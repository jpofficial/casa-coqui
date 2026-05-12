'use client';
import Link from 'next/link';

function UnitCard({ name, tagline, specs, url, eventName }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-atardecer-200 bg-white/80 p-5 text-center backdrop-blur lg:p-6">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-atardecer-700">
        {name === 'Tierra' ? '↓ Ground floor' : '↑ Upper floor'}
      </p>
      <h4 className="mb-1 font-display text-2xl font-bold text-coqui-900 lg:text-3xl">
        Casa Coqui {name}
      </h4>
      <p className="mb-3 text-sm text-cafe-700">{tagline}</p>
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em] text-cafe-600">
        {specs.map((s) => (
          <span key={s} className="rounded-full bg-cafe-100 px-3 py-1">
            {s}
          </span>
        ))}
      </div>
      <Link
        href={url}
        data-event-name={eventName}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-atardecer-400 px-6 py-3 font-semibold text-coqui-900 shadow-[0_6px_14px_-3px_rgba(245,183,49,0.5)] transition-transform hover:scale-[1.02] lg:py-4"
      >
        Check availability →
      </Link>
    </div>
  );
}

export default function CasaCoquiCard({ bookingUrl, bookingUrlTierra, bookingUrlCielo }) {
  const hasBoth = bookingUrlTierra && bookingUrlCielo;
  const fallbackUrl = bookingUrl || bookingUrlTierra || bookingUrlCielo || '/bookings';

  return (
    <section className="mx-5 my-8 overflow-hidden rounded-2xl border border-atardecer-200 bg-atardecer-50 shadow-[0_10px_30px_-4px_rgba(168,95,12,0.18)] md:mx-0">
      <div className="border-b border-atardecer-200 px-6 py-3 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-atardecer-700">
        ★ Where your host recommends
      </div>

      <div className="px-5 py-7 text-center lg:py-10">
        <h3 className="mb-2 font-display text-3xl font-bold leading-none text-coqui-900 lg:text-4xl">
          Casa Coqui
        </h3>

        <p className="mx-auto mb-2 max-w-md text-sm leading-relaxed text-cafe-800 lg:text-base">
          San Juan · 2 units · sleeps up to 8 · hosted by Julio.
        </p>
        <p className="mx-auto mb-6 max-w-md text-sm leading-relaxed text-cafe-700">
          Walkable to Old San Juan, beach access, fast WiFi.
        </p>

        <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.08em] text-cafe-600">
          Built by your host — same person who curated this itinerary
        </p>

        {hasBoth ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <UnitCard
              name="Tierra"
              tagline="The whole-family floor"
              specs={['4 bed', '1 bath', 'sleeps 6']}
              url={bookingUrlTierra}
              eventName="cc_card_check_availability_tierra"
            />
            <UnitCard
              name="Cielo"
              tagline="The couple or small-group floor"
              specs={['2 bed', '1 bath', 'sleeps 4']}
              url={bookingUrlCielo}
              eventName="cc_card_check_availability_cielo"
            />
          </div>
        ) : (
          <Link
            href={fallbackUrl}
            data-event-name="cc_card_check_availability"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-atardecer-400 px-8 py-4 font-semibold text-coqui-900 shadow-[0_6px_14px_-3px_rgba(245,183,49,0.5)] transition-transform hover:scale-[1.02] lg:px-10 lg:py-5 lg:text-lg"
          >
            Check availability →
          </Link>
        )}

        <p className="mt-6 text-xs">
          <Link
            href={fallbackUrl}
            data-event-name="cc_card_see_photos"
            className="text-atardecer-700 underline decoration-atardecer-300 underline-offset-4 hover:text-coqui-900"
          >
            See photos, amenities, and reviews →
          </Link>
        </p>
      </div>
    </section>
  );
}
