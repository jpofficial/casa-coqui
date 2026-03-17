'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useStaffNotifications from '@/hooks/useStaffNotifications';
import usePush from '@/hooks/usePush';
import { detectPlatform, isStandalone } from '@/lib/platform';

// ─── Staff notification type → admin deep-link ──────────────────────────────
const TYPE_PATHS = {
  maintenance: '/admin/maintenance',
  cleaning_update: '/admin/cleaning',
  assignment: '/admin/assignments',
};

function resolveStaffLink(notification) {
  // Prefer explicit targetPath from notification data
  if (notification.data?.targetPath) return notification.data.targetPath;
  return TYPE_PATHS[notification.type] || '/admin';
}

// ─── Category config for staff notification types ────────────────────────────
const STAFF_CATEGORY_CONFIG = {
  maintenance: {
    label: 'Maintenance',
    iconColor: 'text-red-600',
    bgColor: 'bg-red-50',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l5.654-4.654m5.14-5.633l4.14-4.14a2.25 2.25 0 013.182 0l.354.354a2.25 2.25 0 010 3.182l-4.14 4.14M16.5 9.75l-4.94 4.94" />
      </svg>
    ),
  },
  cleaning_update: {
    label: 'Cleaning',
    iconColor: 'text-atardecer-600',
    bgColor: 'bg-atardecer-50',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
  },
  assignment: {
    label: 'Task',
    iconColor: 'text-coqui-600',
    bgColor: 'bg-coqui-50',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  staff: {
    label: 'Staff',
    iconColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
  },
};

function getCategoryConfig(type) {
  return STAFF_CATEGORY_CONFIG[type] || STAFF_CATEGORY_CONFIG.staff;
}

// ─── Relative timestamp ──────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Skeleton row ────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5 animate-pulse">
      <div className="w-9 h-9 rounded-xl bg-gray-100 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="h-3.5 bg-gray-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-gray-100 rounded w-full mb-1" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
    </div>
  );
}

// ─── Notification item ───────────────────────────────────────────────────────
function StaffNotificationItem({ notification, onPress }) {
  const cat = getCategoryConfig(notification.type);
  const isRead = notification.read;

  return (
    <button
      onClick={onPress}
      className={`w-full text-left flex items-start gap-3 px-4 py-3.5 transition-colors
        ${isRead
          ? 'bg-white hover:bg-gray-50 active:bg-gray-100'
          : 'bg-coqui-50/40 hover:bg-coqui-50 active:bg-coqui-100'
        }`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${cat.bgColor} ${cat.iconColor}`}>
        {cat.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm leading-snug ${isRead ? 'font-normal text-gray-700' : 'font-semibold text-gray-900'}`}>
            {notification.title}
          </p>
          <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0 mt-0.5">
            {relativeTime(notification.createdAt)}
          </span>
        </div>
        {notification.body && (
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed line-clamp-2">
            {notification.body}
          </p>
        )}
        <span className={`inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide ${cat.iconColor}`}>
          {cat.label}
        </span>
      </div>

      {!isRead && (
        <div className="w-2 h-2 rounded-full bg-coqui-500 flex-shrink-0 mt-2" aria-label="Unread" />
      )}
    </button>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-gray-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-gray-700 mb-1">All clear</h3>
      <p className="text-sm text-gray-400 max-w-xs">
        No staff notifications yet. You&apos;ll see maintenance requests, cleaning updates, and task alerts here.
      </p>
    </div>
  );
}

// ─── Push status card for staff ──────────────────────────────────────────────
function StaffPushStatusCard({ permission, supported, onEnable, enabling }) {
  const platform = detectPlatform();
  const sa = isStandalone();
  const iosNotInstalled = platform === 'ios' && !sa;

  if (iosNotInstalled) {
    return (
      <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">Install the app for push notifications</p>
          <p className="text-xs text-amber-700 mt-0.5">Tap the Share button in Safari, then &ldquo;Add to Home Screen.&rdquo;</p>
        </div>
      </div>
    );
  }

  if (!supported) return null;

  if (permission === 'denied') {
    return (
      <div className="mx-4 mb-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-700">Notifications blocked</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Re-enable in Settings &rarr; {platform === 'ios' ? 'Safari' : 'Chrome'} &rarr; Notifications.
          </p>
        </div>
      </div>
    );
  }

  if (permission === 'granted') {
    return (
      <div className="mx-4 mb-3 bg-green-50 border border-green-200 rounded-xl px-3.5 py-2.5 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <p className="text-sm font-medium text-green-800 flex-1">Push notifications enabled</p>
      </div>
    );
  }

  // Default — not yet asked
  return (
    <div className="mx-4 mb-3 bg-white border border-coqui-200 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-coqui-50 text-coqui-600 flex items-center justify-center flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">Enable push notifications</p>
        <p className="text-xs text-gray-500 mt-0.5">Get instant alerts for maintenance requests and task updates.</p>
      </div>
      <button
        onClick={onEnable}
        disabled={enabling}
        className="text-xs font-semibold bg-coqui-600 text-white px-3 py-1.5 rounded-lg
          hover:bg-coqui-700 active:bg-coqui-800 transition disabled:opacity-60 whitespace-nowrap flex-shrink-0"
      >
        {enabling ? 'Enabling...' : 'Enable'}
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * StaffNotificationCenter — the full notification list for admin/co-host staff.
 * Intended to be rendered inside `/app/admin/staff-notifications/page.js`.
 *
 * Props:
 *   staffId   {string}  current staff user UID
 */
export default function StaffNotificationCenter({ staffId }) {
  const router = useRouter();
  const { notifications, unreadCount, loading, markRead, markAllRead } =
    useStaffNotifications({ staffId });
  const { permission, requestPermission, supported } = usePush({ staffId });
  const [enabling, setEnabling] = useState(false);

  // Mark all read after a short delay when opening
  const markedRef = useRef(false);
  useEffect(() => {
    if (!loading && !markedRef.current && unreadCount > 0) {
      const timer = setTimeout(() => {
        markAllRead();
        markedRef.current = true;
        if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
          navigator.clearAppBadge().catch(() => {});
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [loading, unreadCount, markAllRead]);

  async function handlePress(notification) {
    await markRead(notification.id);
    const href = resolveStaffLink(notification);
    router.push(href);
  }

  return (
    <div className="flex flex-col min-h-[60vh]">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
          {!loading && unreadCount > 0 && (
            <p className="text-xs text-coqui-600 font-medium mt-0.5">
              {unreadCount} unread
            </p>
          )}
        </div>
        {!loading && notifications.length > 0 && unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs font-semibold text-coqui-600 hover:text-coqui-700
              active:text-coqui-800 transition px-2 py-1 rounded-lg hover:bg-coqui-50"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Push status */}
      <StaffPushStatusCard
        permission={permission}
        supported={supported}
        enabling={enabling}
        onEnable={async () => {
          setEnabling(true);
          try { await requestPermission({ staffId }); }
          finally { setEnabling(false); }
        }}
      />

      {/* List */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50 mx-4">
        {loading ? (
          <>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </>
        ) : notifications.length === 0 ? (
          <EmptyState />
        ) : (
          notifications.map((n) => (
            <StaffNotificationItem
              key={n.id}
              notification={n}
              onPress={() => handlePress(n)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {!loading && notifications.length > 0 && (
        <p className="text-xs text-gray-400 text-center mt-4 pb-2">
          Showing the last {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
