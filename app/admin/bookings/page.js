'use client';

import { useState, useCallback } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '@/hooks/useFirestore';
import useAuth from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-green-100 text-green-700',
    completed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 min-h-[36px] transition-all ${
        copied
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300'
      } ${className}`}
    >
      {copied ? (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy link
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Booking Creation Form — calls API so server-side overlap check runs
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  guestName: '',
  guestEmail: '',
  unit: 'Unit A',
  checkInDate: '',
  checkOutDate: '',
};

function BookingForm({ onCreated, user }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.checkInDate || !form.checkOutDate) {
      setError('Check-in and check-out dates are required.');
      return;
    }
    if (form.checkOutDate <= form.checkInDate) {
      setError('Check-out must be after check-in.');
      return;
    }

    setSubmitting(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          unit: form.unit,
          guestName: form.guestName.trim(),
          checkInDate: form.checkInDate,
          checkOutDate: form.checkOutDate,
        }),
      });

      const json = await res.json();

      if (!json.success) {
        setError(json.error || 'Failed to create booking.');
        return;
      }

      const booking = json.data;

      // Send guest link email if email provided
      const guestEmail = form.guestEmail.trim();
      let emailSent = false;
      if (guestEmail) {
        try {
          const emailRes = await fetch('/api/email/guest-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guestEmail,
              guestName: form.guestName.trim(),
              guestLink: booking.guestLink,
              checkInDate: form.checkInDate,
              checkOutDate: form.checkOutDate,
              unit: form.unit,
            }),
          });
          const emailJson = await emailRes.json();
          emailSent = emailJson.success;
        } catch (emailErr) {
          console.error('Failed to send guest email:', emailErr);
        }
      }

      setForm(EMPTY_FORM);
      onCreated({ ...booking, guestEmail, emailSent });
    } catch (err) {
      setError('Failed to create booking. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder:text-gray-400';

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-4 space-y-4">
      <h2 className="font-semibold text-gray-900">New Booking</h2>

      {/* Guest Name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Guest Name <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          name="guestName"
          value={form.guestName}
          onChange={handleChange}
          placeholder="e.g. Maria Garcia"
          className={inputClass}
        />
      </div>

      {/* Guest Email */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Guest Email <span className="text-gray-400 font-normal">(optional — sends portal link automatically)</span>
        </label>
        <input
          type="email"
          name="guestEmail"
          value={form.guestEmail}
          onChange={handleChange}
          placeholder="e.g. guest@example.com"
          className={inputClass}
        />
      </div>

      {/* Unit */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
        <select
          name="unit"
          value={form.unit}
          onChange={handleChange}
          className={inputClass}
          required
        >
          <option value="Unit A">Unit A</option>
          <option value="Unit B">Unit B</option>
        </select>
      </div>

      {/* Dates row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Check-in</label>
          <input
            type="date"
            name="checkInDate"
            value={form.checkInDate}
            onChange={handleChange}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Check-out</label>
          <input
            type="date"
            name="checkOutDate"
            value={form.checkOutDate}
            onChange={handleChange}
            required
            min={form.checkInDate || undefined}
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg px-4 py-3 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[48px]"
      >
        {submitting ? 'Creating...' : 'Create Booking & Generate Link'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Success Banner
// ---------------------------------------------------------------------------

function SuccessBanner({ booking, onDismiss }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-semibold text-green-800">Booking created!</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-green-500 hover:text-green-700 p-1 min-h-[36px] min-w-[36px] flex items-center justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {booking.emailSent && booking.guestEmail && (
        <p className="text-sm text-green-700">
          Email sent to <span className="font-medium">{booking.guestEmail}</span>
        </p>
      )}
      <div>
        <p className="text-xs text-green-700 font-medium mb-1">Guest link</p>
        <div className="bg-white rounded-lg border border-green-200 px-3 py-2 flex items-center gap-2">
          <span className="flex-1 text-xs text-gray-600 font-mono break-all min-w-0">
            {booking.guestLink}
          </span>
          <CopyButton text={booking.guestLink} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking Card (list item) — with cancel action
// ---------------------------------------------------------------------------

function BookingCard({ booking, onCancel }) {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    setCancelling(true);
    await onCancel(booking.id);
    setCancelling(false);
    setConfirming(false);
  }

  const isActive = booking.status === 'active';

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">
            {booking.guestName || 'Guest (unnamed)'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{booking.unit}</p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <div className="flex items-center gap-1 text-xs text-gray-500">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>
          {formatDate(booking.checkInDate)} — {formatDate(booking.checkOutDate)}
        </span>
      </div>

      {booking.guestLink && (
        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
          <span className="flex-1 text-xs text-gray-500 font-mono truncate min-w-0">
            {booking.guestLink}
          </span>
          <CopyButton text={booking.guestLink} />
        </div>
      )}

      {/* Cancel action — only for active bookings */}
      {isActive && !confirming && (
        <button
          onClick={() => setConfirming(true)}
          className="text-xs text-red-500 hover:text-red-700 font-medium py-1 transition-colors"
        >
          Cancel booking
        </button>
      )}

      {isActive && confirming && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-red-800 font-medium">
            Cancel this booking? The guest link will stop working.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5 min-h-[32px] transition-colors disabled:opacity-60"
            >
              {cancelling ? 'Cancelling...' : 'Yes, cancel'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={cancelling}
              className="text-xs font-medium text-gray-600 hover:text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-1.5 min-h-[32px] transition-colors"
            >
              Keep booking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function BookingsPage() {
  const { user } = useAuth();
  const [newBooking, setNewBooking] = useState(null);
  const [cancelError, setCancelError] = useState('');

  const { data: allBookings, loading } = useCollection('bookings', [
    orderBy('checkInDate', 'desc'),
  ]);

  const bookings = allBookings.filter((b) => b.status !== 'cancelled');

  const handleCreated = useCallback((booking) => {
    setNewBooking(booking);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleCancel = useCallback(async (bookingId) => {
    setCancelError('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json();
      if (!json.success) {
        setCancelError(json.error || 'Failed to cancel booking.');
      }
    } catch {
      setCancelError('Failed to cancel booking. Please try again.');
    }
  }, [user]);

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Bookings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Create and manage guest bookings</p>
      </div>

      {/* Success banner */}
      {newBooking && (
        <SuccessBanner booking={newBooking} onDismiss={() => setNewBooking(null)} />
      )}

      {/* Cancel error */}
      {cancelError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm text-red-700">{cancelError}</p>
        </div>
      )}

      {/* Creation form */}
      <BookingForm onCreated={handleCreated} user={user} />

      {/* Existing bookings */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          All Bookings
        </h2>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-3" />
                <div className="h-8 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <p className="text-gray-400 text-sm">No bookings yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map((booking) => (
              <BookingCard key={booking.id} booking={booking} onCancel={handleCancel} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
