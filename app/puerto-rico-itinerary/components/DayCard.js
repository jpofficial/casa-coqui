'use client';
import ActivityCard from './ActivityCard';

export default function DayCard({ day, date }) {
  return (
    <section className="px-5 py-6">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-caribe-600">
          Day {String(day.day_num).padStart(2, '0')}
        </span>
        {date && (
          <span className="font-mono text-xs text-cafe-600">{date}</span>
        )}
      </div>
      <h2 className="mb-1 font-display text-2xl font-bold leading-tight text-coqui-900">
        {day.theme || `Day ${day.day_num}`}
      </h2>
      <p className="mb-5 font-display text-base italic text-cafe-700">
        {(day.items || []).length} stops
      </p>

      {(day.items || []).map((item, idx) => (
        <ActivityCard key={`${day.day_num}-${idx}`} item={item} />
      ))}
    </section>
  );
}
