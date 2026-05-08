'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth as firebaseAuth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import PhoneStep from '@/components/guest/PhoneStep';

// ─── Shared UI primitives ──────────────────────────────────────────────────────
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

// ─── Step indicator ────────────────────────────────────────────────────────────
function StepIndicator({ current }) {
  const steps = ['Verify', 'Confirm', 'Done'];
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

// ─── Confirm details form (simplified for invited members) ─────────────────────
function ConfirmForm({ code, invite, firebaseUser, verifiedPhone, onSuccess }) {
  const [form, setForm] = useState({
    fullName: invite.name || '',
    email: invite.email || '',
    arrivalTime: '',
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
        bookingCode: code,
        createdAt: serverTimestamp(),
        uid: guestId,
        memberRole: 'member',
      });

      // Update booking_members via server-side API
      try {
        const idToken = await firebaseAuth.currentUser.getIdToken();
        await fetch('/api/guests/link-member', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            bookingCode: code,
            name: form.fullName.trim(),
            email: form.email.trim().toLowerCase(),
            phone: verifiedPhone,
            role: 'member',
          }),
        });
      } catch (memberErr) {
        console.error('Link booking_members error:', memberErr);
      }

      onSuccess(form.fullName.trim());
    } catch (err) {
      console.error('Submit error:', err);
      setErrors({ submit: 'Something went wrong. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  // Arrival time options starting at 3 PM
  const timeOptions = [];
  for (let h = 15; h <= 23; h++) {
    const label = new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    timeOptions.push({ value: `${String(h).padStart(2, '0')}:00`, label });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="text-center mb-1">
        <h2 className="text-lg font-bold text-gray-900">Confirm your details</h2>
        <p className="text-sm text-gray-500 mt-1">
          Phone verified. Just confirm a few details and you&apos;re in.
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

      {errors.submit && (
        <p className="text-sm text-red-500 text-center">{errors.submit}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm mt-1
          hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Saving...' : 'Join Group'}
      </button>
    </form>
  );
}

// ─── Success state ─────────────────────────────────────────────────────────────
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
          Welcome{name ? `, ${name.split(' ')[0]}` : ''}!
        </h2>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed max-w-xs mx-auto">
          You&apos;ve joined the group. Head to the portal to explore everything you need for your stay.
        </p>
      </div>
      <a
        href={`/g/${code}`}
        className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm text-center
          hover:bg-green-700 active:bg-green-800 transition block"
      >
        Go to Guest Portal
      </a>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function JoinPage({ params }) {
  const code = params.code;
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(true);
  const [verifiedUser, setVerifiedUser] = useState(null);
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [guestName, setGuestName] = useState('');

  // Validate the token on mount
  useEffect(() => {
    if (!token) {
      setError('Missing invite token. Please use the link from your invitation email.');
      setClaiming(false);
      return;
    }

    async function claimToken() {
      try {
        const res = await fetch('/api/guests/claim-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();

        if (!json.success) {
          setError(json.error || 'Invalid invite link.');
          setClaiming(false);
          return;
        }

        setInvite(json.data);
        setClaiming(false);
      } catch (err) {
        console.error('Claim invite error:', err);
        setError('Something went wrong. Please try again.');
        setClaiming(false);
      }
    }

    claimToken();
  }, [token]);

  // If already signed in, skip phone step
  useEffect(() => {
    if (user && invite && step === 1) {
      setVerifiedUser(user);
      setStep(2);
    }
  }, [user, invite, step]);

  function handleVerified(firebaseUser, phone) {
    setVerifiedUser(firebaseUser);
    setVerifiedPhone(phone);
    setStep(2);
  }

  function handleSuccess(name) {
    setGuestName(name);
    setStep(3);
  }

  // Loading state
  if (claiming) {
    return (
      <div className="px-4 py-12 text-center">
        <div className="w-12 h-12 border-4 border-green-200 border-t-green-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-500">Validating your invitation...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="px-4 pt-12 pb-4 text-center">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-8 h-8 text-red-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Invite Error</h1>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  if (!invite) return null;

  return (
    <div className="px-4 py-6">
      <StepIndicator current={step} />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-50 p-5">
        {step === 1 && (
          <PhoneStep code={code} onVerified={handleVerified} />
        )}
        {step === 2 && verifiedUser && (
          <ConfirmForm
            code={code}
            invite={invite}
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
