'use client';

import { useState, useCallback } from 'react';
import { where, orderBy, limit } from 'firebase/firestore';
import { useCollection } from '@/hooks/useFirestore';
import { auth } from '@/lib/firebase';

const TEMPLATES = [
  {
    id: 'checkout',
    label: 'Check-out Reminder',
    title: 'Check-out Reminder',
    message:
      'Friendly reminder: check-out is at 11 AM tomorrow. Please remember to leave your keys on the kitchen counter and ensure all lights are off before you leave.',
  },
  {
    id: 'quiet',
    label: 'Quiet Hours',
    title: 'Quiet Hours Reminder',
    message:
      'Please remember quiet hours are from 10 PM to 8 AM. Thank you for being considerate of your neighbors!',
  },
  {
    id: 'parking',
    label: 'Parking Alert',
    title: 'Parking Notice',
    message:
      'Please ensure your vehicle is in your designated parking spot.',
  },
  {
    id: 'welcome',
    label: 'Welcome',
    title: 'Welcome to Casa Coqui!',
    message:
      "We're glad you're here! Check the guest portal for everything you need — WiFi password, house rules, laundry info, and more.",
  },
];

function timeAgo(dateValue) {
  if (!dateValue) return '';
  const date =
    dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function BroadcastCard({ broadcast }) {
  const sent = broadcast.deliveryStats?.total ?? broadcast.sentCount ?? null;
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{broadcast.title}</p>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{broadcast.message}</p>
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
          {timeAgo(broadcast.createdAt)}
        </span>
      </div>
      {sent !== null && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Sent to {sent}
          </span>
          {broadcast.deliveryStats?.push != null && (
            <span className="text-xs text-gray-400">
              {broadcast.deliveryStats.push} push · {broadcast.deliveryStats.sms ?? 0} SMS
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function NotifyPage() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { success, message }

  const { data: broadcasts, loading: broadcastsLoading } = useCollection(
    'notifications',
    [where('type', '==', 'broadcast'), orderBy('createdAt', 'desc'), limit(10)]
  );

  function applyTemplate(template) {
    setTitle(template.title);
    setMessage(template.message);
    setResult(null);
  }

  const handleSend = useCallback(
    async (e) => {
      e.preventDefault();
      if (!title.trim() || !message.trim()) return;
      setSending(true);
      setResult(null);
      try {
        const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
        const res = await fetch('/api/notifications/broadcast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken && { Authorization: `Bearer ${idToken}` }),
          },
          body: JSON.stringify({ title: title.trim(), message: message.trim() }),
        });
        const json = await res.json();
        if (res.ok && json.success) {
          const stats = json.data?.deliveryStats;
          let detail = '';
          if (stats) {
            const parts = [];
            if (stats.push) parts.push(`${stats.push} push`);
            if (stats.sms) parts.push(`${stats.sms} SMS`);
            detail = parts.length ? ` (${parts.join(', ')})` : '';
          }
          setResult({ success: true, message: `Alert sent${detail}.` });
          setTitle('');
          setMessage('');
        } else {
          setResult({ success: false, message: json.error || 'Failed to send alert.' });
        }
      } catch {
        setResult({ success: false, message: 'Network error. Please try again.' });
      } finally {
        setSending(false);
      }
    },
    [title, message]
  );

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Alerts</h1>
        <p className="text-sm text-gray-500 mt-0.5">Send a push notification to all active guests</p>
      </div>

      {/* Quick-send templates */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Quick Send
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => applyTemplate(t)}
              className="bg-white rounded-xl shadow-sm px-3 py-3 text-left text-sm font-medium text-gray-700 active:bg-gray-50 transition-colors border border-transparent hover:border-green-200"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Compose form */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Compose Message
        </h2>
        <form onSubmit={handleSend} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="notify-title">
              Title
            </label>
            <input
              id="notify-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Quick Reminder"
              required
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="notify-message">
              Message
            </label>
            <textarea
              id="notify-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message here..."
              rows={4}
              required
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
            />
          </div>

          {result && (
            <div
              className={`rounded-xl px-4 py-3 text-sm font-medium ${
                result.success
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-600'
              }`}
            >
              {result.message}
            </div>
          )}

          <button
            type="submit"
            disabled={sending || !title.trim() || !message.trim()}
            className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed active:bg-green-700 transition-colors"
          >
            {sending ? 'Sending...' : 'Send to All Guests'}
          </button>
        </form>
      </div>

      {/* Recent broadcasts */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Recent Alerts
        </h2>

        {broadcastsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <p className="text-gray-400 text-sm">No alerts sent yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {broadcasts.map((b) => (
              <BroadcastCard key={b.id} broadcast={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
