'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { orderBy, where } from 'firebase/firestore';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { auth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import { getUnitNames, getUnits } from '@/lib/units';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import StatusPill from '@/components/admin/StatusPill';
import WelcomeMarkSentModal from '@/components/admin/WelcomeMarkSentModal';
import WelcomeSendLaterModal from '@/components/admin/WelcomeSendLaterModal';
import RefineDrawer from '@/components/admin/RefineDrawer';

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

function getPillsForBooking(booking, today) {
  const pills = [];
  if (booking.status === 'cancelled') pills.push('cancelled');
  else if (booking.checkOutDate && booking.checkOutDate < today) pills.push('past');
  else if (booking.checkInDate && booking.checkOutDate &&
           booking.checkInDate <= today && today <= booking.checkOutDate) {
    pills.push('in_house');
  }

  switch (booking.welcomeStatus) {
    case 'ready':      pills.push('ready'); break;
    case 'pending':    pills.push('generating'); break;
    case 'snoozed':    pills.push('snoozed'); break;
    case 'sent':       pills.push('sent'); break;
    case 'skipped':    pills.push('skipped'); break;
    case 'error':      pills.push('error'); break;
    default: break;
  }
  return pills;
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

function CopyButton({ text, className = '', bookingCode }) {
  const { locale } = useLocale();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    // Track linkCopiedAt in guest_access_log (fire-and-forget)
    if (bookingCode) {
      auth.currentUser?.getIdToken().then((idToken) => {
        fetch('/api/guests/track-copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ bookingCode }),
        }).catch(() => {});
      }).catch(() => {});
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
// Guest Lifecycle Badge
// ---------------------------------------------------------------------------
const LIFECYCLE_STYLES = {
  created: { color: 'text-coqui-800/40', bg: '', label: 'admin_book_statusCreated' },
  link_copied: { color: 'text-caribe-600', bg: '', label: 'admin_book_statusLinkCopied' },
  link_opened: { color: 'text-atardecer-600', bg: '', label: 'admin_book_statusLinkOpened' },
  viewing: { color: 'text-coqui-600', bg: '', label: 'admin_book_statusViewing' },
  checked_in: { color: 'text-coqui-700', bg: '', label: 'admin_book_statusCheckedIn' },
  expired: { color: 'text-coqui-800/40', bg: '', label: 'admin_book_statusExpired' },
  revoked: { color: 'text-flamboyan-600', bg: '', label: 'admin_book_statusRevoked' },
};

function GuestLifecycleBadge({ status, accessLog, locale, members }) {
  const style = LIFECYCLE_STYLES[status] || LIFECYCLE_STYLES.created;
  const lastSeen = accessLog?.lastSeenAt;
  const memberCount = members?.length || 0;

  function relativeTime(iso) {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t(locale, 'admin_book_justNow');
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className={`inline-flex items-center gap-1 font-medium ${style.color}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${
          status === 'checked_in' || status === 'viewing' ? 'bg-coqui-500' :
          status === 'link_opened' ? 'bg-atardecer-500' :
          status === 'link_copied' ? 'bg-caribe-500' :
          status === 'revoked' ? 'bg-flamboyan-500' :
          'bg-gray-300'
        }`} />
        {t(locale, style.label)}
      </span>
      {lastSeen && (
        <span className="text-coqui-800/40">
          {t(locale, 'admin_book_lastSeen')} {relativeTime(lastSeen)}
        </span>
      )}
      {memberCount > 1 && (
        <span className="inline-flex items-center gap-1 text-coqui-800/50">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {memberCount} {t(locale, 'admin_book_members')}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome Message Panel
// ---------------------------------------------------------------------------

function WelcomeMessagePanel({ booking, user }) {
  const { locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [showMarkSent, setShowMarkSent] = useState(false);
  const [showSendLater, setShowSendLater] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);

  const { welcomeStatus, welcomeMessage } = booking;

  // Only show for non-sent statuses
  if (!welcomeStatus || welcomeStatus === 'sent') return null;

  async function handleCopyMessage() {
    if (!welcomeMessage) return;
    try {
      await navigator.clipboard.writeText(welcomeMessage);
    } catch {
      const el = document.createElement('textarea');
      el.value = welcomeMessage;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleMarkSent(finalText) {
    setMarking(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/bookings/${booking.id}/welcome`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action: 'mark-sent', text: finalText }),
      });
      if (!res.ok) throw new Error(`mark-sent failed: ${res.status}`);
      setShowMarkSent(false);
    } catch (err) {
      console.error('[WelcomeMessagePanel] markSent failed:', err);
      throw err;
    } finally {
      setMarking(false);
    }
  }

  async function handleSnooze(snoozedUntilIso) {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/bookings/${booking.id}/welcome`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action: 'snooze', snoozedUntil: snoozedUntilIso }),
      });
      if (!res.ok) throw new Error(`snooze failed: ${res.status}`);
      setShowSendLater(false);
    } catch (err) {
      console.error('[WelcomeMessagePanel] snooze failed:', err);
      throw err;
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const idToken = await user.getIdToken();
      await fetch(`/api/bookings/${booking.id}/welcome?force=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
    } catch (err) {
      console.error('[WelcomeMessagePanel] regenerate failed:', err);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSkip() {
    setSkipping(true);
    try {
      const idToken = await user.getIdToken();
      await fetch(`/api/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ welcomeStatus: 'skipped' }),
      });
    } catch (err) {
      console.error('[WelcomeMessagePanel] skip failed:', err);
    } finally {
      setSkipping(false);
    }
  }

  const isPending = welcomeStatus === 'pending';
  const isSkipped = welcomeStatus === 'skipped';

  return (
    <div className="border-t border-cafe-100 pt-3 mt-1 space-y-2.5">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-coqui-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-semibold text-coqui-800">
            {t(locale, 'admin_book_welcome_title')}
          </span>
        </div>
        {isSkipped && (
          <span className="text-xs text-coqui-800/40 italic">
            {t(locale, 'admin_book_welcome_skipped')}
          </span>
        )}
        {isPending && (
          <span className="text-xs text-atardecer-600 font-medium">
            {t(locale, 'admin_book_welcome_pending')}
          </span>
        )}
      </div>

      {/* Message preview, generating state, or error */}
      {welcomeStatus === 'error' ? (
        <div className="bg-flamboyan-50 border border-flamboyan-200 rounded-lg px-3 py-3">
          <p className="text-xs text-flamboyan-700 font-medium mb-1">
            ⚠ {t(locale, 'admin_book_welcome_error')}
          </p>
          {booking.welcomeError && (
            <p className="text-[11px] text-flamboyan-700/80">{booking.welcomeError}</p>
          )}
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="mt-2 px-3 py-1.5 text-xs bg-white border border-flamboyan-300 text-flamboyan-700 rounded-lg hover:bg-flamboyan-100 disabled:opacity-50"
          >
            {regenerating ? '…' : t(locale, 'admin_book_welcome_retry')}
          </button>
        </div>
      ) : isPending ? (
        <div className="bg-coqui-50 border border-coqui-100 rounded-lg px-3 py-3 flex items-center gap-2">
          <span className="inline-block w-3.5 h-3.5 border-2 border-coqui-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-xs text-coqui-700 italic">
            {t(locale, 'admin_book_welcome_generating')}
          </p>
        </div>
      ) : welcomeMessage ? (
        <div className="bg-coqui-50 border border-coqui-100 rounded-lg px-3 py-2.5">
          <p className="text-xs text-coqui-800 leading-relaxed whitespace-pre-wrap break-words">
            {welcomeMessage}
          </p>
        </div>
      ) : null}

      {/* Action buttons — only when there's a message to act on */}
      {!isPending && welcomeMessage && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Copy */}
          <button
            onClick={handleCopyMessage}
            className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 min-h-[36px] transition-all active:scale-[0.98] ${
              copied
                ? 'bg-coqui-100 text-coqui-700'
                : 'bg-cafe-100 text-cafe-700 active:bg-cafe-200'
            }`}
          >
            {copied ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {t(locale, 'admin_book_welcome_copied')}
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {t(locale, 'admin_book_welcome_copy')}
              </>
            )}
          </button>

          {/* Mark as Sent */}
          {!isSkipped && (
            <button
              onClick={() => setShowMarkSent(true)}
              disabled={marking}
              className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 min-h-[36px] bg-coqui-600 text-white active:bg-coqui-700 transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {marking ? (
                <span className="inline-block w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {t(locale, 'admin_book_welcome_markSent')}
            </button>
          )}

          {/* Send later */}
          {!isSkipped && (
            <button
              onClick={() => setShowSendLater(true)}
              className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 min-h-[36px] bg-white border border-cafe-200 text-cafe-800 active:bg-cafe-50 transition-all active:scale-[0.98]"
            >
              {t(locale, 'admin_book_welcome_sendLater')}
            </button>
          )}

          {/* Refine */}
          {booking.welcomeStatus === 'ready' && (
            <button
              onClick={() => setRefineOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors font-medium"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192z" />
              </svg>
              Refine
            </button>
          )}

          {/* Regenerate */}
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 min-h-[36px] bg-caribe-50 text-caribe-700 active:bg-caribe-100 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {regenerating ? (
              <span className="inline-block w-3 h-3 border border-caribe-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {t(locale, 'admin_book_welcome_regenerate')}
          </button>

          {/* Skip — only show if not already skipped */}
          {!isSkipped && (
            <button
              onClick={handleSkip}
              disabled={skipping}
              className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 min-h-[36px] text-coqui-800/50 active:text-coqui-800/70 transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {skipping ? (
                <span className="inline-block w-3 h-3 border border-cafe-400 border-t-transparent rounded-full animate-spin" />
              ) : null}
              {t(locale, 'admin_book_welcome_skip')}
            </button>
          )}
        </div>
      )}

      {/* Skipped state — show regenerate to undo */}
      {isSkipped && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 min-h-[36px] bg-caribe-50 text-caribe-700 active:bg-caribe-100 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {regenerating ? (
              <span className="inline-block w-3 h-3 border border-caribe-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {t(locale, 'admin_book_welcome_regenerate')}
          </button>
        </div>
      )}

      {showMarkSent && (
        <WelcomeMarkSentModal
          initialText={welcomeMessage || ''}
          locale={locale}
          onConfirm={handleMarkSent}
          onCancel={() => setShowMarkSent(false)}
        />
      )}

      {showSendLater && (
        <WelcomeSendLaterModal
          checkInDate={booking.checkInDate}
          locale={locale}
          onConfirm={handleSnooze}
          onCancel={() => setShowSendLater(false)}
        />
      )}

      <RefineDrawer
        isOpen={refineOpen}
        onClose={() => setRefineOpen(false)}
        draft={booking.welcomeMessage || ''}
        context={{
          type: 'welcome',
          guestName: booking.guestName,
          bookingCode: booking.code,
        }}
        onAccept={async (acceptedDraft) => {
          const { doc: firestoreDoc, updateDoc } = await import('firebase/firestore');
          const { db } = await import('@/lib/firebase');
          await updateDoc(firestoreDoc(db, 'bookings', booking.id), {
            welcomeMessage: acceptedDraft,
            welcomeStatus: 'ready',
          });
        }}
      />
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
  const { data: accessLog } = useDocument('guest_access_log', booking.code || null);
  const { data: members } = useCollection('booking_members', [
    where('bookingCode', '==', booking.code || '__none__'),
  ]);
  const unitColor = getUnitColor(booking.unit);
  const isActive = booking.status === 'active';
  const primaryMember = members.find((m) => m.role === 'primary');
  const hasPortalVisit = !!primaryMember?.firstPortalVisitAt;

  // Derive guest lifecycle status from access log
  const guestStatus = accessLog
    ? accessLog.revokedAt ? 'revoked'
    : accessLog.expiredAt ? 'expired'
    : checkin?.checkedIn ? 'checked_in'
    : accessLog.portalViewedAt || hasPortalVisit ? 'viewing'
    : accessLog.linkOpenedAt ? 'link_opened'
    : accessLog.linkCopiedAt ? 'link_copied'
    : 'created'
    : checkin?.checkedIn ? 'checked_in' : 'created';

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

        {/* Guest funnel status */}
        {/* Guest lifecycle status */}
        {isActive && (
          <GuestLifecycleBadge status={guestStatus} accessLog={accessLog} locale={locale} members={members} />
        )}

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
            <CopyButton text={booking.guestLink} bookingCode={booking.code} />
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

        {/* Welcome message panel — shown when status is pending, ready, or skipped */}
        {isActive && booking.welcomeStatus !== 'sent' && (
          <WelcomeMessagePanel booking={booking} user={user} />
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
  const [tab, setTab] = useState(null);

  const { data: allBookings, loading } = useCollection('bookings', [
    orderBy('checkInDate', 'desc'),
  ]);

  const today = todayStr();

  // Derive 4 buckets. A booking with welcomeStatus==='ready' appears in BOTH
  // Drafts and its time-based bucket (Drafts is a view, not a partition).
  const tabBuckets = useMemo(() => {
    const buckets = { drafts: [], inhouse: [], upcoming: [], past: [] };
    for (const b of allBookings) {
      if (b.status === 'cancelled' || (b.checkOutDate && b.checkOutDate < today)) {
        buckets.past.push(b);
        continue;
      }
      if (b.welcomeStatus === 'ready' && b.status === 'active') {
        buckets.drafts.push(b);
      }
      if (b.status === 'active') {
        if (b.checkInDate && b.checkOutDate && b.checkInDate <= today && today <= b.checkOutDate) {
          buckets.inhouse.push(b);
        } else if (b.checkInDate && b.checkInDate > today) {
          buckets.upcoming.push(b);
        }
      }
    }
    return buckets;
  }, [allBookings, today]);

  const tabs = [
    { key: 'drafts',   label: t(locale, 'admin_book_tab_drafts'),   count: tabBuckets.drafts.length,   accent: true },
    { key: 'inhouse',  label: t(locale, 'admin_book_tab_inhouse'),  count: tabBuckets.inhouse.length,  accent: false },
    { key: 'upcoming', label: t(locale, 'admin_book_tab_upcoming'), count: tabBuckets.upcoming.length, accent: false },
    { key: 'past',     label: t(locale, 'admin_book_tab_past'),     count: tabBuckets.past.length,     accent: false },
  ];

  const displayList = tabBuckets[tab] || [];

  // Default tab: Drafts if any, else In-house, else Upcoming.
  useEffect(() => {
    if (tab !== null) return;
    if (loading) return;
    if (tabBuckets.drafts.length > 0) setTab('drafts');
    else if (tabBuckets.inhouse.length > 0) setTab('inhouse');
    else setTab('upcoming');
  }, [loading, tab, tabBuckets]);

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
    tab === 'drafts'
      ? t(locale, 'admin_book_emptyDrafts')
      : tab === 'inhouse'
      ? t(locale, 'admin_book_emptyInhouse')
      : tab === 'upcoming'
      ? t(locale, 'admin_book_emptyUpcoming')
      : t(locale, 'admin_book_emptyPast');

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
      <div className="flex gap-1 bg-cafe-100 rounded-lg p-1 overflow-x-auto">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`flex-1 text-sm font-medium py-2 px-2 rounded-md transition-colors whitespace-nowrap ${
              tab === tabItem.key ? 'bg-white text-coqui-900 shadow-sm' : 'text-coqui-800/50'
            }`}
          >
            {tabItem.label}
            {tabItem.count > 0 && (
              <span className={`inline-block ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                tabItem.accent ? 'bg-amber-100 text-amber-800' : 'bg-cafe-200 text-coqui-800/70'
              }`}>{tabItem.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Booking list */}
      {tab === null ? (
        <div className="py-10 text-center text-sm text-coqui-800/40">Loading…</div>
      ) : (
        <>
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
              {(tab === 'drafts' || tab === 'upcoming') && (
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
              {displayList.map((booking, idx) => {
                const pills = getPillsForBooking(booking, today);
                const shouldAutoOpen = tab === 'drafts' && idx === 0;
                return (
                  <details
                    key={booking.id}
                    open={shouldAutoOpen}
                    className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden group"
                  >
                    <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-coqui-900 truncate">{booking.guestName || '—'}</div>
                        <div className="text-xs text-coqui-800/60 mt-0.5 truncate">
                          📅 {booking.checkInDate} → {booking.checkOutDate} · {booking.unit}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {pills.map((s) => (
                          <StatusPill key={s} status={s} locale={locale} />
                        ))}
                        <span className="text-coqui-800/40 text-xs ml-1 transition-transform group-open:rotate-90">▸</span>
                      </div>
                    </summary>
                    <div className="border-t border-cafe-100">
                      <BookingCard booking={booking} onCancel={handleCancel} user={user} settings={settings} />
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </>
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
