'use client';

import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ─── Relative time helper ──────────────────────────────────────────────────────
function getRelativeTime(timestamp) {
  if (!timestamp) return null;
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Type badge ────────────────────────────────────────────────────────────────
const TYPE_STYLES = {
  parking: {
    label: 'Parking',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
  },
  maintenance: {
    label: 'Maintenance',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
  },
  general: {
    label: 'General',
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
  },
};

function TypeBadge({ type }) {
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.general;
  return (
    <span
      className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${style.bg} ${style.text} ${style.border}`}
    >
      {style.label}
    </span>
  );
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────
function NotificationSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 flex flex-col gap-2">
          <div className="w-16 h-4 bg-gray-200 rounded-full" />
          <div className="w-3/4 h-4 bg-gray-200 rounded" />
          <div className="w-full h-3 bg-gray-100 rounded" />
          <div className="w-2/3 h-3 bg-gray-100 rounded" />
        </div>
        <div className="w-14 h-3 bg-gray-100 rounded flex-shrink-0 mt-1" />
      </div>
    </div>
  );
}

// ─── Announcement card ────────────────────────────────────────────────────────
function AnnouncementCard({ notification }) {
  const relativeTime = getRelativeTime(notification.createdAt);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <TypeBadge type={notification.type} />
            {relativeTime && (
              <span className="text-xs text-gray-400">{relativeTime}</span>
            )}
          </div>
          {notification.title && (
            <p className="text-sm font-semibold text-gray-900 mb-1 leading-snug">
              {notification.title}
            </p>
          )}
          {notification.message && (
            <p className="text-sm text-gray-600 leading-relaxed">
              {notification.message}
            </p>
          )}
        </div>

        {/* Host badge */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4 text-white"
            aria-hidden="true"
          >
            <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Community() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, 'notifications'),
      where('type', 'in', ['broadcast', 'parking', 'general', 'maintenance']),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setNotifications(docs);
        setLoading(false);
      },
      (err) => {
        console.error('Community board listener error:', err);
        setError('Could not load announcements. Please try again later.');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-gray-900">Community Board</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Announcements from your host
        </p>
      </div>

      {/* Info notice */}
      <div className="flex gap-2.5 items-start bg-green-50 border border-green-100 rounded-xl p-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-xs text-green-800 leading-snug">
          Stay informed about property updates and local tips
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && !error && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <NotificationSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Notification list */}
      {!loading && !error && notifications.length > 0 && (
        <div className="flex flex-col gap-3">
          {notifications.map((n) => (
            <AnnouncementCard key={n.id} notification={n} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && notifications.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6 text-gray-300"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">
              No announcements yet
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Check back later for property updates and local tips.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
