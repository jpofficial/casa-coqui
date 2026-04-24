const VERDICT_CHIP = {
  raise: 'bg-green-100 text-green-800',
  hold:  'bg-gray-100 text-gray-600',
  lower: 'bg-red-100 text-red-800',
};

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  return dow === 5 || dow === 6 || dow === 0;
}

export default function DayCell({ day, selected, isToday, isPast, onClick }) {
  if (!day) {
    return <div className="aspect-[1/1.1] rounded-lg border border-gray-100 bg-white opacity-[0.32]" />;
  }

  const { date, rec_nightly_rate, verdict, has_data } = day;
  const dayNum = Number(date.slice(8, 10));
  const weekend = isWeekend(date);

  return (
    <button
      type="button"
      onClick={() => onClick(date)}
      className={[
        'text-left rounded-lg border p-2 min-h-[82px] flex flex-col justify-between',
        'transition hover:border-gray-300 hover:-translate-y-[1px]',
        weekend ? 'bg-gray-50' : 'bg-white',
        !has_data ? 'bg-gray-50/60' : '',
        isPast ? 'opacity-60' : '',
        selected
          ? 'border-green-600 bg-green-50 ring-2 ring-green-600/15'
          : 'border-gray-100',
      ].join(' ')}
    >
      <span className={`text-[11px] font-semibold ${isToday ? 'text-green-600' : 'text-gray-500'}`}>
        {dayNum}
      </span>
      {has_data ? (
        <span className="text-base font-bold text-gray-900 leading-none">${rec_nightly_rate}</span>
      ) : (
        <span className="text-sm font-semibold text-gray-300 leading-none">—</span>
      )}
      {has_data && verdict ? (
        <span className={`self-start text-[9px] uppercase tracking-wide font-semibold px-1.5 py-px rounded ${VERDICT_CHIP[verdict] || VERDICT_CHIP.hold}`}>
          {verdict}
        </span>
      ) : <span />}
    </button>
  );
}
