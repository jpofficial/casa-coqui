'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import CleaningWizard from './CleaningWizard';

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
};

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

// ─── Job Card ────────────────────────────────────────────────────────────────
function JobCard({ job, locale, isToday, onOpenWizard }) {
  const needsAction = job.status === 'scheduled';
  const isActive = ACTIVE_STATUSES.has(job.status);
  const isDeclined = job.status === 'declined';

  return (
    <div className={`bg-white rounded-2xl border shadow-brand overflow-hidden transition-all ${
      isDeclined ? 'border-flamboyan-200' :
      isActive ? 'border-coqui-200' :
      'border-cafe-200'
    }`}>
      <div className="p-4 space-y-2.5">
        {/* Unit + status badge */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-coqui-900">{job.unit}</h3>
          {!needsAction && (
            <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-600'}`}>
              {t(locale, job.status)}
            </span>
          )}
        </div>

        {/* Date + checkout time */}
        <div className="flex items-center gap-3 text-sm text-coqui-800/60">
          {!isToday && <span>{formatDate(locale, job.scheduledDate)}</span>}
          <span>{t(locale, 'checkoutTime')}: {job.checkoutTime || '11:00 AM'}</span>
        </div>

        {/* Same-day arrival flag */}
        {job.sameDayArrival && (
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            {t(locale, 'sameDayArrival')}
          </div>
        )}

        {/* Turnover notes */}
        {job.turnoverNotes && (
          <p className="text-sm text-coqui-800/50 leading-relaxed">
            {job.turnoverNotes}
          </p>
        )}

        {/* Decline reason */}
        {isDeclined && job.declineReason && (
          <p className="text-sm text-flamboyan-700 bg-flamboyan-50 rounded-xl px-3 py-2">
            {job.declineReason}
          </p>
        )}

        {/* Quick action for active jobs */}
        {isActive && (
          <button
            onClick={() => onOpenWizard(job)}
            className="w-full mt-1 bg-coqui-600 text-white font-semibold text-sm py-3 rounded-xl
              hover:bg-coqui-700 active:bg-coqui-800 transition-colors"
          >
            {t(locale, 'continueCleaning')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Completed Row ───────────────────────────────────────────────────────────
function CompletedRow({ job, locale }) {
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
      <span className="text-xs text-coqui-800/40 flex-shrink-0">
        {formatTime(job.completedAt)}
      </span>
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

// ─── Empty State ─────────────────────────────────────────────────────────────
function EmptyDay({ locale }) {
  return (
    <div className="bg-white/50 rounded-2xl border border-dashed border-cafe-200 p-6 text-center">
      <div className="w-12 h-12 rounded-2xl bg-cafe-100 text-cafe-400 flex items-center justify-center mx-auto mb-3">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
      </div>
      <p className="text-sm text-cafe-500 font-medium">{t(locale, 'noJobsToday')}</p>
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="p-5 space-y-5 animate-pulse">
      <div className="h-5 bg-cafe-200 rounded w-2/3" />
      <div className="bg-white rounded-2xl border border-cafe-200 p-5 space-y-3">
        <div className="h-4 bg-cafe-100 rounded w-1/2" />
        <div className="h-3 bg-cafe-100 rounded w-full" />
        <div className="h-10 bg-cafe-100 rounded-xl w-full" />
      </div>
      <div className="bg-white rounded-2xl border border-cafe-200 p-5 space-y-3">
        <div className="h-4 bg-cafe-100 rounded w-1/2" />
        <div className="h-3 bg-cafe-100 rounded w-3/4" />
      </div>
    </div>
  );
}

// ─── Main: CleanerHome ───────────────────────────────────────────────────────
export default function CleanerHome({ user }) {
  const { locale, setLocale } = useLocale();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizardJob, setWizardJob] = useState(null);

  // Real-time listener for cleaner's jobs
  const loadJobs = useCallback(() => {
    const q = query(
      collection(db, 'cleaning_jobs'),
      where('assigneeId', '==', user.uid),
      orderBy('scheduledDate', 'desc')
    );
    return onSnapshot(q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setJobs(data);
        setLoading(false);
      },
      (err) => {
        console.error('[cleaning_jobs] cleaner listener error:', err.code, err.message);
        setLoading(false);
      }
    );
  }, [user.uid]);

  useEffect(() => {
    const unsub = loadJobs();
    return unsub;
  }, [loadJobs]);

  // Group jobs
  const today = todayStr();
  const todayJobs = jobs.filter((j) => j.scheduledDate === today && j.status !== 'completed');
  const attention = jobs.filter((j) => j.status === 'declined' && j.scheduledDate >= today);
  const upcoming = jobs.filter((j) =>
    j.scheduledDate > today && j.status !== 'completed' && j.status !== 'declined'
  );
  const completed = jobs.filter((j) => j.status === 'completed').slice(0, 5);

  // If wizard is open, show it full-screen
  if (wizardJob) {
    const liveJob = jobs.find((j) => j.id === wizardJob.id);
    if (liveJob && liveJob.status === 'completed') {
      // Job was completed — return to home
      setWizardJob(null);
    } else if (liveJob) {
      return (
        <CleaningWizard
          job={liveJob}
          onRefresh={() => setWizardJob(null)}
        />
      );
    }
  }

  // Auto-open wizard if exactly one active job exists (preserves old behavior)
  const activeInProgress = jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
  if (!loading && activeInProgress.length === 1 && !wizardJob) {
    return (
      <CleaningWizard
        job={activeInProgress[0]}
        onRefresh={() => {}}
      />
    );
  }

  if (loading) return <Skeleton />;

  const displayName = user.displayName?.split(' ')[0] || '';

  return (
    <div className="pb-8">
      {/* Greeting + locale toggle */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-coqui-800">
            {getGreeting(locale)}{displayName ? `, ${displayName}` : ''}
          </h1>
          <p className="text-sm text-coqui-800/40 mt-0.5">{t(locale, 'myCleanings')}</p>
        </div>
        <button
          onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
          className="text-xs font-bold bg-cafe-100 text-cafe-600 px-2.5 py-1 rounded-lg
            hover:bg-cafe-200 active:bg-cafe-300 transition-colors"
        >
          {locale === 'es' ? 'EN' : 'ES'}
        </button>
      </div>

      <div className="px-5 space-y-6">
        {/* ── Hoy ───────────────────────────────────────────────────── */}
        <section>
          <SectionHeader label={t(locale, 'today')} count={todayJobs.length} />
          {todayJobs.length === 0 ? (
            <EmptyDay locale={locale} />
          ) : (
            <div className="space-y-3">
              {todayJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  locale={locale}
                  isToday
                  onOpenWizard={setWizardJob}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Necesita Atención ──────────────────────────────────────── */}
        {attention.length > 0 && (
          <section>
            <SectionHeader label={t(locale, 'needsAttention')} count={attention.length} />
            <div className="space-y-3">
              {attention.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  locale={locale}
                  isToday={false}
                  onOpenWizard={setWizardJob}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Próximas ──────────────────────────────────────────────── */}
        {upcoming.length > 0 && (
          <section>
            <SectionHeader label={t(locale, 'upcoming')} count={upcoming.length} />
            <div className="space-y-3">
              {upcoming.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  locale={locale}
                  isToday={false}
                  onOpenWizard={setWizardJob}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Completadas Recientes ─────────────────────────────────── */}
        {completed.length > 0 && (
          <section>
            <SectionHeader label={t(locale, 'recentlyCompleted')} count={0} />
            <div className="bg-white rounded-2xl border border-cafe-200 shadow-brand overflow-hidden divide-y divide-cafe-100 px-4">
              {completed.map((job) => (
                <CompletedRow key={job.id} job={job} locale={locale} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
