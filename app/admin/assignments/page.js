'use client';

import { useState, useEffect, useCallback } from 'react';
import useAuth from '@/hooks/useAuth';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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

export default function AssignmentsPage() {
  const { user, role, isAdmin } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState('active'); // 'active' | 'completed'

  // Real-time listener for assignments
  useEffect(() => {
    if (!user || !role) return;

    let q;
    if (isAdmin) {
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
  }, [user, role, isAdmin]);

  // Fetch staff members for assignment dropdown (admin only)
  useEffect(() => {
    if (!isAdmin || !user) return;

    const q = query(collection(db, 'users'));
    const unsub = onSnapshot(q, (snapshot) => {
      const members = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((m) => m.status !== 'deactivated' && m.role !== 'admin');
      setStaffMembers(members);
    });

    return unsub;
  }, [isAdmin, user]);

  const activeAssignments = assignments.filter(
    (a) => a.status === 'pending' || a.status === 'in_progress'
  );
  const completedAssignments = assignments.filter(
    (a) => a.status === 'completed' || a.status === 'cancelled'
  );
  const displayList = tab === 'active' ? activeAssignments : completedAssignments;

  async function updateStatus(assignmentId, newStatus, completionNote) {
    const idToken = await user.getIdToken();
    const body = { status: newStatus };
    if (completionNote) body.completionNote = completionNote;
    await fetch(`/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
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
          {isAdmin ? 'Assignments' : 'My Tasks'}
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
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg font-medium">
            {tab === 'active' ? 'No active tasks' : 'No completed tasks'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              isAdmin={isAdmin}
              onUpdateStatus={updateStatus}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateAssignmentModal
          user={user}
          staffMembers={staffMembers}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function AssignmentCard({ assignment, isAdmin, onUpdateStatus }) {
  const [completing, setCompleting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const a = assignment;
  const isOverdue = a.dueDate && a.status !== 'completed' && new Date(a.dueDate) < new Date();

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

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-gray-900 text-sm leading-tight">{a.title}</h3>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_STYLES[a.priority]}`}>
          {a.priority}
        </span>
      </div>

      {a.description && (
        <p className="text-xs text-gray-500 mb-2">{a.description}</p>
      )}

      <div className="flex flex-wrap gap-2 text-[11px] text-gray-400 mb-3">
        {isAdmin && <span>Assigned to: {a.assigneeName}</span>}
        {a.unit && <span>{a.unit}</span>}
        {a.dueDate && (
          <span className={isOverdue ? 'text-red-500 font-semibold' : ''}>
            Due: {formatDate(a.dueDate)}{isOverdue ? ' (overdue)' : ''}
          </span>
        )}
        {a.completedAt && <span>Completed: {formatDate(a.completedAt)}</span>}
      </div>

      {a.completionNote && a.status === 'completed' && (
        <div className="bg-green-50 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-green-700">{a.completionNote}</p>
        </div>
      )}

      {/* Action buttons */}
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

      {/* Admin reopen/cancel for completed tasks */}
      {isAdmin && a.status === 'completed' && (
        <button
          disabled={busy}
          onClick={() => handleStatusChange('pending')}
          className="w-full text-sm text-gray-500 border border-gray-200 py-2 rounded-lg active:bg-gray-50 disabled:opacity-50"
        >
          Reopen Task
        </button>
      )}
    </div>
  );
}

function CreateAssignmentModal({ user, staffMembers, onClose }) {
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
              <option value="Unit A">Unit A</option>
              <option value="Unit B">Unit B</option>
              <option value="Shared">Shared</option>
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
