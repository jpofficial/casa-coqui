function formatMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export { addMonths };

export default function MonthNavigator({ month, onChange, todayMonth, minMonth, maxMonth }) {
  const atMin = month <= minMonth;
  const atMax = month >= maxMonth;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => !atMin && onChange(addMonths(month, -1))}
        disabled={atMin}
        className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:border-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Previous month"
      >‹</button>
      <span className="text-sm font-semibold min-w-[130px] text-center">{formatMonth(month)}</span>
      <button
        onClick={() => !atMax && onChange(addMonths(month, 1))}
        disabled={atMax}
        className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:border-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Next month"
      >›</button>
      <button
        onClick={() => onChange(todayMonth)}
        className="ml-2 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-semibold text-gray-600 hover:border-gray-300"
      >Today</button>
    </div>
  );
}
