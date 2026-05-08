'use client';

import { useState, useCallback } from 'react';
import { where, orderBy, limit } from 'firebase/firestore';
import { useCollection } from '@/hooks/useFirestore';
import { auth } from '@/lib/firebase';

// ── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'welcome',
    label: 'Welcome Message',
    description: 'Greet new arrivals',
    icon: '👋',
    urgency: 'info',
    urgencyLabel: 'Welcome',
    title: 'Welcome to Casa Coqui!',
    message:
      "We're glad you're here! Check the guest portal for everything you need — WiFi password, house rules, laundry info, and more.",
  },
  {
    id: 'checkout',
    label: 'Check-out Reminder',
    description: 'Departure instructions',
    icon: '🚪',
    urgency: 'reminder',
    urgencyLabel: 'Reminder',
    title: 'Check-out Reminder',
    message:
      'Friendly reminder: check-out is at 11 AM tomorrow. Please remember to leave your keys on the kitchen counter and ensure all lights are off before you leave.',
  },
  {
    id: 'quiet',
    label: 'Quiet Hours',
    description: 'Courtesy reminder',
    icon: '🌙',
    urgency: 'reminder',
    urgencyLabel: 'Reminder',
    title: 'Quiet Hours Reminder',
    message:
      'Please remember quiet hours are from 10 PM to 8 AM. Thank you for being considerate of your neighbors!',
  },
  {
    id: 'parking',
    label: 'Parking Notice',
    description: 'Vehicle compliance',
    icon: '🚗',
    urgency: 'alert',
    urgencyLabel: 'Alert',
    title: 'Parking Notice',
    message: 'Please ensure your vehicle is in your designated parking spot.',
  },
];

// ── Urgency styles ────────────────────────────────────────────────────────────

const URGENCY_STYLES = {
  info: {
    badge: 'bg-caribe-100 text-caribe-700',
    border: 'border-caribe-200',
    bg: 'bg-caribe-50',
  },
  reminder: {
    badge: 'bg-atardecer-100 text-atardecer-700',
    border: 'border-atardecer-200',
    bg: 'bg-atardecer-50',
  },
  alert: {
    badge: 'bg-flamboyan-100 text-flamboyan-700',
    border: 'border-flamboyan-200',
    bg: 'bg-flamboyan-50',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function inferUrgency(title) {
  if (!title) return 'info';
  const lower = title.toLowerCase();
  if (
    lower.includes('alert') ||
    lower.includes('parking') ||
    lower.includes('urgent') ||
    lower.includes('notice')
  )
    return 'alert';
  if (
    lower.includes('reminder') ||
    lower.includes('quiet') ||
    lower.includes('check')
  )
    return 'reminder';
  return 'info';
}

function inferIcon(title) {
  if (!title) return '📢';
  const lower = title.toLowerCase();
  if (lower.includes('welcome')) return '👋';
  if (lower.includes('check-out') || lower.includes('checkout')) return '🚪';
  if (lower.includes('quiet')) return '🌙';
  if (lower.includes('parking')) return '🚗';
  return '📢';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TemplateCard({ template, onApply }) {
  const style = URGENCY_STYLES[template.urgency];
  return (
    <button
      onClick={() => onApply(template)}
      className={`w-full text-left bg-white border ${style.border} rounded-xl p-4 shadow-brand hover:shadow-brand-md active:scale-[0.98] transition-all duration-150`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0 mt-0.5">{template.icon}</span>
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-coqui-900">
              {template.label}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${style.badge}`}
            >
              {template.urgencyLabel}
            </span>
          </div>
          <p className="text-xs text-coqui-800/50">{template.description}</p>
          <p className="text-xs text-coqui-800/50 mt-1.5 line-clamp-1 italic">
            &ldquo;{template.message.slice(0, 60)}...&rdquo;
          </p>
        </div>
      </div>
    </button>
  );
}

function BroadcastCard({ broadcast, index }) {
  const sent = broadcast.deliveryStats?.total ?? broadcast.sentCount ?? null;
  const urgency = inferUrgency(broadcast.title);
  const style = URGENCY_STYLES[urgency];
  const icon = inferIcon(broadcast.title);

  return (
    <div
      className="bg-white rounded-xl shadow-brand p-4 border border-cafe-100 animate-admin-in"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">{icon}</span>
        <div className="flex-grow min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm font-semibold text-coqui-900 truncate">
                {broadcast.title}
              </p>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0 ${style.badge}`}
              >
                {urgency === 'alert'
                  ? 'Alert'
                  : urgency === 'reminder'
                  ? 'Reminder'
                  : 'Info'}
              </span>
            </div>
            <span className="text-[11px] text-coqui-800/50 whitespace-nowrap flex-shrink-0">
              {timeAgo(broadcast.createdAt)}
            </span>
          </div>
          <p className="text-xs text-coqui-800/50 line-clamp-2">
            {broadcast.message}
          </p>
          {sent !== null && (
            <div className="mt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-coqui-700">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Sent to {sent}
              </span>
              {broadcast.deliveryStats?.push != null && (
                <span className="text-[11px] text-coqui-800/50">
                  {broadcast.deliveryStats.push} push &middot;{' '}
                  {broadcast.deliveryStats.sms ?? 0} SMS
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NotifyPage() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { success, message }

  const { data: broadcasts, loading: broadcastsLoading } = useCollection(
    'notifications',
    [where('type', '==', 'broadcast'), orderBy('createdAt', 'desc'), limit(10)]
  );

  const { data: activeBookings, loading: bookingsLoading } = useCollection(
    'bookings',
    [where('status', '==', 'active')]
  );

  function applyTemplate(template) {
    setTitle(template.title);
    setMessage(template.message);
    setResult(null);
    // Scroll to compose section on mobile
    document
      .getElementById('compose-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const handleSend = useCallback(
    async (e) => {
      e.preventDefault();
      if (!title.trim() || !message.trim()) return;
      setSending(true);
      setResult(null);
      try {
        const idToken = auth.currentUser
          ? await auth.currentUser.getIdToken()
          : null;
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
          setResult({
            success: true,
            message: `Notification sent${detail}.`,
          });
          setTitle('');
          setMessage('');
        } else {
          setResult({
            success: false,
            message: json.error || 'Failed to send notification.',
          });
        }
      } catch {
        setResult({ success: false, message: 'Network error. Please try again.' });
      } finally {
        setSending(false);
      }
    },
    [title, message]
  );

  const guestCount = activeBookings?.length ?? 0;

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">

      {/* ── Page Header ── */}
      <div className="animate-admin-in">
        <h1 className="font-display text-2xl text-coqui-900">
          Guest Notifications
        </h1>
        <p className="text-sm text-coqui-800/60 mt-0.5">
          Send messages to all active guests
        </p>
      </div>

      {/* ── Recipient Context Banner ── */}
      <div className="animate-admin-in" style={{ animationDelay: '40ms' }}>
        {bookingsLoading ? (
          <div className="h-16 animate-admin-shimmer rounded-xl" />
        ) : (
          <div className="bg-coqui-50 border border-coqui-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-coqui-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-coqui-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 20h5v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2h5m6 0H6m6 0v-2m0 2v2M9 7a3 3 0 116 0 3 3 0 01-6 0z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-coqui-800">
                {guestCount} active guest{guestCount !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-coqui-700/60">
                Will receive via push notification with SMS fallback
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Message Templates ── */}
      <div className="animate-admin-in" style={{ animationDelay: '80ms' }}>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          Message Templates
        </h2>
        <div className="flex flex-col gap-2.5">
          {TEMPLATES.map((t) => (
            <TemplateCard key={t.id} template={t} onApply={applyTemplate} />
          ))}
        </div>
      </div>

      {/* ── Compose Form ── */}
      <div
        id="compose-section"
        className="animate-admin-in"
        style={{ animationDelay: '120ms' }}
      >
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          Compose Message
        </h2>
        <form
          onSubmit={handleSend}
          className="bg-white rounded-xl shadow-brand p-4 space-y-4 border border-cafe-100"
        >
          {/* Title field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                className="block text-xs font-semibold text-coqui-800"
                htmlFor="notify-title"
              >
                Title
              </label>
              <span
                className={`text-[11px] tabular-nums ${
                  title.length > 54
                    ? 'text-flamboyan-600 font-semibold'
                    : 'text-coqui-800/50'
                }`}
              >
                {title.length}/60
              </span>
            </div>
            <input
              id="notify-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 60))}
              placeholder="e.g. Quick Reminder"
              required
              className="w-full rounded-xl border border-cafe-200 focus:border-coqui-500 bg-white px-4 py-3 text-sm text-coqui-900 placeholder:text-coqui-800/30 focus:outline-none admin-input-focus"
            />
          </div>

          {/* Message field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                className="block text-xs font-semibold text-coqui-800"
                htmlFor="notify-message"
              >
                Message
              </label>
              <span
                className={`text-[11px] tabular-nums ${
                  message.length > 450
                    ? 'text-flamboyan-600 font-semibold'
                    : 'text-coqui-800/50'
                }`}
              >
                {message.length}/500
              </span>
            </div>
            <textarea
              id="notify-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 500))}
              placeholder="Type your message here..."
              rows={4}
              required
              className="w-full rounded-xl border border-cafe-200 focus:border-coqui-500 bg-white px-4 py-3 text-sm text-coqui-900 placeholder:text-coqui-800/30 focus:outline-none resize-none admin-input-focus"
            />
          </div>

          {/* Live preview */}
          {(title.trim() || message.trim()) && (
            <div className="bg-cafe-50 rounded-xl p-3 border border-cafe-200 animate-admin-slide-down">
              <p className="text-[10px] font-bold uppercase tracking-widest text-coqui-700 mb-2">
                Preview
              </p>
              <div className="bg-white rounded-lg p-3 shadow-brand">
                {title.trim() && (
                  <p className="text-sm font-semibold text-coqui-900">
                    {title}
                  </p>
                )}
                {message.trim() && (
                  <p className="text-xs text-coqui-800/70 mt-1">{message}</p>
                )}
              </div>
            </div>
          )}

          {/* Result message */}
          {result && (
            <div
              className={`rounded-xl px-4 py-3 text-sm font-medium animate-admin-slide-down ${
                result.success
                  ? 'bg-coqui-50 text-coqui-700 border border-coqui-200'
                  : 'bg-flamboyan-50 text-flamboyan-700 border border-flamboyan-200'
              }`}
            >
              {result.message}
            </div>
          )}

          {/* Send button */}
          <button
            type="submit"
            disabled={sending || !title.trim() || !message.trim()}
            className="w-full bg-coqui-600 hover:bg-coqui-700 active:bg-coqui-800 active:scale-[0.98] text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
          >
            {sending
              ? 'Sending...'
              : `Send to ${guestCount} Guest${guestCount !== 1 ? 's' : ''}`}
          </button>
        </form>
      </div>

      {/* ── Delivery History ── */}
      <div className="animate-admin-in" style={{ animationDelay: '160ms' }}>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          Delivery History
        </h2>

        {broadcastsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-brand p-4 border border-cafe-100">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 animate-admin-shimmer rounded-full flex-shrink-0" />
                  <div className="flex-grow space-y-2">
                    <div className="h-4 animate-admin-shimmer rounded w-2/5" />
                    <div className="h-3 animate-admin-shimmer rounded w-3/4" />
                    <div className="h-3 animate-admin-shimmer rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="bg-white rounded-xl shadow-brand p-8 text-center border border-cafe-100">
            <p className="text-coqui-800/50 text-sm">No messages sent yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {broadcasts.map((b, i) => (
              <BroadcastCard key={b.id} broadcast={b} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
