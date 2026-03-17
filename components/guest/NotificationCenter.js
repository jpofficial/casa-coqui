'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useNotifications from '@/hooks/useNotifications';
import usePush, { detectPlatform, isStandalone } from '@/hooks/usePush';
import NotificationItem from '@/components/guest/NotificationItem';

// ─── Skeleton row ─────────────────────────────────────────────────────────────
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

// ─── Category → deep-link path (mirrors SW logic, client-side) ────────────────
function resolveLink(notification, code) {
  const base = `/g/${code}`;
  switch (notification.category) {
    case 'parking': return `${base}/parking`;
    case 'laundry': return `${base}/laundry`;
    case 'maintenance': return `${base}/maintenance`;
    case 'community': return `${base}/community`;
    case 'checkin': return `${base}/checkin`;
    default: return base;
  }
}

/**
 * NotificationCenter — the full notification list for the guest portal.
 * Intended to be rendered inside `/app/g/[code]/notifications/page.js`.
 *
 * Props:
 *   code          {string}   booking code
 *   bookingCode   {string}   same as code — passed to the hook
 */
export default function NotificationCenter({ code, bookingCode }) {
  const router = useRouter();
  const bc = bookingCode || code;
  const { notifications, unreadCount, loading, isRead, markRead, markAllRead } =
    useNotifications({ bookingCode: bc });
  const { permission, requestPermission, supported, pushCapable } = usePush({ bookingCode: bc });
  const [enabling, setEnabling] = useState(false);

  const platform = detectPlatform();
  const sa = isStandalone();
  const iosNotInstalled = platform === 'ios' && !sa;

  // Mark all read when the center is mounted and visible
  const markedRef = useRef(false);
  useEffect(() => {
    if (!loading && !markedRef.current && unreadCount > 0) {
      // Small delay so the unread dots are visible briefly
      const timer = setTimeout(() => {
        markAllRead();
        markedRef.current = true;

        // Clear the OS badge when the user opens the center
        if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
          navigator.clearAppBadge().catch(() => {});
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [loading, unreadCount, markAllRead]);

  async function handlePress(notification) {
    await markRead(notification.id);
    const href = resolveLink(notification, code);
    router.push(href);
  }

  return (
    <div className="flex flex-col min-h-[60vh]">
      {/* Page header */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
          {!loading && unreadCount > 0 && (
            <p className="text-xs text-green-600 font-medium mt-0.5">
              {unreadCount} unread
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!loading && notifications.length > 0 && unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs font-semibold text-green-600 hover:text-green-700
                active:text-green-800 transition px-2 py-1 rounded-lg hover:bg-green-50"
            >
              Mark all read
            </button>
          )}
          <Link
            href={`/g/${code}/notification-settings`}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 transition px-2 py-1 rounded-lg hover:bg-gray-50"
            aria-label="Notification settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4.5 h-4.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Push permission status */}
      <PushStatusCard
        permission={permission}
        supported={supported}
        pushCapable={pushCapable}
        iosNotInstalled={iosNotInstalled}
        platform={platform}
        enabling={enabling}
        settingsHref={`/g/${code}/notification-settings`}
        onEnable={async () => {
          setEnabling(true);
          try { await requestPermission({ bookingCode: bc }); }
          finally { setEnabling(false); }
        }}
      />

      {/* List */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
        {loading ? (
          <>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </>
        ) : notifications.length === 0 ? (
          <EmptyState />
        ) : (
          notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              isRead={isRead(n)}
              onPress={() => handlePress(n)}
            />
          ))
        )}
      </div>

      {/* Footer note */}
      {!loading && notifications.length > 0 && (
        <p className="text-xs text-gray-400 text-center mt-4 pb-2">
          Showing the last {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

// ─── Push permission status card ─────────────────────────────────────────────
function PushStatusCard({
  permission, supported, pushCapable,
  iosNotInstalled, platform, enabling, settingsHref, onEnable,
}) {
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
        <p className="text-sm font-medium text-green-800 flex-1">Push enabled</p>
        <Link
          href={settingsHref}
          className="text-xs font-semibold text-green-600 hover:text-green-700 transition whitespace-nowrap"
        >
          Settings
        </Link>
      </div>
    );
  }

  // Default — not yet asked
  return (
    <div className="mx-4 mb-3 bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">Enable push notifications</p>
        <p className="text-xs text-gray-500 mt-0.5">Get instant alerts for parking, laundry, and host messages.</p>
      </div>
      <button
        onClick={onEnable}
        disabled={enabling || !pushCapable}
        className="text-xs font-semibold bg-green-600 text-white px-3 py-1.5 rounded-lg
          hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 whitespace-nowrap flex-shrink-0"
      >
        {enabling ? 'Enabling...' : 'Enable'}
      </button>
    </div>
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
        No notifications yet. We&apos;ll alert you about parking, laundry availability, and host announcements here.
      </p>
    </div>
  );
}
