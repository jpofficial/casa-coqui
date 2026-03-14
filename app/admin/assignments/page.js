'use client';

import { useState, useEffect } from 'react';
import useAuth from '@/hooks/useAuth';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useDocument } from '@/hooks/useFirestore';
import { getUnitsWithShared } from '@/lib/units';

const PRIORITY_STYLES = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
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

export default function AssignmentsPage() {
  const { user, role, isAdmin } = useAuth();
  const isCohost = role === 'cohost';
  const canManage = isAdmin || isCohost;
  const { data: settings } = useDocument('settings', 'property');
  const [assignments, setAssignments] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState('active'); // 'active' | 'completed'

  // Real-time listener for assignments
  useEffect(() => {
    if (!user || !role) return;

    let q;
    if (canManage) {
      // Admin and cohost see all assignments (including unassigned maintenance tasks)
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

  const activeAssignments = assignments.filter(
    (a) => a.status === 'pending' || a.status === 'in_progress'
  );
  const completedAssignments = assignments.filter(
    (a) => a.status === 'completed' || a.status === 'cancelled'
  );
  const displayList = tab === 'active' ? activeAssignments : completedAssignments;

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

  if (loading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">
          {canManage ? 'Tasks' : 'My Tasks'}
        </h1>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg active:bg-green-700"
          >
            + New Task
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
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

      {/* Assignment list */}
      {displayList.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <p className="text-base font-medium text-gray-700">
            {tab === 'active' ? 'No active tasks' : 'No completed tasks'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {tab === 'active'
              ? (canManage ? 'Create a task to assign work to your team.' : 'When tasks are assigned to you, they\u2019ll appear here.')
              : 'Completed tasks will show up here.'}
          </p>
        </div>
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
  const isOverdue = a.dueDate && a.status !== 'completed' && new Date(a.dueDate) < new Date();

  // Extract category from title for maintenance tasks (format: "Maintenance: Category")
  const maintenanceCategory = isMaintenance && a.title
    ? a.title.replace('Maintenance: ', '')
    : null;

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
    <div className={`bg-white rounded-xl border p-4 shadow-sm ${isMaintenance ? 'border-orange-200' : 'border-gray-200'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {isMaintenance && maintenanceCategory && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${CATEGORY_STYLES[maintenanceCategory] || CATEGORY_STYLES.Other}`}>
              {maintenanceCategory}
            </span>
          )}
          <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
            {isMaintenance ? 'Maintenance Request' : a.title}
          </h3>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_STYLES[a.priority]}`}>
          {a.priority}
        </span>
      </div>

      {a.description && (
        <p className="text-xs text-gray-500 mb-2">{a.description}</p>
      )}

      {/* Maintenance photo */}
      {isMaintenance && a.photoUrl && (
        <div className="mb-2">
          <button onClick={() => setViewPhoto(true)} className="block">
            <img
              src={a.photoUrl}
              alt="Maintenance photo"
              className="h-20 w-28 object-cover rounded-lg border border-gray-100"
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

      {/* Meta row */}
      <div className="flex flex-wrap gap-2 text-[11px] text-gray-400 mb-3">
        {canManage && (
          <span className={isUnassigned ? 'text-orange-500 font-semibold' : ''}>
            {isUnassigned ? 'Unassigned' : `Assigned to: ${a.assigneeName}`}
          </span>
        )}
        {isMaintenance && <span className="text-orange-500">Guest request</span>}
        {a.unit && <span>{a.unit}</span>}
        {a.dueDate && (
          <span className={isOverdue ? 'text-red-500 font-semibold' : ''}>
            Due: {formatDate(a.dueDate)}{isOverdue ? ' (overdue)' : ''}
          </span>
        )}
        {a.completedAt && <span>Completed: {formatDate(a.completedAt)}</span>}
      </div>

      {/* Existing guest response display */}
      {isMaintenance && (a.guestResponse || a.estimatedTime) && !showRespond && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs space-y-1 mb-3">
          {a.guestResponse && (
            <p className="text-blue-800">
              <span className="font-medium">Response: </span>{a.guestResponse}
            </p>
          )}
          {a.estimatedTime && (
            <p className="text-blue-700">
              <span className="font-medium">ETA: </span>{a.estimatedTime}
            </p>
          )}
        </div>
      )}

      {a.completionNote && a.status === 'completed' && (
        <div className="bg-green-50 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-green-700">{a.completionNote}</p>
        </div>
      )}

      {/* Respond to Guest editor (maintenance only) */}
      {showRespond && (
        <div className="space-y-2 bg-blue-50 rounded-xl p-3 mb-3">
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

      {/* Assign dropdown (for unassigned tasks) */}
      {showAssign && canManage && (
        <div className="mb-3">
          <select
            onChange={(e) => { if (e.target.value) handleAssign(e.target.value); }}
            disabled={busy}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
      <div className="space-y-2">
        {a.status === 'pending' && (
          <button
            disabled={busy}
            onClick={() => handleStatusChange('in_progress')}
            className="w-full bg-blue-600 text-white text-sm font-medium py-2.5 rounded-lg active:bg-blue-700 disabled:opacity-50"
          >
            Start Task
          </button>
        )}

        {a.status === 'in_progress' && !completing && (
          <button
            disabled={busy}
            onClick={() => handleStatusChange('completed')}
            className="w-full bg-green-600 text-white text-sm font-medium py-2.5 rounded-lg active:bg-green-700 disabled:opacity-50"
          >
            Mark Done
          </button>
        )}

        {completing && (
          <div className="space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Completion note (optional)"
              className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none"
              rows={2}
            />
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => handleStatusChange('completed')}
                className="flex-1 bg-green-600 text-white text-sm font-medium py-2 rounded-lg active:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Saving...' : 'Confirm Done'}
              </button>
              <button
                onClick={() => { setCompleting(false); setNote(''); }}
                className="px-4 text-sm text-gray-500 border border-gray-200 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Secondary actions row */}
        <div className="flex flex-wrap gap-2">
          {/* Admin reopen for completed tasks */}
          {canManage && a.status === 'completed' && (
            <button
              disabled={busy}
              onClick={() => handleStatusChange('pending')}
              className="flex-1 text-sm text-gray-500 border border-gray-200 py-2 rounded-lg active:bg-gray-50 disabled:opacity-50"
            >
              Reopen
            </button>
          )}

          {/* Assign button for unassigned tasks */}
          {canManage && isUnassigned && a.status !== 'completed' && (
            <button
              onClick={() => setShowAssign(!showAssign)}
              className="flex-1 text-sm text-orange-600 bg-orange-50 border border-orange-200 py-2 rounded-lg active:bg-orange-100"
            >
              {showAssign ? 'Cancel' : 'Assign'}
            </button>
          )}

          {/* Respond to Guest button (maintenance tasks only) */}
          {isMaintenance && a.status !== 'completed' && (
            <button
              onClick={() => setShowRespond(!showRespond)}
              className="flex-1 text-sm text-blue-700 bg-blue-50 border border-blue-200 py-2 rounded-lg active:bg-blue-100"
            >
              {showRespond ? 'Cancel' : a.guestResponse ? 'Edit Response' : 'Respond to Guest'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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
          <button onClick={onClose} className="text-gray-400 p-2">
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

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
