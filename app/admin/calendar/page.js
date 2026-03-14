'use client';

import { useState, useMemo } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { getUnitNames } from '@/lib/units';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ymd(dateStr) {
  // Normalize any date string to a YYYY-MM-DD string without timezone shift
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
  return new Date(year, month, 1).getDay(); // 0=Sun
}

function formatMonthYear(year, month) {
  const d = new Date(year, month, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDateFull(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const TODAY = dateToYMD(new Date());

// Booking status logic
function bookingStatus(booking) {
  const checkIn = ymd(booking.checkInDate);
  const checkOut = ymd(booking.checkOutDate);
  if (checkOut < TODAY) return 'completed';
  if (checkIn > TODAY) return 'upcoming';
  return 'active';
}

const STATUS_STYLES = {
  active: {
    bar: 'bg-green-500',
    badge: 'bg-green-100 text-green-700',
    label: 'Active',
  },
  upcoming: {
    bar: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700',
    label: 'Upcoming',
  },
  completed: {
    bar: 'bg-gray-300',
    badge: 'bg-gray-100 text-gray-500',
    label: 'Completed',
  },
};

// Color palette for units — cycles if more than 2 units
const UNIT_COLOR_PALETTE = [
  { active: 'bg-green-500', upcoming: 'bg-blue-500', completed: 'bg-gray-300' },
  { active: 'bg-emerald-400', upcoming: 'bg-indigo-400', completed: 'bg-gray-200' },
];

function getUnitBarColor(unit, status, unitNames) {
  const idx = unitNames.indexOf(unit);
  const palette = UNIT_COLOR_PALETTE[idx >= 0 ? idx % UNIT_COLOR_PALETTE.length : 0];
  return palette?.[status] || STATUS_STYLES[status]?.bar || 'bg-gray-300';
}

// ---------------------------------------------------------------------------
// Build calendar grid rows
// Each row: array of 7 day-cells. Each cell: { dayNum, dateStr } or null (padding)
// ---------------------------------------------------------------------------
function buildCalendarGrid(year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const cells = [];

  // Padding cells before day 1
  for (let i = 0; i < firstDay; i++) cells.push(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dayNum: d, dateStr });
  }

  // Pad to complete the last row
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// For a given booking, determine which days in a month it covers
// Returns: { startDay, endDay, isStart, isEnd }
// ---------------------------------------------------------------------------
function bookingDaysInMonth(booking, year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const checkIn = ymd(booking.checkInDate);
  const checkOut = ymd(booking.checkOutDate);

  if (checkOut < monthStart || checkIn > monthEnd) return null;

  const clampedStart = checkIn < monthStart ? monthStart : checkIn;
  const clampedEnd = checkOut > monthEnd ? monthEnd : checkOut;

  const startDay = parseInt(clampedStart.split('-')[2], 10);
  const endDay = parseInt(clampedEnd.split('-')[2], 10);
  const isStart = checkIn >= monthStart && checkIn <= monthEnd;
  const isEnd = checkOut >= monthStart && checkOut <= monthEnd;

  return { startDay, endDay, isStart, isEnd };
}

// ---------------------------------------------------------------------------
// BookingDetailModal
// ---------------------------------------------------------------------------
function BookingDetailModal({ booking, onClose }) {
  const status = bookingStatus(booking);
  const styles = STATUS_STYLES[status] || STATUS_STYLES.upcoming;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900">
            {booking.guestName || 'Guest'}
          </h3>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles.badge}`}>
            {styles.label}
          </span>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="text-sm text-gray-700">{booking.unit || 'Unknown unit'}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div className="text-sm text-gray-700">
              <span>{formatDateFull(ymd(booking.checkInDate))}</span>
              <span className="text-gray-400 mx-1">—</span>
              <span>{formatDateFull(ymd(booking.checkOutDate))}</span>
            </div>
          </div>
          {booking.checkedIn !== undefined && (
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-gray-700">
                {booking.checkedIn ? 'Checked in' : 'Not checked in yet'}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full bg-gray-100 text-gray-700 font-semibold rounded-lg px-4 py-3 text-sm active:bg-gray-200"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar Day Cell
// ---------------------------------------------------------------------------
function DayCell({ cell, bookingsInDay, onBookingTap, isToday, unitNames }) {
  if (!cell) {
    return <div className="min-h-[52px]" />;
  }

  return (
    <div
      className={`min-h-[52px] rounded-lg p-1 relative ${
        isToday ? 'bg-green-50 ring-1 ring-green-300' : ''
      }`}
    >
      <span
        className={`text-xs font-medium block text-center mb-0.5 ${
          isToday ? 'text-green-700 font-bold' : 'text-gray-500'
        }`}
      >
        {cell.dayNum}
      </span>
      <div className="flex flex-col gap-0.5">
        {bookingsInDay.map(({ booking, status }) => (
          <button
            key={booking.id}
            onClick={() => onBookingTap(booking)}
            className={`w-full h-3 rounded-sm ${getUnitBarColor(booking.unit, status, unitNames)} opacity-80 hover:opacity-100 active:opacity-100 transition-opacity`}
            title={`${booking.guestName || 'Guest'} · ${booking.unit}`}
          />
        ))}
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
  const unitNames = getUnitNames(settings);

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [unitFilter, setUnitFilter] = useState('All');

  const filteredBookings = useMemo(() => {
    if (unitFilter === 'All') return bookings;
    return bookings.filter((b) => b.unit === unitFilter);
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

  // Bookings that overlap with the current month (for the list below)
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
                  <div key={col} className="h-12 bg-gray-50 rounded-lg animate-pulse" />
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
        <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-x-4 gap-y-2">
          {unitNames.map((name, idx) => {
            const palette = UNIT_COLOR_PALETTE[idx % UNIT_COLOR_PALETTE.length];
            return (
              <div key={name} className="contents">
                <div className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded-sm ${palette.active}`} />
                  <span className="text-xs text-gray-500">{name} Active</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded-sm ${palette.upcoming}`} />
                  <span className="text-xs text-gray-500">{name} Upcoming</span>
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-gray-300" />
            <span className="text-xs text-gray-500">Completed</span>
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
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <p className="text-gray-400 text-sm">No bookings this month.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {monthBookings.map((booking) => {
              const status = bookingStatus(booking);
              const styles = STATUS_STYLES[status] || STATUS_STYLES.upcoming;
              return (
                <button
                  key={booking.id}
                  onClick={() => setSelectedBooking(booking)}
                  className="w-full bg-white rounded-xl shadow-sm p-4 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">
                          {booking.guestName || 'Guest'}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles.badge}`}>
                          {styles.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{booking.unit}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-500">
                        {ymd(booking.checkInDate)}
                      </p>
                      <p className="text-xs text-gray-400">
                        — {ymd(booking.checkOutDate)}
                      </p>
                    </div>
                  </div>
                  {/* Mini unit-colored bar */}
                  <div className={`mt-2 h-1.5 rounded-full ${getUnitBarColor(booking.unit, status, unitNames)}`} style={{ width: '100%', opacity: 0.5 }} />
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
        />
      )}
    </div>
  );
}
