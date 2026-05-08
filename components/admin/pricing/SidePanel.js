function timeAgo(iso) {
  if (!iso) return 'unknown';
  const diffMs = Date.now() - new Date(iso).getTime();
  const hrs = Math.round(diffMs / 3_600_000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs} hrs ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatLongDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

const VERDICT_CHIP = {
  raise: 'bg-green-100 text-green-800',
  hold:  'bg-gray-100 text-gray-600',
  lower: 'bg-red-100 text-red-800',
};

export default function SidePanel({ unit, date, payload, loading, compSet }) {
  if (!date) return <div className="p-6 text-sm text-gray-500">Tap a day on the calendar.</div>;
  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (!payload) return <div className="p-6 text-sm text-gray-500">No data.</div>;

  if (!payload.has_data) {
    return (
      <div className="p-6">
        <div className="text-xs text-gray-500">{formatLongDate(date)} · {unit === 'unit-a' ? 'Unit A' : 'Unit B'}</div>
        <div className="text-4xl font-extrabold text-gray-300 mt-2">—</div>
        <p className="mt-4 text-sm text-gray-600 leading-relaxed">
          We don&apos;t have a recommendation for this night. This usually means data is older than 14 days,
          or fewer than 3 comps were captured for this date.
        </p>
        {payload.lastRun && (
          <div className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
            Last autopilot run: {timeAgo(payload.lastRun.started_at)}
          </div>
        )}
      </div>
    );
  }

  const {
    rec_nightly_rate, verdict, your_rate, tcpn_2n, demand_signal,
    confidence, reasoning = {}, lede, compsSummary, topComps, lastRun,
  } = payload;

  const delta = your_rate != null ? rec_nightly_rate - your_rate : null;
  const deltaLabel =
    delta == null ? null :
    delta > 0 ? `+$${delta}` :
    delta < 0 ? `−$${Math.abs(delta)}` :
    '$0';

  return (
    <div className="p-6">
      <div className="text-xs text-gray-500">{formatLongDate(date)} · {unit === 'unit-a' ? 'Unit A' : 'Unit B'}</div>
      <div className="flex items-baseline gap-2.5 mt-1">
        <span className="text-4xl font-extrabold tracking-tight">${rec_nightly_rate}</span>
        <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${VERDICT_CHIP[verdict] || VERDICT_CHIP.hold}`}>
          {verdict}{deltaLabel ? ` · ${deltaLabel}` : ''}
        </span>
      </div>

      {lede && (
        <div className="mt-4 p-3 bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-lg text-sm text-emerald-900 leading-relaxed">
          {lede}
        </div>
      )}

      <div className="mt-5 text-[10px] uppercase tracking-widest font-bold text-gray-400">Why this rate</div>
      <Row label="Market median (2n)" val={tcpn_2n ? `$${Math.round(tcpn_2n)}` : '—'} />
      <Row
        label="Comp availability"
        val={
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
            demand_signal === 'tight' ? 'bg-red-100 text-red-800' :
            demand_signal === 'open' ? 'bg-blue-100 text-blue-800' :
            'bg-yellow-100 text-yellow-800'
          }`}>
            {demand_signal} · {compsSummary.pct}% booked
          </span>
        }
      />
      {reasoning.trend && <Row label="Trend" val={<span className="text-green-700 font-semibold">{reasoning.trendLabel || reasoning.trend}</span>} />}
      {reasoning.weekdayMultiplier && <Row label="Weekday multiplier" val={`${reasoning.weekdayMultiplier}×`} />}
      <Row
        label="Confidence"
        val={
          <span className="flex items-center gap-2">
            {confidence}
            <span className="inline-block h-1.5 w-[110px] bg-gray-100 rounded overflow-hidden">
              <span className="block h-full bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: `${Math.min(100, confidence)}%` }} />
            </span>
          </span>
        }
      />
      {compSet && compSet.count > 0 && (
        <Row
          label="Comp set"
          val={
            <span className="text-gray-700">
              {compSet.count} listings · {compSet.minBedrooms === compSet.maxBedrooms
                ? `${compSet.minBedrooms} BR`
                : `${compSet.minBedrooms}–${compSet.maxBedrooms} BR`} · avg {compSet.avgBedrooms} BR
            </span>
          }
        />
      )}

      <div className="mt-5 text-[10px] uppercase tracking-widest font-bold text-gray-400">Comps that night</div>
      <table className="w-full text-xs mt-1">
        <tbody>
          {topComps.map(c => (
            <tr key={c.airbnb_id} className="border-b border-gray-50 last:border-0">
              <td className="py-1.5 text-gray-700">
                {c.name}
                {c.bedrooms != null && <span className="ml-1 text-gray-400">· {c.bedrooms}BR</span>}
                {c.booked && (
                  <span className="ml-1.5 text-[9px] text-red-800 bg-red-50 px-1.5 py-px rounded uppercase tracking-wide font-semibold">
                    booked
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right font-semibold">${c.nightly_rate}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {compsSummary.total > topComps.length && (
        <div className="mt-2 text-xs text-emerald-700 font-semibold">+ {compsSummary.total - topComps.length} more comps</div>
      )}

      {lastRun && (
        <div className="mt-5 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
          Snapshot {timeAgo(lastRun.started_at)} · last autopilot run
        </div>
      )}
    </div>
  );
}

function Row({ label, val }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 text-[13px]">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-900">{val}</span>
    </div>
  );
}
