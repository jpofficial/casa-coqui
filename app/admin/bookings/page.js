'use client';

import { useState, useCallback, useMemo } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import useAuth from '@/hooks/useAuth';
import { getUnitNames, getUnits } from '@/lib/units';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr, locale) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const UNIT_COLORS = {
  'Unit A': { accent: 'bg-caribe-500', text: 'text-caribe-600' },
  'Unit B': { accent: 'bg-atardecer-400', text: 'text-atardecer-600' },
};

function getUnitColor(unit) {
  return UNIT_COLORS[unit] || { accent: 'bg-cafe-300', text: 'text-cafe-700' };
}

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-coqui-100 text-coqui-700',
    completed: 'bg-cafe-200 text-cafe-800',
    cancelled: 'bg-flamboyan-100 text-flamboyan-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[status] || 'bg-cafe-200 text-cafe-700'}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// VehicleInfo
// ---------------------------------------------------------------------------

function VehicleInfo({ hasVehicle, vehicle }) {
  const { locale } = useLocale();

  if (!hasVehicle || hasVehicle === 'unsure') return null;
  if (hasVehicle === 'no') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-coqui-800/50">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        {t(locale, 'admin_book_noCar')}
      </div>
    );
  }
  if (hasVehicle === 'yes' && vehicle) {
    const parts = [vehicle.make, vehicle.model, vehicle.color ? `(${vehicle.color})` : null, vehicle.plate ? `\u2014 ${vehicle.plate}` : null].filter(Boolean);
    if (!parts.length) return null;
    return (
      <div className="flex items-center gap-1.5 text-xs text-coqui-800/60">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0 text-coqui-800/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
        </svg>
        {parts.join(' ')}
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text, className = '' }) {
  const { locale } = useLocale();
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
          ? 'bg-coqui-100 text-coqui-700'
          : 'bg-cafe-100 text-cafe-700 active:bg-cafe-200'
      } ${className}`}
    >
      {copied ? (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {t(locale, 'admin_book_copied')}
        </>
      ) : (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {t(locale, 'admin_book_copyLink')}
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Booking Creation Form
// ---------------------------------------------------------------------------

function BookingForm({ onCreated, onClose, user, settings }) {
  const { locale } = useLocale();
  const units = getUnits(settings);
  const unitNames = units.map((u) => u.name);
  const [form, setForm] = useState({
    guestName: '',
    guestEmail: '',
    unit: unitNames[0] || '',
    checkInDate: '',
    checkOutDate: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Derive the stable unitId from the currently selected unit name
  const selectedUnitId = units.find((u) => u.name === form.unit)?.id || null;

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.checkInDate || !form.checkOutDate) {
      setError(t(locale, 'admin_book_errDatesRequired'));
      return;
    }
    if (form.checkOutDate <= form.checkInDate) {
      setError(t(locale, 'admin_book_errCheckOutAfter'));
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
          unitId: selectedUnitId,
          guestName: form.guestName.trim(),
          guestEmail: form.guestEmail.trim(),
          checkInDate: form.checkInDate,
          checkOutDate: form.checkOutDate,
        }),
      });

      const json = await res.json();

      if (!json.success) {
        setError(json.error || t(locale, 'admin_book_errCreateFailed'));
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
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
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

      setForm({ guestName: '', guestEmail: '', unit: unitNames[0] || '', checkInDate: '', checkOutDate: '' });
      onCreated({ ...booking, guestEmail, emailSent });
      onClose();
    } catch (err) {
      setError(t(locale, 'admin_book_errCreateFailed'));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-cafe-200 px-3 py-2.5 text-sm text-coqui-900 focus:outline-none focus:ring-2 focus:ring-coqui-500 focus:border-transparent placeholder:text-cafe-400';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-cafe-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-coqui-900">{t(locale, 'admin_book_formTitle')}</h2>
          <button onClick={onClose} className="text-cafe-400 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_guestName')}</label>
            <input type="text" name="guestName" value={form.guestName} onChange={handleChange} placeholder={t(locale, 'admin_book_guestNamePlaceholder')} className={inputClass} />
          </div>

          <div>
            <label className="block text-sm font-medium text-coqui-800 mb-1">
              {t(locale, 'admin_book_guestEmail')} <span className="text-cafe-400 font-normal text-xs">{t(locale, 'admin_book_guestEmailHint')}</span>
            </label>
            <input type="email" name="guestEmail" value={form.guestEmail} onChange={handleChange} placeholder={t(locale, 'admin_book_guestEmailPlaceholder')} className={inputClass} />
          </div>

          <div>
            <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_unit')}</label>
            <select name="unit" value={form.unit} onChange={handleChange} required className={inputClass}>
              {unitNames.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_checkIn')}</label>
              <input type="date" name="checkInDate" value={form.checkInDate} onChange={handleChange} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_checkOut')}</label>
              <input type="date" name="checkOutDate" value={form.checkOutDate} onChange={handleChange} required min={form.checkInDate || undefined} className={inputClass} />
            </div>
          </div>

          {error && <p className="text-sm text-flamboyan-600 bg-flamboyan-50 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-coqui-600 active:bg-coqui-700 text-white font-semibold rounded-lg px-4 py-3 text-sm transition-colors disabled:opacity-60 min-h-[48px]"
          >
            {submitting ? t(locale, 'admin_book_creating') : t(locale, 'admin_book_createBooking')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Booking Form
// ---------------------------------------------------------------------------

function EditBookingForm({ booking, onClose, user, settings }) {
  const { locale } = useLocale();
  const units = getUnits(settings);
  const unitNames = units.map((u) => u.name);
  const [form, setForm] = useState({
    guestName: booking.guestName || '',
    guestEmail: booking.guestEmail || '',
    unit: booking.unit || unitNames[0] || '',
    checkInDate: booking.checkInDate || '',
    checkOutDate: booking.checkOutDate || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedUnitId = units.find((u) => u.name === form.unit)?.id || null;

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.checkInDate || !form.checkOutDate) {
      setError(t(locale, 'admin_book_errDatesRequired'));
      return;
    }
    if (form.checkOutDate <= form.checkInDate) {
      setError(t(locale, 'admin_book_errCheckOutAfter'));
      return;
    }

    setSubmitting(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          unit: form.unit,
          unitId: selectedUnitId,
          guestName: form.guestName.trim(),
          guestEmail: form.guestEmail.trim(),
          checkInDate: form.checkInDate,
          checkOutDate: form.checkOutDate,
        }),
      });

      const json = await res.json();

      if (!json.success) {
        setError(json.error || 'Failed to update booking.');
        return;
      }

      onClose();
    } catch (err) {
      setError('Failed to update booking.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-cafe-200 px-3 py-2.5 text-sm text-coqui-900 focus:outline-none focus:ring-2 focus:ring-coqui-500 focus:border-transparent placeholder:text-cafe-400';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-cafe-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-coqui-900">{t(locale, 'admin_book_editTitle')}</h2>
          <button onClick={onClose} className="text-cafe-400 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_guestName')}</label>
            <input type="text" name="guestName" value={form.guestName} onChange={handleChange} placeholder={t(locale, 'admin_book_guestNamePlaceholder')} className={inputClass} />
          </div>

          <div>
            <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_guestEmail')}</label>
            <input type="email" name="guestEmail" value={form.guestEmail} onChange={handleChange} placeholder={t(locale, 'admin_book_guestEmailPlaceholder')} className={inputClass} />
          </div>

          <div>
            <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_unit')}</label>
            <select name="unit" value={form.unit} onChange={handleChange} required className={inputClass}>
              {unitNames.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_checkIn')}</label>
              <input type="date" name="checkInDate" value={form.checkInDate} onChange={handleChange} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-coqui-800 mb-1">{t(locale, 'admin_book_checkOut')}</label>
              <input type="date" name="checkOutDate" value={form.checkOutDate} onChange={handleChange} required min={form.checkInDate || undefined} className={inputClass} />
            </div>
          </div>

          {error && <p className="text-sm text-flamboyan-600 bg-flamboyan-50 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-coqui-600 active:bg-coqui-700 text-white font-semibold rounded-lg px-4 py-3 text-sm transition-colors disabled:opacity-60 min-h-[48px]"
          >
            {submitting ? t(locale, 'saving') : t(locale, 'admin_book_saveChanges')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Success Banner
// ---------------------------------------------------------------------------

function SuccessBanner({ booking, onDismiss }) {
  const { locale } = useLocale();

  return (
    <div className="bg-coqui-50 border border-coqui-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-coqui-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-semibold text-coqui-800">{t(locale, 'admin_book_successTitle')}</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-coqui-400 p-1 min-h-[36px] min-w-[36px] flex items-center justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {booking.emailSent && booking.guestEmail && (
        <p className="text-sm text-coqui-700">
          {t(locale, 'admin_book_emailSent')} <span className="font-medium">{booking.guestEmail}</span>
        </p>
      )}
      <div>
        <p className="text-xs text-coqui-700 font-medium mb-1">{t(locale, 'admin_book_guestLink')}</p>
        <div className="bg-white rounded-lg border border-coqui-200 px-3 py-2 flex items-center gap-2">
          <span className="flex-1 text-xs text-coqui-800/60 font-mono break-all min-w-0">
            {booking.guestLink}
          </span>
          <CopyButton text={booking.guestLink} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking Card
// ---------------------------------------------------------------------------

function BookingCard({ booking, onCancel, user, settings }) {
  const { locale } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const { data: checkin } = useDocument('checkins', booking.code || null);
  const unitColor = getUnitColor(booking.unit);
  const isActive = booking.status === 'active';

  async function handleCancel() {
    setCancelling(true);
    await onCancel(booking.id);
    setCancelling(false);
    setConfirming(false);
  }

  return (
    <div className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden">
      <div className={`h-1 ${unitColor.accent}`} />
      <div className="p-4 space-y-2.5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-coqui-900 text-sm truncate">
              {booking.guestName || t(locale, 'admin_book_guestUnnamed')}
            </p>
            <p className={`text-xs font-medium mt-0.5 ${unitColor.text}`}>{booking.unit}</p>
          </div>
          <StatusBadge status={booking.status} />
        </div>

        {/* Dates */}
        <div className="flex items-center gap-1.5 text-xs text-coqui-800/60">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>{formatDate(booking.checkInDate, locale)} — {formatDate(booking.checkOutDate, locale)}</span>
        </div>

        {/* Vehicle */}
        {checkin && (checkin.hasVehicle === 'yes' || checkin.hasVehicle === 'no') && (
          <VehicleInfo hasVehicle={checkin.hasVehicle} vehicle={checkin.vehicle} />
        )}

        {/* Guest link */}
        {booking.guestLink && (
          <div className="flex items-center gap-2 bg-cafe-50 rounded-lg px-3 py-2">
            <span className="flex-1 text-xs text-coqui-800/50 font-mono truncate min-w-0">
              {booking.guestLink}
            </span>
            <CopyButton text={booking.guestLink} />
          </div>
        )}

        {/* Edit + Cancel actions */}
        {isActive && !confirming && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-caribe-600 font-medium py-1 transition-colors"
            >
              {t(locale, 'admin_book_editBooking')}
            </button>
            <button
              onClick={() => setConfirming(true)}
              className="text-xs text-flamboyan-500 font-medium py-1 transition-colors"
            >
              {t(locale, 'admin_book_cancelBooking')}
            </button>
          </div>
        )}

        {isActive && confirming && (
          <div className="bg-flamboyan-50 border border-flamboyan-200 rounded-lg p-3 space-y-2">
            <p className="text-xs text-flamboyan-800 font-medium">
              {t(locale, 'admin_book_cancelBooking')}? {t(locale, 'admin_book_cancelConfirm')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="text-xs font-semibold bg-flamboyan-600 text-white rounded-lg px-3 py-1.5 min-h-[32px] transition-colors disabled:opacity-60"
              >
                {cancelling ? t(locale, 'admin_book_cancelling') : t(locale, 'admin_book_yesCancel')}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={cancelling}
                className="text-xs font-medium text-coqui-800/60 bg-white border border-cafe-200 rounded-lg px-3 py-1.5 min-h-[32px] transition-colors"
              >
                {t(locale, 'admin_book_keepBooking')}
              </button>
            </div>
          </div>
        )}

        {/* Edit modal */}
        {editing && (
          <EditBookingForm
            booking={booking}
            onClose={() => setEditing(false)}
            user={user}
            settings={settings}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function BookingsPage() {
  const { locale } = useLocale();
  const { user } = useAuth();
  const { data: settings } = useDocument('settings', 'property');
  const [newBooking, setNewBooking] = useState(null);
  const [cancelError, setCancelError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState('active');

  const { data: allBookings, loading } = useCollection('bookings', [
    orderBy('checkInDate', 'desc'),
  ]);

  const today = todayStr();

  const activeBookings = useMemo(
    () => allBookings.filter((b) => b.status === 'active' && b.checkOutDate >= today),
    [allBookings, today]
  );
  const upcomingBookings = useMemo(
    () => allBookings.filter((b) => b.status === 'active' && b.checkInDate > today),
    [allBookings, today]
  );
  const pastBookings = useMemo(
    () => allBookings.filter((b) => b.status === 'completed' || (b.status === 'active' && b.checkOutDate < today)),
    [allBookings, today]
  );
  const cancelledBookings = useMemo(
    () => allBookings.filter((b) => b.status === 'cancelled'),
    [allBookings]
  );

  const tabs = [
    { key: 'active', label: t(locale, 'admin_book_tabActive'), count: activeBookings.length },
    { key: 'past', label: t(locale, 'admin_book_tabPast'), count: pastBookings.length },
    { key: 'cancelled', label: t(locale, 'admin_book_tabCancelled'), count: cancelledBookings.length },
  ];

  const displayList = tab === 'active' ? activeBookings : tab === 'past' ? pastBookings : cancelledBookings;

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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const json = await res.json();
      if (!json.success) {
        setCancelError(json.error || t(locale, 'admin_book_errCancelFailed'));
      }
    } catch {
      setCancelError(t(locale, 'admin_book_errCancelFailed'));
    }
  }, [user, locale]);

  const emptyMessage =
    tab === 'active'
      ? t(locale, 'admin_book_emptyActive')
      : tab === 'past'
      ? t(locale, 'admin_book_emptyPast')
      : t(locale, 'admin_book_emptyCancelled');

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-coqui-900">{t(locale, 'admin_book_title')}</h1>
          <p className="text-sm text-coqui-800/60 mt-0.5">
            {new Date().toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-coqui-600 text-white text-sm font-medium px-4 py-2 rounded-lg active:bg-coqui-700 min-h-[44px]"
        >
          {t(locale, 'admin_book_newBooking')}
        </button>
      </div>

      {/* Success banner */}
      {newBooking && (
        <SuccessBanner booking={newBooking} onDismiss={() => setNewBooking(null)} />
      )}

      {/* Cancel error */}
      {cancelError && (
        <div className="bg-flamboyan-50 border border-flamboyan-200 rounded-xl p-3">
          <p className="text-sm text-flamboyan-700">{cancelError}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-cafe-100 rounded-lg p-1">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
              tab === tabItem.key ? 'bg-white text-coqui-900 shadow-sm' : 'text-coqui-800/50'
            }`}
          >
            {tabItem.label} ({tabItem.count})
          </button>
        ))}
      </div>

      {/* Booking list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden">
              <div className="h-1 bg-cafe-200" />
              <div className="p-4 animate-pulse space-y-3">
                <div className="h-4 bg-cafe-100 rounded w-1/3" />
                <div className="h-3 bg-cafe-100 rounded w-1/2" />
                <div className="h-8 bg-cafe-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : displayList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-brand border border-cafe-100 p-8 text-center">
          <p className="text-coqui-800/50 text-sm">{emptyMessage}</p>
          {tab === 'active' && (
            <button
              onClick={() => setShowCreate(true)}
              className="text-coqui-600 text-sm font-medium mt-2 inline-block"
            >
              {t(locale, 'admin_book_createOne')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map((booking) => (
            <BookingCard key={booking.id} booking={booking} onCancel={handleCancel} user={user} settings={settings} />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <BookingForm
          onCreated={handleCreated}
          onClose={() => setShowCreate(false)}
          user={user}
          settings={settings}
        />
      )}
    </div>
  );
}
