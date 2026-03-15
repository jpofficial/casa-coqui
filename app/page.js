'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const GUEST_CODE_KEY = 'casa-coqui-guest-code';

// ─── Coqui frog SVG — the spirit of the island ──────────────────────────────
function CoquiIcon({ className = '' }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Stylized coqui frog silhouette — sitting on a leaf, mid-song */}
      <path
        d="M32 8c-4 0-7.5 2-9.5 5.5C20.5 16 19 19 19 22c0 4 2 7.5 5 10l-3 6c-1 2-.5 4 1 5.5
           1 1 2.5 1.5 4 1.5h1l2-3h6l2 3h1c1.5 0 3-.5 4-1.5 1.5-1.5 2-3.5 1-5.5l-3-6
           c3-2.5 5-6 5-10 0-3-1.5-6-3.5-8.5C39.5 10 36 8 32 8z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      {/* Eye */}
      <circle cx="27.5" cy="19" r="2" fill="#052e1a" fillOpacity="0.6" />
      <circle cx="36.5" cy="19" r="2" fill="#052e1a" fillOpacity="0.6" />
      {/* Front legs */}
      <path
        d="M22 35c-2 1-4 3-4.5 5.5-.3 1.5.5 2.5 2 2.5 1.5 0 3-1 4-2.5l1.5-3"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M42 35c2 1 4 3 4.5 5.5.3 1.5-.5 2.5-2 2.5-1.5 0-3-1-4-2.5l-1.5-3"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Leaf underneath */}
      <path
        d="M14 52c6-3 12-4 18-4s12 1 18 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.3"
        fill="none"
      />
    </svg>
  );
}

// ─── Decorative leaf silhouettes for the background ──────────────────────────
function LeafDecoration() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Top-right palm frond */}
      <svg
        className="absolute -top-8 -right-12 w-64 h-64 text-white/[0.04]"
        viewBox="0 0 200 200"
        fill="currentColor"
      >
        <path d="M180 10C140 30 100 80 90 130c-5-50-30-90-70-110 50 10 100 40 130 80-10-40-10-70 30-90z" />
      </svg>
      {/* Bottom-left banana leaf */}
      <svg
        className="absolute -bottom-16 -left-16 w-72 h-72 text-white/[0.03] rotate-45"
        viewBox="0 0 200 200"
        fill="currentColor"
      >
        <path d="M100 10c-20 40-30 90-20 140 5-50 25-90 60-120-15 40-20 85-10 130 15-50 35-90 60-130-30 20-60 50-80 90 5-50 0-80-10-110z" />
      </svg>
      {/* Mid-right heliconia shape */}
      <svg
        className="absolute top-1/3 -right-8 w-32 h-48 text-white/[0.03]"
        viewBox="0 0 100 150"
        fill="currentColor"
      >
        <ellipse cx="50" cy="30" rx="25" ry="35" transform="rotate(-15 50 30)" />
        <ellipse cx="55" cy="75" rx="22" ry="30" transform="rotate(10 55 75)" />
        <ellipse cx="48" cy="115" rx="20" ry="28" transform="rotate(-5 48 115)" />
      </svg>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');

  useEffect(() => {
    // 1. Check localStorage first (instant redirect for returning PWA guests)
    const savedCode = localStorage.getItem(GUEST_CODE_KEY);
    if (savedCode) {
      router.replace(`/g/${savedCode}`);
      return;
    }

    // 2. Fallback: check Firebase auth for guest custom claims
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const tokenResult = await user.getIdTokenResult();
          if (tokenResult.claims.bookingCode && tokenResult.claims.role === 'guest') {
            const code = tokenResult.claims.bookingCode;
            localStorage.setItem(GUEST_CODE_KEY, code);
            router.replace(`/g/${code}`);
            return;
          }
        } catch (err) {
          console.warn('[Home] Token check failed:', err);
        }
      }
      // No guest session found — show landing page
      setChecking(false);
    });

    return unsubscribe;
  }, [router]);

  function handleRecoverySubmit(e) {
    e.preventDefault();
    const code = recoveryCode.trim();
    if (code) {
      localStorage.setItem(GUEST_CODE_KEY, code);
      router.push(`/g/${code}`);
    }
  }

  // Brief loading state while checking for guest session
  if (checking) {
    return (
      <div className="min-h-screen bg-landing-gradient flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-landing-gradient relative flex flex-col items-center justify-center px-6 overflow-hidden">
      {/* Background leaf decorations */}
      <LeafDecoration />

      {/* Mist effect at the bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-coqui-950/20 to-transparent pointer-events-none" />

      <div className="relative z-10 text-center space-y-8 max-w-sm w-full">
        {/* Coqui logo mark */}
        <div className="space-y-5">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center shadow-brand-lg">
            <CoquiIcon className="w-12 h-12 text-atardecer-400" />
          </div>

          {/* Brand name — DM Serif Display for warmth and premium feel */}
          <div>
            <h1 className="font-display text-4xl text-white tracking-tight">
              Casa Coqu<span className="text-atardecer-400">i</span>
            </h1>
            <p className="text-coqui-300 text-sm mt-2 font-light tracking-wide">
              Bienvenidos a su casa
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-3 pt-2">
          <button
            onClick={() => router.push('/admin/login')}
            className="w-full bg-white/95 hover:bg-white active:bg-cafe-100 text-coqui-800
              font-semibold rounded-brand px-5 py-4 text-sm transition-all duration-200
              min-h-[52px] shadow-brand-md hover:shadow-brand-lg
              focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:ring-offset-2 focus:ring-offset-coqui-800"
          >
            Admin Portal
          </button>

          <p className="text-coqui-400 text-xs pt-3 leading-relaxed">
            Guests — use the link from your host to access your portal.
          </p>

          {/* Guest recovery — re-enter booking code */}
          {!showRecovery ? (
            <button
              onClick={() => setShowRecovery(true)}
              className="text-coqui-400 hover:text-coqui-200 text-xs underline underline-offset-2 transition-colors"
            >
              Already checked in? Tap here.
            </button>
          ) : (
            <form onSubmit={handleRecoverySubmit} className="mt-2 space-y-2">
              <input
                type="text"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder="Enter your booking code"
                autoFocus
                className="w-full rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm
                  px-4 py-3 text-sm text-white placeholder-coqui-400
                  focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:border-transparent transition"
              />
              <button
                type="submit"
                disabled={!recoveryCode.trim()}
                className="w-full bg-atardecer-500 hover:bg-atardecer-600 disabled:opacity-40
                  text-white font-semibold rounded-xl px-5 py-3 text-sm transition-all duration-200
                  focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:ring-offset-2 focus:ring-offset-coqui-800"
              >
                Go to My Portal
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Subtle bottom flourish */}
      <div className="absolute bottom-6 flex items-center gap-2 text-coqui-600 z-10">
        <div className="w-8 h-px bg-coqui-600/30" />
        <span className="text-[10px] uppercase tracking-[0.2em] font-medium">Puerto Rico</span>
        <div className="w-8 h-px bg-coqui-600/30" />
      </div>
    </div>
  );
}
