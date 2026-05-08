'use client';

import { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

const STATUS = {
  available: { labelKey: 'laundry_available', dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  in_use: { labelKey: 'laundry_inUse', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
  needs_attention: { labelKey: 'laundry_attention', dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
};

function getRemainingMinutes(sessionExpiresAt) {
  if (!sessionExpiresAt) return null;
  const expiresMs = new Date(sessionExpiresAt).getTime();
  const remainingMs = expiresMs - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 60000);
}

function MachineStatusPill({ machineId, icon, label }) {
  const { locale } = useLocale();
  const [status, setStatus] = useState('available');
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [remainingMinutes, setRemainingMinutes] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    const ref = doc(db, 'laundry', machineId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setStatus(d.status ?? 'available');
          setSessionExpiresAt(d.sessionExpiresAt ?? null);
        } else {
          setStatus('available');
          setSessionExpiresAt(null);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsubscribe;
  }, [machineId]);

  // Update remaining minutes every minute
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (status === 'in_use' && sessionExpiresAt) {
      function tick() {
        setRemainingMinutes(getRemainingMinutes(sessionExpiresAt));
      }
      tick();
      intervalRef.current = setInterval(tick, 60000);
    } else {
      setRemainingMinutes(null);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status, sessionExpiresAt]);

  const info = STATUS[status] ?? STATUS.available;

  // Compute display label
  let displayLabel = t(locale, info.labelKey);
  if (status === 'in_use' && remainingMinutes !== null) {
    displayLabel = remainingMinutes > 0
      ? t(locale, 'laundry_inUseMinutes').replace('{min}', remainingMinutes)
      : t(locale, 'laundry_finishingUp');
  }

  if (loading) {
    return (
      <div className="flex-1 bg-white rounded-lg border border-gray-100 p-3 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-16 mb-2" />
        <div className="h-3 bg-gray-50 rounded w-12" />
      </div>
    );
  }

  return (
    <div className={`flex-1 rounded-lg border p-3 ${info.bg} border-gray-100`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-base" aria-hidden="true">
          {icon}
        </span>
        <span className="text-xs font-semibold text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${info.dot} ${
            status === 'in_use' ? 'animate-pulse' : ''
          }`}
        />
        <span className={`text-xs font-semibold ${info.text}`}>{displayLabel}</span>
      </div>
    </div>
  );
}

/**
 * Compact laundry status display for the guest home page.
 * Shows real-time washer/dryer status as two side-by-side pills with
 * remaining time when in use. Tapping navigates to the full laundry page.
 */
export default function LaundryQuickStatus({ code }) {
  const { locale } = useLocale();

  return (
    <Link href={`/g/${code}/laundry`} className="block">
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3 hover:shadow-md active:scale-[0.99] transition-all duration-150 cursor-pointer">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {t(locale, 'laundry_quickTitle')}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-3.5 h-3.5 text-gray-300"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </div>
        <div className="flex gap-2">
          <MachineStatusPill machineId="washer" icon="🧺" label={t(locale, 'laundry_washer')} />
          <MachineStatusPill machineId="dryer" icon="💨" label={t(locale, 'laundry_dryer')} />
        </div>
      </div>
    </Link>
  );
}
