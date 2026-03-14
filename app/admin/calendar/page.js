'use client';

import { useState, useMemo } from 'react';
import { orderBy } from 'firebase/firestore';
import Link from 'next/link';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { getUnitNames } from '@/lib/units';
import useAuth from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ymd(dateStr) {
  if (!dateStr) return '';
  return String(dateStr).substring(0, 10);
}

function dateToYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

function formatMonthYear(year, month) {
  const d = new Date(year, month, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateFull(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function getNightCount(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const [y1, m1, d1] = checkIn.split('-').map(Number);
  const [y2, m2, d2] = checkOut.split('-').map(Number);
  const a = new Date(y1, m1 - 1, d1);
  const b = new Date(y2, m2 - 1, d2);
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function firstName(name) {
  if (!name) return 'Guest';
  return name.split(' ')[0];
}

const TODAY = dateToYMD(new Date());

function bookingStatus(booking) {
  const checkIn = ymd(booking.checkInDate);
  const checkOut = ymd(booking.checkOutDate);
  if (checkOut < TODAY) return 'completed';
  if (checkIn > TODAY) return 'upcoming';
  return 'active';
}

// ---------------------------------------------------------------------------
// Unit-based color system — teal for unit A, amber for unit B
// Status conveyed through opacity/saturation, not separate hues
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  active: 'Active',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

const STATUS_BADGE_STYLES = {
  active: 'bg-green-100 text-green-700',
  upcoming: 'bg-blue-100 text-blue-700',
  completed: 'bg-gray-100 text-gray-500',
};

const UNIT_PALETTES = [
  {
    name: 'Teal',
    text: 'text-teal-600',
    pill: { active: 'bg-teal-500 text-white', upcoming: 'bg-teal-200 text-teal-800', completed: 'bg-teal-100 text-teal-400' },
    accent: { active: 'bg-teal-500', upcoming: 'bg-teal-300', completed: 'bg-teal-200' },
    swatch: { active: 'bg-teal-500', upcoming: 'bg-teal-300', completed: 'bg-teal-100' },
  },
  {
    name: 'Amber',
    text: 'text-amber-600',
    pill: { active: 'bg-amber-500 text-white', upcoming: 'bg-amber-200 text-amber-800', completed: 'bg-amber-100 text-amber-400' },
    accent: { active: 'bg-amber-500', upcoming: 'bg-amber-300', completed: 'bg-amber-200' },
    swatch: { active: 'bg-amber-500', upcoming: 'bg-amber-300', completed: 'bg-amber-100' },
  },
];

function getUnitPalette(unit, unitNames) {
  const idx = unitNames.indexOf(unit);
  return UNIT_PALETTES[idx >= 0 ? idx % UNIT_PALETTES.length : 0];
}

// ---------------------------------------------------------------------------
// Build calendar grid rows
// ---------------------------------------------------------------------------

function buildCalendarGrid(year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const cells = [];

  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dayNum: d, dateStr });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Booking days in month — checkout date is excluded (guest departs that day)
// ---------------------------------------------------------------------------

function bookingDaysInMonth(booking, year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const checkIn = ymd(booking.checkInDate);
  const checkOut = ymd(booking.checkOutDate);

  // If checkout is on or before month start, booking doesn't occupy this month
  if (checkOut <= monthStart || checkIn > monthEnd) return null;

  const clampedStart = checkIn < monthStart ? monthStart : checkIn;
  const clampedEnd = checkOut > monthEnd ? monthEnd : checkOut;

  const startDay = parseInt(clampedStart.split('-')[2], 10);
  let endDay = parseInt(clampedEnd.split('-')[2], 10);

  // If checkout falls within this month, exclude the checkout day itself
  if (checkOut <= monthEnd) {
    endDay = endDay - 1;
  }

  if (endDay < startDay) return null;

  const isStart = checkIn >= monthStart && checkIn <= monthEnd;
  const isEnd = checkOut >= monthStart && checkOut <= monthEnd;

  return { startDay, endDay, isStart, isEnd };
}

// ---------------------------------------------------------------------------
// BookingDetailModal
// ---------------------------------------------------------------------------

function BookingDetailModal({ booking, onClose, unitNames }) {
  const status = bookingStatus(booking);
  const ci = ymd(booking.checkInDate);
  const co = ymd(booking.checkOutDate);
  const nights = getNightCount(ci, co);
  const palette = getUnitPalette(booking.unit, unitNames);

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-end justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`h-1 ${palette.accent[status]}`} />
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-gray-900">
              {booking.guestName || 'Guest'}
            </h3>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors text-gray-400"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold ${palette.pill[status]}`}>
              {booking.unit || 'Unknown unit'}
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_STYLES[status]}`}>
              {STATUS_LABELS[status]}
            </span>
          </div>

          <div className="bg-gray-50 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Check-in</p>
                <p className="text-sm font-medium text-gray-800">{formatDateFull(ci)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Check-out</p>
                <p className="text-sm font-medium text-gray-800">{formatDateFull(co)}</p>
              </div>
            </div>
            <div className="border-t border-gray-200 pt-2 text-center">
              <span className="text-sm text-gray-600 font-medium">{nights} night{nights !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {booking.checkedIn !== undefined && (
            <p className="mt-3 text-sm text-gray-500">
              {booking.checkedIn ? 'Checked in' : 'Not checked in yet'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar Day Cell
// ---------------------------------------------------------------------------

function DayCell({ cell, bookingsInDay, onBookingTap, isToday, unitNames }) {
  if (!cell) {
    return <div className="min-h-[72px]" />;
  }

  return (
    <div className={`min-h-[72px] rounded-lg p-1 relative ${isToday ? 'bg-green-50' : ''}`}>
      <div className="flex justify-center mb-1">
        <span
          className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
            isToday ? 'bg-green-600 text-white font-bold' : 'text-gray-500'
          }`}
        >
          {cell.dayNum}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {bookingsInDay.map(({ booking, status }) => {
          const palette = getUnitPalette(booking.unit, unitNames);
          return (
            <button
              key={booking.id}
              onClick={() => onBookingTap(booking)}
              className={`w-full py-0.5 px-1 rounded text-[10px] font-medium truncate text-left min-h-[18px] ${palette.pill[status]} hover:opacity-90 active:opacity-80 transition-opacity`}
              title={`${booking.guestName || 'Guest'} \u00b7 ${booking.unit}`}
            >
              {firstName(booking.guestName)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Calendar Page
// ---------------------------------------------------------------------------

export default function OccupancyCalendar() {
  const { data: bookings, loading, error } = useCollection('bookings', [orderBy('checkInDate', 'asc')]);
  const { data: settings } = useDocument('settings', 'property');
  const { isAdmin } = useAuth();
  const unitNames = getUnitNames(settings);

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [unitFilter, setUnitFilter] = useState('All');

  // Filter out cancelled bookings, then apply unit filter
  const filteredBookings = useMemo(() => {
    let filtered = bookings.filter((b) => b.status !== 'cancelled');
    if (unitFilter !== 'All') filtered = filtered.filter((b) => b.unit === unitFilter);
    return filtered;
  }, [bookings, unitFilter]);

  const calendarGrid = useMemo(
    () => buildCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  // Map: dateStr -> [{ booking, status }]
  const dayBookingsMap = useMemo(() => {
    const map = {};
    for (const booking of filteredBookings) {
      const range = bookingDaysInMonth(booking, viewYear, viewMonth);
      if (!range) continue;
      const status = bookingStatus(booking);
      for (let d = range.startDay; d <= range.endDay; d++) {
        const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push({ booking, status });
      }
    }
    return map;
  }, [filteredBookings, viewYear, viewMonth]);

  const monthBookings = useMemo(() => {
    return filteredBookings.filter((b) => bookingDaysInMonth(b, viewYear, viewMonth) !== null);
  }, [filteredBookings, viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function goToToday() {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  }

  if (error) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto">
        <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">
          Failed to load calendar data. Please refresh.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
        <p className="text-sm text-gray-500 mt-0.5">Occupancy across both units</p>
      </div>

      {/* Unit filter */}
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

      {/* Calendar card */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Previous month"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <button
            onClick={goToToday}
            className="text-base font-bold text-gray-900 px-2 py-1 rounded hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            {formatMonthYear(viewYear, viewMonth)}
          </button>

          <button
            onClick={nextMonth}
            className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Next month"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="space-y-1">
            {[1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: 7 }).map((_, col) => (
                  <div key={col} className="h-[72px] bg-gray-50 rounded-lg animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {calendarGrid.map((row, rowIdx) => (
              <div key={rowIdx} className="grid grid-cols-7 gap-0.5">
                {row.map((cell, colIdx) => {
                  const isToday = cell && cell.dateStr === TODAY;
                  const bookingsInDay = cell ? (dayBookingsMap[cell.dateStr] || []) : [];
                  return (
                    <DayCell
                      key={colIdx}
                      cell={cell}
                      bookingsInDay={bookingsInDay}
                      onBookingTap={setSelectedBooking}
                      isToday={isToday}
                      unitNames={unitNames}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-x-5 gap-y-2 items-center">
          {unitNames.map((name, idx) => {
            const palette = UNIT_PALETTES[idx % UNIT_PALETTES.length];
            return (
              <div key={name} className="flex items-center gap-1.5">
                <div className="flex gap-px">
                  <div className={`w-3 h-3 rounded-l ${palette.swatch.active}`} />
                  <div className={`w-3 h-3 ${palette.swatch.upcoming}`} />
                  <div className={`w-3 h-3 rounded-r ${palette.swatch.completed}`} />
                </div>
                <span className="text-xs text-gray-600 font-medium">{name}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-3 text-[10px] text-gray-400 ml-auto">
            <span>Dark = active</span>
            <span>Light = past</span>
          </div>
        </div>
      </div>

      {/* Bookings this month list */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Bookings in {formatMonthYear(viewYear, viewMonth)}
        </h2>

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : monthBookings.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-gray-400 text-sm mb-2">No bookings this month</p>
            {isAdmin && (
              <Link href="/admin/bookings" className="text-green-600 text-sm font-medium">
                Create a booking
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {monthBookings.map((booking) => {
              const status = bookingStatus(booking);
              const ci = ymd(booking.checkInDate);
              const co = ymd(booking.checkOutDate);
              const nights = getNightCount(ci, co);
              const palette = getUnitPalette(booking.unit, unitNames);
              return (
                <button
                  key={booking.id}
                  onClick={() => setSelectedBooking(booking)}
                  className="w-full bg-white rounded-xl shadow-sm text-left hover:bg-gray-50 active:bg-gray-100 transition-colors overflow-hidden"
                >
                  <div className={`h-1 ${palette.accent[status]}`} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900">
                            {booking.guestName || 'Guest'}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_STYLES[status]}`}>
                            {STATUS_LABELS[status]}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs font-semibold ${palette.text}`}>
                            {booking.unit}
                          </span>
                          <span className="text-xs text-gray-400">&middot;</span>
                          <span className="text-xs text-gray-500">{nights} night{nights !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-medium text-gray-700">
                          {formatDateShort(ci)}
                        </p>
                        <p className="text-xs text-gray-400">
                          — {formatDateShort(co)}
                        </p>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Booking Detail Modal */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          unitNames={unitNames}
        />
      )}
    </div>
  );
}
