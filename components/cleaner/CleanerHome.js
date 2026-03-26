'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, where, orderBy, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { getUnitNames, getUnitPalette } from '@/lib/units';
import JobForum from './JobForum';

// ─── Status badge colors (branded) ──────────────────────────────────────────
const STATUS_COLORS = {
  scheduled: 'bg-cafe-100 text-cafe-700',
  acknowledged: 'bg-coqui-100 text-coqui-700',
  declined: 'bg-flamboyan-100 text-flamboyan-700',
  en_route: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-purple-100 text-purple-700',
  before_photos: 'bg-yellow-100 text-yellow-700',
  cleaning: 'bg-amber-100 text-amber-700',
  after_photos: 'bg-atardecer-100 text-atardecer-700',
  laundry_check: 'bg-teal-100 text-teal-700',
  completed: 'bg-coqui-100 text-coqui-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

// Statuses hidden from the cleaner view (deleted/archived/cancelled)
const HIDDEN_STATUSES = new Set(['deleted', 'archived', 'cancelled']);

// Statuses that mean the wizard is actively in progress
const ACTIVE_STATUSES = new Set([
  'acknowledged', 'en_route', 'arrived', 'before_photos',
  'cleaning', 'after_photos', 'laundry_check',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getGreeting(locale) {
  const hour = new Date().getHours();
  if (hour < 12) return t(locale, 'goodMorning');
  if (hour < 18) return t(locale, 'goodAfternoon');
  return t(locale, 'goodEvening');
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(locale, dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Date Row (one job within a unit section) ───────────────────────────────
function DateRow({ job, locale, onOpenForum }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const today = todayStr();
  const isToday = job.scheduledDate === today;
  const isActive = ACTIVE_STATUSES.has(job.status);

  async function handleConfirm() {
    setBusy(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/cleaning/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'acknowledged' }),
      });
      const data = await res.json();
      if (!data.success) console.error('Confirm failed:', data.error);
    } catch (err) {
      console.error('Confirm failed:', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/cleaning/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'declined', declineReason: reason.trim() }),
      });
      const data = await res.json();
      if (!data.success) console.error('Decline failed:', data.error);
      else setDeclining(false);
    } catch (err) {
      console.error('Decline failed:', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        {/* Date + status */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-medium text-coqui-900">
            {isToday ? t(locale, 'today') : formatDate(locale, job.scheduledDate)}
          </span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
            STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-600'
          }`}>
            {t(locale, job.status)}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {job.status === 'scheduled' && !declining && (
            <>
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="text-sm font-semibold px-4 py-2 rounded-xl bg-coqui-600 text-white
                  hover:bg-coqui-700 active:bg-coqui-800 disabled:opacity-50 transition-colors"
              >
                {busy ? t(locale, 'sending') : t(locale, 'confirmCleaning')}
              </button>
              <button
                onClick={() => setDeclining(true)}
                disabled={busy}
                className="text-sm font-semibold px-4 py-2 rounded-xl bg-flamboyan-100 text-flamboyan-700
                  hover:bg-flamboyan-200 active:bg-flamboyan-300 disabled:opacity-50 transition-colors"
              >
                {t(locale, 'declineCleaning')}
              </button>
            </>
          )}
          {isActive && (
            <button
              onClick={() => onOpenForum(job)}
              className="text-sm font-semibold px-4 py-2 rounded-xl bg-coqui-600 text-white
                hover:bg-coqui-700 active:bg-coqui-800 transition-colors flex items-center gap-1"
            >
              {t(locale, 'continueCleaning')}
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Same-day arrival flag */}
      {job.sameDayArrival && (
        <div className="flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          </svg>
          {t(locale, 'sameDayArrival')}
        </div>
      )}

      {/* Checkout time */}
      {job.checkoutTime && (
        <p className="text-xs text-coqui-800/50">
          {t(locale, 'checkoutTime')}: {job.checkoutTime}
        </p>
      )}

      {/* Declined reason */}
      {job.status === 'declined' && job.declineReason && (
        <p className="text-xs text-flamboyan-700 bg-flamboyan-50 rounded-lg px-2.5 py-1.5">
          {job.declineReason}
        </p>
      )}

      {/* Inline decline reason input */}
      {declining && (
        <div className="flex gap-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(locale, 'reasonRequired')}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2
              focus:outline-none focus:ring-2 focus:ring-flamboyan-200 focus:border-flamboyan-300
              placeholder:text-gray-400"
            autoFocus
          />
          <button
            onClick={handleDecline}
            disabled={!reason.trim() || busy}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-flamboyan-600 text-white
              hover:bg-flamboyan-700 disabled:opacity-50 transition-colors"
          >
            {t(locale, 'submitDeclineShort')}
          </button>
          <button
            onClick={() => { setDeclining(false); setReason(''); }}
            className="text-xs text-gray-400 px-2 py-2 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Unit Section (all jobs for one unit) ───────────────────────────────────
function UnitSection({ unitName, jobs, palette, locale, onOpenForum }) {
  return (
    <div className="bg-white rounded-2xl border border-cafe-200 shadow-brand overflow-hidden">
      {/* Accent bar + unit name */}
      <div className={`h-1.5 ${palette.accent}`} />
      <div className="px-4 pt-3 pb-1">
        <h3 className={`text-lg font-bold ${palette.text}`}>{unitName}</h3>
      </div>

      {jobs.length > 0 ? (
        <div className="px-4 pb-3 divide-y divide-cafe-100">
          {jobs.map((job) => (
            <DateRow
              key={job.id}
              job={job}
              locale={locale}
              onOpenForum={onOpenForum}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 pb-4">
          <p className="text-sm text-coqui-800/40 italic">
            {t(locale, 'noCleaningsScheduled')}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Completed Row ───────────────────────────────────────────────────────────
function CompletedRow({ job, locale, onOpenForum }) {
  return (
    <div className="flex items-center justify-between py-3 px-1">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 rounded-full bg-coqui-100 text-coqui-600 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-coqui-900 truncate">{job.unit}</p>
          <p className="text-xs text-coqui-800/40">{formatDate(locale, job.scheduledDate)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-coqui-800/40">
          {formatTime(job.completedAt)}
        </span>
        <button
          onClick={() => onOpenForum(job)}
          className="text-xs font-medium text-coqui-600 px-2 py-1 rounded-lg hover:bg-coqui-50 transition-colors"
        >
          {t(locale, 'forum_openForum')}
        </button>
      </div>
    </div>
  );
}

// ─── Section Header ──────────────────────────────────────────────────────────
function SectionHeader({ label, count }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-coqui-800/40">
        {label}
      </h2>
      {count > 0 && (
        <span className="text-[10px] font-bold bg-coqui-100 text-coqui-700 px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="p-5 space-y-5 animate-pulse">
      <div className="h-5 bg-cafe-200 rounded w-2/3" />
      <div className="bg-white rounded-2xl border border-cafe-200 p-5 space-y-3">
        <div className="h-1.5 bg-teal-200 rounded w-full" />
        <div className="h-4 bg-cafe-100 rounded w-1/2" />
        <div className="h-3 bg-cafe-100 rounded w-full" />
        <div className="h-10 bg-cafe-100 rounded-xl w-full" />
      </div>
      <div className="bg-white rounded-2xl border border-cafe-200 p-5 space-y-3">
        <div className="h-1.5 bg-amber-200 rounded w-full" />
        <div className="h-4 bg-cafe-100 rounded w-1/2" />
        <div className="h-3 bg-cafe-100 rounded w-3/4" />
      </div>
    </div>
  );
}

// ─── Main: CleanerHome ───────────────────────────────────────────────────────
export default function CleanerHome({ user }) {
  const { locale } = useLocale();
  const [jobs, setJobs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forumJob, setWizardJob] = useState(null);
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

  // Real-time listener for property settings (unit names)
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

  // Close wizard and prevent auto-open from re-triggering
  const closeForum = useCallback(() => {
    dismissedRef.current = true;
    setWizardJob(null);
  }, []);

  // Open wizard manually (resets dismissed flag)
  const openForum = useCallback((job) => {
    dismissedRef.current = false;
    setWizardJob(job);
  }, []);

  // Auto-open wizard if exactly one active job and user hasn't dismissed
  useEffect(() => {
    if (loading || forumJob || dismissedRef.current) return;
    const activeInProgress = jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
    if (activeInProgress.length === 1) {
      setWizardJob(activeInProgress[0]);
    }
  }, [loading, jobs, forumJob]);

  // Derive unit names and group ALL non-completed jobs per unit
  const unitNames = getUnitNames(settings);
  const today = todayStr();

  const jobsByUnit = unitNames.map((unitName) => {
    const unitJobs = jobs
      .filter((j) => j.unit === unitName && j.status !== 'completed' && !HIDDEN_STATUSES.has(j.status))
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
    return { unitName, jobs: unitJobs };
  });

  const completed = jobs.filter((j) => j.status === 'completed').slice(0, 5);

  // If forum is open, show it full-screen
  if (forumJob) {
    const liveJob = jobs.find((j) => j.id === forumJob.id);
    if (liveJob) {
      return (
        <JobForum
          job={liveJob}
          onClose={closeForum}
        />
      );
    }
  }

  if (loading) return <Skeleton />;

  const displayName = user.displayName?.split(' ')[0] || '';

  return (
    <div className="pb-8">
      {/* Greeting */}
      <div className="px-5 pt-5 pb-4">
        <h1 className="text-xl font-display font-bold text-coqui-800">
          {getGreeting(locale)}{displayName ? `, ${displayName}` : ''}
        </h1>
        <p className="text-sm text-coqui-800/40 mt-0.5">{t(locale, 'myCleanings')}</p>
      </div>

      <div className="px-5 space-y-4">
        {/* ── Unit Sections (all future dates per unit) ──────────────── */}
        {jobsByUnit.map(({ unitName, jobs: unitJobs }) => {
          const palette = getUnitPalette(unitName, unitNames);
          return (
            <UnitSection
              key={unitName}
              unitName={unitName}
              jobs={unitJobs}
              palette={palette}
              locale={locale}
              onOpenForum={openForum}
            />
          );
        })}

        {/* ── Completadas Recientes ─────────────────────────────────── */}
        {completed.length > 0 && (
          <section>
            <SectionHeader label={t(locale, 'recentlyCompleted')} count={completed.length} />
            <div className="bg-white rounded-2xl border border-cafe-200 shadow-brand overflow-hidden divide-y divide-cafe-100 px-4">
              {completed.map((job) => (
                <CompletedRow key={job.id} job={job} locale={locale} onOpenForum={openForum} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
