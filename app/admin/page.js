'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { where, orderBy, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { db } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';

const LAUNDRY_STATUSES = [
  { key: 'available', label: 'Available', color: 'bg-green-100 text-green-700', active: 'bg-green-600 text-white' },
  { key: 'in-use', label: 'In Use', color: 'bg-amber-100 text-amber-700', active: 'bg-amber-500 text-white' },
  { key: 'needs-attention', label: 'Needs Attention', color: 'bg-red-100 text-red-600', active: 'bg-red-500 text-white' },
];

function laundryStatusColor(status) {
  if (status === 'available') return 'bg-green-100 text-green-700';
  if (status === 'in-use') return 'bg-amber-100 text-amber-700';
  if (status === 'needs-attention') return 'bg-red-100 text-red-600';
  return 'bg-gray-100 text-gray-500';
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
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {loading ? (
          <div className="h-5 w-20 bg-gray-100 rounded-full animate-pulse" />
        ) : currentStatus ? (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${laundryStatusColor(currentStatus)}`}>
            {LAUNDRY_STATUSES.find((s) => s.key === currentStatus)?.label || currentStatus}
          </span>
        ) : (
          <span className="text-xs text-gray-400">No status</span>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {LAUNDRY_STATUSES.map((s) => (
          <button
            key={s.key}
            onClick={() => handleOverride(s.key)}
            className={`flex-1 min-w-[80px] text-xs font-medium py-2 px-2 rounded-lg transition-colors ${
              currentStatus === s.key ? s.active : 'bg-gray-100 text-gray-600 active:bg-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsCard({ label, value, accent, loading }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-500 font-medium uppercase tracking-wide leading-none">
        {label}
      </span>
      {loading ? (
        <div className="h-8 w-12 bg-gray-100 rounded animate-pulse mt-1" />
      ) : (
        <span className={`text-3xl font-bold leading-none mt-1 ${accent || 'text-gray-800'}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-green-100 text-green-700',
    completed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-600',
    pending: 'bg-yellow-100 text-yellow-700',
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
    data: maintenanceRequests,
    loading: maintenanceLoading,
  } = useCollection('maintenance', [where('status', '==', 'open')]);

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Operations</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Operations stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatsCard
          label="Active Stays"
          value={stays.length}
          accent="text-green-600"
          loading={staysLoading}
        />
        <StatsCard
          label="Open Maintenance"
          value={maintenanceRequests.length}
          accent={maintenanceRequests.length > 0 ? 'text-red-500' : 'text-gray-800'}
          loading={maintenanceLoading}
        />
      </div>

      {/* Quick actions for co-host */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Link
            href="/admin/assignments"
            className="flex flex-col items-center gap-2 bg-white rounded-xl shadow-sm p-4 min-h-[72px] active:bg-gray-50 transition-colors"
          >
            <span className="text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </span>
            <span className="text-xs font-medium text-gray-700 text-center leading-tight">
              My Tasks
            </span>
          </Link>
          <Link
            href="/admin/maintenance"
            className="flex flex-col items-center gap-2 bg-white rounded-xl shadow-sm p-4 min-h-[72px] active:bg-gray-50 transition-colors"
          >
            <span className="text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-gray-700 text-center leading-tight">
              Maintenance
            </span>
          </Link>
          <Link
            href="/admin/stays"
            className="flex flex-col items-center gap-2 bg-white rounded-xl shadow-sm p-4 min-h-[72px] active:bg-gray-50 transition-colors"
          >
            <span className="text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-gray-700 text-center leading-tight">
              Current Stays
            </span>
          </Link>
        </div>
      </div>

      {/* Current stays (privacy-filtered for co-host) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Active Stays
          </h2>
          <Link href="/admin/stays" className="text-xs text-green-600 font-medium min-h-[44px] flex items-center">
            View all
          </Link>
        </div>

        {staysLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : stays.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <p className="text-gray-400 text-sm">No active stays</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stays.map((stay) => (
              <div key={stay.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">
                      {stay.unit}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {stay.guestFirstName}
                    </p>
                  </div>
                  <StatusBadge status={stay.checkedIn ? 'active' : 'pending'} />
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>
                    {formatDate(stay.checkInDate)} — {formatDate(stay.checkOutDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Laundry Status */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
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
    data: maintenanceRequests,
    loading: maintenanceLoading,
  } = useCollection('maintenance', [where('status', '==', 'open')]);

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
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatsCard
          label="Active Bookings"
          value={activeBookings.length}
          accent="text-green-600"
          loading={bookingsLoading}
        />
        <StatsCard
          label="Pending Check-ins"
          value={pendingCheckIns.length}
          accent={pendingCheckIns.length > 0 ? 'text-yellow-600' : 'text-gray-800'}
          loading={bookingsLoading}
        />
        <StatsCard
          label="Open Maintenance"
          value={maintenanceRequests.length}
          accent={maintenanceRequests.length > 0 ? 'text-red-500' : 'text-gray-800'}
          loading={maintenanceLoading}
        />
        <StatsCard
          label="Monthly Revenue"
          value={
            revenueLoading
              ? '...'
              : `$${monthlyRevenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
          }
          accent="text-green-600"
          loading={revenueLoading}
        />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Link
            href="/admin/bookings"
            className="flex flex-col items-center gap-2 bg-white rounded-xl shadow-sm p-4 min-h-[72px] active:bg-gray-50 transition-colors"
          >
            <span className="text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </span>
            <span className="text-xs font-medium text-gray-700 text-center leading-tight">
              Create Booking
            </span>
          </Link>
          <Link
            href="/admin/notify"
            className="flex flex-col items-center gap-2 bg-white rounded-xl shadow-sm p-4 min-h-[72px] active:bg-gray-50 transition-colors"
          >
            <span className="text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0h6z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-gray-700 text-center leading-tight">
              Broadcast
            </span>
          </Link>
          <Link
            href="/admin/messages"
            className="flex flex-col items-center gap-2 bg-white rounded-xl shadow-sm p-4 min-h-[72px] active:bg-gray-50 transition-colors"
          >
            <span className="text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 16a2 2 0 01-2 2H7l-4 4V6a2 2 0 012-2h14a2 2 0 012 2v10z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-gray-700 text-center leading-tight">
              Messages
            </span>
          </Link>
        </div>
      </div>

      {/* Current Guests */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Current Guests
          </h2>
          <Link href="/admin/bookings" className="text-xs text-green-600 font-medium min-h-[44px] flex items-center">
            View all
          </Link>
        </div>

        {bookingsLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : currentGuests.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <p className="text-gray-400 text-sm">No active bookings</p>
            <Link href="/admin/bookings" className="text-green-600 text-sm font-medium mt-1 inline-block">
              Create one
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {currentGuests.map((booking) => (
              <div key={booking.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">
                      {booking.guestName || 'Awaiting check-in'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {booking.unit}
                    </p>
                  </div>
                  <StatusBadge status={booking.checkedIn ? 'active' : 'pending'} />
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>
                    {formatDate(booking.checkInDate)} — {formatDate(booking.checkOutDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Laundry Status */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
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
