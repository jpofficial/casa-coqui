'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import useAuth from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Unit palette — matches calendar teal/amber scheme
// ---------------------------------------------------------------------------
const UNIT_PALETTES = {
  'Unit A': {
    accent: 'bg-teal-500',
    text: 'text-teal-600',
    progressBg: 'bg-teal-100',
    progressFill: 'bg-teal-500',
  },
  'Unit B': {
    accent: 'bg-amber-500',
    text: 'text-amber-600',
    progressBg: 'bg-amber-100',
    progressFill: 'bg-amber-500',
  },
};

const DEFAULT_PALETTE = {
  accent: 'bg-gray-500',
  text: 'text-gray-600',
  progressBg: 'bg-gray-100',
  progressFill: 'bg-gray-500',
};

function getPalette(unit) {
  return UNIT_PALETTES[unit] || DEFAULT_PALETTE;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getProgressLabel(stay) {
  const today = todayStr();
  if (stay.checkOutDate === today) {
    return { text: 'Checking out today', color: 'text-red-600' };
  }
  // Check if checkout is tomorrow
  const [y, m, d] = today.split('-').map(Number);
  const tomorrow = new Date(y, m - 1, d + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  if (stay.checkOutDate === tomorrowStr) {
    return { text: 'Checking out tomorrow', color: 'text-amber-600' };
  }
  if (stay.checkInDate === today && !stay.checkedIn) {
    return { text: 'Arriving today', color: 'text-blue-600' };
  }
  const nightsElapsed = stay.nightCount - stay.nightsRemaining;
  if (nightsElapsed >= 0 && stay.nightCount > 0) {
    return {
      text: `Night ${nightsElapsed + 1} of ${stay.nightCount}`,
      color: 'text-gray-600',
    };
  }
  return { text: `${stay.nightCount} nights`, color: 'text-gray-600' };
}

function getProgressPercent(stay) {
  if (!stay.nightCount) return 0;
  const elapsed = stay.nightCount - stay.nightsRemaining;
  return Math.min(100, Math.max(0, (elapsed / stay.nightCount) * 100));
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------
function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden animate-pulse">
      <div className="h-1 bg-gray-200" />
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-4 bg-gray-100 rounded w-24" />
          <div className="h-5 bg-gray-100 rounded-full w-20" />
        </div>
        <div className="h-2 bg-gray-100 rounded-full w-full" />
        <div className="flex gap-3">
          <div className="h-3 bg-gray-100 rounded w-16" />
          <div className="h-3 bg-gray-100 rounded w-20" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 bg-gray-100 rounded-lg w-20" />
          <div className="h-8 bg-gray-100 rounded-lg w-20" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stay Card
// ---------------------------------------------------------------------------
function StayCard({ stay, isAdmin }) {
  const palette = getPalette(stay.unit);
  const progress = getProgressPercent(stay);
  const label = getProgressLabel(stay);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const primaryGuest = stay.members?.find((m) => m.role === 'primary');
  const invitedGuests = stay.members?.filter((m) => m.role !== 'primary') || [];

  async function handleCopyLink() {
    if (!stay.guestLink) return;
    try {
      await navigator.clipboard.writeText(stay.guestLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = stay.guestLink;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Unit accent bar */}
      <div className={`h-1 ${palette.accent}`} />

      <div className="p-4 space-y-3">
        {/* Header: unit + guest + status — tappable to expand */}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full flex items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-sm font-bold ${palette.text}`}>{stay.unit}</span>
            <span className="text-sm font-semibold text-gray-900 truncate">
              {isAdmin && stay.guestName ? stay.guestName : stay.guestFirstName}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                stay.checkedIn
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {stay.checkedIn ? 'Checked In' : 'Expected'}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-xs font-medium ${label.color}`}>{label.text}</span>
          </div>
          <div className={`h-2 rounded-full ${palette.progressBg}`}>
            <div
              className={`h-2 rounded-full ${palette.progressFill} transition-all duration-500`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[11px] text-gray-400">{formatDate(stay.checkInDate)}</span>
            <span className="text-[11px] text-gray-400">{formatDate(stay.checkOutDate)}</span>
          </div>
        </div>

        {/* Guest details (if check-in completed) */}
        {stay.checkedIn && (stay.guestCount || stay.arrivalTime || stay.specialRequests) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            {stay.guestCount && (
              <span className="flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {stay.guestCount} guest{stay.guestCount !== 1 ? 's' : ''}
              </span>
            )}
            {stay.arrivalTime && !stay.checkedIn && (
              <span className="flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {stay.arrivalTime}
              </span>
            )}
          </div>
        )}

        {/* Special requests snippet */}
        {stay.specialRequests && (
          <p className="text-xs text-gray-400 italic truncate">
            &ldquo;{stay.specialRequests}&rdquo;
          </p>
        )}

        {/* Alert badges */}
        {(stay.unreadMessageCount > 0 || stay.openMaintenanceCount > 0) && (
          <div className="flex flex-wrap gap-2">
            {stay.unreadMessageCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {stay.unreadMessageCount} unread
              </span>
            )}
            {stay.openMaintenanceCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {stay.openMaintenanceCount} open issue{stay.openMaintenanceCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Expanded guest details */}
        {expanded && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Guests</p>
            <div className="space-y-1.5">
              {/* Primary guest */}
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <span className="text-sm text-gray-900 font-medium">
                  {primaryGuest?.name || (isAdmin && stay.guestName) || stay.guestFirstName || 'Guest'}
                </span>
                <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">Primary</span>
              </div>
              {/* Invited guests */}
              {invitedGuests.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-700">{g.name || 'Invited guest'}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    g.status === 'verified' ? 'text-green-700 bg-green-100' : 'text-yellow-700 bg-yellow-100'
                  }`}>
                    {g.status === 'verified' ? 'Joined' : 'Pending'}
                  </span>
                </div>
              ))}
              {invitedGuests.length === 0 && (
                <p className="text-xs text-gray-400 pl-8">No additional guests invited</p>
              )}
            </div>
            {/* Extra details */}
            {isAdmin && (stay.guestEmail || stay.phone) && (
              <div className="pt-2 border-t border-gray-200 space-y-1">
                {stay.guestEmail && (
                  <p className="text-xs text-gray-500">
                    <span className="font-medium text-gray-600">Email:</span> {stay.guestEmail}
                  </p>
                )}
                {stay.phone && (
                  <p className="text-xs text-gray-500">
                    <span className="font-medium text-gray-600">Phone:</span> {stay.phone}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quick actions (admin only) */}
        {isAdmin && (
          <div className="flex gap-2 pt-1">
            <a
              href="https://www.airbnb.com/hosting/inbox"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-xs font-medium text-gray-700 active:bg-gray-200 transition-colors min-h-[36px]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Message
            </a>

            {stay.guestLink && (
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-xs font-medium text-gray-700 active:bg-gray-200 transition-colors min-h-[36px]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            )}

            {stay.phone && (
              <a
                href={`tel:${stay.phone}`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-xs font-medium text-gray-700 active:bg-gray-200 transition-colors min-h-[36px]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Call
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyState({ isAdmin }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-8 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-12 h-12 text-gray-300 mx-auto mb-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
      <p className="text-gray-500 font-medium">No active stays</p>
      <p className="text-sm text-gray-400 mt-1">Your property is currently vacant</p>
      {isAdmin && (
        <Link
          href="/admin/bookings"
          className="inline-block mt-4 text-green-600 text-sm font-medium hover:text-green-700"
        >
          Create a booking
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function StaysPage() {
  const { user, isAdmin } = useAuth();
  const [stays, setStays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unitFilter, setUnitFilter] = useState('All');

  useEffect(() => {
    async function fetchStays() {
      if (!user) return;
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/stays/active', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const json = await res.json();
        if (json.success) {
          setStays(json.data);
        } else {
          setError(json.error);
        }
      } catch {
        setError('Failed to load stays.');
      } finally {
        setLoading(false);
      }
    }
    fetchStays();
  }, [user]);

  // Derive unique unit names from the data
  const unitNames = useMemo(() => {
    const units = [...new Set(stays.map((s) => s.unit).filter(Boolean))];
    units.sort();
    return units;
  }, [stays]);

  // Filter by unit
  const filteredStays = useMemo(() => {
    if (unitFilter === 'All') return stays;
    return stays.filter((s) => s.unit === unitFilter);
  }, [stays, unitFilter]);

  // Today's formatted date for subtitle
  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (error) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Active Stays</h1>
        <p className="text-sm text-gray-500 mt-0.5">{todayFormatted}</p>
      </div>

      {/* Unit filter pills */}
      {!loading && unitNames.length > 1 && (
        <div className="flex gap-2">
          {['All', ...unitNames].map((unit) => (
            <button
              key={unit}
              onClick={() => setUnitFilter(unit)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                unitFilter === unit
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-600 active:bg-gray-200'
              }`}
            >
              {unit}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filteredStays.length === 0 ? (
        <EmptyState isAdmin={isAdmin} />
      ) : (
        <div className="space-y-3">
          {filteredStays.map((stay) => (
            <StayCard key={stay.id} stay={stay} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}
