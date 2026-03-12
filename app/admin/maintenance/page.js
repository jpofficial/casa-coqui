'use client';

import { useState } from 'react';
import { orderBy, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useCollection } from '@/hooks/useFirestore';
import { db } from '@/lib/firebase';

const FILTER_TABS = ['All', 'Open', 'In Progress', 'Done'];

const STATUS_KEYS = {
  All: null,
  Open: 'open',
  'In Progress': 'in-progress',
  Done: 'done',
};

const STATUS_STYLES = {
  open: 'bg-red-100 text-red-600',
  'in-progress': 'bg-amber-100 text-amber-700',
  done: 'bg-green-100 text-green-700',
};

const STATUS_LABELS = {
  open: 'Open',
  'in-progress': 'In Progress',
  done: 'Done',
};

const CATEGORY_STYLES = {
  Plumbing: 'bg-blue-100 text-blue-700',
  Electrical: 'bg-yellow-100 text-yellow-700',
  HVAC: 'bg-cyan-100 text-cyan-700',
  Appliance: 'bg-purple-100 text-purple-700',
  Other: 'bg-gray-100 text-gray-600',
};

const URGENCY_STYLES = {
  Low: { dot: 'bg-green-500', label: 'text-green-600' },
  Medium: { dot: 'bg-amber-400', label: 'text-amber-600' },
  High: { dot: 'bg-red-500', label: 'text-red-600' },
};

const STATUS_TRANSITIONS = {
  open: [
    { key: 'in-progress', label: 'Mark In Progress' },
    { key: 'done', label: 'Mark Done' },
  ],
  'in-progress': [
    { key: 'open', label: 'Reopen' },
    { key: 'done', label: 'Mark Done' },
  ],
  done: [
    { key: 'open', label: 'Reopen' },
  ],
};

function timeAgo(dateValue) {
  if (!dateValue) return '';
  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function MaintenanceCard({ request }) {
  const [expanded, setExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(request.notes || '');
  const [saving, setSaving] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(false);

  const urgency = request.urgency || 'Low';
  const category = request.category || 'Other';
  const status = request.status || 'open';
  const urgencyStyle = URGENCY_STYLES[urgency] || URGENCY_STYLES.Low;
  const categoryStyle = CATEGORY_STYLES[category] || CATEGORY_STYLES.Other;
  const transitions = STATUS_TRANSITIONS[status] || [];

  async function handleStatusChange(newStatus) {
    try {
      await updateDoc(doc(db, 'maintenance', request.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  async function handleSaveNotes() {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'maintenance', request.id), {
        notes: notes.trim(),
        updatedAt: serverTimestamp(),
      });
      setShowNotes(false);
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${categoryStyle}`}>
            {category}
          </span>
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${urgencyStyle.label}`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${urgencyStyle.dot}`} />
            {urgency}
          </span>
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABELS[status] || status}
        </span>
      </div>

      {/* Description */}
      <div>
        <p className={`text-sm text-gray-800 leading-snug ${!expanded ? 'line-clamp-2' : ''}`}>
          {request.description}
        </p>
        {request.description && request.description.length > 120 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-green-600 font-medium mt-0.5"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Photo thumbnail */}
      {request.photoUrl && (
        <div>
          <button onClick={() => setViewPhoto(true)} className="block">
            <img
              src={request.photoUrl}
              alt="Maintenance photo"
              className="h-20 w-28 object-cover rounded-lg border border-gray-100"
            />
          </button>
          {viewPhoto && (
            <div
              className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
              onClick={() => setViewPhoto(false)}
            >
              <img
                src={request.photoUrl}
                alt="Full size"
                className="max-w-full max-h-full rounded-xl"
              />
            </div>
          )}
        </div>
      )}

      {/* Meta */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          {request.unit ? `Unit ${request.unit} · ` : ''}
          {timeAgo(request.createdAt)}
        </span>
        {request.guestName && <span className="truncate ml-2">{request.guestName}</span>}
      </div>

      {/* Admin notes preview */}
      {request.notes && !showNotes && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Note: </span>
          {request.notes}
        </div>
      )}

      {/* Notes editor */}
      {showNotes && (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add an admin note..."
            rows={3}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveNotes}
              disabled={saving}
              className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-xs font-semibold disabled:opacity-50 active:bg-green-700 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Note'}
            </button>
            <button
              onClick={() => { setNotes(request.notes || ''); setShowNotes(false); }}
              className="flex-1 bg-gray-100 text-gray-600 rounded-xl py-2.5 text-xs font-semibold active:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="flex flex-wrap gap-2 pt-1">
        {transitions.map((t) => (
          <button
            key={t.key}
            onClick={() => handleStatusChange(t.key)}
            className="flex-1 min-w-[100px] bg-gray-100 text-gray-700 rounded-xl py-2.5 text-xs font-semibold active:bg-gray-200 transition-colors"
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="flex-1 min-w-[100px] border border-gray-200 text-gray-600 rounded-xl py-2.5 text-xs font-semibold active:bg-gray-50 transition-colors"
        >
          {showNotes ? 'Hide Notes' : request.notes ? 'Edit Note' : 'Add Note'}
        </button>
      </div>
    </div>
  );
}

export default function MaintenancePage() {
  const [activeFilter, setActiveFilter] = useState('All');

  const { data: requests, loading } = useCollection('maintenance', [
    orderBy('createdAt', 'desc'),
  ]);

  const filtered =
    STATUS_KEYS[activeFilter] === null
      ? requests
      : requests.filter((r) => r.status === STATUS_KEYS[activeFilter]);

  const counts = {
    All: requests.length,
    Open: requests.filter((r) => r.status === 'open').length,
    'In Progress': requests.filter((r) => r.status === 'in-progress').length,
    Done: requests.filter((r) => r.status === 'done').length,
  };

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-5">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Maintenance</h1>
        <p className="text-sm text-gray-500 mt-0.5">Guest-submitted requests</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveFilter(tab)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-colors ${
              activeFilter === tab
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-500 shadow-sm border border-gray-100'
            }`}
          >
            {tab}
            {counts[tab] > 0 && (
              <span
                className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none ${
                  activeFilter === tab ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {counts[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Request list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/4 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-full mb-1" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center">
          <p className="text-gray-400 text-sm">
            {activeFilter === 'All'
              ? 'No maintenance requests yet'
              : `No ${activeFilter.toLowerCase()} requests`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <MaintenanceCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  );
}
