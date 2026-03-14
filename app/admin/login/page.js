'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';

/* ------------------------------------------------------------------ */
/*  Decorative SVG Components                                         */
/* ------------------------------------------------------------------ */

/** Coqui frog silhouette — the icon of Puerto Rico.
 *  Simplified, elegant profile facing right. Used as brand mark. */
function CoquiFrog({ className = '' }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* Body: round, compact tree frog shape */}
      <path d="M32 8c-2.5 0-4.8 1.2-6.2 3.1C23.5 9.5 21 8.5 18.5 9c-3.5.7-6 3.8-6 7.3 0 1.2.3 2.3.8 3.3C10.5 22 9 25.5 9 29.5c0 6 3.5 11 8.5 13.5-.5 2-1 4.5-1 6.5 0 2 .5 3.5 1.5 4.5 1.5 1.5 3 2 5 2s3-.5 4-1.5c.8-.8 1.2-1.8 1.5-3 1 .3 2.2.5 3.5.5s2.5-.2 3.5-.5c.3 1.2.7 2.2 1.5 3 1 1 2 1.5 4 1.5s3.5-.5 5-2c1-1 1.5-2.5 1.5-4.5 0-2-.5-4.5-1-6.5C51.5 40.5 55 35.5 55 29.5c0-4-1.5-7.5-4.3-10C51.2 18.6 51.5 17.5 51.5 16.3c0-3.5-2.5-6.6-6-7.3-2.5-.5-5 .5-7.3 2.1C36.8 9.2 34.5 8 32 8z" />
      {/* Eyes: two bright circles that catch light */}
      <circle cx="25" cy="18" r="3.5" fill="currentColor" opacity="0.3" />
      <circle cx="39" cy="18" r="3.5" fill="currentColor" opacity="0.3" />
      <circle cx="25.5" cy="17.5" r="1.5" fill="white" opacity="0.9" />
      <circle cx="39.5" cy="17.5" r="1.5" fill="white" opacity="0.9" />
    </svg>
  );
}

/** Tropical leaf — simplified monstera/palm hybrid.
 *  Used as large decorative elements at viewport edges. */
function TropicalLeaf({ className = '', flip = false }) {
  return (
    <svg
      viewBox="0 0 200 320"
      fill="currentColor"
      className={className}
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      {/* Main leaf blade with natural splits */}
      <path d="M100 10 C85 40, 40 80, 30 130 C22 170, 35 210, 50 240 C60 260, 75 280, 95 310 C100 310, 100 310, 105 310 C125 280, 140 260, 150 240 C165 210, 178 170, 170 130 C160 80, 115 40, 100 10Z" opacity="0.7" />
      {/* Central vein */}
      <path d="M100 30 L100 300" stroke="currentColor" strokeWidth="2" opacity="0.3" fill="none" />
      {/* Side veins */}
      <path d="M100 80 L55 120 M100 120 L45 170 M100 160 L55 210 M100 200 L65 245" stroke="currentColor" strokeWidth="1.5" opacity="0.2" fill="none" />
      <path d="M100 80 L145 120 M100 120 L155 170 M100 160 L145 210 M100 200 L135 245" stroke="currentColor" strokeWidth="1.5" opacity="0.2" fill="none" />
      {/* Monstera-style fenestrations */}
      <ellipse cx="65" cy="145" rx="12" ry="20" fill="black" opacity="0.4" />
      <ellipse cx="135" cy="145" rx="12" ry="20" fill="black" opacity="0.4" />
      <ellipse cx="70" cy="200" rx="10" ry="16" fill="black" opacity="0.3" />
      <ellipse cx="130" cy="200" rx="10" ry="16" fill="black" opacity="0.3" />
    </svg>
  );
}

/** Wave pattern for the bottom edge — Caribbean coastline rhythm */
function WaveBottom({ className = '' }) {
  return (
    <svg
      viewBox="0 0 1440 120"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M0,60 C180,120 360,0 540,60 C720,120 900,0 1080,60 C1260,120 1440,30 1440,30 L1440,120 L0,120 Z"
        fill="currentColor"
        opacity="0.06"
      />
      <path
        d="M0,80 C200,40 400,100 600,70 C800,40 1000,100 1200,70 C1350,50 1440,80 1440,80 L1440,120 L0,120 Z"
        fill="currentColor"
        opacity="0.03"
      />
    </svg>
  );
}

/** Bioluminescent dot — a single floating particle.
 *  References Mosquito Bay in Vieques. */
function BiolumDot({ className = '', delay = '0s', duration = '7s' }) {
  return (
    <div
      className={`absolute rounded-full animate-biolum-float ${className}`}
      style={{
        animationDelay: delay,
        animationDuration: duration,
      }}
      aria-hidden="true"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Login Page                                                         */
/* ------------------------------------------------------------------ */

function TeamLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Set session cookie before navigating — the middleware checks for it
      // and onAuthStateChanged (which also sets it) may not fire in time.
      document.cookie = 'casa-coqui-session=1; path=/; max-age=604800; SameSite=Lax';
      const redirect = searchParams.get('redirect') || '/admin';
      router.push(redirect);
    } catch (err) {
      console.error('[TeamLogin] Sign-in error:', err.code, err.message);

      switch (err.code) {
        case 'auth/invalid-credential':
        case 'auth/user-not-found':
        case 'auth/wrong-password':
          setError('Invalid email or password.');
          break;
        case 'auth/too-many-requests':
          setError('Too many failed attempts. Please try again later.');
          break;
        case 'auth/network-request-failed':
          setError('Network error. Check your connection and try again.');
          break;
        default:
          setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setError('');
    setResetMessage('');
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setResetMessage('Check your email \u2014 we sent a link to reset your password.');
    } catch (err) {
      console.error('[TeamLogin] Reset error:', err.code, err.message);

      switch (err.code) {
        case 'auth/user-not-found':
        case 'auth/invalid-email':
          setError('No account found with that email.');
          break;
        case 'auth/too-many-requests':
          setError('Too many requests. Please try again later.');
          break;
        default:
          setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4">

      {/* ============================================================ */}
      {/*  LAYER 1: Animated jungle gradient background                */}
      {/* ============================================================ */}
      <div
        className="absolute inset-0 animate-gradient-shift"
        style={{
          background: 'linear-gradient(135deg, #042114 0%, #073620 20%, #0b4a2c 40%, #0f5f38 60%, #137a47 80%, #0b4a2c 100%)',
          backgroundSize: '200% 200%',
        }}
      />

      {/* ============================================================ */}
      {/*  LAYER 2: Golden-hour radial glow (top-right)                */}
      {/*  Simulates Caribbean sunset light bleeding through canopy     */}
      {/* ============================================================ */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 85% 15%, rgba(245, 183, 49, 0.08) 0%, transparent 70%), radial-gradient(ellipse 40% 40% at 10% 85%, rgba(38, 169, 181, 0.05) 0%, transparent 70%)',
        }}
      />

      {/* ============================================================ */}
      {/*  LAYER 3: Decorative tropical leaves                         */}
      {/*  Positioned at viewport edges, bleeding off-screen           */}
      {/* ============================================================ */}

      {/* Top-left leaf — large, extends past viewport */}
      <div className="absolute -top-12 -left-16 sm:-top-8 sm:-left-12 animate-leaf-sway origin-bottom-right">
        <TropicalLeaf className="w-40 h-64 sm:w-52 sm:h-80 text-coqui-400 opacity-[0.08]" />
      </div>

      {/* Bottom-right leaf — mirrored, lower positioned */}
      <div
        className="absolute -bottom-16 -right-12 sm:-bottom-8 sm:-right-8 animate-leaf-sway origin-top-left"
        style={{ animationDelay: '-9s' }}
      >
        <TropicalLeaf
          className="w-36 h-56 sm:w-48 sm:h-72 text-coqui-300 opacity-[0.06]"
          flip
        />
      </div>

      {/* ============================================================ */}
      {/*  LAYER 4: Bioluminescent particles (Mosquito Bay reference)  */}
      {/* ============================================================ */}
      <BiolumDot
        className="w-1.5 h-1.5 bg-caribe-300 top-[18%] left-[12%]"
        delay="0s"
        duration="7s"
      />
      <BiolumDot
        className="w-2 h-2 bg-caribe-200 top-[35%] right-[18%]"
        delay="-2.5s"
        duration="8s"
      />
      <BiolumDot
        className="w-1 h-1 bg-coqui-200 bottom-[28%] left-[25%]"
        delay="-4s"
        duration="9s"
      />
      <BiolumDot
        className="w-1.5 h-1.5 bg-caribe-300 top-[60%] right-[30%] hidden sm:block"
        delay="-6s"
        duration="7.5s"
      />
      <BiolumDot
        className="w-1 h-1 bg-coqui-300 top-[75%] left-[65%] hidden sm:block"
        delay="-3s"
        duration="10s"
      />

      {/* ============================================================ */}
      {/*  LAYER 5: Wave pattern at bottom edge                        */}
      {/* ============================================================ */}
      <WaveBottom className="absolute bottom-0 left-0 right-0 w-full h-20 sm:h-28 text-noche-950" />

      {/* ============================================================ */}
      {/*  LOGIN CARD — Glassmorphism over the jungle                  */}
      {/* ============================================================ */}
      <div className="w-full max-w-sm relative z-10 animate-fade-in-up">
        <div
          className="rounded-3xl p-8 sm:p-10 border border-white/[0.12]"
          style={{
            background: 'rgba(253, 251, 247, 0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 8px 32px rgba(5, 46, 26, 0.2), 0 2px 8px rgba(5, 46, 26, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
          }}
        >

          {/* ------------------------------------------------------ */}
          {/*  Brand / Logo Area                                      */}
          {/* ------------------------------------------------------ */}
          <div className="mb-8 text-center">
            {/* Coqui frog icon */}
            <div className="flex justify-center mb-3">
              <CoquiFrog className="w-10 h-10 text-coqui-700" />
            </div>

            {/* Brand name in serif display font */}
            <h1
              className="text-3xl font-normal text-coqui-900 tracking-wide"
              style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}
            >
              Casa Coqu&iacute;
            </h1>

            {/* Subtitle */}
            <p className="text-sm text-coqui-600/70 mt-1.5 tracking-wide uppercase">
              {resetMode ? 'Reset your password' : 'Bienvenidos'}
            </p>

            {/* Decorative gold divider line */}
            <div className="flex justify-center mt-4">
              <div
                className="h-px w-12 rounded-full animate-shimmer-sweep"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, #f5b731 50%, transparent 100%)',
                  backgroundSize: '200% 100%',
                }}
              />
            </div>
          </div>

          {/* ------------------------------------------------------ */}
          {/*  Forms                                                   */}
          {/* ------------------------------------------------------ */}

          {resetMode ? (
            /* ---- Password Reset Form ---- */
            <form onSubmit={handleReset} noValidate className="space-y-5">
              <p className="text-sm text-coqui-700/70 text-center -mt-2 mb-4">
                Enter your email and we&apos;ll send you a link to create a new password.
              </p>

              <div>
                <label
                  htmlFor="reset-email"
                  className="block text-sm font-medium text-coqui-800/80 mb-1.5"
                >
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full rounded-xl border border-cafe-300 bg-white/80 px-4 py-3 text-base text-coqui-900 placeholder-cafe-400 focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:border-transparent transition-all duration-200"
                />
              </div>

              {/* Error message — warm terracotta, not harsh red */}
              {error && (
                <p role="alert" className="text-sm text-flamboyan-700 bg-flamboyan-50/80 border border-flamboyan-200/60 rounded-xl px-4 py-3">
                  {error}
                </p>
              )}

              {/* Success message — bioluminescent green */}
              {resetMessage && (
                <p role="status" className="text-sm text-coqui-700 bg-coqui-50/80 border border-coqui-200/60 rounded-xl px-4 py-3">
                  {resetMessage}
                </p>
              )}

              {/* Submit button — golden, warm, premium */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-atardecer-400 hover:bg-atardecer-500 active:bg-atardecer-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:ring-offset-2 focus:ring-offset-cafe-50 shadow-sm hover:shadow-md"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              {/* Back to login link */}
              <button
                type="button"
                onClick={() => {
                  setResetMode(false);
                  setError('');
                  setResetMessage('');
                }}
                className="w-full text-sm text-coqui-600 hover:text-coqui-700 font-medium py-2 transition-colors duration-200"
              >
                Back to sign in
              </button>
            </form>
          ) : (
            /* ---- Login Form ---- */
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-coqui-800/80 mb-1.5"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full rounded-xl border border-cafe-300 bg-white/80 px-4 py-3 text-base text-coqui-900 placeholder-cafe-400 focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:border-transparent transition-all duration-200"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-coqui-800/80 mb-1.5"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-cafe-300 bg-white/80 px-4 py-3 text-base text-coqui-900 placeholder-cafe-400 focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:border-transparent transition-all duration-200"
                />
                <button
                  type="button"
                  onClick={() => {
                    setResetMode(true);
                    setError('');
                  }}
                  className="mt-2 text-sm text-coqui-500 hover:text-coqui-700 font-medium transition-colors duration-200"
                >
                  Forgot your password?
                </button>
              </div>

              {/* Error message — warm flamboyan, not harsh red */}
              {error && (
                <p role="alert" className="text-sm text-flamboyan-700 bg-flamboyan-50/80 border border-flamboyan-200/60 rounded-xl px-4 py-3">
                  {error}
                </p>
              )}

              {/* Sign In button — the golden call to action */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-atardecer-400 hover:bg-atardecer-500 active:bg-atardecer-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:ring-offset-2 focus:ring-offset-cafe-50 shadow-sm hover:shadow-md"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in&hellip;
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          )}
        </div>

        {/* Footer text below card — on the dark background */}
        <p className="text-center text-xs text-coqui-200/50 mt-6 tracking-wide">
          Casa Coqu&iacute; &middot; Puerto Rico
        </p>
      </div>
    </div>
  );
}

export default function TeamLogin() {
  return (
    <Suspense>
      <TeamLoginInner />
    </Suspense>
  );
}
