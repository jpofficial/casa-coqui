'use client';

import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
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
// Admin / Cohost — cleaning job management dashboard
// ---------------------------------------------------------------------------
function AdminCleaningDashboard({ user, role, isAdmin }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active'); // 'active' | 'completed' | 'archived'
  const [showForm, setShowForm] = useState(false);
  const [confirm, setConfirm] = useState(null); // { jobId, action: 'archive' | 'delete' }
  const [actionBusy, setActionBusy] = useState(null); // jobId being acted on
  const [selectedJob, setSelectedJob] = useState(null); // job to view in forum

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
