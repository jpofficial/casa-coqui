'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';

// ─── Step indicator ────────────────────────────────────────────────────────────
function StepIndicator({ current }) {
  const steps = ['Verify', 'Details', 'Done'];
  return (
    <div className="flex items-center justify-center gap-2 mb-6" aria-label="Form progress">
      {steps.map((label, idx) => {
        const stepNum = idx + 1;
        const done = current > stepNum;
        const active = current === stepNum;
        return (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                  ${done ? 'bg-green-600 text-white' : active ? 'bg-green-600 text-white ring-4 ring-green-100' : 'bg-gray-100 text-gray-400'}`}
              >
                {done ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                ) : stepNum}
              </div>
              <span className={`text-[10px] font-medium ${active ? 'text-green-600' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`flex-1 h-px mb-5 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

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

// ─── Step 1 — Phone verification ──────────────────────────────────────────────
function PhoneStep({ code, onVerified }) {
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const recaptchaRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);

  // Format phone to E.164 (basic US helper)
  function formatPhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  }

  function validatePhone(raw) {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 10;
  }

  async function initRecaptcha() {
    if (recaptchaVerifierRef.current) return recaptchaVerifierRef.current;
    const verifier = new RecaptchaVerifier(auth, recaptchaRef.current, {
      size: 'invisible',
      callback: () => {},
    });
    recaptchaVerifierRef.current = verifier;
    return verifier;
  }

  async function handleSendOtp(e) {
    e.preventDefault();
    setError('');
    if (!validatePhone(phone)) {
      setError('Please enter a valid 10-digit phone number.');
      return;
    }
    setLoading(true);
    try {
      const verifier = await initRecaptcha();
      const result = await signInWithPhoneNumber(auth, formatPhone(phone), verifier);
      setConfirmationResult(result);
      setOtpSent(true);
    } catch (err) {
      console.error('Send OTP error:', err);
      setError('Could not send code. Please check the number and try again.');
      // Reset reCAPTCHA on error
      recaptchaVerifierRef.current = null;
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault();
    setError('');
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code.');
      return;
    }
    setLoading(true);
    try {
      const result = await confirmationResult.confirm(otp);
      onVerified(result.user, formatPhone(phone));
    } catch (err) {
      console.error('Verify OTP error:', err);
      setError('Incorrect code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-7 h-7 text-green-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 3h3m-6 3h.008v.008H6V15.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900">Verify your phone</h2>
        <p className="text-sm text-gray-500 mt-1">
          {otpSent
            ? `We sent a 6-digit code to ${phone}`
            : "We'll send a one-time code to confirm your identity."}
        </p>
      </div>

      {/* Invisible reCAPTCHA anchor */}
      <div ref={recaptchaRef} />

      {!otpSent ? (
        <form onSubmit={handleSendOtp} className="flex flex-col gap-4" noValidate>
          <Field label="Mobile phone number" error={error}>
            <Input
              type="tel"
              placeholder="(555) 000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              required
            />
          </Field>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm
              hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Sending...' : 'Send Code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4" noValidate>
          <Field label="6-digit verification code" error={error}>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              autoComplete="one-time-code"
              className="tracking-[0.4em] text-center text-lg font-mono"
              required
            />
          </Field>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm
              hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying...' : 'Verify Code'}
          </button>
          <button
            type="button"
            onClick={() => { setOtpSent(false); setOtp(''); setError(''); }}
            className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-700 transition"
          >
            Change number
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Step 2 — Guest details form ──────────────────────────────────────────────
function DetailsForm({ code, firebaseUser, verifiedPhone, onSuccess }) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    arrivalTime: '',
    guestCount: '1',
    specialRequests: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

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
      const guestId = firebaseUser.uid;

      // Save guest document
      await setDoc(doc(db, 'guests', guestId), {
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: verifiedPhone,
        arrivalTime: form.arrivalTime,
        guestCount: parseInt(form.guestCount, 10),
        specialRequests: form.specialRequests.trim() || null,
        bookingCode: code,
        createdAt: serverTimestamp(),
        uid: guestId,
      });

      // Update booking to mark check-in started
      // We query by code in the collection; to keep it simple we use a known doc path
      // The booking doc is stored with its own Firestore ID, but we link via guestId
      // Use a sub-write on a "checkins" path keyed to the booking code
      await setDoc(doc(db, 'checkins', code), {
        guestId,
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: verifiedPhone,
        arrivalTime: form.arrivalTime,
        guestCount: parseInt(form.guestCount, 10),
        specialRequests: form.specialRequests.trim() || null,
        bookingCode: code,
        checkedIn: true,
        checkedInAt: serverTimestamp(),
      });

      onSuccess(form.fullName.trim());
    } catch (err) {
      console.error('Submit error:', err);
      setErrors({ submit: 'Something went wrong. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  // Build arrival time options (hourly, 12h, today + tomorrow)
  const timeOptions = [];
  for (let h = 10; h <= 23; h++) {
    const label = new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    timeOptions.push({ value: `${String(h).padStart(2, '0')}:00`, label });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="text-center mb-1">
        <h2 className="text-lg font-bold text-gray-900">Tell us about yourself</h2>
        <p className="text-sm text-gray-500 mt-1">
          Phone verified. Fill in a few quick details.
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
          <option value="">Select a time…</option>
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
          placeholder="Early check-in, accessibility needs, or anything else we should know…"
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
  );
}

// ─── Step 3 — Success ──────────────────────────────────────────────────────────
function SuccessState({ name, code }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-4">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-green-600">
          <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
        </svg>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          You&apos;re all set{name ? `, ${name.split(' ')[0]}` : ''}!
        </h2>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed max-w-xs mx-auto">
          Your check-in is complete. Explore the portal below to find everything you need for a great stay.
        </p>
      </div>

      <div className="w-full bg-green-50 border border-green-100 rounded-xl p-4 text-left flex flex-col gap-2">
        <p className="text-sm font-semibold text-green-800">What&apos;s next</p>
        <ul className="text-sm text-green-700 flex flex-col gap-1">
          <li className="flex gap-2 items-start">
            <span className="mt-0.5 text-green-500" aria-hidden="true">&#x2713;</span>
            Check the Check-In Guide for arrival instructions
          </li>
          <li className="flex gap-2 items-start">
            <span className="mt-0.5 text-green-500" aria-hidden="true">&#x2713;</span>
            Review your parking spot on the Parking page
          </li>
          <li className="flex gap-2 items-start">
            <span className="mt-0.5 text-green-500" aria-hidden="true">&#x2713;</span>
            Grab the WiFi password from Access Codes
          </li>
        </ul>
      </div>

      <a
        href={`/g/${code}`}
        className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm text-center
          hover:bg-green-700 active:bg-green-800 transition block"
      >
        Go to Home
      </a>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function CheckInPage({ params }) {
  const code = params.code;

  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [verifiedUser, setVerifiedUser] = useState(null);
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [guestName, setGuestName] = useState('');

  // If already signed in, skip phone step
  useEffect(() => {
    if (user && step === 1) {
      setVerifiedUser(user);
      setStep(2);
    }
  }, [user, step]);

  function handleVerified(firebaseUser, phone) {
    setVerifiedUser(firebaseUser);
    setVerifiedPhone(phone);
    setStep(2);
  }

  function handleSuccess(name) {
    setGuestName(name);
    setStep(3);
  }

  return (
    <div className="px-4 py-6">
      <StepIndicator current={step} />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-50 p-5">
        {step === 1 && (
          <PhoneStep code={code} onVerified={handleVerified} />
        )}
        {step === 2 && verifiedUser && (
          <DetailsForm
            code={code}
            firebaseUser={verifiedUser}
            verifiedPhone={verifiedPhone}
            onSuccess={handleSuccess}
          />
        )}
        {step === 3 && (
          <SuccessState name={guestName} code={code} />
        )}
      </div>
    </div>
  );
}
