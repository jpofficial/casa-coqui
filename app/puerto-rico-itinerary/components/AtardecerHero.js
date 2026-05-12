'use client';
import Link from 'next/link';

export default function AtardecerHero() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-cafe-50">
      {/* Atardecer radial glow top-right (larger on desktop) */}
      <div
        className="pointer-events-none absolute top-0 right-0 h-[500px] w-[500px] rounded-full lg:h-[900px] lg:w-[900px]"
        style={{
          background:
            'radial-gradient(circle, rgba(251,224,153,0.22) 0%, transparent 70%)',
          transform: 'translate(20%, -30%)',
        }}
      />

      {/* Second glow bottom-left, desktop only */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 hidden h-[700px] w-[700px] rounded-full lg:block"
        style={{
          background:
            'radial-gradient(circle, rgba(251,224,153,0.10) 0%, transparent 70%)',
          transform: 'translate(-30%, 30%)',
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-7 py-12 text-center md:max-w-2xl lg:max-w-6xl lg:flex-row lg:gap-16 lg:py-0 lg:text-left">
        {/* Left side / centered on mobile — main copy */}
        <div className="lg:flex-1 lg:max-w-2xl">
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.12em] text-atardecer-700 lg:text-sm">
            San Juan · Puerto Rico
          </p>

          <h1 className="mb-5 font-display text-4xl font-bold leading-[1.05] text-coqui-900 md:text-5xl lg:text-7xl lg:leading-[1.0]">
            Your Puerto Rico,
            <br />
            <em className="italic text-atardecer-700">day by day.</em>
          </h1>

          <p className="mb-10 text-base leading-relaxed text-cafe-800 lg:text-lg lg:max-w-md">
            Tell us about your trip. We&apos;ll build your itinerary —
            vetted, personal, free.
          </p>

          <div className="flex flex-col items-center gap-5 lg:items-start">
            <Link
              href="/puerto-rico-itinerary/wizard"
              className="inline-flex w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl bg-coqui-500 px-8 py-4 font-semibold text-white shadow-[0_6px_14px_-3px_rgba(26,154,90,0.4)] transition-transform hover:scale-[1.02] lg:w-auto lg:max-w-none lg:px-10 lg:py-5 lg:text-lg"
            >
              Build my itinerary →
            </Link>

            <p className="font-mono text-xs text-cafe-600">
              75+ vetted San Juan activities · powered by local knowledge
            </p>
          </div>

          <div className="mt-12 flex flex-wrap justify-center gap-3 lg:justify-start">
            {[
              '🌿 Locally curated',
              '🆓 Always free',
              '🤝 No accounts needed',
            ].map((t) => (
              <span
                key={t}
                className="rounded-full border border-cafe-200 bg-cafe-100 px-3 py-1.5 text-xs text-cafe-800 lg:text-sm lg:px-4 lg:py-2"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Right side — desktop-only "preview card" mosaic */}
        <div className="mt-16 hidden lg:mt-0 lg:flex lg:flex-1 lg:max-w-md lg:flex-col lg:gap-4">
          <div className="rounded-2xl border border-cafe-100 bg-white p-5 shadow-[0_8px_24px_-4px_rgba(7,54,32,0.08)]">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-caribe-600">
              Day 01 · Old San Juan
            </div>
            <div className="mb-2 font-display text-xl font-bold text-coqui-900">
              Forts, cobblestones, café cuatro sombras
            </div>
            <div className="space-y-2.5">
              {[
                { time: '9:00 AM', name: 'Castillo San Felipe del Morro', emoji: '🏰' },
                { time: '11:30 AM', name: 'Café Cuatro Sombras', emoji: '☕' },
                { time: '1:00 PM', name: 'Pirilo Pizza Rústica', emoji: '🍕' },
                { time: '8:00 PM', name: 'La Factoría', emoji: '🍸' },
              ].map((item) => (
                <div key={item.name} className="flex items-center gap-3 rounded-xl bg-cafe-50 p-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cafe-200 text-base">
                    {item.emoji}
                  </div>
                  <div>
                    <div className="font-mono text-[10px] text-caribe-600">{item.time}</div>
                    <div className="text-sm font-semibold text-coqui-900">{item.name}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-center font-display text-sm italic text-cafe-700">
            ↑ a sample day · yours will be tailored to you
          </p>
        </div>
      </div>
    </section>
  );
}
