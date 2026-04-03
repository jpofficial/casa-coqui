'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { collection, query, where, orderBy, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { getUnitNames, getUnitPalette } from '@/lib/units';
import JobForum from './JobForum';

// ─── Constants ───────────────────────────────────────────────────────────────

const HIDDEN_STATUSES = new Set(['deleted', 'archived', 'cancelled']);

// Genuinely in-progress (cleaner is working on-site)
const IN_PROGRESS = new Set([
  'en_route', 'arrived', 'before_photos',
  'cleaning', 'after_photos', 'laundry_check',
]);

// Status badge config: i18n key + visual styling
const STATUS_CFG = {
  scheduled:     { key: 'cleaner_scheduled',  bg: 'bg-cafe-100',     text: 'text-cafe-600' },
  acknowledged:  { key: 'cleaner_confirmed',  bg: 'bg-caribe-50',    text: 'text-caribe-700' },
  declined:      { key: 'cleaner_declined',   bg: 'bg-flamboyan-50', text: 'text-flamboyan-600' },
  en_route:      { key: 'cleaner_inProgress', bg: 'bg-coqui-50',    text: 'text-coqui-700' },
  arrived:       { key: 'cleaner_inProgress', bg: 'bg-coqui-50',    text: 'text-coqui-700' },
  before_photos: { key: 'cleaner_inProgress', bg: 'bg-coqui-50',    text: 'text-coqui-700' },
  cleaning:      { key: 'cleaner_inProgress', bg: 'bg-coqui-50',    text: 'text-coqui-700' },
  after_photos:  { key: 'cleaner_inProgress', bg: 'bg-coqui-50',    text: 'text-coqui-700' },
  laundry_check: { key: 'cleaner_inProgress', bg: 'bg-coqui-50',    text: 'text-coqui-700' },
  completed:     { key: 'cleaner_done',       bg: 'bg-coqui-50/50', text: 'text-coqui-500' },
};

// Unit-specific colors (indexed by unit position)
// Unit 0 (Coqui Tierra) = green, Unit 1 (Coqui Cielo) = blue
const UNIT_BORDER = ['border-l-coqui-500', 'border-l-caribe-500'];
const UNIT_DOT = ['bg-coqui-500', 'bg-caribe-500'];
const UNIT_DOT_LIGHT = ['bg-coqui-400', 'bg-caribe-400'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function getGreeting(locale) {
  const hour = new Date().getHours();
  if (hour < 12) return t(locale, 'goodMorning');
  if (hour < 18) return t(locale, 'goodAfternoon');
  return t(locale, 'goodEvening');
}

function formatDateFull(locale, dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  } catch { return dateStr; }
}

function formatMonthDay(locale, dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', {
      month: 'short', day: 'numeric',
    });
  } catch { return dateStr; }
}

function getDateLabel(locale, dateStr) {
  if (dateStr === todayStr()) return t(locale, 'today');
  if (dateStr === tomorrowStr()) return t(locale, 'cleaner_tomorrow');
  return formatDateFull(locale, dateStr);
}

function uIdx(unit, unitNames) {
  const i = unitNames.indexOf(unit);
  return i >= 0 ? i : 0;
}

// ─── Status Summary ─────────────────────────────────────────────────────────

function StatusSummary({ jobs, locale }) {
  const today = todayStr();
  const todayCount = jobs.filter(j => j.scheduledDate === today && j.status !== 'completed').length;
  const newCount = jobs.filter(j => j.status === 'scheduled').length;
  const activeCount = jobs.filter(j => IN_PROGRESS.has(j.status)).length;

  const parts = [];
  if (todayCount > 0) parts.push(`${todayCount} ${t(locale, 'today').toLowerCase()}`);
  if (newCount > 0) parts.push(`${newCount} ${t(locale, 'cleaner_scheduled').toLowerCase()}`);
  if (activeCount > 0) parts.push(`${activeCount} ${t(locale, 'cleaner_inProgress').toLowerCase()}`);

  if (parts.length === 0) return null;
  return <p className="text-[13px] text-coqui-800/40 font-medium mt-0.5">{parts.join(' \u00B7 ')}</p>;
}

// ─── Job Row ─────────────────────────────────────────────────────────────────
// Compact, information-dense row. Tapping opens the appropriate view
// (bottom sheet for scheduled/acknowledged/declined, JobForum for active/done).

function JobRow({ job, locale, unitNames, onTap, showDate }) {
  const idx = uIdx(job.unit, unitNames);
  const borderCls = UNIT_BORDER[idx] || 'border-l-gray-300';
  const dotCls = UNIT_DOT[idx] || 'bg-gray-400';
  const cfg = STATUS_CFG[job.status] || { key: job.status, bg: 'bg-gray-100', text: 'text-gray-600' };

  return (
    <button
      onClick={() => onTap(job)}
      className={`w-full flex items-center gap-3 pl-3 pr-3.5 py-3 bg-white rounded-xl
        border border-cafe-100/80 border-l-[3px] ${borderCls}
        active:bg-cafe-50/40 transition-colors text-left`}
    >
      {/* Unit + metadata */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`} />
          {showDate ? (
            <>
              <span className="text-[13px] font-semibold text-coqui-800 truncate">
                {getDateLabel(locale, job.scheduledDate)}
              </span>
              <span className="text-[11px] text-coqui-800/35">{job.unit}</span>
            </>
          ) : (
            <span className="text-[13px] font-semibold text-coqui-800 truncate">{job.unit}</span>
          )}
          {job.sameDayArrival && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-amber-500 flex-shrink-0">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 ml-4">
          {job.checkoutTime && (
            <span className="text-[11px] text-coqui-800/35">{job.checkoutTime}</span>
          )}
          {job.turnoverNotes && (
            <>
              {job.checkoutTime && <span className="text-coqui-800/15">&middot;</span>}
              <span className="text-[11px] text-coqui-800/30 truncate">{job.turnoverNotes}</span>
            </>
          )}
        </div>
      </div>

      {/* Badge + chevron */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
          {t(locale, cfg.key)}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5 text-coqui-800/20">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </button>
  );
}

// ─── Job Sheet (Bottom Sheet) ────────────────────────────────────────────────
// Contextual action area for scheduled/acknowledged/declined jobs.
// Active + completed jobs bypass the sheet and open JobForum directly.

function JobSheet({ job, locale, unitNames, onClose, onOpenForum }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const palette = getUnitPalette(job.unit, unitNames);
  const isScheduled = job.status === 'scheduled';
  const isConfirmed = job.status === 'acknowledged';
  const isDeclined = job.status === 'declined';

  async function apiCall(body) {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`/api/cleaning/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      const data = await apiCall({ status: 'acknowledged' });
      if (data.success) onClose();
    } catch (err) { console.error('Confirm failed:', err); }
    finally { setBusy(false); }
  }

  async function handleStart() {
    setBusy(true);
    try {
      const data = await apiCall({ status: 'arrived' });
      if (data.success) { onClose(); onOpenForum(job); }
    } catch (err) { console.error('Start failed:', err); }
    finally { setBusy(false); }
  }

  async function handleDecline() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const data = await apiCall({ status: 'declined', declineReason: reason.trim() });
      if (data.success) onClose();
    } catch (err) { console.error('Decline failed:', err); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-2xl shadow-xl max-h-[70vh] overflow-y-auto animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-cafe-200" />
        </div>

        {/* Unit accent strip */}
        <div className={`h-1 mx-5 rounded-full ${palette.accent}`} />

        <div className="px-5 py-4 space-y-4">
          {/* Job info */}
          <div>
            <h3 className="text-base font-bold text-coqui-800">{job.unit}</h3>
            <p className="text-sm text-coqui-800/45 mt-0.5">
              {getDateLabel(locale, job.scheduledDate)}
              {job.checkoutTime ? ` \u00B7 ${job.checkoutTime}` : ''}
            </p>
          </div>

          {job.sameDayArrival && (
            <div className="flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              {t(locale, 'sameDayArrival')}
            </div>
          )}

          {job.turnoverNotes && (
            <p className="text-sm text-coqui-800/50 bg-cafe-50 rounded-lg px-3 py-2">{job.turnoverNotes}</p>
          )}

          {isDeclined && job.declineReason && (
            <p className="text-sm text-flamboyan-700 bg-flamboyan-50 rounded-lg px-3 py-2">{job.declineReason}</p>
          )}

          {/* Scheduled — Confirm / Decline */}
          {isScheduled && !declining && (
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="flex-1 text-sm font-semibold py-3 rounded-xl bg-coqui-600 text-white
                  active:bg-coqui-700 disabled:opacity-50 transition-colors"
              >
                {busy ? t(locale, 'sending') : t(locale, 'confirmCleaning')}
              </button>
              <button
                onClick={() => setDeclining(true)}
                disabled={busy}
                className="flex-1 text-sm font-semibold py-3 rounded-xl bg-flamboyan-50 text-flamboyan-600
                  active:bg-flamboyan-100 disabled:opacity-50 transition-colors"
              >
                {t(locale, 'declineCleaning')}
              </button>
            </div>
          )}

          {/* Decline reason */}
          {declining && (
            <div className="space-y-3 pt-1">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t(locale, 'reasonRequired')}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-3
                  focus:outline-none focus:ring-2 focus:ring-flamboyan-200 focus:border-flamboyan-300
                  placeholder:text-gray-400"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={handleDecline}
                  disabled={!reason.trim() || busy}
                  className="flex-1 text-sm font-semibold py-3 rounded-xl bg-flamboyan-600 text-white
                    disabled:opacity-50 transition-colors"
                >
                  {busy ? t(locale, 'sending') : t(locale, 'submitDeclineShort')}
                </button>
                <button
                  onClick={() => { setDeclining(false); setReason(''); }}
                  className="w-12 flex items-center justify-center rounded-xl border border-cafe-200
                    text-coqui-800/40 active:bg-cafe-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Acknowledged — Start Cleaning */}
          {isConfirmed && (
            <button
              onClick={handleStart}
              disabled={busy}
              className="w-full text-sm font-semibold py-3 rounded-xl bg-coqui-600 text-white
                active:bg-coqui-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              {busy ? t(locale, 'sending') : t(locale, 'cleaner_startCleaning')}
            </button>
          )}
        </div>
        <div className="h-8" />
      </div>
    </div>
  );
}

// ─── Unit Legend ──────────────────────────────────────────────────────────────

function UnitLegend({ unitNames }) {
  return (
    <div className="flex items-center justify-center gap-4">
      {unitNames.map((name, i) => (
        <div key={name} className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full ${UNIT_DOT[i] || 'bg-gray-400'}`} />
          <span className="text-[11px] font-medium text-coqui-800/50">{name}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Calendar View (Month Grid) ──────────────────────────────────────────────
// Month grid with unit-colored dots per day. Tapping a day shows jobs below.

function CalendarView({ jobs, locale, unitNames, onTap }) {
  const [selectedDate, setSelectedDate] = useState(null);
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Index jobs by date → unit indices for dot rendering
  const jobsByDate = useMemo(() => {
    const map = {};
    jobs.forEach(j => {
      if (!j.scheduledDate) return;
      if (!map[j.scheduledDate]) map[j.scheduledDate] = [];
      map[j.scheduledDate].push(j);
    });
    return map;
  }, [jobs]);

  const { year, month } = viewMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Mon = 0
  const daysInMonth = lastDay.getDate();

  const monthLabel = firstDay.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', {
    month: 'long', year: 'numeric',
  });

  const dayHeaders = locale === 'es'
    ? ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']
    : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  const today = todayStr();

  const cells = [];
  for (let i = 0; i < startDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push(dateStr);
  }

  const prevMonth = () => {
    setViewMonth(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
  };
  const nextMonth = () => {
    setViewMonth(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
  };

  const selectedJobs = selectedDate
    ? (jobsByDate[selectedDate] || []).filter(j => j.status !== 'completed').sort((a, b) => a.unit.localeCompare(b.unit))
    : [];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-cafe-100/80 shadow-sm overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <button onClick={prevMonth} className="w-8 h-8 rounded-full flex items-center justify-center active:bg-cafe-100 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-coqui-800/50">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="text-[13px] font-bold text-coqui-800 capitalize">{monthLabel}</span>
          <button onClick={nextMonth} className="w-8 h-8 rounded-full flex items-center justify-center active:bg-cafe-100 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-coqui-800/50">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 px-3">
          {dayHeaders.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-coqui-800/25 uppercase py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 px-3 pb-3">
          {cells.map((dateStr, i) => {
            if (!dateStr) return <div key={`empty-${i}`} />;
            const day = parseInt(dateStr.split('-')[2], 10);
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            const dayJobs = jobsByDate[dateStr] || [];
            const unitIndices = [...new Set(dayJobs.filter(j => j.status !== 'completed').map(j => uIdx(j.unit, unitNames)))].sort();

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className={`relative flex flex-col items-center justify-center py-1.5 rounded-xl transition-colors ${
                  isSelected
                    ? 'bg-coqui-600 text-white'
                    : isToday
                    ? 'bg-coqui-50 text-coqui-700 font-bold'
                    : 'text-coqui-800/70 hover:bg-cafe-50'
                }`}
              >
                <span className="text-xs">{day}</span>
                {/* Unit-colored dots */}
                <div className="flex gap-0.5 mt-0.5 h-2 items-center">
                  {unitIndices.map(idx => (
                    <span key={idx} className={`w-1.5 h-1.5 rounded-full ${
                      isSelected ? 'bg-white/70' : (UNIT_DOT[idx] || 'bg-gray-300')
                    }`} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* Legend inside calendar card */}
        <div className="border-t border-cafe-100/60 px-4 py-2.5">
          <UnitLegend unitNames={unitNames} />
        </div>
      </div>

      {/* Selected date jobs */}
      {selectedDate && (
        <div className="space-y-2">
          <p className="text-[13px] font-bold text-coqui-800/35 uppercase tracking-wider px-0.5">
            {getDateLabel(locale, selectedDate)}
          </p>
          {selectedJobs.length > 0 ? (
            selectedJobs.map(job => (
              <JobRow key={job.id} job={job} locale={locale} unitNames={unitNames} onTap={onTap} />
            ))
          ) : (
            <div className="bg-white rounded-xl border border-cafe-100/80 px-4 py-5 text-center">
              <p className="text-sm text-coqui-800/25">{t(locale, 'cleaner_noJobsOnDate')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Done Section ────────────────────────────────────────────────────────────
// Collapsible section for completed jobs at the bottom of the agenda.

function DoneSection({ jobs, locale, unitNames, onTap }) {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[13px] font-bold text-coqui-800/25 uppercase tracking-wider px-0.5 py-2 w-full text-left"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"
          className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        {t(locale, 'recentlyCompleted')} ({jobs.length})
      </button>
      {open && (
        <div className="space-y-2 mt-1">
          {jobs.map(job => (
            <JobRow key={job.id} job={job} locale={locale} unitNames={unitNames} onTap={onTap} showDate />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="px-5 pt-5 space-y-4 animate-pulse">
      <div className="h-5 bg-cafe-200/40 rounded w-44" />
      <div className="h-3 bg-cafe-100/40 rounded w-28" />
      <div className="h-8 bg-cafe-100/30 rounded-lg" />
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-3 bg-white rounded-xl border border-cafe-100 p-3 border-l-[3px] border-l-cafe-200/50">
          <div className="flex-1 space-y-2">
            <div className="h-3.5 bg-cafe-100/40 rounded w-20" />
            <div className="h-2.5 bg-cafe-100/30 rounded w-32" />
          </div>
          <div className="h-5 bg-cafe-100/30 rounded-full w-16" />
        </div>
      ))}
    </div>
  );
}

// ─── Main: CleanerHome ──────────────────────────────────────────────────────

export default function CleanerHome({ user }) {
  const { locale } = useLocale();
  const [jobs, setJobs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forumJob, setForumJob] = useState(null);
  const [sheetJob, setSheetJob] = useState(null);
  const [view, setView] = useState('agenda');
  const dismissedRef = useRef(false);

  // Real-time listener for cleaner's jobs
  const loadJobs = useCallback(() => {
    const q = query(
      collection(db, 'cleaning_jobs'),
      where('assigneeId', '==', user.uid),
      orderBy('scheduledDate', 'desc')
    );
    return onSnapshot(q,
      (snap) => {
        const data = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((j) => !HIDDEN_STATUSES.has(j.status));
        setJobs(data);
        setLoading(false);
      },
      (err) => {
        console.error('[cleaning_jobs] cleaner listener error:', err.code, err.message);
        setLoading(false);
      }
    );
  }, [user.uid]);

  // Property settings for unit names
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'property'), (snap) => {
      setSettings(snap.exists() ? snap.data() : null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = loadJobs();
    return unsub;
  }, [loadJobs]);

  const closeForum = useCallback(() => {
    dismissedRef.current = true;
    setForumJob(null);
  }, []);

  const openForum = useCallback((job) => {
    dismissedRef.current = false;
    setSheetJob(null);
    setForumJob(job);
  }, []);

  // Route taps: in-progress/completed → forum, everything else → bottom sheet
  const handleRowTap = useCallback((job) => {
    if (IN_PROGRESS.has(job.status) || job.status === 'completed') {
      openForum(job);
    } else {
      setSheetJob(job);
    }
  }, [openForum]);

  // Auto-open forum for single in-progress job
  useEffect(() => {
    if (loading || forumJob || dismissedRef.current) return;
    const active = jobs.filter(j => IN_PROGRESS.has(j.status));
    if (active.length === 1) setForumJob(active[0]);
  }, [loading, jobs, forumJob]);

  const unitNames = getUnitNames(settings);

  // Group non-completed jobs by unit, then sorted by date within each unit
  const jobsByUnit = useMemo(() => {
    const nonCompleted = jobs
      .filter(j => j.status !== 'completed')
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

    return unitNames.map((name, idx) => ({
      name,
      idx,
      jobs: nonCompleted.filter(j => j.unit === name),
    }));
  }, [jobs, unitNames]);

  const completed = useMemo(() =>
    jobs.filter(j => j.status === 'completed').slice(0, 10),
    [jobs]
  );

  // Forum full-screen overlay
  if (forumJob) {
    const liveJob = jobs.find(j => j.id === forumJob.id);
    if (liveJob) return <JobForum job={liveJob} onClose={closeForum} />;
  }

  if (loading) return <Skeleton />;

  const displayName = user.displayName?.split(' ')[0] || '';

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="px-5 pt-5 pb-1">
        <h1 className="text-lg font-display font-bold text-coqui-800">
          {getGreeting(locale)}{displayName ? `, ${displayName}` : ''}
        </h1>
        <StatusSummary jobs={jobs} locale={locale} />
      </div>

      {/* Agenda / Calendar toggle */}
      <div className="px-5 py-3">
        <div className="flex bg-cafe-100/50 rounded-lg p-0.5">
          {['agenda', 'calendar'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 text-[13px] font-semibold py-1.5 rounded-md transition-all ${
                view === v
                  ? 'bg-white text-coqui-800 shadow-sm'
                  : 'text-coqui-800/30 active:text-coqui-800/50'
              }`}
            >
              {t(locale, v === 'agenda' ? 'cleaner_agenda' : 'cleaner_calendar')}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 space-y-5">
        {view === 'agenda' ? (
          <>
            {jobsByUnit.some(g => g.jobs.length > 0) ? (
              jobsByUnit.map(({ name, idx, jobs: unitJobs }) => (
                <section key={name}>
                  {/* Unit header with colored accent */}
                  <div className="flex items-center gap-2 mb-2 px-0.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${UNIT_DOT[idx] || 'bg-gray-400'}`} />
                    <span className="text-[13px] font-bold text-coqui-800 uppercase tracking-wider">{name}</span>
                  </div>
                  {unitJobs.length > 0 ? (
                    <div className="space-y-2">
                      {unitJobs.map(job => (
                        <JobRow key={job.id} job={job} locale={locale} unitNames={unitNames} onTap={handleRowTap} showDate />
                      ))}
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-cafe-100/80 px-4 py-4 text-center">
                      <p className="text-sm text-coqui-800/20">{t(locale, 'noCleaningsScheduled')}</p>
                    </div>
                  )}
                </section>
              ))
            ) : (
              <div className="bg-white rounded-xl border border-cafe-100/80 px-4 py-8 text-center">
                <p className="text-sm text-coqui-800/25">{t(locale, 'noCleaningsScheduled')}</p>
              </div>
            )}

            {completed.length > 0 && (
              <DoneSection jobs={completed} locale={locale} unitNames={unitNames} onTap={handleRowTap} />
            )}
          </>
        ) : (
          <CalendarView jobs={jobs} locale={locale} unitNames={unitNames} onTap={handleRowTap} />
        )}
      </div>

      {/* Bottom sheet for job actions */}
      {sheetJob && (
        <JobSheet
          job={jobs.find(j => j.id === sheetJob.id) || sheetJob}
          locale={locale}
          unitNames={unitNames}
          onClose={() => setSheetJob(null)}
          onOpenForum={openForum}
        />
      )}
    </div>
  );
}
