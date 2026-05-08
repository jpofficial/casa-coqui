'use client';

import { useState, useEffect, useMemo } from 'react';
import useAuth from '@/hooks/useAuth';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatMinutes(n) {
  if (!n || n <= 0) return '0h';
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatHours(minutes) {
  if (!minutes || minutes <= 0) return '0';
  const h = minutes / 60;
  return h % 1 === 0 ? `${h}` : h.toFixed(1);
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function prevMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function nextMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function isSameMonth(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

function toDate(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  if (val.seconds) return new Date(val.seconds * 1000);
  return new Date(val);
}

function monthLabel(date, locale) {
  const lang = locale === 'es' ? 'es' : 'en';
  const name = date.toLocaleString(lang, { month: 'long' });
  return `${name.charAt(0).toUpperCase() + name.slice(1)} ${date.getFullYear()}`;
}

function shortMonthLabel(date, locale) {
  const lang = locale === 'es' ? 'es' : 'en';
  const name = date.toLocaleString(lang, { month: 'short' });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MonthNav({ selected, onPrev, onNext, locale }) {
  const now = new Date();
  const isCurrentMonth = isSameMonth(selected, now);

  return (
    <div className="flex items-center justify-between">
      <h1 className="text-lg font-bold text-gray-900">{t(locale, 'hours_title')}</h1>
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition min-h-[44px] min-w-[44px]"
          aria-label="Previous month"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-gray-700 min-w-[120px] text-center">
          {monthLabel(selected, locale)}
        </span>
        <button
          onClick={onNext}
          disabled={isCurrentMonth}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition disabled:opacity-30 disabled:pointer-events-none min-h-[44px] min-w-[44px]"
          aria-label="Next month"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function StatCard({ value, label, trend, trendLabel }) {
  const trendUp = trend > 0;
  const trendColor = trend === null || trend === undefined
    ? ''
    : trendUp
      ? 'bg-green-100 text-green-700'
      : trend < 0
        ? 'bg-red-100 text-red-700'
        : 'bg-gray-100 text-gray-500';

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col items-center text-center">
      <span className="text-2xl font-bold text-gray-900">{value}</span>
      <span className="text-xs text-gray-500 mt-0.5">{label}</span>
      {trend !== null && trend !== undefined && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1.5 ${trendColor}`}>
          {trendUp ? '↑' : trend < 0 ? '↓' : '–'}{Math.abs(trend)}%
          {trendLabel ? ` ${trendLabel}` : ''}
        </span>
      )}
    </div>
  );
}

function BarRow({ name, value, maxValue, label, sublabel, color = 'bg-green-500' }) {
  const pct = maxValue > 0 ? Math.round((value / maxValue) * 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-700 font-medium w-20 truncate flex-shrink-0">{name}</span>
      <div className="flex-1 min-w-0">
        <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
          <div
            className={`${color} rounded-full h-3 transition-all duration-500`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <span className="text-sm font-semibold text-gray-900">{label}</span>
        {sublabel && <span className="text-xs text-gray-400 ml-1">({sublabel})</span>}
      </div>
    </div>
  );
}

function SectionCard({ title, children, empty, emptyMsg }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      {empty ? (
        <p className="text-sm text-gray-400 italic">{emptyMsg}</p>
      ) : (
        <div className="space-y-2.5">{children}</div>
      )}
    </div>
  );
}

function EstVsActual({ estimated, actual, locale }) {
  if (!estimated || estimated <= 0) return null;
  const ratio = Math.round((actual / estimated) * 100);
  const isOver = actual > estimated;
  const barColor = isOver ? 'bg-amber-500' : 'bg-green-500';
  const statusLabel = isOver ? t(locale, 'hours_over_estimate') : t(locale, 'hours_under_estimate');
  const statusColor = isOver ? 'text-amber-600' : 'text-green-600';

  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{t(locale, 'hours_est_vs_actual')}</h2>
      <div className="bg-gray-100 rounded-full h-4 overflow-hidden mb-2">
        <div
          className={`${barColor} rounded-full h-4 transition-all duration-500`}
          style={{ width: `${Math.min(ratio, 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">
          {t(locale, 'hours_est_label')} {formatMinutes(estimated)} → {t(locale, 'hours_actual_label')} {formatMinutes(actual)}
        </span>
        <span className={`font-semibold ${statusColor}`}>
          {ratio}% · {statusLabel}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function HoursPage() {
  const { user, role } = useAuth();
  const isCohost = role === 'cohost';
  const canManage = role === 'admin' || isCohost;
  const { locale } = useLocale();

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => monthStart(new Date()));

  // Real-time listener — same pattern as assignments page
  useEffect(() => {
    if (!user || !role) return;

    let q;
    if (canManage) {
      q = query(collection(db, 'assignments'), orderBy('createdAt', 'desc'));
    } else {
      q = query(
        collection(db, 'assignments'),
        where('assigneeId', '==', user.uid),
        orderBy('createdAt', 'desc'),
      );
    }

    const unsub = onSnapshot(q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setAssignments(items);
        setLoading(false);
      },
      (err) => {
        console.error('[hours] listener error:', err.code, err.message);
        setLoading(false);
      },
    );

    return unsub;
  }, [user, role, canManage]);

  // Aggregation
  const stats = useMemo(() => {
    const start = monthStart(selectedMonth);
    const end = monthEnd(selectedMonth);

    // Filter: completed + has time logged + completedAt in selected month
    const inMonth = assignments.filter((a) => {
      if (a.status !== 'completed' || !a.minutesSpent || a.minutesSpent <= 0) return false;
      const completed = toDate(a.completedAt);
      if (!completed) return false;
      return completed >= start && completed <= end;
    });

    const totalMinutes = inMonth.reduce((sum, a) => sum + (a.minutesSpent || 0), 0);
    const taskCount = inMonth.length;

    // Per-person breakdown
    const personMap = {};
    for (const a of inMonth) {
      const name = a.assigneeName || 'Unassigned';
      if (!personMap[name]) personMap[name] = { name, minutes: 0, tasks: 0 };
      personMap[name].minutes += a.minutesSpent || 0;
      personMap[name].tasks += 1;
    }
    const byPerson = Object.values(personMap).sort((a, b) => b.minutes - a.minutes);

    // Per-unit breakdown
    const unitMap = {};
    for (const a of inMonth) {
      const unit = a.unit || t(locale, 'hours_general');
      if (!unitMap[unit]) unitMap[unit] = { unit, minutes: 0 };
      unitMap[unit].minutes += a.minutesSpent || 0;
    }
    const byUnit = Object.values(unitMap).sort((a, b) => b.minutes - a.minutes);

    // Est vs actual (only tasks that have both)
    let estMinutes = 0;
    let actMinutes = 0;
    for (const a of inMonth) {
      if (a.estimatedMinutes && a.estimatedMinutes > 0) {
        estMinutes += a.estimatedMinutes;
        actMinutes += a.minutesSpent || 0;
      }
    }

    // Previous month for % change
    const prevStart = monthStart(prevMonth(selectedMonth));
    const prevEnd = monthEnd(prevMonth(selectedMonth));
    const prevMonthMinutes = assignments
      .filter((a) => {
        if (a.status !== 'completed' || !a.minutesSpent || a.minutesSpent <= 0) return false;
        const completed = toDate(a.completedAt);
        if (!completed) return false;
        return completed >= prevStart && completed <= prevEnd;
      })
      .reduce((sum, a) => sum + (a.minutesSpent || 0), 0);

    const pctChange = prevMonthMinutes > 0
      ? Math.round(((totalMinutes - prevMonthMinutes) / prevMonthMinutes) * 100)
      : null;

    // Monthly trend (6 months ending at selected month)
    const trend = [];
    let cursor = new Date(selectedMonth);
    for (let i = 0; i < 6; i++) {
      const mStart = monthStart(cursor);
      const mEnd = monthEnd(cursor);
      const mins = assignments
        .filter((a) => {
          if (a.status !== 'completed' || !a.minutesSpent || a.minutesSpent <= 0) return false;
          const completed = toDate(a.completedAt);
          if (!completed) return false;
          return completed >= mStart && completed <= mEnd;
        })
        .reduce((sum, a) => sum + (a.minutesSpent || 0), 0);
      trend.push({ date: new Date(cursor), minutes: mins });
      cursor = prevMonth(cursor);
    }

    return { totalMinutes, taskCount, byPerson, byUnit, estMinutes, actMinutes, pctChange, trend };
  }, [assignments, selectedMonth, locale]);

  const maxPersonMinutes = stats.byPerson.length > 0 ? stats.byPerson[0].minutes : 0;
  const maxUnitMinutes = stats.byUnit.length > 0 ? stats.byUnit[0].minutes : 0;
  const maxTrendMinutes = Math.max(...stats.trend.map((m) => m.minutes), 1);
  const isEmpty = stats.taskCount === 0;

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-coqui-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      {/* Month navigation */}
      <MonthNav
        selected={selectedMonth}
        onPrev={() => setSelectedMonth(prevMonth(selectedMonth))}
        onNext={() => setSelectedMonth(nextMonth(selectedMonth))}
        locale={locale}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          value={formatHours(stats.totalMinutes) + 'h'}
          label={t(locale, 'hours_total')}
        />
        <StatCard
          value={stats.taskCount}
          label={t(locale, 'hours_tasks_completed')}
        />
        <StatCard
          value={stats.pctChange !== null ? `${stats.pctChange > 0 ? '+' : ''}${stats.pctChange}%` : '–'}
          label={t(locale, 'hours_vs_last_month')}
          trend={stats.pctChange}
        />
      </div>

      {isEmpty && (
        <div className="bg-white rounded-xl shadow-sm p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">{t(locale, 'hours_no_data')}</p>
        </div>
      )}

      {/* Team breakdown */}
      {!isEmpty && (
        <SectionCard title={t(locale, 'hours_team_breakdown')} empty={stats.byPerson.length === 0} emptyMsg={t(locale, 'hours_no_data')}>
          {stats.byPerson.map((p) => (
            <BarRow
              key={p.name}
              name={p.name}
              value={p.minutes}
              maxValue={maxPersonMinutes}
              label={formatMinutes(p.minutes)}
              sublabel={`${p.tasks} ${t(locale, 'hours_tasks_suffix')}`}
              color="bg-green-500"
            />
          ))}
        </SectionCard>
      )}

      {/* By unit */}
      {!isEmpty && (
        <SectionCard title={t(locale, 'hours_by_unit')} empty={stats.byUnit.length === 0} emptyMsg={t(locale, 'hours_no_data')}>
          {stats.byUnit.map((u) => (
            <BarRow
              key={u.unit}
              name={u.unit}
              value={u.minutes}
              maxValue={maxUnitMinutes}
              label={formatMinutes(u.minutes)}
              color="bg-blue-500"
            />
          ))}
        </SectionCard>
      )}

      {/* Estimated vs actual */}
      {!isEmpty && stats.estMinutes > 0 && (
        <EstVsActual estimated={stats.estMinutes} actual={stats.actMinutes} locale={locale} />
      )}

      {/* Monthly trend (6 months) */}
      {!isEmpty && (
        <SectionCard title={t(locale, 'hours_monthly_trend')} empty={false}>
          {stats.trend.map((m, i) => (
            <BarRow
              key={i}
              name={shortMonthLabel(m.date, locale)}
              value={m.minutes}
              maxValue={maxTrendMinutes}
              label={m.minutes > 0 ? formatMinutes(m.minutes) : '–'}
              color={i === 0 ? 'bg-amber-500' : 'bg-amber-300'}
            />
          ))}
        </SectionCard>
      )}
    </div>
  );
}
