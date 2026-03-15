'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useDocument } from '@/hooks/useFirestore';
import { resolveUnitDisplayName } from '@/lib/units';

// ─── Status config ──────────────────────────────────────────────────────────────
const STATUS = {
  available: {
    label: 'Available',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
    dot: 'bg-green-500',
  },
  in_use: {
    label: 'In Use',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  needs_attention: {
    label: 'Needs Attention',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    dot: 'bg-red-500',
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────────
async function apiCall(url, options = {}) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  return res.json();
}

function formatCountdown(secondsRemaining) {
  if (secondsRemaining <= 0) return '0:00';
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Machine card ──────────────────────────────────────────────────────────────
function MachineCard({ machineId, type, displayName, icon, waitlistState, onWaitlistChange, readOnly = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [error, setError] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const intervalRef = useRef(null);

  const currentUid = auth.currentUser?.uid ?? null;

  // Real-time Firestore subscription
  useEffect(() => {
    const ref = doc(db, 'laundry', machineId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setData(snap.data());
        } else {
          setData({ status: 'available' });
        }
        setLoading(false);
      },
      (err) => {
        console.error(`Laundry listener error (${machineId}):`, err);
        setError('Could not load status.');
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [machineId]);

  // Countdown timer
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (data?.status === 'in_use' && data?.sessionExpiresAt) {
      function tick() {
        const expiresAt = new Date(data.sessionExpiresAt).getTime();
        const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        setSecondsLeft(remaining);

        if (remaining <= 0) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          // Trigger server-side release check
          apiCall('/api/laundry').catch(() => {});
        }
      }
      tick();
      intervalRef.current = setInterval(tick, 1000);
    } else {
      setSecondsLeft(null);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [data?.status, data?.sessionExpiresAt]);

  async function handleStart() {
    if (actionLoading) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await apiCall('/api/laundry/start', {
        method: 'POST',
        body: JSON.stringify({ machineId }),
      });
      if (!result.success) {
        setError(result.error ?? 'Could not start session. Please try again.');
        setTimeout(() => setError(null), 4000);
      }
      // onSnapshot will update the UI
    } catch (err) {
      console.error('Start session error:', err);
      setError('Could not start session. Please try again.');
      setTimeout(() => setError(null), 4000);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleEnd() {
    if (actionLoading) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await apiCall('/api/laundry/end', {
        method: 'POST',
        body: JSON.stringify({ machineId }),
      });
      if (!result.success) {
        setError(result.error ?? 'Could not end session. Please try again.');
        setTimeout(() => setError(null), 4000);
      }
    } catch (err) {
      console.error('End session error:', err);
      setError('Could not end session. Please try again.');
      setTimeout(() => setError(null), 4000);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleWaitlist() {
    const isSubscribed = !!waitlistState?.[machineId];
    try {
      if (isSubscribed) {
        await apiCall('/api/laundry/waitlist', {
          method: 'DELETE',
          body: JSON.stringify({ machineId }),
        });
        onWaitlistChange(machineId, null);
      } else {
        const result = await apiCall('/api/laundry/waitlist', {
          method: 'POST',
          body: JSON.stringify({ machineId }),
        });
        if (result.success) {
          onWaitlistChange(machineId, result.data ?? true);
        }
      }
    } catch (err) {
      console.error('Waitlist error:', err);
    }
  }

  async function handleReport() {
    if (reportLoading || reportDone) return;
    setReportLoading(true);
    try {
      await apiCall('/api/laundry/attention', {
        method: 'POST',
        body: JSON.stringify({ machineId, action: 'report' }),
      });
      setReportDone(true);
      setTimeout(() => setReportDone(false), 5000);
    } catch (err) {
      console.error('Report error:', err);
    } finally {
      setReportLoading(false);
    }
  }

  if (loading) return <MachineSkeleton />;

  const status = data?.status ?? 'available';
  const statusInfo = STATUS[status] ?? STATUS.available;

  const isOwner =
    status === 'in_use' && currentUid && data?.sessionOwnerId === currentUid;
  const isOtherUser = status === 'in_use' && !isOwner;
  const isSubscribed = !!waitlistState?.[machineId];

  const ownerName = data?.sessionOwnerName ?? 'another guest';
  const timerFinished = secondsLeft === 0;

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border ${statusInfo.border} overflow-hidden transition-colors duration-300`}
    >
      {/* Card header */}
      <div className={`${statusInfo.bg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2.5">
          <span className="text-2xl" aria-hidden="true">
            {icon}
          </span>
          <div>
            <p className="text-sm font-bold text-gray-900">{displayName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${statusInfo.dot} ${
                  status === 'in_use' ? 'animate-pulse' : ''
                }`}
              />
              <span className={`text-xs font-semibold ${statusInfo.color}`}>
                {status === 'in_use' && secondsLeft !== null && !timerFinished
                  ? `In Use — ${formatCountdown(secondsLeft)} remaining`
                  : statusInfo.label}
              </span>
            </div>
          </div>
        </div>

        {/* Duration badge */}
        {status === 'available' && (
          <span className="text-xs text-gray-400 font-medium">
            {type === 'washer' ? '40 min' : '60 min'}
          </span>
        )}
      </div>

      {/* Card body */}
      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Error message */}
        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* ── AVAILABLE ── */}
        {status === 'available' && !readOnly && (
          <button
            onClick={handleStart}
            disabled={actionLoading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-green-600 text-white
              hover:bg-green-700 active:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed
              transition-colors duration-150 shadow-sm"
          >
            {actionLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="w-4 h-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                Starting...
              </span>
            ) : (
              `Start ${displayName}`
            )}
          </button>
        )}

        {/* ── IN USE — OWNER ── */}
        {status === 'in_use' && isOwner && (
          <div className="flex flex-col gap-2">
            {timerFinished ? (
              <p className="text-sm text-amber-700 font-medium text-center py-1">
                Finishing up...
              </p>
            ) : (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-center">
                <p className="text-xs text-amber-600 font-medium mb-0.5">Your session</p>
                <p className="text-3xl font-bold text-amber-800 tabular-nums tracking-tight">
                  {secondsLeft !== null ? formatCountdown(secondsLeft) : '--:--'}
                </p>
                <p className="text-xs text-amber-500 mt-0.5">remaining</p>
              </div>
            )}
            {!readOnly && (
              <button
                onClick={handleEnd}
                disabled={actionLoading}
                className="w-full py-2.5 rounded-xl text-sm font-semibold border border-amber-300
                  bg-white text-amber-700 hover:bg-amber-50 active:bg-amber-100
                  disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-150"
              >
                {actionLoading ? 'Ending session...' : 'End Early'}
              </button>
            )}
          </div>
        )}

        {/* ── IN USE — OTHER USER ── */}
        {status === 'in_use' && isOtherUser && (
          <div className="flex flex-col gap-2">
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-700 font-medium">
                In use by {ownerName}
              </p>
              {secondsLeft !== null && !timerFinished && (
                <p className="text-sm text-amber-800 font-semibold mt-0.5">
                  Free in {formatCountdown(secondsLeft)}
                </p>
              )}
              {timerFinished && (
                <p className="text-sm text-amber-800 font-semibold mt-0.5">
                  Finishing up soon...
                </p>
              )}
            </div>

            {/* Waitlist button */}
            {!readOnly && (
              <button
                onClick={handleWaitlist}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2
                  border transition-colors duration-150
                  ${
                    isSubscribed
                      ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 active:bg-blue-200'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 active:bg-gray-100'
                  }`}
              >
                {isSubscribed ? (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-4 h-4 text-blue-500"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                        clipRule="evenodd"
                      />
                    </svg>
                    You will be notified
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.75}
                      stroke="currentColor"
                      className="w-4 h-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                      />
                    </svg>
                    Notify me when free
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* ── NEEDS ATTENTION ── */}
        {status === 'needs_attention' && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-sm text-red-700 font-medium">
              This machine needs attention.
            </p>
            <p className="text-xs text-red-500 mt-0.5">
              Please contact your host for assistance.
            </p>
          </div>
        )}
      </div>

      {/* Report a problem footer */}
      {!readOnly && (
        <div className="px-4 pb-3">
          <button
            onClick={handleReport}
            disabled={reportLoading || reportDone}
            className="text-xs text-gray-400 hover:text-red-500 active:text-red-700 underline underline-offset-2
              disabled:cursor-not-allowed transition-colors duration-150"
          >
            {reportDone
              ? 'Report sent — thank you'
              : reportLoading
              ? 'Sending report...'
              : 'Report a problem'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────
function MachineSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
      <div className="bg-gray-50 px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-gray-200 rounded-lg" />
        <div className="flex flex-col gap-1.5">
          <div className="w-24 h-4 bg-gray-200 rounded" />
          <div className="w-16 h-3 bg-gray-100 rounded" />
        </div>
      </div>
      <div className="px-4 py-3 flex flex-col gap-2">
        <div className="w-full h-10 bg-gray-100 rounded-xl" />
      </div>
    </div>
  );
}

// ─── Location directions per unit ───────────────────────────────────────────────
function getLocationText(unitName) {
  const lower = (unitName || '').toLowerCase();
  if (lower.includes('cielo')) {
    return 'The laundry is on the first floor next to the stairs. From your unit, head downstairs from the room that leads to the balcony — it\u2019s the first door on your right.';
  }
  if (lower.includes('tierra')) {
    return 'The laundry is in the back of the premises, right next to the stairs. Head toward the rear of your unit and you\u2019ll find it there.';
  }
  return 'The laundry is on the first floor, right next to the stairs.';
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Laundry({ code, readOnly = false, checkInDate = null }) {
  const { data: settings } = useDocument('settings', 'property');
  const [unitName, setUnitName] = useState(null);
  // waitlistState: { washer: entry | null, dryer: entry | null }
  const [waitlistState, setWaitlistState] = useState({ washer: null, dryer: null });

  // Fetch booking to determine the guest's unit
  useEffect(() => {
    if (!code) return;
    async function fetchUnit() {
      try {
        const q = query(collection(db, 'bookings'), where('code', '==', code));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const booking = snap.docs[0].data();
          setUnitName(resolveUnitDisplayName(booking, settings));
        }
      } catch (err) {
        console.error('Failed to fetch booking for unit:', err);
      }
    }
    fetchUnit();
  }, [code, settings]);

  // Fetch initial waitlist state on mount
  useEffect(() => {
    async function fetchWaitlist() {
      try {
        const result = await apiCall('/api/laundry/waitlist');
        if (result.success && result.data) {
          setWaitlistState({
            washer: result.data.washer ?? null,
            dryer: result.data.dryer ?? null,
          });
        }
      } catch (err) {
        // Non-critical — ignore silently
        console.error('Failed to fetch waitlist state:', err);
      }
    }
    if (auth.currentUser) fetchWaitlist();
  }, []);

  const handleWaitlistChange = useCallback((machineId, entry) => {
    setWaitlistState((prev) => ({ ...prev, [machineId]: entry }));
  }, []);

  const machines = [
    { machineId: 'washer', type: 'washer', displayName: 'Washer', icon: '🧺' },
    { machineId: 'dryer', type: 'dryer', displayName: 'Dryer', icon: '💨' },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-gray-900">Laundry Status</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Real-time status — sessions are timed and automatically released when done.
        </p>
      </div>

      {/* Info notice */}
      {readOnly && checkInDate ? (() => {
        const [y, m, d] = checkInDate.split('-').map(Number);
        const checkInDisplay = new Date(y, m - 1, d).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        });
        return (
          <div className="flex gap-2.5 items-start bg-coqui-50 border border-coqui-100 rounded-xl p-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-coqui-600 flex-shrink-0 mt-0.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <p className="text-xs text-coqui-800 leading-snug">
              Laundry will be available to use when your stay begins on <strong>{checkInDisplay}</strong>. You can check machine status in the meantime.
            </p>
          </div>
        );
      })() : (
        <div className="flex gap-2.5 items-start bg-blue-50 border border-blue-100 rounded-xl p-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-xs text-blue-800 leading-snug">
            This runs on the <strong>honor system</strong> — tap <strong>Start</strong> when you begin a load and the timer
            handles the rest. You can end early if you finish sooner. We appreciate everyone helping keep
            laundry running smoothly!
          </p>
        </div>
      )}

      {/* Machine cards */}
      <div className="flex flex-col gap-3">
        {machines.map((m) => (
          <MachineCard
            key={m.machineId}
            machineId={m.machineId}
            type={m.type}
            displayName={m.displayName}
            icon={m.icon}
            waitlistState={waitlistState}
            onWaitlistChange={handleWaitlistChange}
            readOnly={readOnly}
          />
        ))}
      </div>

      {/* Laundry location */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-4 flex gap-3 items-start">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          stroke="currentColor"
          className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
          />
        </svg>
        <div>
          <p className="text-sm font-semibold text-gray-900">Location</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-snug">
            {getLocationText(unitName)}
          </p>
        </div>
      </div>
    </div>
  );
}
