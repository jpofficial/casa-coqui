'use client';
import Link from 'next/link';

export default function AtardecerHero() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-cafe-50">
      {/* Atardecer radial glow top-right */}
      <div
        className="pointer-events-none absolute top-0 right-0 h-[500px] w-[500px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(251,224,153,0.22) 0%, transparent 70%)',
          transform: 'translate(20%, -30%)',
        }}
      />

      <div className="relative mx-auto max-w-md px-7 pt-20 pb-12 text-center">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.12em] text-atardecer-700">
          San Juan · Puerto Rico
        </p>

        <h1 className="mb-5 font-display text-4xl font-bold leading-[1.05] text-coqui-900 md:text-5xl">
          Your Puerto Rico,
          <br />
          <em className="italic text-atardecer-700">day by day.</em>
        </h1>

        <p className="mb-10 text-base leading-relaxed text-cafe-800">
          Tell us about your trip. We&apos;ll build your itinerary —
          <br />
          vetted, personal, free.
        </p>

        <Link
          href="/puerto-rico-itinerary/wizard"
          className="inline-flex w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl bg-coqui-500 px-8 py-4 font-semibold text-white shadow-[0_6px_14px_-3px_rgba(26,154,90,0.4)] transition-transform hover:scale-[1.02]"
        >
          Build my itinerary →
        </Link>

        <p className="mt-5 font-mono text-xs text-cafe-600">
          75+ vetted San Juan activities · powered by local knowledge
        </p>

        <div className="mt-12 flex flex-wrap justify-center gap-3">
          {[
            '🌿 Locally curated',
            '🆓 Always free',
            '🤝 No accounts needed',
          ].map((t) => (
            <span
              key={t}
              className="rounded-full border border-cafe-200 bg-cafe-100 px-3 py-1.5 text-xs text-cafe-800"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
