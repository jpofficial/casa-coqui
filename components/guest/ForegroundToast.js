'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORY_CONFIG } from '@/components/guest/NotificationItem';

const AUTO_DISMISS_MS = 5000;

/**
 * ForegroundToast — displays an in-app toast when an FCM message arrives
 * while the guest portal is in the foreground.
 *
 * Mount this once in the guest layout. It watches `foregroundMsg` from
 * usePush() and renders a dismissable toast that deep-links on tap.
 *
 * Props:
 *   foregroundMsg   — the FCM payload from usePush().foregroundMsg
 *   code            — booking code for deep-linking (guest context)
 *   isStaff         — when true, uses admin-aware deep-link paths
 */
export default function ForegroundToast({ foregroundMsg, code, isStaff = false }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    if (!foregroundMsg) return;

    const data = foregroundMsg.data ?? {};
    // Data-only messages carry title/body in `data`; fall back to `notification` for compat.
    const title = data.title || (foregroundMsg.notification && foregroundMsg.notification.title);
    const body = data.body || (foregroundMsg.notification && foregroundMsg.notification.body);
    if (!title) return;

    setCurrent({ title, body, data });
    setVisible(true);

    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [foregroundMsg]);

  const handleTap = useCallback(() => {
    if (!current) return;
    setVisible(false);

    const { type, bookingCode, targetPath } = current.data ?? {};
    if (targetPath) {
      router.push(targetPath);
      return;
    }
    if (isStaff) {
      const staffPaths = {
        maintenance: '/admin/maintenance',
        cleaning_assignment: '/admin/cleaning',
        cleaning_update: '/admin/cleaning',
        assignment: '/admin/assignments',
      };
      router.push(staffPaths[type] || '/admin/staff-notifications');
      return;
    }
    const base = `/g/${code}`;
    const paths = {
      parking: `${base}/parking`,
      laundry: `${base}/laundry`,
      maintenance: `${base}/maintenance`,
      community: `${base}/community`,
      checkin: `${base}/checkin`,
    };
    router.push(paths[type] || base);
  }, [current, code, isStaff, router]);

  if (!visible || !current) return null;

  const cat = CATEGORY_CONFIG[current.data?.type] || CATEGORY_CONFIG.general;

  return (
    <div
      className="fixed top-16 left-4 right-4 z-[100] max-w-lg mx-auto animate-slide-down"
      style={{ animation: 'slideDown 0.25s ease-out' }}
    >
      <button
        onClick={handleTap}
        className="w-full flex items-start gap-3 bg-gray-900 text-white rounded-2xl px-4 py-3.5
          shadow-xl border border-white/10 text-left active:opacity-90 transition-opacity"
      >
        {/* Icon */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${cat.bgColor} ${cat.iconColor}`}>
          {cat.icon}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-snug">{current.title}</p>
          {current.body && (
            <p className="text-xs text-white/70 mt-0.5 line-clamp-2">{current.body}</p>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={(e) => { e.stopPropagation(); setVisible(false); }}
          className="text-white/40 hover:text-white/80 transition flex-shrink-0 p-0.5"
          aria-label="Dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-400 rounded-full"
          style={{ animation: `shrink ${AUTO_DISMISS_MS}ms linear forwards` }}
        />
      </div>

      <style jsx>{`
        @keyframes slideDown {
          from { transform: translateY(-16px); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        @keyframes shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  );
}
