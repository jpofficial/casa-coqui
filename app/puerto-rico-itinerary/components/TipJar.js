'use client';

const TIERS = [
  { emoji: '☕', label: 'Cafecito', amount: 1 },
  { emoji: '☕☕', label: 'Café con leche', amount: 3 },
  { emoji: '☕☕☕', label: 'Pinta de Medalla', amount: 5 },
];

export default function TipJar({ bmcUsername }) {
  if (!bmcUsername) return null;
  const baseUrl = `https://www.buymeacoffee.com/${bmcUsername}`;

  return (
    <section className="mx-5 my-10 rounded-2xl border-t border-cafe-200 bg-cafe-100 px-6 py-8 text-center md:mx-0">
      <h3 className="mb-2 font-display text-xl italic text-coqui-900 lg:text-2xl">
        ¿Te ayudó este itinerario?
      </h3>
      <p className="mx-auto mb-6 max-w-md text-sm leading-relaxed text-cafe-700 lg:text-base">
        Invítame un cafecito — every dollar helps me keep this free for the next traveler.
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        {TIERS.map((t) => (
          <a
            key={t.label}
            href={`${baseUrl}?amount=${t.amount}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-cafe-300 bg-white px-4 py-2.5 text-sm font-medium text-coqui-900 transition-colors hover:bg-atardecer-100 hover:border-atardecer-300"
          >
            <span>{t.emoji}</span>
            <span>{t.label}</span>
            <span className="font-mono text-xs text-cafe-600">${t.amount}</span>
          </a>
        ))}
      </div>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.08em] text-cafe-600">
        100% goes toward keeping this app free + ad-free
      </p>
    </section>
  );
}
