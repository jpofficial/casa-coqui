'use client';

import React, { useState, useRef } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth } from '@/lib/firebase';

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

export default function PhoneStep({ code, onVerified }) {
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const recaptchaRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);

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

      // Set custom claims (bookingCode) so Firestore rules work
      try {
        const idToken = await result.user.getIdToken();
        await fetch('/api/guests/set-claims', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ bookingCode: code }),
        });
        // Force token refresh to pick up new claims
        await result.user.getIdToken(true);
      } catch (claimErr) {
        console.error('Set claims error:', claimErr);
      }

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
