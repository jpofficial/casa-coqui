'use client';

import { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import Community from '@/components/guest/Community';

const POST_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'parking', label: 'Parking' },
  { value: 'noise', label: 'Noise' },
  { value: 'lost_found', label: 'Lost & Found' },
];

export default function AdminCommunityPage() {
  const { user, role } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [type, setType] = useState('general');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

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
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl px-4 py-3 text-sm transition flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Post to Community Board
        </button>
      )}

      {/* Compose form */}
      {showForm && (
        <form onSubmit={handlePost} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">New Post (as Host)</p>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-400 hover:text-gray-600"
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
                    ? 'border-green-600 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600'
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
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />

          <button
            type="submit"
            disabled={!message.trim() || submitting}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition"
          >
            {submitting ? 'Posting...' : 'Post'}
          </button>
        </form>
      )}

      {/* Success toast */}
      {success && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-800 font-medium">Posted to community board</p>
        </div>
      )}

      {/* Feed — showBookingCode=true for admin visibility */}
      <Community showBookingCode={true} />
    </div>
  );
}
