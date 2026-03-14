'use client';

import { useState, useEffect, useMemo } from 'react';
import useAuth from '@/hooks/useAuth';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useDocument } from '@/hooks/useFirestore';
import { getUnitsWithShared } from '@/lib/units';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PRIORITY_ACCENT = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-gray-300',
};

const PRIORITY_BADGE = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-500',
};

const PRIORITY_LABEL = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const STATUS_BADGE = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const STATUS_LABELS = {
  pending: 'To Do',
  in_progress: 'In Progress',
  completed: 'Done',
  cancelled: 'Cancelled',
};

const CATEGORY_STYLES = {
  Plumbing: 'bg-blue-100 text-blue-700',
  Electrical: 'bg-yellow-100 text-yellow-700',
  HVAC: 'bg-cyan-100 text-cyan-700',
  Appliance: 'bg-purple-100 text-purple-700',
  Other: 'bg-gray-100 text-gray-600',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

function isOverdue(dueDate, status) {
  if (!dueDate || status === 'completed' || status === 'cancelled') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate) < today;
}

// ---------------------------------------------------------------------------
// Icons (inline SVGs)
// ---------------------------------------------------------------------------
function PersonIcon({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function CalendarIcon({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function ClockIcon({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function WrenchIcon({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function HomeIcon({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function AlertIcon({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------
function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden animate-pulse flex">
      <div className="w-1 bg-gray-200 flex-shrink-0" />
      <div className="p-4 flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-5 bg-gray-100 rounded-full w-28" />
          <div className="h-5 bg-gray-100 rounded-full w-16" />
        </div>
        <div className="h-4 bg-gray-100 rounded w-3/4" />
        <div className="h-3 bg-gray-100 rounded w-full" />
        <div className="flex gap-4">
          <div className="h-3 bg-gray-100 rounded w-20" />
          <div className="h-3 bg-gray-100 rounded w-24" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignment Card — redesigned for clarity
// ---------------------------------------------------------------------------
function AssignmentCard({ assignment, canManage, isAdmin, staffMembers, onUpdateStatus, onPatch }) {
  const [completing, setCompleting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRespond, setShowRespond] = useState(false);
  const [guestResponse, setGuestResponse] = useState(assignment.guestResponse || '');
  const [estimatedTime, setEstimatedTime] = useState(assignment.estimatedTime || '');
  const [sendingResponse, setSendingResponse] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(false);

  const a = assignment;
  const isMaintenance = a.source === 'maintenance';
  const isUnassigned = !a.assigneeId;
  const overdue = isOverdue(a.dueDate, a.status);

  // Extract category from title for maintenance tasks (format: "Maintenance: Category")
  const maintenanceCategory = isMaintenance && a.title
    ? a.title.replace('Maintenance: ', '')
    : null;

  const displayTitle = isMaintenance ? 'Maintenance Request' : a.title;

  async function handleStatusChange(newStatus) {
    if (newStatus === 'completed' && !completing) {
      setCompleting(true);
      return;
    }
    setBusy(true);
    await onUpdateStatus(a.id, newStatus, newStatus === 'completed' ? note : undefined);
    setBusy(false);
    setCompleting(false);
    setNote('');
  }

  async function handleSendResponse() {
    if (!guestResponse.trim() && !estimatedTime.trim()) return;
    setSendingResponse(true);
    try {
      const updates = {};
      if (guestResponse.trim()) updates.guestResponse = guestResponse.trim();
      if (estimatedTime.trim()) updates.estimatedTime = estimatedTime.trim();
      await onPatch(a.id, updates);
      setShowRespond(false);
    } catch (err) {
      console.error('Failed to send response:', err);
    } finally {
      setSendingResponse(false);
    }
  }

  async function handleAssign(assigneeId) {
    setBusy(true);
    await onPatch(a.id, { assigneeId });
    setBusy(false);
    setShowAssign(false);
  }

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden flex">
      {/* Priority accent bar */}
      <div className={`w-1 flex-shrink-0 ${PRIORITY_ACCENT[a.priority] || PRIORITY_ACCENT.medium}`} />

      <div className="flex-1 min-w-0">
        <div className="p-4 space-y-3">
          {/* Row 1: Source + Status + Priority badges */}
          <div className="flex items-center flex-wrap gap-1.5">
            {isMaintenance && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-700">
                <WrenchIcon className="w-3 h-3" />
                Guest Request
              </span>
            )}
            {isMaintenance && maintenanceCategory && (
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${CATEGORY_STYLES[maintenanceCategory] || CATEGORY_STYLES.Other}`}>
                {maintenanceCategory}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_BADGE[a.status]}`}>
              {STATUS_LABELS[a.status]}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${PRIORITY_BADGE[a.priority]}`}>
              {PRIORITY_LABEL[a.priority]}
            </span>
            {overdue && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">
                <AlertIcon className="w-3 h-3" />
                Overdue
              </span>
            )}
            {isUnassigned && a.status !== 'completed' && a.status !== 'cancelled' && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-600">
                Unassigned
              </span>
            )}
          </div>

          {/* Row 2: Title */}
          <h3 className="text-sm font-bold text-gray-900 leading-snug">
            {displayTitle}
          </h3>

          {/* Row 3: Description */}
          {a.description && (
            <p className="text-sm text-gray-500 leading-relaxed">
              {a.description}
            </p>
          )}

          {/* Maintenance photo */}
          {isMaintenance && a.photoUrl && (
            <div>
              <button onClick={() => setViewPhoto(true)} className="block rounded-lg overflow-hidden">
                <img
                  src={a.photoUrl}
                  alt="Maintenance photo"
                  className="h-24 w-32 object-cover border border-gray-100 rounded-lg"
                />
              </button>
              {viewPhoto && (
                <div
                  className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
                  onClick={() => setViewPhoto(false)}
                >
                  <img src={a.photoUrl} alt="Full size" className="max-w-full max-h-full rounded-xl" />
                </div>
              )}
            </div>
          )}

          {/* Row 4: Meta details — icon + text pairs */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500">
            {canManage && !isUnassigned && (
              <span className="inline-flex items-center gap-1">
                <PersonIcon className="w-3.5 h-3.5 text-gray-400" />
                {a.assigneeName}
              </span>
            )}
            {a.unit && (
              <span className="inline-flex items-center gap-1">
                <HomeIcon className="w-3.5 h-3.5 text-gray-400" />
                {a.unit}
              </span>
            )}
            {a.dueDate && (
              <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : ''}`}>
                <CalendarIcon className="w-3.5 h-3.5" />
                Due {formatDate(a.dueDate)}
              </span>
            )}
            {a.createdAt && (
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="w-3.5 h-3.5 text-gray-400" />
                {timeAgo(a.createdAt)}
              </span>
            )}
            {a.completedAt && (
              <span className="inline-flex items-center gap-1 text-green-600">
                <CalendarIcon className="w-3.5 h-3.5" />
                Done {formatDate(a.completedAt)}
              </span>
            )}
          </div>

          {/* Guest response display */}
          {isMaintenance && (a.guestResponse || a.estimatedTime) && !showRespond && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 space-y-1">
              {a.guestResponse && (
                <p className="text-xs text-blue-800">
                  <span className="font-semibold">Response:</span> {a.guestResponse}
                </p>
              )}
              {a.estimatedTime && (
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">ETA:</span> {a.estimatedTime}
                </p>
              )}
            </div>
          )}

          {/* Completion note */}
          {a.completionNote && a.status === 'completed' && (
            <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
              <p className="text-xs text-green-700">{a.completionNote}</p>
            </div>
          )}

          {/* Respond to Guest editor (maintenance only) */}
          {showRespond && (
            <div className="space-y-2 bg-blue-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-blue-800">Respond to Guest</p>
              <textarea
                value={guestResponse}
                onChange={(e) => setGuestResponse(e.target.value)}
                placeholder="Message to guest (e.g. 'We've dispatched a plumber')"
                rows={3}
                className="w-full rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
              <input
                type="text"
                value={estimatedTime}
                onChange={(e) => setEstimatedTime(e.target.value)}
                placeholder="Estimated time (e.g. 'Tomorrow morning', '2-3 hours')"
                className="w-full rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSendResponse}
                  disabled={sendingResponse || (!guestResponse.trim() && !estimatedTime.trim())}
                  className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-xs font-semibold disabled:opacity-50 active:bg-blue-700 transition-colors"
                >
                  {sendingResponse ? 'Sending...' : 'Send to Guest'}
                </button>
                <button
                  onClick={() => {
                    setGuestResponse(a.guestResponse || '');
                    setEstimatedTime(a.estimatedTime || '');
                    setShowRespond(false);
                  }}
                  className="flex-1 bg-white text-gray-600 border border-gray-200 rounded-xl py-2.5 text-xs font-semibold active:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Assign dropdown */}
          {showAssign && canManage && (
            <div>
              <select
                onChange={(e) => { if (e.target.value) handleAssign(e.target.value); }}
                disabled={busy}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                defaultValue=""
              >
                <option value="" disabled>Select team member</option>
                {staffMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || m.email} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Action buttons */}
          {(a.status !== 'completed' && a.status !== 'cancelled') && !completing && (
            <div className="flex flex-wrap gap-2 pt-1">
              {/* Primary status action */}
              {a.status === 'pending' && (
                <button
                  disabled={busy}
                  onClick={() => handleStatusChange('in_progress')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold active:bg-blue-700 disabled:opacity-50 min-h-[36px]"
                >
                  Start Task
                </button>
              )}
              {a.status === 'in_progress' && (
                <button
                  disabled={busy}
                  onClick={() => handleStatusChange('completed')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold active:bg-green-700 disabled:opacity-50 min-h-[36px]"
                >
                  Mark Done
                </button>
              )}

              {/* Assign */}
              {canManage && isUnassigned && (
                <button
                  onClick={() => setShowAssign(!showAssign)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 text-xs font-semibold active:bg-orange-100 min-h-[36px]"
                >
                  {showAssign ? 'Cancel' : 'Assign'}
                </button>
              )}

              {/* Respond to guest */}
              {isMaintenance && (
                <button
                  onClick={() => setShowRespond(!showRespond)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold active:bg-blue-100 min-h-[36px]"
                >
                  {showRespond ? 'Cancel' : a.guestResponse ? 'Edit Response' : 'Respond'}
                </button>
              )}
            </div>
          )}

          {/* Completion flow */}
          {completing && (
            <div className="space-y-2 pt-1">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Completion note (optional)"
                className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => handleStatusChange('completed')}
                  className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-lg active:bg-green-700 disabled:opacity-50 min-h-[36px]"
                >
                  {busy ? 'Saving...' : 'Confirm Done'}
                </button>
                <button
                  onClick={() => { setCompleting(false); setNote(''); }}
                  className="px-4 text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg min-h-[36px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Reopen button for completed tasks */}
          {canManage && a.status === 'completed' && (
            <div className="pt-1">
              <button
                disabled={busy}
                onClick={() => handleStatusChange('pending')}
                className="text-xs font-semibold text-gray-500 border border-gray-200 px-3 py-2 rounded-lg active:bg-gray-50 disabled:opacity-50 min-h-[36px]"
              >
                Reopen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyState({ tab, canManage }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-8 text-center">
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      </div>
      <p className="text-gray-700 font-medium">
        {tab === 'active' ? 'No active tasks' : 'No completed tasks'}
      </p>
      <p className="text-sm text-gray-400 mt-1">
        {tab === 'active'
          ? (canManage ? 'Create a task to assign work to your team.' : 'When tasks are assigned to you, they\u2019ll appear here.')
          : 'Completed tasks will show up here.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Assignment Modal
// ---------------------------------------------------------------------------
function CreateAssignmentModal({ user, staffMembers, settings, onClose }) {
  const unitOptions = getUnitsWithShared(settings);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !assigneeId) return;

    setSaving(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          assigneeId,
          dueDate: dueDate || null,
          priority,
          unit: unit || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        onClose();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New Task</h2>
          <button onClick={onClose} className="text-gray-400 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
              placeholder="e.g. Check if guest left charger in Unit A"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Additional details or instructions"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign To *</label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              <option value="">Select team member</option>
              {staffMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName || m.email} ({m.role})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              <option value="">None</option>
              {unitOptions.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={saving || !title.trim() || !assigneeId}
            className="w-full bg-green-600 text-white font-medium py-3 rounded-lg active:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Task'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AssignmentsPage() {
  const { user, role, isAdmin } = useAuth();
  const isCohost = role === 'cohost';
  const canManage = isAdmin || isCohost;
  const { data: settings } = useDocument('settings', 'property');
  const [assignments, setAssignments] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState('active');

  // Real-time listener for assignments
  useEffect(() => {
    if (!user || !role) return;

    let q;
    if (canManage) {
      q = query(collection(db, 'assignments'), orderBy('createdAt', 'desc'));
    } else {
      q = query(
        collection(db, 'assignments'),
        where('assigneeId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setAssignments(items);
      setLoading(false);
    });

    return unsub;
  }, [user, role, canManage]);

  // Fetch staff members for assignment dropdown (admin/cohost)
  useEffect(() => {
    if (!canManage || !user) return;

    const q = query(collection(db, 'users'));
    const unsub = onSnapshot(q, (snapshot) => {
      const members = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((m) => m.status !== 'deactivated' && m.role !== 'admin');
      setStaffMembers(members);
    });

    return unsub;
  }, [canManage, user]);

  const activeAssignments = useMemo(
    () => assignments.filter((a) => a.status === 'pending' || a.status === 'in_progress'),
    [assignments]
  );
  const completedAssignments = useMemo(
    () => assignments.filter((a) => a.status === 'completed' || a.status === 'cancelled'),
    [assignments]
  );
  const displayList = tab === 'active' ? activeAssignments : completedAssignments;

  // Count overdue for the header
  const overdueCount = useMemo(
    () => activeAssignments.filter((a) => isOverdue(a.dueDate, a.status)).length,
    [activeAssignments]
  );

  async function patchAssignment(assignmentId, body) {
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function updateStatus(assignmentId, newStatus, completionNote) {
    const body = { status: newStatus };
    if (completionNote) body.completionNote = completionNote;
    await patchAssignment(assignmentId, body);
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {canManage ? 'Tasks' : 'My Tasks'}
          </h1>
          {!loading && overdueCount > 0 && (
            <p className="text-xs text-red-600 font-medium mt-0.5">
              {overdueCount} overdue
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg active:bg-green-700 min-h-[44px]"
          >
            + New Task
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setTab('active')}
          className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
            tab === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          Active ({activeAssignments.length})
        </button>
        <button
          onClick={() => setTab('completed')}
          className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
            tab === 'completed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          Completed ({completedAssignments.length})
        </button>
      </div>

      {/* Task list */}
      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : displayList.length === 0 ? (
        <EmptyState tab={tab} canManage={canManage} />
      ) : (
        <div className="space-y-3">
          {displayList.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              canManage={canManage}
              isAdmin={isAdmin}
              staffMembers={staffMembers}
              onUpdateStatus={updateStatus}
              onPatch={patchAssignment}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateAssignmentModal
          user={user}
          staffMembers={staffMembers}
          settings={settings}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
