'use client';

import { useState, useMemo, useCallback } from 'react';
import { orderBy } from 'firebase/firestore';
import Link from 'next/link';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { getUnitNames } from '@/lib/units';
import useAuth from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';
import {
  ymd,
  dateToYMD,
  formatMonthYear,
  formatDateFull,
  formatDateShort,
  getNightCount,
  firstName,
  bookingStatus,
  buildCalendarGrid,
  bookingDaysInMonth,
  getUnitPalette,
  UNIT_PALETTES,
  CLEANING_STATUS_COLORS,
  CLEANING_STATUS_LABELS,
  getDayContext,
  TODAY,
} from '@/lib/calendar-helpers';

// ---------------------------------------------------------------------------
// Unified Operational Calendar
//
// Shows booking spans + cleaning jobs + conflict indicators in one view.
// Replaces the separate occupancy calendar and admin cleaning calendar.
// ---------------------------------------------------------------------------

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

function detectConflicts(bookings, cleaningJobs, dateStr, unitNames) {
  const conflicts = [];
  const dateBookings = bookings.filter((b) => ymd(b.checkOutDate) === dateStr && b.status !== 'cancelled');

  for (const booking of dateBookings) {
    const hasJob = cleaningJobs.some(
      (j) =>
        j.bookingId === booking.id &&
        !['cancelled', 'deleted', 'archived'].includes(j.status)
    );
    if (!hasJob) {
      // Also check by unit + date match (jobs without bookingId)
      const hasUnitDateJob = cleaningJobs.some(
        (j) =>
          j.unit === booking.unit &&
          j.scheduledDate === dateStr &&
          !['cancelled', 'deleted', 'archived'].includes(j.status)
      );
      if (!hasUnitDateJob) {
        conflicts.push({
          type: 'missing_cleaning',
          message: `No cleaning job for ${booking.unit} checkout`,
          unit: booking.unit,
        });
      }
    }
  }

  // Date mismatch: cleaning job scheduledDate != linked booking checkOutDate
  for (const job of cleaningJobs) {
    if (job.scheduledDate !== dateStr) continue;
    if (['cancelled', 'deleted', 'archived'].includes(job.status)) continue;
    if (!job.bookingId) continue;

    const linkedBooking = bookings.find((b) => b.id === job.bookingId);
    if (linkedBooking && ymd(linkedBooking.checkOutDate) !== job.scheduledDate && !job.manualOverride) {
      conflicts.push({
        type: 'date_mismatch',
        message: `Cleaning scheduled ${formatDateShort(job.scheduledDate)} but checkout is ${formatDateShort(linkedBooking.checkOutDate)}`,
        unit: job.unit,
      });
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Calendar Day Cell
// ---------------------------------------------------------------------------

function CalendarDayCell({ cell, dayData, isToday, isSelected, onTap, unitNames }) {
  if (!cell) {
    return <div className="min-h-[72px]" />;
  }

  const { bookings = [], cleaningJobs = [], conflicts = [] } = dayData || {};
  const hasConflict = conflicts.length > 0;

  return (
    <button
      onClick={() => onTap(cell.dateStr)}
      className={`min-h-[72px] rounded-lg p-1 relative w-full text-left transition-colors ${
        isToday ? 'bg-green-50' : ''
      } ${isSelected ? 'ring-2 ring-green-500' : ''} ${hasConflict ? 'bg-red-50/40' : ''}`}
    >
      {/* Day number */}
      <div className="flex justify-center mb-0.5">
        <span
          className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
            isToday ? 'bg-green-600 text-white font-bold' : 'text-gray-500'
          }`}
        >
          {cell.dayNum}
        </span>
      </div>

      {/* Unit occupancy bars */}
      <div className="flex flex-col gap-px">
        {unitNames.map((unitName, unitIdx) => {
          const unitBookings = bookings.filter((b) => b.booking.unit === unitName);
          if (unitBookings.length === 0) return <div key={unitIdx} className="h-[3px]" />;

          const { booking, status, isCheckIn, isCheckOut } = unitBookings[0];
          const palette = UNIT_PALETTES[unitIdx % UNIT_PALETTES.length];
          const barColor = palette.bar[status] || palette.bar.active;

          let rounded = '';
          if (isCheckIn && isCheckOut) rounded = 'rounded-sm';
          else if (isCheckIn) rounded = 'rounded-l-sm';
          else if (isCheckOut) rounded = 'rounded-r-sm';

          return (
            <div key={unitIdx} className={`h-[3px] ${barColor} ${rounded}`} />
          );
        })}
      </div>

      {/* Bottom row: CI/CO markers + cleaning dots */}
      <div className="flex items-center justify-center gap-0.5 mt-0.5">
        {bookings.some((b) => b.isCheckIn) && (
          <span className="text-[7px] font-bold text-blue-500">CI</span>
        )}
        {bookings.some((b) => b.isCheckOut) && (
          <span className="text-[7px] font-bold text-red-500">CO</span>
        )}
        {cleaningJobs
          .filter((j) => !['cancelled', 'deleted', 'archived'].includes(j.status))
          .map((job) => (
            <span
              key={job.id}
              className={`w-2 h-2 rounded-full ${CLEANING_STATUS_COLORS[job.status] || 'bg-gray-400'} ${
                job.manualOverride ? 'ring-1 ring-blue-400' : ''
              }`}
            />
          ))}
        {bookings.some((b) => b.booking.source === 'airbnb') && (
          <span className="text-[7px] font-bold text-pink-500">A</span>
        )}
      </div>

      {/* Conflict indicator */}
      {hasConflict && (
        <span className="absolute top-0.5 right-0.5 text-[8px] text-red-500">⚠</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Day Detail Sheet (bottom sheet)
// ---------------------------------------------------------------------------

function DayDetailSheet({ dateStr, dayData, unitNames, onClose, onReassign }) {
  const { bookings = [], cleaningJobs = [], conflicts = [] } = dayData || {};

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl w-full max-w-lg max-h-[75vh] overflow-y-auto shadow-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="px-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">{formatDateFull(dateStr)}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-4">
          {/* Conflict alerts */}
          {conflicts.length > 0 && (
            <div className="space-y-2">
              {conflicts.map((c, i) => (
                <div key={i} className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
                  <span>⚠</span>
                  <span>{c.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Bookings section */}
          {bookings.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Reservations</h4>
              <div className="space-y-2">
                {bookings.map(({ booking, status, isCheckIn, isCheckOut }) => {
                  const palette = getUnitPalette(booking.unit, unitNames);
                  const ci = ymd(booking.checkInDate);
                  const co = ymd(booking.checkOutDate);
                  const nights = getNightCount(ci, co);
                  const context = getDayContext(booking, dateStr);

                  return (
                    <div key={booking.id} className={`border-l-[3px] ${palette.accent[status]} rounded-r-lg bg-gray-50 p-3`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-900">{booking.guestName || 'Guest'}</span>
                        <div className="flex items-center gap-1.5">
                          {booking.source === 'airbnb' && (
                            <span className="text-[10px] font-semibold bg-pink-100 text-pink-600 px-1.5 py-0.5 rounded">Airbnb</span>
                          )}
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            status === 'active' ? 'bg-green-100 text-green-700' :
                            status === 'upcoming' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {status === 'active' ? 'Active' : status === 'upcoming' ? 'Upcoming' : 'Past'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={`font-medium ${palette.text}`}>{booking.unit}</span>
                        <span>·</span>
                        <span>{formatDateShort(ci)} → {formatDateShort(co)}</span>
                        <span>·</span>
                        <span>{nights} night{nights !== 1 ? 's' : ''}</span>
                      </div>
                      {context && (
                        <div className={`mt-1 text-xs font-semibold ${
                          isCheckIn ? 'text-blue-600' : isCheckOut ? 'text-red-600' : 'text-gray-500'
                        }`}>
                          {context}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cleaning jobs section */}
          {cleaningJobs.filter((j) => !['cancelled', 'deleted', 'archived'].includes(j.status)).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Cleaning Jobs</h4>
              <div className="space-y-2">
                {cleaningJobs
                  .filter((j) => !['cancelled', 'deleted', 'archived'].includes(j.status))
                  .map((job) => {
                    const palette = getUnitPalette(job.unit, unitNames);
                    return (
                      <div key={job.id} className={`border-l-[3px] ${palette.accent.active} rounded-r-lg bg-gray-50 p-3`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${CLEANING_STATUS_COLORS[job.status]}`} />
                            <span className="text-sm font-semibold text-gray-900">
                              {CLEANING_STATUS_LABELS[job.status] || job.status}
                            </span>
                          </div>
                          {job.manualOverride && (
                            <span className="text-[10px] font-semibold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">Pinned</span>
                          )}
                          {job.source === 'airbnb' && (
                            <span className="text-[10px] font-semibold bg-pink-100 text-pink-600 px-1.5 py-0.5 rounded">Airbnb</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className={`font-medium ${palette.text}`}>{job.unit}</span>
                          <span>·</span>
                          <span>Checkout {job.checkoutTime || '11:00 AM'}</span>
                          <span>·</span>
                          <span>{job.assigneeName || 'Unassigned'}</span>
                        </div>
                        {job.sameDayArrival && (
                          <div className="mt-1 text-xs font-semibold text-amber-600">Same-day arrival</div>
                        )}
                        {job.notes && (
                          <div className="mt-1 text-xs text-gray-400">{job.notes}</div>
                        )}
                        <div className="mt-2 flex gap-2">
                          <Link
                            href="/admin/cleaning"
                            className="text-xs font-medium text-green-700 hover:text-green-800"
                          >
                            View Forum →
                          </Link>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {bookings.length === 0 && cleaningJobs.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No activity on this date</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar Legend
// ---------------------------------------------------------------------------

function CalendarLegend({ unitNames }) {
  return (
    <div className="border-t border-gray-100 pt-3 px-1 flex flex-wrap gap-3 text-[10px] text-gray-500">
      {unitNames.map((name, idx) => (
        <div key={idx} className="flex items-center gap-1">
          <span className={`w-4 h-[3px] rounded-sm ${UNIT_PALETTES[idx % UNIT_PALETTES.length].bar.active}`} />
          <span>{name}</span>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <span className="text-[8px] font-bold text-blue-500">CI</span>
        <span>Check-in</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[8px] font-bold text-red-500">CO</span>
        <span>Checkout</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-gray-400" />
        <span>Scheduled</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span>Confirmed</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span>In Progress</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <span>Completed</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[8px] font-bold text-pink-500">A</span>
        <span>Airbnb</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[8px] text-red-500">⚠</span>
        <span>Conflict</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Calendar Page
// ---------------------------------------------------------------------------

export default function OperationalCalendar() {
  const { data: bookings, loading: bookingsLoading } = useCollection('bookings', [orderBy('checkInDate', 'asc')]);
  const { data: cleaningJobs, loading: jobsLoading } = useCollection('cleaning_jobs', [orderBy('scheduledDate', 'asc')]);
  const { data: settings } = useDocument('settings', 'property');
  const { isAdmin } = useAuth();
  const unitNames = getUnitNames(settings);

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [unitFilter, setUnitFilter] = useState('All');

  const loading = bookingsLoading || jobsLoading;

  // Filter bookings
  const filteredBookings = useMemo(() => {
    let filtered = bookings.filter((b) => b.status !== 'cancelled');
    if (unitFilter !== 'All') filtered = filtered.filter((b) => b.unit === unitFilter);
    return filtered;
  }, [bookings, unitFilter]);

  // Filter cleaning jobs
  const filteredJobs = useMemo(() => {
    let filtered = cleaningJobs;
    if (unitFilter !== 'All') filtered = filtered.filter((j) => j.unit === unitFilter);
    return filtered;
  }, [cleaningJobs, unitFilter]);

  const calendarGrid = useMemo(
    () => buildCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  // Build dayDataMap: dateStr -> { bookings, cleaningJobs, conflicts }
  const dayDataMap = useMemo(() => {
    const map = {};
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // Initialize all days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      map[dateStr] = { bookings: [], cleaningJobs: [], conflicts: [] };
    }

    // Add bookings to days they occupy
    for (const booking of filteredBookings) {
      const range = bookingDaysInMonth(booking, viewYear, viewMonth);
      if (!range) continue;
      const status = bookingStatus(booking);
      const ci = ymd(booking.checkInDate);
      const co = ymd(booking.checkOutDate);

      for (let d = range.startDay; d <= range.endDay; d++) {
        const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (map[dateStr]) {
          map[dateStr].bookings.push({
            booking,
            status,
            isCheckIn: dateStr === ci,
            isCheckOut: false, // Checkout day is not in occupancy range
          });
        }
      }

      // Add checkout day marker (if in this month)
      const coMonth = parseInt(co.split('-')[1], 10) - 1;
      const coYear = parseInt(co.split('-')[0], 10);
      if (coYear === viewYear && coMonth === viewMonth) {
        if (map[co]) {
          map[co].bookings.push({
            booking,
            status,
            isCheckIn: false,
            isCheckOut: true,
          });
        }
      }
    }

    // Add cleaning jobs to their scheduled dates
    for (const job of filteredJobs) {
      const dateStr = job.scheduledDate;
      if (map[dateStr]) {
        map[dateStr].cleaningJobs.push(job);
      }
    }

    // Detect conflicts for each day
    for (const dateStr of Object.keys(map)) {
      map[dateStr].conflicts = detectConflicts(
        bookings, // Use all bookings (not filtered) for conflict detection
        filteredJobs,
        dateStr,
        unitNames
      );
    }

    return map;
  }, [filteredBookings, filteredJobs, bookings, viewYear, viewMonth, unitNames]);

  // Count conflicts in month
  const monthConflictCount = useMemo(() => {
    return Object.values(dayDataMap).reduce((sum, d) => sum + d.conflicts.length, 0);
  }, [dayDataMap]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  function goToToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  }

  function handleDayTap(dateStr) {
    setSelectedDate(selectedDate === dateStr ? null : dateStr);
  }

  if (loading) {
    return (
      <div className="px-4 py-6 flex flex-col gap-4 animate-pulse">
        <div className="h-7 bg-gray-200 rounded w-1/3" />
        <div className="h-80 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
        <p className="text-sm text-gray-500">Reservations, checkouts, and cleaning jobs</p>
      </div>

      {/* Unit filter */}
      <div className="flex gap-2">
        {['All', ...unitNames].map((label) => (
          <button
            key={label}
            onClick={() => setUnitFilter(label)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              unitFilter === label
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Conflict banner */}
      {monthConflictCount > 0 && (
        <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2">
          <span>⚠</span>
          <span>{monthConflictCount} warning{monthConflictCount !== 1 ? 's' : ''} this month — tap day to see details</span>
        </div>
      )}

      {/* Calendar card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <button onClick={goToToday} className="text-sm font-bold text-gray-900 hover:text-green-700 transition">
            {formatMonthYear(viewYear, viewMonth)}
          </button>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="text-center py-2 text-[10px] font-semibold text-gray-400 uppercase">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="p-1">
          {calendarGrid.map((row, rowIdx) => (
            <div key={rowIdx} className="grid grid-cols-7">
              {row.map((cell, cellIdx) => (
                <CalendarDayCell
                  key={cellIdx}
                  cell={cell}
                  dayData={cell ? dayDataMap[cell.dateStr] : null}
                  isToday={cell?.dateStr === TODAY}
                  isSelected={cell?.dateStr === selectedDate}
                  onTap={handleDayTap}
                  unitNames={unitNames}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="px-3 pb-3">
          <CalendarLegend unitNames={unitNames} />
        </div>
      </div>

      {/* Day detail sheet */}
      {selectedDate && dayDataMap[selectedDate] && (
        <DayDetailSheet
          dateStr={selectedDate}
          dayData={dayDataMap[selectedDate]}
          unitNames={unitNames}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
