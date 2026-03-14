'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { where, orderBy, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { db } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';

const LAUNDRY_STATUSES = [
  { key: 'available', label: 'Available', color: 'bg-coqui-100 text-coqui-700', active: 'bg-coqui-600 text-white' },
  { key: 'in_use', label: 'In Use', color: 'bg-atardecer-100 text-atardecer-700', active: 'bg-atardecer-500 text-white' },
  { key: 'needs_attention', label: 'Needs Attention', color: 'bg-flamboyan-100 text-flamboyan-600', active: 'bg-flamboyan-500 text-white' },
];

const UNIT_COLORS = {
  'Unit A': { accent: 'bg-caribe-500', text: 'text-caribe-600' },
  'Unit B': { accent: 'bg-atardecer-400', text: 'text-atardecer-600' },
};

function laundryStatusColor(status) {
  if (status === 'available') return 'bg-coqui-100 text-coqui-700';
  if (status === 'in_use') return 'bg-atardecer-100 text-atardecer-700';
  if (status === 'needs_attention') return 'bg-flamboyan-100 text-flamboyan-600';
  return 'bg-cafe-200 text-cafe-700';
}

function LaundryMachineCard({ machineId, label }) {
  const { data, loading } = useDocument('laundry', machineId);

  async function handleOverride(newStatus) {
    try {
      await updateDoc(doc(db, 'laundry', machineId), {
        status: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: 'admin',
      });
    } catch (err) {
      console.error('Failed to update laundry status:', err);
    }
  }

  const currentStatus = data?.status || null;

  return (
    <div className="bg-white rounded-xl shadow-brand p-4 border border-cafe-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-coqui-900">{label}</span>
        {loading ? (
          <div className="h-5 w-20 animate-admin-shimmer rounded-full" />
        ) : currentStatus ? (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${laundryStatusColor(currentStatus)}`}>
            {LAUNDRY_STATUSES.find((s) => s.key === currentStatus)?.label || currentStatus}
          </span>
        ) : (
          <span className="text-xs text-coqui-800/50">No status</span>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {LAUNDRY_STATUSES.map((s) => (
          <button
            key={s.key}
            onClick={() => handleOverride(s.key)}
            className={`flex-1 min-w-[80px] text-xs font-medium py-2 px-2 rounded-lg transition-colors ${
              currentStatus === s.key ? s.active : `${s.color} active:opacity-80`
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsCard({ label, value, accent, loading, bgTint }) {
  return (
    <div className={`rounded-xl shadow-brand p-4 flex flex-col gap-1 border ${bgTint || 'bg-white border-cafe-200'}`}>
      <span className="text-[11px] text-coqui-800/60 font-semibold uppercase tracking-wider leading-none">
        {label}
      </span>
      {loading ? (
        <div className="h-8 w-14 rounded animate-admin-shimmer mt-1" />
      ) : (
        <span className={`text-3xl font-bold leading-none mt-1 ${accent || 'text-coqui-900'}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-coqui-100 text-coqui-700',
    completed: 'bg-cafe-200 text-cafe-800',
    cancelled: 'bg-flamboyan-100 text-flamboyan-700',
    pending: 'bg-atardecer-100 text-atardecer-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminDashboard() {
  const { role, isAdmin } = useAuth();

  if (role === 'cohost') {
    return <CohostDashboard />;
  }

  return <FullAdminDashboard />;
}

function CohostDashboard() {
  const { user } = useAuth();
  const [stays, setStays] = useState([]);
  const [staysLoading, setStaysLoading] = useState(true);

  useEffect(() => {
    async function fetchStays() {
      if (!user) return;
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/stays/active', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const json = await res.json();
        if (json.success) setStays(json.data);
      } catch (err) {
        console.error('Failed to fetch stays:', err);
      } finally {
        setStaysLoading(false);
      }
    }
    fetchStays();
  }, [user]);

  const {
    data: openTasks,
    loading: tasksLoading,
  } = useCollection('assignments', [where('status', 'in', ['pending', 'in_progress'])]);

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl text-coqui-900">Operations</h1>
        <p className="text-sm text-coqui-800/60 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Operations stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatsCard
          label="Active Stays"
          value={stays.length}
          accent="text-coqui-600"
          loading={staysLoading}
          bgTint="bg-coqui-50 border-coqui-100"
        />
        <StatsCard
          label="Open Tasks"
          value={openTasks.length}
          accent={openTasks.length > 0 ? 'text-atardecer-600' : 'text-coqui-900'}
          loading={tasksLoading}
          bgTint="bg-atardecer-50 border-atardecer-100"
        />
      </div>

      {/* Quick actions for co-host */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Link
            href="/admin/assignments"
            className="flex flex-col items-center gap-2 bg-white border border-cafe-200 rounded-xl shadow-brand p-4 min-h-[72px] active:scale-[0.98] active:bg-cafe-100 transition-all duration-150"
          >
            <span className="text-coqui-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </span>
            <span className="text-xs font-medium text-coqui-900 text-center leading-tight">
              My Tasks
            </span>
          </Link>
          <Link
            href="/admin/community"
            className="flex flex-col items-center gap-2 bg-white border border-cafe-200 rounded-xl shadow-brand p-4 min-h-[72px] active:scale-[0.98] active:bg-cafe-100 transition-all duration-150"
          >
            <span className="text-coqui-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-coqui-900 text-center leading-tight">
              Community
            </span>
          </Link>
          <Link
            href="/admin/calendar"
            className="flex flex-col items-center gap-2 bg-white border border-cafe-200 rounded-xl shadow-brand p-4 min-h-[72px] active:scale-[0.98] active:bg-cafe-100 transition-all duration-150"
          >
            <span className="text-coqui-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-coqui-900 text-center leading-tight">
              Calendar
            </span>
          </Link>
        </div>
      </div>

      {/* Current stays (privacy-filtered for co-host) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700">
            Active Stays
          </h2>
          <Link href="/admin/stays" className="text-xs text-coqui-600 font-medium min-h-[44px] flex items-center">
            View all
          </Link>
        </div>

        {staysLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden">
                <div className="h-1 animate-admin-shimmer" />
                <div className="p-4">
                  <div className="h-4 animate-admin-shimmer rounded w-1/3 mb-2" />
                  <div className="h-3 animate-admin-shimmer rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : stays.length === 0 ? (
          <div className="bg-white rounded-xl shadow-brand p-8 text-center border border-cafe-100">
            <p className="text-coqui-800/50 text-sm">No active stays</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stays.map((stay, i) => {
              const unitColor = UNIT_COLORS[stay.unit] || { accent: 'bg-cafe-300', text: 'text-cafe-700' };
              return (
                <div key={stay.id} className="animate-admin-in" style={{ animationDelay: `${i * 50}ms` }}>
                  <div className="bg-white rounded-xl shadow-brand overflow-hidden border border-cafe-100">
                    <div className={`h-1 ${unitColor.accent}`} />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-coqui-900 text-sm truncate">
                            {stay.unit}
                          </p>
                          <p className="text-xs text-coqui-800/60 mt-0.5">
                            {stay.guestFirstName}
                          </p>
                        </div>
                        <StatusBadge status={stay.checkedIn ? 'active' : 'pending'} />
                      </div>
                      <div className="mt-2 flex items-center gap-1 text-xs text-coqui-800/60">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>
                          {formatDate(stay.checkInDate)} — {formatDate(stay.checkOutDate)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Laundry Status */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          Laundry Status
        </h2>
        <div className="space-y-3">
          <LaundryMachineCard machineId="washer" label="Washer" />
          <LaundryMachineCard machineId="dryer" label="Dryer" />
        </div>
      </div>
    </div>
  );
}

function FullAdminDashboard() {
  const {
    data: activeBookings,
    loading: bookingsLoading,
  } = useCollection('bookings', [where('status', '==', 'active')]);

  const {
    data: allBookings,
    loading: allBookingsLoading,
  } = useCollection('bookings', [orderBy('checkInDate', 'desc')]);

  const {
    data: openTasks,
    loading: tasksLoading,
  } = useCollection('assignments', [where('status', 'in', ['pending', 'in_progress'])]);

  const {
    data: revenue,
    loading: revenueLoading,
  } = useCollection('revenue');

  const pendingCheckIns = useMemo(() => {
    return activeBookings.filter((b) => !b.checkedIn);
  }, [activeBookings]);

  const monthlyRevenue = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    return revenue
      .filter((r) => {
        const d = new Date(r.date || r.createdAt || 0);
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      })
      .reduce((sum, r) => sum + (r.amount || 0), 0);
  }, [revenue]);

  const currentGuests = useMemo(() => {
    return [...activeBookings].sort(
      (a, b) => new Date(a.checkInDate) - new Date(b.checkInDate)
    );
  }, [activeBookings]);

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Page title */}
      <div>
        <h1 className="font-display text-2xl text-coqui-900">Dashboard</h1>
        <p className="text-sm text-coqui-800/60 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatsCard
          label="Active Bookings"
          value={activeBookings.length}
          accent="text-coqui-600"
          loading={bookingsLoading}
          bgTint="bg-coqui-50 border-coqui-100"
        />
        <StatsCard
          label="Pending Check-ins"
          value={pendingCheckIns.length}
          accent={pendingCheckIns.length > 0 ? 'text-atardecer-600' : 'text-coqui-900'}
          loading={bookingsLoading}
          bgTint="bg-atardecer-50 border-atardecer-100"
        />
        <StatsCard
          label="Open Tasks"
          value={openTasks.length}
          accent={openTasks.length > 0 ? 'text-flamboyan-600' : 'text-coqui-900'}
          loading={tasksLoading}
          bgTint="bg-flamboyan-50 border-flamboyan-100"
        />
        <StatsCard
          label="Monthly Revenue"
          value={
            revenueLoading
              ? '...'
              : `$${monthlyRevenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
          }
          accent="text-caribe-600"
          loading={revenueLoading}
          bgTint="bg-caribe-50 border-caribe-100"
        />
      </div>

      {/* Quick Actions — Send Alert first (most frequent), then Calendar, then Create Booking */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Link
            href="/admin/notify"
            className="flex flex-col items-center gap-2 bg-white border border-cafe-200 rounded-xl shadow-brand p-4 min-h-[72px] active:scale-[0.98] active:bg-cafe-100 transition-all duration-150"
          >
            <span className="text-coqui-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0h6z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-coqui-900 text-center leading-tight">
              Send Alert
            </span>
          </Link>
          <Link
            href="/admin/calendar"
            className="flex flex-col items-center gap-2 bg-white border border-cafe-200 rounded-xl shadow-brand p-4 min-h-[72px] active:scale-[0.98] active:bg-cafe-100 transition-all duration-150"
          >
            <span className="text-coqui-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-coqui-900 text-center leading-tight">
              Calendar
            </span>
          </Link>
          <Link
            href="/admin/bookings"
            className="flex flex-col items-center gap-2 bg-white border border-cafe-200 rounded-xl shadow-brand p-4 min-h-[72px] active:scale-[0.98] active:bg-cafe-100 transition-all duration-150"
          >
            <span className="text-coqui-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </span>
            <span className="text-xs font-medium text-coqui-900 text-center leading-tight">
              Create Booking
            </span>
          </Link>
        </div>
      </div>

      {/* Current Guests */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700">
            Current Guests
          </h2>
          <Link href="/admin/bookings" className="text-xs text-coqui-600 font-medium min-h-[44px] flex items-center">
            View all
          </Link>
        </div>

        {bookingsLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden">
                <div className="h-1 animate-admin-shimmer" />
                <div className="p-4">
                  <div className="h-4 animate-admin-shimmer rounded w-1/3 mb-2" />
                  <div className="h-3 animate-admin-shimmer rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : currentGuests.length === 0 ? (
          <div className="bg-white rounded-xl shadow-brand p-8 text-center border border-cafe-100">
            <p className="text-coqui-800/50 text-sm">No active bookings</p>
            <Link href="/admin/bookings" className="text-coqui-600 text-sm font-medium mt-1 inline-block">
              Create one
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {currentGuests.map((booking, i) => {
              const unitColor = UNIT_COLORS[booking.unit] || { accent: 'bg-cafe-300', text: 'text-cafe-700' };
              return (
                <div key={booking.id} className="animate-admin-in" style={{ animationDelay: `${i * 50}ms` }}>
                  <div className="bg-white rounded-xl shadow-brand overflow-hidden border border-cafe-100">
                    <div className={`h-1 ${unitColor.accent}`} />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-coqui-900 text-sm truncate">
                            {booking.guestName || 'Awaiting check-in'}
                          </p>
                          <p className={`text-xs mt-0.5 font-medium ${unitColor.text}`}>
                            {booking.unit}
                          </p>
                        </div>
                        <StatusBadge status={booking.checkedIn ? 'active' : 'pending'} />
                      </div>
                      <div className="mt-2 flex items-center gap-1 text-xs text-coqui-800/60">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>
                          {formatDate(booking.checkInDate)} — {formatDate(booking.checkOutDate)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Laundry Status */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          Laundry Status
        </h2>
        <div className="space-y-3">
          <LaundryMachineCard machineId="washer" label="Washer" />
          <LaundryMachineCard machineId="dryer" label="Dryer" />
        </div>
      </div>
    </div>
  );
}
