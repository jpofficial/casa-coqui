'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ActivityCard from './ActivityCard';

export default function DayCard({ day, date, plan_id }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!input.trim()) return;
    setPending(true);
    try {
      const res = await fetch('/api/plan/refine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_id, day_num: day.day_num, user_request: input.trim() }),
      });
      if (res.ok) router.refresh();
      else alert('Could not refine that day. Try again.');
    } finally {
      setPending(false);
      setOpen(false);
      setInput('');
    }
  };

  return (
    <section className="px-5 py-6">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-caribe-600">
          Day {String(day.day_num).padStart(2, '0')}
        </span>
        {date && <span className="font-mono text-xs text-cafe-600">{date}</span>}
      </div>
      <h2 className="mb-1 font-display text-2xl font-bold leading-tight text-coqui-900">
        {day.theme || `Day ${day.day_num}`}
      </h2>
      <p className="mb-3 font-display text-base italic text-cafe-700">
        {(day.items || []).length} stops
      </p>
      {day.narrative && day.narrative.trim() && (
        <p className="mb-5 max-w-[80%] border-l-2 border-coqui-200 pl-3 font-display text-[15px] italic leading-relaxed text-cafe-800">
          {day.narrative}
        </p>
      )}

      {(day.items || []).map((item, idx) => (
        <ActivityCard key={`${day.day_num}-${idx}`} item={item} />
      ))}

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 w-full rounded-xl border border-dashed border-cafe-300 px-4 py-3 font-mono text-xs uppercase tracking-[0.08em] text-cafe-700 hover:bg-cafe-100"
        >
          ↻ Swap this day
        </button>
      ) : (
        <div className="mt-3 rounded-xl bg-cafe-100 p-3">
          <textarea
            className="mb-2 w-full rounded-md border border-cafe-200 bg-white p-3 text-sm focus:border-coqui-500 focus:outline-none"
            rows={2}
            placeholder="e.g. More food, less beach. Or: focus on nightlife."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="flex-1 rounded-lg bg-coqui-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Rebuilding…' : 'Rebuild day'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-cafe-300 px-3 py-2 text-sm text-cafe-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
