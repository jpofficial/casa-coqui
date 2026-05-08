'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { where, orderBy } from 'firebase/firestore';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { auth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

const LAUNDRY_STATUSES = [
  { key: 'available', labelKey: 'admin_dash_laundryAvailable', color: 'bg-coqui-100 text-coqui-700', active: 'bg-coqui-600 text-white' },
  { key: 'in_use', labelKey: 'admin_dash_laundryInUse', color: 'bg-atardecer-100 text-atardecer-700', active: 'bg-atardecer-500 text-white' },
  { key: 'needs_attention', labelKey: 'admin_dash_laundryNeedsAttention', color: 'bg-flamboyan-100 text-flamboyan-600', active: 'bg-flamboyan-500 text-white' },
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
  const { locale } = useLocale();
  const { data, loading } = useDocument('laundry', machineId);
  const [actionLoading, setActionLoading] = useState(false);
  const [countdown, setCountdown] = useState(null);

  const currentStatus = data?.status || null;
  const sessionOwnerName = data?.sessionOwnerName || null;
  const sessionExpiresAt = data?.sessionExpiresAt || null;

  // Live countdown ticker for in_use machines
  useEffect(() => {
    if (currentStatus !== 'in_use' || !sessionExpiresAt) {
      setCountdown(null);
      return;
    }

    function tick() {
      const msLeft = new Date(sessionExpiresAt).getTime() - Date.now();
      if (msLeft <= 0) {
        setCountdown(t(locale, 'admin_dash_expired'));
        return;
      }
      const totalMinutes = Math.floor(msLeft / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      setCountdown(
        hours > 0
          ? t(locale, 'admin_dash_hLeft').replace('{h}', hours).replace('{m}', minutes)
          : t(locale, 'admin_dash_mLeft').replace('{m}', minutes)
      );
    }

    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, [currentStatus, sessionExpiresAt, locale]);

  async function callApi(endpoint, body) {
    setActionLoading(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        console.error(`[LaundryMachineCard] ${endpoint} error:`, json.error);
      }
    } catch (err) {
      console.error(`[LaundryMachineCard] ${endpoint} failed:`, err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleOverride(newStatus) {
    if (actionLoading) return;

    if (newStatus === 'available' && currentStatus === 'in_use') {
      // End the active session
      await callApi('/api/laundry/end', { machineId });
    } else if (newStatus === 'needs_attention') {
      // Report a problem
      await callApi('/api/laundry/attention', { machineId, action: 'report' });
    } else if (newStatus === 'available' && currentStatus === 'needs_attention') {
      // Clear the attention flag
      await callApi('/api/laundry/attention', { machineId, action: 'clear' });
    } else if (newStatus === 'in_use') {
      // Admin test: start a session (requires staff auth, no guest bookingCode needed)
      await callApi('/api/laundry/start', { machineId });
    }
  }

  const currentStatusEntry = LAUNDRY_STATUSES.find((s) => s.key === currentStatus);

  return (
    <div className="bg-white rounded-xl shadow-brand p-4 border border-cafe-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-coqui-900">{label}</span>
        {loading ? (
          <div className="h-5 w-20 animate-admin-shimmer rounded-full" />
        ) : currentStatus ? (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${laundryStatusColor(currentStatus)}`}>
            {currentStatusEntry ? t(locale, currentStatusEntry.labelKey) : currentStatus}
          </span>
        ) : (
          <span className="text-xs text-coqui-800/50">{t(locale, 'admin_noStatus')}</span>
        )}
      </div>

      {/* Session info — only when in_use */}
      {currentStatus === 'in_use' && (sessionOwnerName || countdown) && (
        <div className="mb-3 px-3 py-2 bg-atardecer-50 rounded-lg border border-atardecer-100 flex items-center justify-between gap-2">
          {sessionOwnerName && (
            <span className="text-xs text-atardecer-700 font-medium truncate">
              {sessionOwnerName}
            </span>
          )}
          {countdown && (
            <span className="text-xs text-atardecer-600 whitespace-nowrap">
              {countdown}
            </span>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {LAUNDRY_STATUSES.map((s) => (
          <button
            key={s.key}
            onClick={() => handleOverride(s.key)}
            disabled={actionLoading}
            className={`flex-1 min-w-[80px] text-xs font-medium py-2 px-2 rounded-lg transition-colors disabled:opacity-50 ${
              currentStatus === s.key ? s.active : `${s.color} active:opacity-80`
            }`}
          >
            {actionLoading && currentStatus !== s.key ? (
              <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              t(locale, s.labelKey)
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsCard({ label, value, accent, loading, bgTint, href }) {
  const Wrapper = href ? Link : 'div';
  const wrapperProps = href ? { href } : {};
  return (
    <Wrapper
      {...wrapperProps}
      className={`rounded-xl shadow-brand p-4 flex flex-col gap-1 border ${bgTint || 'bg-white border-cafe-200'} ${
        href ? 'active:scale-[0.97] active:opacity-80 transition-all duration-150 cursor-pointer' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-coqui-800/60 font-semibold uppercase tracking-wider leading-none">
          {label}
        </span>
        {href && (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-coqui-800/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-14 rounded animate-admin-shimmer mt-1" />
      ) : (
        <span className={`text-3xl font-bold leading-none mt-1 ${accent || 'text-coqui-900'}`}>
          {value}
        </span>
      )}
    </Wrapper>
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

function formatDate(dateStr, locale) {
  if (!dateStr) return '—';
  // Parse YYYY-MM-DD in local time, not UTC — new Date('2026-04-20') = UTC
  // midnight = prior-day evening in Puerto Rico (AST = UTC-4), shifting display
  // by one day.
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
  const { locale } = useLocale();
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
        <h1 className="font-display text-2xl text-coqui-900">{t(locale, 'admin_dash_opsTitle')}</h1>
        <p className="text-sm text-coqui-800/60 mt-0.5">
          {new Date().toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Operations stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatsCard
          label={t(locale, 'admin_dash_activeStays')}
          value={stays.length}
          accent="text-coqui-600"
          loading={staysLoading}
          bgTint="bg-coqui-50 border-coqui-100"
          href="/admin/stays"
        />
        <StatsCard
          label={t(locale, 'admin_dash_openTasks')}
          value={openTasks.length}
          accent={openTasks.length > 0 ? 'text-atardecer-600' : 'text-coqui-900'}
          loading={tasksLoading}
          bgTint="bg-atardecer-50 border-atardecer-100"
          href="/admin/assignments"
        />
      </div>

      {/* Quick actions for co-host */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          {t(locale, 'admin_dash_quickActions')}
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
              {t(locale, 'admin_dash_myTasks')}
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
              {t(locale, 'admin_dash_community')}
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
              {t(locale, 'admin_dash_calendar')}
            </span>
          </Link>
        </div>
      </div>

      {/* Current stays (privacy-filtered for co-host) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700">
            {t(locale, 'admin_dash_activeStays')}
          </h2>
          <Link href="/admin/stays" className="text-xs text-coqui-600 font-medium min-h-[44px] flex items-center">
            {t(locale, 'admin_viewAll')}
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
            <p className="text-coqui-800/50 text-sm">{t(locale, 'admin_dash_noActiveStays')}</p>
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
                          {formatDate(stay.checkInDate, locale)} — {formatDate(stay.checkOutDate, locale)}
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
          {t(locale, 'admin_dash_laundryStatus')}
        </h2>
        <div className="space-y-3">
          <LaundryMachineCard machineId="washer" label={t(locale, 'admin_dash_washer')} />
          <LaundryMachineCard machineId="dryer" label={t(locale, 'admin_dash_dryer')} />
        </div>
      </div>
    </div>
  );
}

function DashboardBookingCard({ booking, index }) {
  const { locale } = useLocale();
  const { data: checkin } = useDocument('checkins', booking.code || null);
  const isCheckedIn = booking.checkedIn || !!checkin?.checkedIn;
  const unitColor = UNIT_COLORS[booking.unit] || { accent: 'bg-cafe-300', text: 'text-cafe-700' };

  return (
    <div className="animate-admin-in" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="bg-white rounded-xl shadow-brand overflow-hidden border border-cafe-100">
        <div className={`h-1 ${unitColor.accent}`} />
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-coqui-900 text-sm truncate">
                {booking.guestName || t(locale, 'admin_dash_awaitingCheckin')}
              </p>
              <p className={`text-xs mt-0.5 font-medium ${unitColor.text}`}>
                {booking.unit}
              </p>
            </div>
            <StatusBadge status={isCheckedIn ? 'active' : 'pending'} />
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs text-coqui-800/60">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>
              {formatDate(booking.checkInDate, locale)} — {formatDate(booking.checkOutDate, locale)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FullAdminDashboard() {
  const { locale } = useLocale();

  const {
    data: activeBookings,
    loading: bookingsLoading,
  } = useCollection('bookings', [where('status', '==', 'active')]);

  const {
    data: allBookings,
    loading: allBookingsLoading,
  } = useCollection('bookings', [orderBy('checkInDate', 'desc')]);

  const {
    data: welcomePendingBookings,
    loading: welcomeLoading,
  } = useCollection('bookings', [
    where('status', '==', 'active'),
    where('welcomeStatus', 'in', ['pending', 'ready']),
  ]);

  const {
    data: openTasks,
    loading: tasksLoading,
  } = useCollection('assignments', [where('status', 'in', ['pending', 'in_progress'])]);

  const {
    data: revenue,
    loading: revenueLoading,
  } = useCollection('revenue');

  const {
    data: checkins,
    loading: checkinsLoading,
  } = useCollection('checkins', [where('checkedIn', '==', true)]);

  const checkedInCodes = useMemo(() => {
    const set = new Set();
    for (const c of checkins) {
      if (c.bookingCode) set.add(c.bookingCode);
    }
    return set;
  }, [checkins]);

  // Defense-in-depth: filter out stays past checkout (Cloud Function updates status at 2 AM)
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const currentActiveBookings = useMemo(() => {
    return activeBookings.filter((b) => b.checkOutDate >= today);
  }, [activeBookings, today]);

  const pendingCheckIns = useMemo(() => {
    return currentActiveBookings.filter((b) => !b.checkedIn && !checkedInCodes.has(b.code));
  }, [currentActiveBookings, checkedInCodes]);

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
    return [...currentActiveBookings].sort(
      (a, b) => new Date(a.checkInDate) - new Date(b.checkInDate)
    );
  }, [currentActiveBookings]);

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Page title */}
      <div>
        <h1 className="font-display text-2xl text-coqui-900">{t(locale, 'admin_dash_title')}</h1>
        <p className="text-sm text-coqui-800/60 mt-0.5">
          {new Date().toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatsCard
          label={t(locale, 'admin_dash_activeBookings')}
          value={currentActiveBookings.length}
          accent="text-coqui-600"
          loading={bookingsLoading}
          bgTint="bg-coqui-50 border-coqui-100"
          href="/admin/stays"
        />
        <StatsCard
          label={t(locale, 'admin_dash_pendingCheckins')}
          value={pendingCheckIns.length}
          accent={pendingCheckIns.length > 0 ? 'text-atardecer-600' : 'text-coqui-900'}
          loading={bookingsLoading}
          bgTint="bg-atardecer-50 border-atardecer-100"
          href="/admin/bookings"
        />
        <StatsCard
          label={t(locale, 'admin_dash_openTasks')}
          value={openTasks.length}
          accent={openTasks.length > 0 ? 'text-flamboyan-600' : 'text-coqui-900'}
          loading={tasksLoading}
          bgTint="bg-flamboyan-50 border-flamboyan-100"
          href="/admin/assignments"
        />
        <StatsCard
          label={t(locale, 'admin_dash_monthlyRevenue')}
          value={
            revenueLoading
              ? '...'
              : `$${monthlyRevenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
          }
          accent="text-caribe-600"
          loading={revenueLoading}
          bgTint="bg-caribe-50 border-caribe-100"
          href="/admin/revenue"
        />
      </div>

      {/* Quick Actions — Send Alert first (most frequent), then Calendar, then Create Booking */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          {t(locale, 'admin_dash_quickActions')}
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
              {t(locale, 'admin_dash_sendAlert')}
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
              {t(locale, 'admin_dash_calendar')}
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
              {t(locale, 'admin_dash_createBooking')}
            </span>
          </Link>
        </div>
      </div>

      {/* Welcome Messages Needed — only shown when count > 0 */}
      {!welcomeLoading && welcomePendingBookings.length > 0 && (
        <Link
          href="/admin/bookings"
          className="flex items-center gap-3 bg-atardecer-50 border border-atardecer-200 rounded-xl px-4 py-3 active:scale-[0.98] active:bg-atardecer-100 transition-all duration-150"
        >
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-atardecer-100 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4.5 h-4.5 text-atardecer-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-atardecer-800 leading-snug">
              {t(locale, 'admin_dash_welcomeNeeded').replace('{n}', welcomePendingBookings.length)}
            </p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-atardecer-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}

      {/* Current Guests */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700">
            {t(locale, 'admin_dash_currentGuests')}
          </h2>
          <Link href="/admin/bookings" className="text-xs text-coqui-600 font-medium min-h-[44px] flex items-center">
            {t(locale, 'admin_viewAll')}
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
            <p className="text-coqui-800/50 text-sm">{t(locale, 'admin_dash_noActiveBookings')}</p>
            <Link href="/admin/bookings" className="text-coqui-600 text-sm font-medium mt-1 inline-block">
              {t(locale, 'admin_dash_createOne')}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {currentGuests.map((booking, i) => (
              <DashboardBookingCard key={booking.id} booking={booking} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Laundry Status */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
          {t(locale, 'admin_dash_laundryStatus')}
        </h2>
        <div className="space-y-3">
          <LaundryMachineCard machineId="washer" label={t(locale, 'admin_dash_washer')} />
          <LaundryMachineCard machineId="dryer" label={t(locale, 'admin_dash_dryer')} />
        </div>
      </div>
    </div>
  );
}
