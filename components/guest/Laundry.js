'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Status options
const STATUS = {
  available: {
    label: 'Available',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
    dot: 'bg-green-500',
    description: 'Free to use',
  },
  in_use: {
    label: 'In Use',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
    description: 'Someone is using it',
  },
  needs_attention: {
    label: 'Needs Attention',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    dot: 'bg-red-500',
    description: 'Report to host',
  },
};

// ─── Machine card ──────────────────────────────────────────────────────────────
function MachineCard({ machineId, type, displayName, icon }) {
  // Optimistic state
  const [status, setStatus] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [updatedBy, setUpdatedBy] = useState(null);
  const [firestoreStatus, setFirestoreStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);

  // Real-time Firestore subscription
  useEffect(() => {
    const ref = doc(db, 'laundry', machineId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setFirestoreStatus(data.status ?? 'available');
          setStatus(data.status ?? 'available');
          setLastUpdated(data.updatedAt?.toDate?.() ?? null);
          setUpdatedBy(data.updatedBy ?? null);
        } else {
          setFirestoreStatus('available');
          setStatus('available');
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

  async function handleToggle(newStatus) {
    if (updating || status === newStatus) return;
    // Optimistic update
    const previous = status;
    setStatus(newStatus);
    setUpdating(true);
    try {
      const ref = doc(db, 'laundry', machineId);
      await updateDoc(ref, {
        status: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: 'guest',
      });
    } catch (err) {
      console.error('Laundry update error:', err);
      // Rollback optimistic update
      setStatus(previous);
      setError('Update failed. Please try again.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setUpdating(false);
    }
  }

  const statusInfo = STATUS[status] ?? STATUS.available;
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className={`bg-white rounded-xl shadow-sm border ${statusInfo.border} overflow-hidden transition-colors duration-300`}>
      {/* Card header */}
      <div className={`${statusInfo.bg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2.5">
          <span className={`text-2xl`} aria-hidden="true">{icon}</span>
          <div>
            <p className="text-sm font-bold text-gray-900">{displayName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusInfo.dot} ${status === 'in_use' ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-semibold ${statusInfo.color}`}>{statusInfo.label}</span>
            </div>
          </div>
        </div>

        {/* Loading skeleton for status */}
        {loading && (
          <div className="w-16 h-6 bg-gray-200 rounded-full animate-pulse" />
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Last updated info */}
        {timeStr && (
          <p className="text-xs text-gray-400">
            Last reported at {timeStr}
            {updatedBy ? ` by ${updatedBy}` : ''}
          </p>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {/* Toggle buttons */}
        <div>
          <p className="text-xs text-gray-500 mb-2 font-medium">Update status:</p>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(STATUS).map(([key, info]) => {
              const isActive = status === key;
              return (
                <button
                  key={key}
                  onClick={() => handleToggle(key)}
                  disabled={updating || loading}
                  aria-pressed={isActive}
                  className={`py-2 px-1 rounded-lg text-xs font-semibold transition-all duration-150 border
                    ${isActive
                      ? `${info.bg} ${info.color} ${info.border} ring-2 ring-offset-1 ring-current`
                      : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100 active:bg-gray-200'
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {info.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
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
      <div className="px-4 py-3">
        <div className="w-full h-9 bg-gray-100 rounded-lg" />
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Laundry() {
  const machines = [
    {
      machineId: 'washer',
      type: 'washer',
      displayName: 'Washer',
      icon: '🧺',
    },
    {
      machineId: 'dryer',
      type: 'dryer',
      displayName: 'Dryer',
      icon: '💨',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-gray-900">Laundry Status</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Real-time status — updated by guests on the honor system.
        </p>
      </div>

      {/* Honor system notice */}
      <div className="flex gap-2.5 items-start bg-blue-50 border border-blue-100 rounded-xl p-3">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
        </svg>
        <p className="text-xs text-blue-800 leading-snug">
          When you start or finish a load, please tap the button to update the status so other guests know when it is free.
        </p>
      </div>

      {/* Machine cards */}
      <div className="flex flex-col gap-3">
        {machines.map((m) => (
          <MachineCard
            key={m.machineId}
            machineId={m.machineId}
            type={m.type}
            displayName={m.displayName}
            icon={m.icon}
          />
        ))}
      </div>

      {/* Laundry location */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-4 flex gap-3 items-start">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-gray-900">Location</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-snug">
            Laundry room is in the common area between Units A and B, accessible from the courtyard. Detergent is provided under the counter.
          </p>
        </div>
      </div>
    </div>
  );
}
