'use client';

import { useState } from 'react';

// ─── Category icons ───────────────────────────────────────────────────────────
const BENEFITS = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
      </svg>
    ),
    label: 'Parking alerts',
    color: 'text-amber-600 bg-amber-50',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    ),
    label: 'Laundry free',
    color: 'text-teal-600 bg-teal-50',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
    label: 'Host messages',
    color: 'text-indigo-600 bg-indigo-50',
  },
];

/**
 * PushPermissionExplainer — shown before calling Notification.requestPermission().
 * Presents the value proposition and lets the user opt in or dismiss.
 *
 * Props:
 *   onEnable()   — caller should invoke usePush().requestPermission() here
 *   onDismiss()  — caller stores dismissal time so re-prompt is rate-limited
 *   compact      — renders as a slim banner instead of a full card (default false)
 */
export default function PushPermissionExplainer({ onEnable, onDismiss, compact = false }) {
  const [enabling, setEnabling] = useState(false);

  async function handleEnable() {
    setEnabling(true);
    try {
      await onEnable();
    } finally {
      setEnabling(false);
    }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-3 py-3">
        <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-white">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-green-900 leading-snug">Enable notifications</p>
          <p className="text-xs text-green-700">Get parking alerts and host messages</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleEnable}
            disabled={enabling}
            className="text-xs font-semibold bg-green-600 text-white px-3 py-1.5 rounded-lg
              hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60"
          >
            {enabling ? 'Enabling...' : 'Enable'}
          </button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="text-xs text-gray-400 hover:text-gray-600 transition p-1"
              aria-label="Dismiss"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-green-600 px-5 pt-6 pb-8 text-white text-center">
        <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-7 h-7 text-white">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
        </div>
        <h2 className="text-lg font-bold">Stay in the loop</h2>
        <p className="text-sm text-green-100 mt-1">
          Allow notifications so you never miss important updates during your stay.
        </p>
      </div>

      {/* Benefits */}
      <div className="px-5 py-4 flex flex-col gap-2.5">
        {BENEFITS.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${b.color}`}>
              {b.icon}
            </div>
            <span className="text-sm text-gray-700">{b.label}</span>
          </div>
        ))}
      </div>

      {/* Privacy note */}
      <p className="px-5 text-xs text-gray-400 leading-relaxed">
        Notifications are only sent by your host for updates relevant to your stay.
        You can turn them off at any time in your phone settings.
      </p>

      {/* Actions */}
      <div className="px-5 py-5 flex flex-col gap-2">
        <button
          onClick={handleEnable}
          disabled={enabling}
          className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm
            hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60"
        >
          {enabling ? 'Requesting permission...' : 'Enable Notifications'}
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
}
