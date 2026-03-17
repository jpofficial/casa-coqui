'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import { LocaleProvider } from '@/hooks/useLocale';
import CleaningWizard from '@/components/cleaner/CleaningWizard';
import { t } from '@/lib/i18n';

const STATUS_COLORS = {
  scheduled: 'bg-gray-100 text-gray-700',
  acknowledged: 'bg-blue-100 text-blue-700',
  declined: 'bg-red-100 text-red-700',
  en_route: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-purple-100 text-purple-700',
  before_photos: 'bg-yellow-100 text-yellow-700',
  cleaning: 'bg-amber-100 text-amber-700',
  after_photos: 'bg-orange-100 text-orange-700',
  laundry_check: 'bg-teal-100 text-teal-700',
  completed: 'bg-green-100 text-green-700',
};

export default function CleaningPage() {
  const { user, role } = useAuth();

  if (!user) return null;

  if (role === 'cleaner') {
    return (
      <LocaleProvider defaultLocale="es">
        <CleanerView user={user} />
      </LocaleProvider>
    );
  }

  return <AdminCleaningDashboard user={user} role={role} />;
}

// ---------------------------------------------------------------------------
// Cleaner View — shows active job wizard or upcoming job list
// ---------------------------------------------------------------------------
function CleanerView({ user }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(() => {
    const q = query(
      collection(db, 'cleaning_jobs'),
      where('assigneeId', '==', user.uid),
      orderBy('scheduledDate', 'desc')
    );
    return onSnapshot(q,
      (snap) => {
        setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">{t('es', 'loading')}</p>
      </div>
    );
  }

  // Find active (non-completed) job — show wizard for it
  const activeJob = jobs.find((j) => j.status !== 'completed');
  if (activeJob) {
    return <CleaningWizard job={activeJob} onRefresh={() => {}} />;
  }

  // No active job — show upcoming list
  const upcoming = jobs.filter((j) => j.status === 'scheduled');
  const completed = jobs.filter((j) => j.status === 'completed').slice(0, 5);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div>
          <p className="text-sm font-bold text-gray-900">Casa Coqui</p>
          <p className="text-xs text-gray-500">{t('es', 'myCleanings')}</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">
          {t('es', 'upcomingCleanings')}
        </h2>

        {upcoming.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <p className="text-sm text-gray-500">{t('es', 'noUpcomingJobs')}</p>
          </div>
        ) : (
          upcoming.map((job) => (
            <div key={job.id} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-2">
              <p className="text-lg font-bold text-gray-900">{job.unit}</p>
              <p className="text-sm text-gray-500">
                {t('es', 'date')}: {job.scheduledDate}
              </p>
              <p className="text-sm text-gray-500">
                {t('es', 'checkoutTime')}: {job.checkoutTime || '11:00 AM'}
              </p>
              {job.sameDayArrival && (
                <p className="text-sm font-medium text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  {t('es', 'sameDayArrival')}
                </p>
              )}
              {job.turnoverNotes && (
                <p className="text-sm text-gray-600">
                  {t('es', 'notes')}: {job.turnoverNotes}
                </p>
              )}
            </div>
          ))
        )}

        {completed.length > 0 && (
          <>
            <h2 className="text-base font-semibold text-gray-800 mt-6">
              {t('es', 'completed')}
            </h2>
            {completed.map((job) => (
              <div key={job.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{job.unit}</p>
                  <p className="text-xs text-gray-500">{job.scheduledDate}</p>
                </div>
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-1 rounded-full">
                  {t('es', 'completed')}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin / Cohost — cleaning job management dashboard
// ---------------------------------------------------------------------------
function AdminCleaningDashboard({ user, role }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active'); // 'active' | 'completed' | 'all'

  useEffect(() => {
    const q = query(
      collection(db, 'cleaning_jobs'),
      orderBy('scheduledDate', 'desc')
    );
    const unsub = onSnapshot(q,
      (snap) => {
        setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('[cleaning_jobs] admin listener error:', err.code, err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const filtered = jobs.filter((j) => {
    if (filter === 'active') return j.status !== 'completed';
    if (filter === 'completed') return j.status === 'completed';
    return true;
  });

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6 pb-8">
      <h1 className="text-xl font-bold text-gray-900">Cleaning Jobs</h1>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {['active', 'completed', 'all'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              filter === f
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading jobs...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
          <p className="text-sm text-gray-500">No cleaning jobs found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => (
            <div key={job.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-gray-900">{job.unit}</p>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-600'}`}>
                  {job.status?.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>{job.scheduledDate}</span>
                <span>{job.checkoutTime || '11:00 AM'}</span>
                {job.assigneeName && <span>{job.assigneeName}</span>}
              </div>

              {job.sameDayArrival && (
                <p className="text-xs font-medium text-amber-700 bg-amber-50 rounded px-2 py-1 inline-block">
                  Same-day arrival
                </p>
              )}

              {job.turnoverNotes && (
                <p className="text-xs text-gray-600">Notes: {job.turnoverNotes}</p>
              )}

              {/* Photo counts */}
              <div className="flex items-center gap-3 text-xs text-gray-400">
                {(job.beforePhotos?.length || 0) > 0 && (
                  <span>Before: {job.beforePhotos.length} photos</span>
                )}
                {(job.afterPhotos?.length || 0) > 0 && (
                  <span>After: {job.afterPhotos.length} photos</span>
                )}
                {(job.issues?.length || 0) > 0 && (
                  <span className="text-amber-600 font-medium">
                    {job.issues.length} issue{job.issues.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Timeline */}
              {job.status !== 'scheduled' && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 pt-1">
                  {job.acknowledgedAt && <span>Ack {new Date(job.acknowledgedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                  {job.enRouteAt && <span>En route {new Date(job.enRouteAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                  {job.arrivedAt && <span>Arrived {new Date(job.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                  {job.startedAt && <span>Started {new Date(job.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                  {job.completedAt && <span>Done {new Date(job.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
