'use client';

import Link from 'next/link';

/**
 * StaffNotificationBell — bell icon with unread count badge.
 * Renders in the admin header and links to /admin/staff-notifications.
 *
 * Props:
 *   unreadCount  {number}  — number of unread staff notifications
 */
export default function StaffNotificationBell({ unreadCount = 0 }) {
  return (
    <Link
      href="/admin/staff-notifications"
      className="relative flex items-center justify-center w-10 h-10 rounded-xl
        text-coqui-800/50 hover:text-coqui-800 hover:bg-coqui-50
        active:bg-coqui-100 transition-colors"
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.75}
        stroke="currentColor"
        className="w-5.5 h-5.5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
        />
      </svg>

      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center
          bg-red-500 text-white text-[10px] font-bold rounded-full px-1 shadow-sm">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
