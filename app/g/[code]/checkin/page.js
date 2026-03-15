'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { where } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth as firebaseAuth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import { useCollection, useDocument } from '@/hooks/useFirestore';

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
    if (!form.fullName.trim()) e.fullName = 'Full name is required.';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = 'A valid email address is required.';
    }
    if (!form.arrivalTime) e.arrivalTime = 'Please select an expected arrival time.';
    const count = parseInt(form.guestCount, 10);
    if (!count || count < 1 || count > 20) e.guestCount = 'Enter a number between 1 and 20.';
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
          phone: null,
          arrivalTime: form.arrivalTime,
          guestCount: parseInt(form.guestCount, 10),
          specialRequests: form.specialRequests.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrors({ submit: json.error || 'Something went wrong. Please try again.' });
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

      router.push(`/g/${code}?welcome=1`);
    } catch (err) {
      console.error('Submit error:', err);
      setErrors({ submit: 'Something went wrong. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  // Build arrival time options
  const timeOptions = [];
  for (let h = 15; h <= 23; h++) {
    const label = new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    timeOptions.push({ value: `${String(h).padStart(2, '0')}:00`, label });
  }

  // Wait for anonymous auth to complete
  if (authLoading || !user) {
    return (
      <div className="px-4 py-12 flex flex-col items-center gap-4">
        {authError ? (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 max-w-sm text-center">
            <p className="text-sm font-medium text-red-800 mb-1">Unable to load check-in</p>
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
            <h2 className="text-lg font-bold text-gray-900">Welcome to Casa Coqui</h2>
            <p className="text-sm text-gray-500 mt-1">
              Fill in a few quick details to get started.
            </p>
          </div>

          <Field label="Full name" error={errors.fullName}>
            <Input
              type="text"
              placeholder="Jane Smith"
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              autoComplete="name"
              required
            />
          </Field>

          <Field label="Email address" error={errors.email}>
            <Input
              type="email"
              placeholder="jane@example.com"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              autoComplete="email"
              required
            />
          </Field>

          <Field label="Expected arrival time" error={errors.arrivalTime}>
            <select
              value={form.arrivalTime}
              onChange={(e) => set('arrivalTime', e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition appearance-none"
              required
            >
              <option value="">Select a time...</option>
              {timeOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
              <option value="late">After midnight (late arrival)</option>
            </select>
          </Field>

          <Field label="Number of guests (including yourself)" error={errors.guestCount}>
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

          <Field label="Special requests (optional)">
            <Textarea
              placeholder="Early check-in, accessibility needs, or anything else we should know..."
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
            {loading ? 'Saving...' : 'Complete Check-In'}
          </button>
        </form>
      </div>
    </div>
  );
}
