'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { where } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth as firebaseAuth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// ─── Field component ───────────────────────────────────────────────────────────
function Field({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400
        focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition
        disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
      {...props}
    />
  );
}

function Textarea({ className = '', ...props }) {
  return (
    <textarea
      className={`w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400
        focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition resize-none
        disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
      rows={3}
      {...props}
    />
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function CheckInPage({ params }) {
  const code = params.code;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { locale } = useLocale();

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    arrivalTime: '',
    guestCount: '1',
    specialRequests: '',
  });
  const [prefilled, setPrefilled] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Fetch booking to pre-populate
  const { data: bookings } = useCollection('bookings', [
    where('code', '==', code),
  ]);
  const booking = bookings?.[0] ?? null;

  // Already checked in → send straight to portal
  const { data: existingCheckin } = useDocument('checkins', code);

  useEffect(() => {
    if (existingCheckin?.checkedIn && user) {
      router.replace(`/g/${code}`);
    }
  }, [existingCheckin, user, router, code]);

  // Auto sign-in anonymously if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      signInAnonymously(firebaseAuth).catch((err) => {
        console.error('Anonymous sign-in error:', err);
        setAuthError(err.code === 'auth/operation-not-allowed'
          ? 'Anonymous sign-in is not enabled. Please enable it in the Firebase Console under Authentication → Sign-in method.'
          : `Authentication failed: ${err.message}`);
      });
    }
  }, [authLoading, user]);

  // Pre-populate from booking data
  useEffect(() => {
    if (booking && !prefilled) {
      setPrefilled(true);
      setForm((prev) => ({
        ...prev,
        fullName: prev.fullName || booking.guestName || '',
        email: prev.email || booking.guestEmail || '',
      }));
    }
  }, [booking, prefilled]);

  function validate() {
    const e = {};
    if (!form.fullName.trim()) e.fullName = t(locale, 'errorFullName');
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = t(locale, 'errorEmail');
    }
    if (!form.arrivalTime) e.arrivalTime = t(locale, 'errorArrival');
    const count = parseInt(form.guestCount, 10);
    if (!count || count < 1 || count > 20) e.guestCount = t(locale, 'errorGuestCount');
    return e;
  }

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const e2 = validate();
    if (Object.keys(e2).length) {
      setErrors(e2);
      return;
    }
    setLoading(true);
    try {
      const idToken = await firebaseAuth.currentUser.getIdToken();
      const res = await fetch('/api/guests/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          bookingCode: code,
          fullName: form.fullName.trim(),
          email: form.email.trim().toLowerCase(),
          arrivalTime: form.arrivalTime,
          guestCount: parseInt(form.guestCount, 10),
          specialRequests: form.specialRequests.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrors({ submit: json.error || t(locale, 'errorGeneric') });
        return;
      }

      // Set custom claims for Firestore access
      try {
        const freshToken = await firebaseAuth.currentUser.getIdToken();
        await fetch('/api/guests/set-claims', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({ bookingCode: code }),
        });
        await firebaseAuth.currentUser.getIdToken(true);
      } catch (claimErr) {
        console.error('Set claims error:', claimErr);
      }

      // Persist booking code so PWA can restore session from root
      localStorage.setItem('casa-coqui-guest-code', code);

      router.push(`/g/${code}/setup`);
    } catch (err) {
      console.error('Submit error:', err);
      setErrors({ submit: t(locale, 'errorGeneric') });
    } finally {
      setLoading(false);
    }
  }

  // Arrival window options
  const arrivalWindows = [
    { value: 'afternoon_early', label: t(locale, 'arrivalEarly') },
    { value: 'afternoon_late',  label: t(locale, 'arrivalLate') },
    { value: 'evening',         label: t(locale, 'arrivalEvening') },
    { value: 'undecided',       label: t(locale, 'arrivalUndecided') },
  ];

  // Wait for anonymous auth to complete
  if (authLoading || !user) {
    return (
      <div className="px-4 py-12 flex flex-col items-center gap-4">
        {authError ? (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 max-w-sm text-center">
            <p className="text-sm font-medium text-red-800 mb-1">{t(locale, 'unableToLoad')}</p>
            <p className="text-xs text-red-600">{authError}</p>
          </div>
        ) : (
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-50 p-5">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div className="text-center mb-1">
            <h2 className="text-lg font-bold text-gray-900">{t(locale, 'checkinWelcome')}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {t(locale, 'checkinSubtitle')}
            </p>
          </div>

          <Field label={t(locale, 'fullName')} error={errors.fullName}>
            <Input
              type="text"
              placeholder="Jane Smith"
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              autoComplete="name"
              required
            />
          </Field>

          <Field label={t(locale, 'emailAddress')} error={errors.email}>
            <Input
              type="email"
              placeholder="jane@example.com"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              autoComplete="email"
              required
            />
          </Field>

          <Field label={t(locale, 'arrivalQuestion')} error={errors.arrivalTime}>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Arrival time window">
              {arrivalWindows.map(({ value, label }) => {
                const selected = form.arrivalTime === value;
                const isUndecided = value === 'undecided';
                return (
                  <label
                    key={value}
                    className={[
                      'relative flex flex-col items-center justify-center rounded-xl border p-3 cursor-pointer transition select-none',
                      selected
                        ? 'border-green-600 bg-green-50 ring-2 ring-green-600'
                        : 'border-gray-200 bg-white hover:border-gray-300',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="arrivalTime"
                      value={value}
                      checked={selected}
                      onChange={() => set('arrivalTime', value)}
                      className="sr-only"
                    />
                    <span
                      className={[
                        'text-sm font-medium text-center leading-snug',
                        selected
                          ? 'text-green-800'
                          : isUndecided
                            ? 'text-gray-400 italic'
                            : 'text-gray-800',
                      ].join(' ')}
                    >
                      {label}
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label={t(locale, 'guestCount')} error={errors.guestCount}>
            <Input
              type="number"
              min={1}
              max={20}
              placeholder="1"
              value={form.guestCount}
              onChange={(e) => set('guestCount', e.target.value)}
              inputMode="numeric"
              required
            />
          </Field>

          <Field label={t(locale, 'specialRequests')}>
            <Textarea
              placeholder={t(locale, 'specialRequestsPlaceholder')}
              value={form.specialRequests}
              onChange={(e) => set('specialRequests', e.target.value)}
            />
          </Field>

          {errors.submit && (
            <p className="text-sm text-red-500 text-center">{errors.submit}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm mt-1
              hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? t(locale, 'saving') : t(locale, 'completeCheckInBtn')}
          </button>
        </form>
      </div>
    </div>
  );
}
