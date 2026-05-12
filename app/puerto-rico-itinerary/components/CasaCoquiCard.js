'use client';
import Link from 'next/link';

export default function CasaCoquiCard({ bookingUrl }) {
  return (
    <section className="mx-5 my-8 overflow-hidden rounded-2xl border border-atardecer-200 bg-atardecer-50 shadow-[0_10px_30px_-4px_rgba(168,95,12,0.18)] md:mx-0">
      <div className="border-b border-atardecer-200 px-6 py-3 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-atardecer-700">
        ★ Where your host recommends
      </div>

      <div className="px-6 py-7 text-center lg:py-10">
        <h3 className="mb-2 font-display text-3xl font-bold leading-none text-coqui-900 lg:text-4xl">
          Casa Coqui
        </h3>

        <p className="mx-auto mb-3 max-w-md text-sm leading-relaxed text-cafe-800 lg:text-base">
          San Juan · 2 units · sleeps up to 8 · hosted by Julio.
          <br />
          Walkable to Old San Juan, beach access, fast WiFi.
        </p>

        <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.08em] text-cafe-600">
          Built by your host — same person who curated this itinerary
        </p>

        <Link
          href={bookingUrl}
          data-event-name="cc_card_check_availability"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-atardecer-400 px-8 py-4 font-semibold text-coqui-900 shadow-[0_6px_14px_-3px_rgba(245,183,49,0.5)] transition-transform hover:scale-[1.02] lg:px-10 lg:py-5 lg:text-lg"
        >
          Check availability →
        </Link>

        <p className="mt-5 text-xs">
          <Link href={bookingUrl} data-event-name="cc_card_see_photos" className="text-atardecer-700 underline decoration-atardecer-300 underline-offset-4 hover:text-coqui-900">
            See photos, amenities, and reviews
          </Link>
        </p>
      </div>
    </section>
  );
}
