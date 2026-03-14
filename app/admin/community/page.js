'use client';

import { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import Community from '@/components/guest/Community';

const POST_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'parking', label: 'Parking' },
  { value: 'laundry', label: 'Laundry' },
  { value: 'property_issue', label: 'Property Issue' },
];

const FILTER_MODES = [
  { value: 'last7', label: 'Last 7 days' },
  { value: 'all', label: 'All posts' },
  { value: 'custom', label: 'Custom range' },
];

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export default function AdminCommunityPage() {
  const { user, role } = useAuth();
  const canDelete = role === 'admin' || role === 'cohost';
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [type, setType] = useState('general');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleDeletePost(postId) {
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/community/${postId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
  }

  // Filter state
  const [filterMode, setFilterMode] = useState('last7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Compute dateFrom/dateTo based on filter mode
  let dateFrom = null;
  let dateTo = null;
  if (filterMode === 'last7') {
    dateFrom = getDateNDaysAgo(7);
  } else if (filterMode === 'custom') {
    dateFrom = customFrom || null;
    dateTo = customTo || null;
  }
  // 'all' leaves both null

  async function handlePost(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'community'), {
        message: message.trim(),
        type,
        photoUrl: null,
        bookingCode: null,
        postedByRole: role || 'admin',
        createdAt: new Date().toISOString(),
      });
      setMessage('');
      setType('general');
      setShowForm(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to post:', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto pb-8 space-y-4">
      {/* Post button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full bg-coqui-600 hover:bg-coqui-700 text-white font-semibold rounded-xl px-4 py-3 text-sm transition flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Post to Broadcast
        </button>
      )}

      {/* Compose form */}
      {showForm && (
        <form onSubmit={handlePost} className="bg-white rounded-xl border border-cafe-200 p-4 space-y-3 shadow-brand">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-coqui-900">New Post (as Host)</p>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-coqui-800/50 hover:text-coqui-900 transition-colors"
            >
              Cancel
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            {POST_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                  type === t.value
                    ? 'border-coqui-600 bg-coqui-50 text-coqui-700'
                    : 'border-cafe-200 bg-white text-coqui-800/60 hover:border-coqui-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message..."
            rows={3}
            className="admin-input-focus w-full rounded-lg border border-cafe-200 px-4 py-2.5 text-sm text-coqui-900 placeholder-cafe-400 resize-none focus:outline-none"
          />

          <button
            type="submit"
            disabled={!message.trim() || submitting}
            className="w-full bg-coqui-600 hover:bg-coqui-700 disabled:bg-coqui-300 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition"
          >
            {submitting ? 'Posting...' : 'Post'}
          </button>
        </form>
      )}

      {/* Success toast */}
      {success && (
        <div className="flex items-center gap-2 bg-coqui-50 border border-coqui-100 rounded-lg px-4 py-3">
          <svg className="w-5 h-5 text-coqui-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-coqui-800 font-medium">Posted to Broadcast</p>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-cafe-200 p-3 shadow-brand space-y-3">
        <p className="text-xs font-semibold text-coqui-800/60 uppercase tracking-wide">Filter posts</p>
        <div className="flex gap-2 flex-wrap">
          {FILTER_MODES.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilterMode(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                filterMode === f.value
                  ? 'border-coqui-600 bg-coqui-50 text-coqui-700'
                  : 'border-cafe-200 bg-white text-coqui-800/60 hover:border-coqui-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filterMode === 'custom' && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="admin-input-focus flex-1 rounded-lg border border-cafe-200 px-3 py-2 text-sm text-coqui-900 focus:outline-none"
            />
            <span className="text-xs text-coqui-800/50">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="admin-input-focus flex-1 rounded-lg border border-cafe-200 px-3 py-2 text-sm text-coqui-900 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Feed — showBookingCode=true for admin visibility */}
      <Community showBookingCode={true} hidePostButton dateFrom={dateFrom} dateTo={dateTo} canDelete={canDelete} onDelete={handleDeletePost} />
    </div>
  );
}
