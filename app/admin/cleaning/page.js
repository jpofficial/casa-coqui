'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import Link from 'next/link';
import CleanerHome from '@/components/cleaner/CleanerHome';
import CleaningJobForm from '@/components/admin/CleaningJobForm';
import JobForum from '@/components/cleaner/JobForum';

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
  archived: 'bg-gray-100 text-gray-500',
  deleted: 'bg-red-50 text-red-400',
};

// States where a cleaning job is actively in progress — cannot be deleted
const NON_DELETABLE = ['en_route', 'arrived', 'before_photos', 'cleaning', 'after_photos', 'laundry_check'];

export default function CleaningPage() {
  const { user, role } = useAuth();

  if (!user) return null;

  if (role === 'cleaner') {
    return <CleanerHome user={user} />;
  }

  return <AdminCleaningDashboard user={user} role={role} isAdmin={role === 'admin'} />;
}

// ---------------------------------------------------------------------------
// Confirm Dialog — reusable inline confirmation
// ---------------------------------------------------------------------------
function ConfirmDialog({ title, message, confirmLabel, confirmClass, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className={`flex-1 text-sm font-semibold py-2.5 rounded-xl transition ${confirmClass}`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 text-sm font-semibold py-2.5 rounded-xl border border-gray-200 text-gray-600 active:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

function dateToYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatMonthYear(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const STATUS_DOT = {
  scheduled: 'bg-gray-400',
  acknowledged: 'bg-blue-500',
  declined: 'bg-red-500',
  en_route: 'bg-indigo-500',
  arrived: 'bg-purple-500',
  before_photos: 'bg-yellow-500',
  cleaning: 'bg-amber-500',
  after_photos: 'bg-orange-500',
  laundry_check: 'bg-teal-500',
  completed: 'bg-green-500',
};

// ---------------------------------------------------------------------------
// CleaningCalendar — month-grid view of cleaning jobs
// ---------------------------------------------------------------------------
function CleaningCalendar({ jobs, loading, onSelectJob }) {
  const today = dateToYMD(new Date());
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(null);

  function prevMonth() {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
    setSelectedDate(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
    setSelectedDate(null);
  }
  function goToToday() {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setSelectedDate(today);
  }

  // Map jobs to dates (exclude deleted/cancelled)
  const jobsByDate = useMemo(() => {
    const map = {};
    for (const job of jobs) {
      if (!job.scheduledDate || job.status === 'deleted' || job.status === 'cancelled') continue;
      const dateStr = job.scheduledDate.substring(0, 10);
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(job);
    }
    return map;
  }, [jobs]);

  // Build calendar grid
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const weeks = [];
  let week = new Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    week.push({ day: d, dateStr });
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  // Jobs for selected date
  const selectedJobs = selectedDate ? (jobsByDate[selectedDate] || []) : [];

  if (loading) return <p className="text-sm text-gray-500">Loading calendar...</p>;

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-gray-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <button onClick={goToToday} className="text-base font-bold text-gray-900 hover:text-coqui-700 transition">
          {formatMonthYear(year, month)}
        </button>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-gray-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider py-2">
              {d}
            </div>
          ))}
        </div>
        {/* Weeks */}
        {weeks.map((wk, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-b-0">
            {wk.map((cell, ci) => {
              if (!cell) return <div key={ci} className="h-16 bg-gray-50/50" />;
              const dayJobs = jobsByDate[cell.dateStr] || [];
              const isToday = cell.dateStr === today;
              const isSelected = cell.dateStr === selectedDate;
              return (
                <button
                  key={ci}
                  onClick={() => setSelectedDate(isSelected ? null : cell.dateStr)}
                  className={`h-16 flex flex-col items-center pt-1.5 gap-1 transition-colors relative ${
                    isSelected ? 'bg-coqui-50 ring-2 ring-inset ring-coqui-400' :
                    isToday ? 'bg-amber-50/50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className={`text-xs font-medium leading-none ${
                    isToday ? 'bg-coqui-600 text-white w-5 h-5 rounded-full flex items-center justify-center' :
                    isSelected ? 'text-coqui-800 font-bold' : 'text-gray-700'
                  }`}>
                    {cell.day}
                  </span>
                  {/* Job dots */}
                  {dayJobs.length > 0 && (
                    <div className="flex gap-0.5 flex-wrap justify-center max-w-[90%]">
                      {dayJobs.slice(0, 4).map((j, ji) => (
                        <span key={ji} className={`w-2 h-2 rounded-full ${STATUS_DOT[j.status] || 'bg-gray-300'}`} />
                      ))}
                      {dayJobs.length > 4 && (
                        <span className="text-[8px] text-gray-400 font-bold leading-none">+{dayJobs.length - 4}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
        {[
          ['Scheduled', 'bg-gray-400'],
          ['Acknowledged', 'bg-blue-500'],
          ['In progress', 'bg-amber-500'],
          ['Completed', 'bg-green-500'],
        ].map(([label, dot]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            {label}
          </span>
        ))}
      </div>

      {/* Selected date job list */}
      {selectedDate && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          {selectedJobs.length === 0 ? (
            <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-4 text-center">
              No cleaning jobs on this date.
            </p>
          ) : (
            selectedJobs.map((job) => (
              <div key={job.id} className="bg-white rounded-xl border border-gray-200 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{job.unit}</p>
                    {job.notes?.startsWith('Guest: ') && (
                      <span className="text-xs text-gray-500">· {job.notes.replace('Guest: ', '')}</span>
                    )}
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-600'}`}>
                    {job.status?.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{job.checkoutTime || '11:00 AM'}</span>
                  <span>{job.assigneeName || 'Unassigned'}</span>
                </div>
                <button
                  onClick={() => onSelectJob(job)}
                  className="text-xs font-semibold text-coqui-600 mt-1"
                >
                  View Forum
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin / Cohost — cleaning job management dashboard
// ---------------------------------------------------------------------------
function AdminCleaningDashboard({ user, role, isAdmin }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'calendar'
  const [filter, setFilter] = useState('active'); // 'active' | 'completed' | 'archived'
  const [showForm, setShowForm] = useState(false);
  const [confirm, setConfirm] = useState(null); // { jobId, action: 'archive' | 'delete' }
  const [actionBusy, setActionBusy] = useState(null); // jobId being acted on
  const [selectedJob, setSelectedJob] = useState(null); // job to view in forum
  const [cleaners, setCleaners] = useState([]);

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

  // Fetch active cleaners for reassignment
  useEffect(() => {
    async function fetchCleaners() {
      try {
        const q = query(collection(db, 'users'), where('role', '==', 'cleaner'), where('status', '==', 'active'));
        const snap = await getDocs(q);
        setCleaners(snap.docs.map((d) => ({ id: d.id, name: d.data().displayName || d.data().email })));
      } catch (err) {
        console.error('[cleaning] fetch cleaners error:', err);
      }
    }
    fetchCleaners();
  }, []);

  async function patchJob(jobId, body) {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`/api/cleaning/jobs/${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function handleConfirmAction() {
    if (!confirm) return;
    setActionBusy(confirm.jobId);
    try {
      await patchJob(confirm.jobId, { status: confirm.action === 'delete' ? 'deleted' : 'archived' });
    } catch (err) {
      console.error(`[cleaning] ${confirm.action} error:`, err);
    } finally {
      setActionBusy(null);
      setConfirm(null);
    }
  }

  // Statuses that admin has removed — hide from active view (cleaner already hides these)
  const ADMIN_HIDDEN = new Set(['deleted', 'cancelled']);

  // Filter logic: partition active vs completed vs archived
  const filtered = jobs.filter((j) => {
    if (j.status === 'deleted') return false;
    if (filter === 'active') return j.status !== 'completed' && j.status !== 'archived' && j.status !== 'cancelled';
    if (filter === 'completed') return j.status === 'completed';
    if (filter === 'archived') return j.status === 'archived';
    if (filter === 'cancelled') return j.status === 'cancelled';
    return true;
  });

  const counts = {
    active: jobs.filter((j) => j.status !== 'completed' && j.status !== 'archived' && !ADMIN_HIDDEN.has(j.status)).length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    archived: jobs.filter((j) => j.status === 'archived').length,
    cancelled: jobs.filter((j) => j.status === 'cancelled').length,
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6 pb-8">
      {/* Link to unified calendar */}
      <Link
        href="/admin/calendar"
        className="block bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 hover:bg-green-100 transition"
      >
        <span className="font-semibold">Operational Calendar</span>
        <span className="text-green-600"> — View reservations + cleaning jobs together →</span>
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Cleaning Jobs</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-coqui-600 text-white text-sm font-semibold px-3.5 py-2 rounded-xl
            hover:bg-coqui-700 active:bg-coqui-800 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Job
        </button>
      </div>

      <CleaningJobForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onCreated={() => {}}
      />

      {/* View toggle: List / Calendar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setView('list')}
          className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2 rounded-md transition-colors ${
            view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
          List
        </button>
        <button
          onClick={() => setView('calendar')}
          className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2 rounded-md transition-colors ${
            view === 'calendar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          Calendar
        </button>
      </div>

      {view === 'calendar' ? (
        <CleaningCalendar jobs={jobs} loading={loading} onSelectJob={setSelectedJob} />
      ) : (
      <>
      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {['active', 'completed', 'archived', ...(counts.cancelled > 0 ? ['cancelled'] : [])].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
              filter === f
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading jobs...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
          <p className="text-sm text-gray-500">
            {filter === 'active' ? 'No active cleaning jobs.' : filter === 'completed' ? 'No completed jobs.' : filter === 'cancelled' ? 'No cancelled jobs.' : 'No archived jobs.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => {
            const canArchive = job.status === 'completed';
            const canDelete = isAdmin && !NON_DELETABLE.includes(job.status);
            const isBusy = actionBusy === job.id;

            return (
              <div key={job.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{job.unit}</p>
                    {job.notes?.startsWith('Guest: ') && (
                      <span className="text-xs text-gray-500">· {job.notes.replace('Guest: ', '')}</span>
                    )}
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-600'}`}>
                    {job.status?.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{job.scheduledDate}</span>
                  <span>{job.checkoutTime || '11:00 AM'}</span>
                </div>

                {/* Assignee with reassign */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400">Assigned:</span>
                  {isAdmin && cleaners.length > 0 ? (
                    <select
                      value={job.assigneeId || ''}
                      onChange={async (e) => {
                        if (!e.target.value || e.target.value === job.assigneeId) return;
                        setActionBusy(job.id);
                        await patchJob(job.id, { assigneeId: e.target.value }).catch(() => {});
                        setActionBusy(null);
                      }}
                      disabled={isBusy}
                      className="text-xs font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5
                        focus:outline-none focus:ring-2 focus:ring-coqui-200 disabled:opacity-50"
                    >
                      {!cleaners.find((c) => c.id === job.assigneeId) && (
                        <option value={job.assigneeId || ''}>{job.assigneeName || 'Unassigned'}</option>
                      )}
                      {cleaners.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-medium text-gray-700">{job.assigneeName || 'Unassigned'}</span>
                  )}
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
                {job.status !== 'scheduled' && job.status !== 'archived' && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 pt-1">
                    {job.acknowledgedAt && <span>Ack {new Date(job.acknowledgedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    {job.enRouteAt && <span>En route {new Date(job.enRouteAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    {job.arrivedAt && <span>Arrived {new Date(job.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    {job.startedAt && <span>Started {new Date(job.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    {job.completedAt && <span>Done {new Date(job.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                  </div>
                )}

                {/* View forum + Archive / Delete actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setSelectedJob(job)}
                    className="text-xs font-semibold text-coqui-600 border border-coqui-200 px-3 py-2 rounded-lg active:bg-coqui-50 min-h-[36px]"
                  >
                    View Forum
                  </button>
                  {canArchive && (
                    <button
                      disabled={isBusy}
                      onClick={() => setConfirm({ jobId: job.id, action: 'archive', unit: job.unit })}
                      className="text-xs font-semibold text-gray-500 border border-gray-200 px-3 py-2 rounded-lg active:bg-gray-50 disabled:opacity-50 min-h-[36px]"
                    >
                      Archive
                    </button>
                  )}
                  {canDelete && (
                    <button
                      disabled={isBusy}
                      onClick={() => setConfirm({ jobId: job.id, action: 'delete', unit: job.unit })}
                      className="text-xs font-semibold text-red-500 border border-red-200 px-3 py-2 rounded-lg active:bg-red-50 disabled:opacity-50 min-h-[36px]"
                    >
                      Delete
                    </button>
                  )}
                </div>

                {/* Restore button for archived jobs */}
                {job.status === 'archived' && (
                  <div className="pt-1">
                    <button
                      disabled={isBusy}
                      onClick={async () => {
                        setActionBusy(job.id);
                        await patchJob(job.id, { status: 'completed' }).catch(() => {});
                        setActionBusy(null);
                      }}
                      className="text-xs font-semibold text-caribe-600 border border-caribe-200 px-3 py-2 rounded-lg active:bg-caribe-50 disabled:opacity-50 min-h-[36px]"
                    >
                      Restore
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      </>
      )}

      {/* Confirmation dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.action === 'delete' ? 'Delete Cleaning Job?' : 'Archive Cleaning Job?'}
          message={
            confirm.action === 'delete'
              ? `This will soft-delete the cleaning job for ${confirm.unit}. It won't appear in any view.`
              : `Move the cleaning job for ${confirm.unit} to the archive?`
          }
          confirmLabel={confirm.action === 'delete' ? 'Delete' : 'Archive'}
          confirmClass={
            confirm.action === 'delete'
              ? 'bg-red-600 text-white active:bg-red-700'
              : 'bg-gray-800 text-white active:bg-gray-900'
          }
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Job forum overlay */}
      {selectedJob && (
        <JobForum
          job={jobs.find((j) => j.id === selectedJob.id) || selectedJob}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  );
}
