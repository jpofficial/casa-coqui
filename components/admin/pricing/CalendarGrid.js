import DayCell from './DayCell';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildMonthCells(month, daysByDate) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last  = new Date(Date.UTC(y, m, 0));
  const leading = first.getUTCDay();
  const trailing = 6 - last.getUTCDay();
  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= last.getUTCDate(); d++) {
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push(daysByDate.get(dateStr) || { date: dateStr, has_data: false });
  }
  for (let i = 0; i < trailing; i++) cells.push(null);
  // Pad to a stable 42 cells so the grid height doesn't jump between months.
  while (cells.length < 42) cells.push(null);
  return cells;
}

export default function CalendarGrid({ month, days, selectedDate, todayStr, onSelect }) {
  const daysByDate = new Map(days.map(d => [d.date, d]));
  const cells = buildMonthCells(month, daysByDate);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 px-0.5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-center">
        {WEEKDAYS.map(w => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c, i) => (
          <DayCell
            key={i}
            day={c}
            selected={c && c.date === selectedDate}
            isToday={c && c.date === todayStr}
            isPast={c && c.date < todayStr}
            onClick={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
