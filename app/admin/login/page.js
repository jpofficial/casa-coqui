'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';

/* ================================================================== */
/*  Decorative SVG Components                                         */
/* ================================================================== */

/** Coqui frog silhouette -- the icon of Puerto Rico.
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

/** Tropical leaf -- simplified monstera/palm hybrid.
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

/** Smaller palm frond -- used for mid-depth foliage layer */
function PalmFrond({ className = '' }) {
  return (
    <svg
      viewBox="0 0 120 200"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* Simplified palm frond with curved blade */}
      <path d="M60 5 C50 25, 20 55, 15 90 C12 115, 20 140, 35 165 C45 180, 55 195, 60 200 C65 195, 75 180, 85 165 C100 140, 108 115, 105 90 C100 55, 70 25, 60 5Z" opacity="0.6" />
      {/* Central spine */}
      <path d="M60 15 L60 190" stroke="currentColor" strokeWidth="1.5" opacity="0.25" fill="none" />
      {/* Frond veins */}
      <path d="M60 50 L30 80 M60 80 L25 115 M60 110 L35 145 M60 140 L40 170" stroke="currentColor" strokeWidth="1" opacity="0.15" fill="none" />
      <path d="M60 50 L90 80 M60 80 L95 115 M60 110 L85 145 M60 140 L80 170" stroke="currentColor" strokeWidth="1" opacity="0.15" fill="none" />
    </svg>
  );
}

/** Bioluminescent dot -- a single floating particle.
 *  References Mosquito Bay in Vieques. */
function BiolumDot({ className = '', delay = '0s', duration = '7s', animation = 'animate-biolum-float' }) {
  return (
    <div
      className={`absolute rounded-full ${animation} ${className}`}
      style={{
        animationDelay: delay,
        animationDuration: duration,
      }}
      aria-hidden="true"
    />
  );
}


/* ================================================================== */
/*  Login Page                                                         */
/* ================================================================== */

function TeamLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Set session cookie before navigating -- the middleware checks for it
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
      {/*  LAYER 1 (z-0): Animated jungle gradient background          */}
      {/*  Enhanced with 4-point position cycle for organic breathing   */}
      {/* ============================================================ */}
      <div
        className="absolute inset-0 animate-gradient-shift"
        style={{
          background: 'linear-gradient(135deg, #042114 0%, #073620 20%, #0b4a2c 40%, #0f5f38 60%, #137a47 80%, #0b4a2c 100%)',
          backgroundSize: '200% 200%',
        }}
      />

      {/* ============================================================ */}
      {/*  LAYER 2 (z-1): Ambient light -- moving radial glow          */}
      {/*  The golden-hour light slowly drifts and breathes,           */}
      {/*  simulating shifting sunlight through canopy                  */}
      {/* ============================================================ */}
      <div
        className="absolute inset-0 pointer-events-none animate-ambient-light"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 80% 20%, rgba(245, 183, 49, 0.1) 0%, transparent 70%)',
        }}
      />

      {/* Secondary caribe glow -- bottom-left, pulsing warmth */}
      <div
        className="absolute inset-0 pointer-events-none animate-warm-pulse"
        style={{
          background: 'radial-gradient(ellipse 45% 40% at 15% 80%, rgba(38, 169, 181, 0.06) 0%, transparent 65%)',
        }}
      />

      {/* ============================================================ */}
      {/*  LAYER 3 (z-2): Light rays -- god rays through the canopy    */}
      {/*  Two diagonal shafts of warm light at different angles        */}
      {/* ============================================================ */}

      {/* Primary ray -- warm gold, upper-right origin */}
      <div
        className="absolute top-0 right-[10%] w-[200px] sm:w-[300px] h-[120%] pointer-events-none animate-light-ray"
        style={{
          background: 'linear-gradient(195deg, rgba(245, 183, 49, 0.04) 0%, transparent 60%)',
          willChange: 'opacity',
        }}
        aria-hidden="true"
      />

      {/* Secondary ray -- cooler, left side, offset timing */}
      <div
        className="absolute top-0 left-[15%] w-[150px] sm:w-[250px] h-[110%] pointer-events-none animate-light-ray hidden sm:block"
        style={{
          background: 'linear-gradient(200deg, rgba(26, 154, 90, 0.03) 0%, transparent 50%)',
          animationDelay: '-10s',
          animationDuration: '25s',
          willChange: 'opacity',
        }}
        aria-hidden="true"
      />

      {/* ============================================================ */}
      {/*  LAYER 4 (z-3): Mist / Fog drift -- El Yunque cloud forest   */}
      {/*  Two wide layers drifting at different speeds create depth    */}
      {/* ============================================================ */}

      {/* Back mist layer -- wide, slow, low in viewport */}
      <div
        className="absolute inset-x-[-20%] bottom-[15%] h-[35%] pointer-events-none animate-mist-drift"
        style={{
          background: 'radial-gradient(ellipse 80% 100% at 50% 80%, rgba(253, 251, 247, 0.06) 0%, transparent 70%)',
          willChange: 'transform, opacity',
        }}
        aria-hidden="true"
      />

      {/* Front mist layer -- slightly higher, counter-direction */}
      <div
        className="absolute inset-x-[-15%] bottom-[25%] h-[30%] pointer-events-none animate-mist-drift-reverse"
        style={{
          background: 'radial-gradient(ellipse 70% 80% at 50% 70%, rgba(253, 251, 247, 0.04) 0%, transparent 65%)',
          animationDelay: '-15s',
          willChange: 'transform, opacity',
        }}
        aria-hidden="true"
      />

      {/* ============================================================ */}
      {/*  LAYER 5 (z-4): Decorative tropical leaves -- multi-depth    */}
      {/*  Three layers: deep (slow), mid (standard), fore (faster)    */}
      {/* ============================================================ */}

      {/* DEEP layer -- top-left large monstera, very slow sway */}
      <div className="absolute -top-16 -left-20 sm:-top-12 sm:-left-16 animate-leaf-sway-deep origin-bottom-right">
        <TropicalLeaf className="w-44 h-72 sm:w-56 sm:h-88 text-coqui-400 opacity-[0.06]" />
      </div>

      {/* MID layer -- bottom-right monstera, standard sway */}
      <div
        className="absolute -bottom-16 -right-12 sm:-bottom-8 sm:-right-8 animate-leaf-sway origin-top-left"
        style={{ animationDelay: '-9s' }}
      >
        <TropicalLeaf
          className="w-36 h-56 sm:w-48 sm:h-72 text-coqui-300 opacity-[0.07]"
          flip
        />
      </div>

      {/* FORE layer -- small palm frond, top-right, faster sway */}
      <div
        className="absolute -top-4 -right-8 sm:top-4 sm:-right-4 animate-leaf-sway-fore origin-bottom-left hidden sm:block"
        style={{ animationDelay: '-5s' }}
      >
        <PalmFrond className="w-28 h-44 text-coqui-300 opacity-[0.05]" />
      </div>

      {/* Vine element -- left edge, mid-height, slow unfurl breathing */}
      <div
        className="absolute top-[30%] -left-6 sm:-left-2 animate-vine-unfurl origin-top hidden sm:block"
        style={{ animationDelay: '-11s' }}
      >
        <PalmFrond className="w-20 h-32 text-coqui-500 opacity-[0.04] rotate-[15deg]" />
      </div>

      {/* ============================================================ */}
      {/*  LAYER 6 (z-5): Atmospheric particle system                  */}
      {/*  Mix of biolum floats, firefly wanders, and distant pulses   */}
      {/* ============================================================ */}

      {/* -- Bioluminescent floaters (original behavior, enhanced paths) -- */}
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

      {/* -- Firefly wanderers (erratic horizontal + vertical drift) -- */}
      <BiolumDot
        className="w-1.5 h-1.5 bg-atardecer-300 top-[45%] left-[65%]"
        delay="-2s"
        duration="12s"
        animation="animate-firefly-wander"
      />
      <BiolumDot
        className="w-1 h-1 bg-caribe-200 top-[25%] right-[35%] hidden sm:block"
        delay="-7s"
        duration="14s"
        animation="animate-firefly-wander"
      />

      {/* -- Distant sparkle pulses (stationary, fade in/out) -- */}
      <BiolumDot
        className="w-1 h-1 bg-caribe-300 top-[70%] left-[75%]"
        delay="-3s"
        duration="10s"
        animation="animate-biolum-pulse"
      />
      <BiolumDot
        className="w-0.5 h-0.5 bg-coqui-200 top-[15%] left-[50%] hidden sm:block"
        delay="-5s"
        duration="8s"
        animation="animate-biolum-pulse"
      />
      <BiolumDot
        className="w-1 h-1 bg-atardecer-200 top-[80%] right-[20%] hidden sm:block"
        delay="-1s"
        duration="12s"
        animation="animate-biolum-pulse"
      />

      {/* -- Horizontal mist particles (slow sideways drift) -- */}
      <BiolumDot
        className="w-3 h-1 bg-white/[0.08] top-[55%] left-[30%] rounded-full hidden sm:block"
        delay="-8s"
        duration="20s"
        animation="animate-mist-particle"
      />
      <BiolumDot
        className="w-4 h-1 bg-white/[0.05] top-[40%] left-[60%] rounded-full hidden sm:block"
        delay="-4s"
        duration="24s"
        animation="animate-mist-particle"
      />

      {/* ============================================================ */}
      {/*  LAYER 7 (z-6): Animated waves at bottom edge                */}
      {/*  Two independent wave layers lapping at different speeds      */}
      {/* ============================================================ */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none" aria-hidden="true">
        {/* Back wave -- slower, more transparent */}
        <svg
          viewBox="0 0 1440 120"
          preserveAspectRatio="none"
          className="absolute bottom-0 w-full h-24 sm:h-32 text-noche-950 animate-wave-lap-slow"
        >
          <path
            d="M0,80 C200,40 400,100 600,70 C800,40 1000,100 1200,70 C1350,50 1440,80 1440,80 L1440,120 L0,120 Z"
            fill="currentColor"
            opacity="0.03"
          />
        </svg>

        {/* Front wave -- faster, slightly more opaque */}
        <svg
          viewBox="0 0 1440 120"
          preserveAspectRatio="none"
          className="absolute bottom-0 w-full h-20 sm:h-28 text-noche-950 animate-wave-lap"
        >
          <path
            d="M0,60 C180,120 360,0 540,60 C720,120 900,0 1080,60 C1260,120 1440,30 1440,30 L1440,120 L0,120 Z"
            fill="currentColor"
            opacity="0.06"
          />
        </svg>
      </div>

      {/* ============================================================ */}
      {/*  LOGIN CARD -- Glassmorphism over the jungle                  */}
      {/*                                                               */}
      {/*  FIX: Two-div nesting to separate entrance and idle float.    */}
      {/*  Outer div: one-shot fadeInUp entrance animation.             */}
      {/*  Inner wrapper: continuous cardFloat breathing after entrance. */}
      {/*  This prevents the two animations from colliding on one node. */}
      {/* ============================================================ */}
      <div className="w-full max-w-sm relative z-10 animate-fade-in-up">
        <div className="animate-card-float">
          <div
            className="rounded-3xl p-8 sm:p-10 border border-white/[0.18]"
            style={{
              background: 'rgba(253, 251, 247, 0.95)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: '0 8px 32px rgba(5, 46, 26, 0.25), 0 2px 8px rgba(5, 46, 26, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 0 60px rgba(253, 251, 247, 0.04)',
            }}
          >

            {/* ------------------------------------------------------ */}
            {/*  Brand / Logo Area -- staggered entrance                */}
            {/* ------------------------------------------------------ */}
            <div className="mb-8 text-center">
              {/* Coqui frog icon -- first to appear */}
              <div
                className="flex justify-center mb-3 animate-stagger-fade-in"
                style={{ animationDelay: '0.3s' }}
              >
                <CoquiFrog className="w-10 h-10 text-coqui-700" />
              </div>

              {/* Brand name in serif display font -- second to appear */}
              <h1
                className="text-3xl font-normal text-coqui-900 tracking-wide animate-stagger-fade-in"
                style={{
                  fontFamily: "'DM Serif Display', Georgia, serif",
                  animationDelay: '0.45s',
                }}
              >
                Casa Coqu<span className="text-atardecer-400">&iacute;</span>
              </h1>

              {/* Subtitle -- third to appear */}
              <p
                className="text-sm text-coqui-600/70 mt-1.5 tracking-wide uppercase animate-stagger-fade-in"
                style={{ animationDelay: '0.55s' }}
              >
                {resetMode ? 'Reset your password' : 'Bienvenidos'}
              </p>

              {/* Decorative gold divider line -- last brand element */}
              <div
                className="flex justify-center mt-4 animate-stagger-fade-in"
                style={{ animationDelay: '0.65s' }}
              >
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
            {/*  Forms -- with staggered field entrance                  */}
            {/*  FIX: key={resetMode} forces React to unmount/remount   */}
            {/*  when switching modes, so stagger animations replay.    */}
            {/* ------------------------------------------------------ */}

            {resetMode ? (
              /* ---- Password Reset Form ---- */
              <form key="reset" onSubmit={handleReset} noValidate className="space-y-5">
                <p
                  className="text-sm text-coqui-700/70 text-center -mt-2 mb-4 animate-stagger-fade-in"
                  style={{ animationDelay: '0.15s' }}
                >
                  Enter your email and we&apos;ll send you a link to create a new password.
                </p>

                <div
                  className="animate-stagger-fade-in"
                  style={{ animationDelay: '0.25s' }}
                >
                  <label
                    htmlFor="reset-email"
                    className="block text-sm font-medium text-coqui-800/80 mb-1.5"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cafe-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                    <input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="login-input-focus w-full rounded-xl border border-cafe-300 bg-white pl-10 pr-4 py-3 text-base text-coqui-900 placeholder-cafe-400 focus:outline-none focus:ring-0 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Error message -- warm terracotta, not harsh red */}
                {error && (
                  <p role="alert" className="text-sm text-flamboyan-700 bg-flamboyan-50/80 border border-flamboyan-200/60 rounded-xl px-4 py-3 animate-stagger-fade-in">
                    {error}
                  </p>
                )}

                {/* Success message -- bioluminescent green */}
                {resetMessage && (
                  <p role="status" className="text-sm text-coqui-700 bg-coqui-50/80 border border-coqui-200/60 rounded-xl px-4 py-3 animate-stagger-fade-in">
                    {resetMessage}
                  </p>
                )}

                {/* Submit button -- golden, warm, premium */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-atardecer-400 hover:bg-atardecer-500 active:bg-atardecer-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:ring-offset-2 focus:ring-offset-cafe-50 shadow-sm hover:shadow-md animate-stagger-fade-in"
                  style={{ animationDelay: '0.35s' }}
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
              <form key="login" onSubmit={handleSubmit} noValidate className="space-y-5">
                {/* Email field -- stagger entrance */}
                <div
                  className="animate-stagger-fade-in"
                  style={{ animationDelay: '0.7s' }}
                >
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-coqui-800/80 mb-1.5"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cafe-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="login-input-focus w-full rounded-xl border border-cafe-300 bg-white pl-10 pr-4 py-3 text-base text-coqui-900 placeholder-cafe-400 focus:outline-none focus:ring-0 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Password field -- stagger entrance */}
                <div
                  className="animate-stagger-fade-in"
                  style={{ animationDelay: '0.8s' }}
                >
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-coqui-800/80 mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cafe-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="login-input-focus w-full rounded-xl border border-cafe-300 bg-white pl-10 pr-10 py-3 text-base text-coqui-900 placeholder-cafe-400 focus:outline-none focus:ring-0 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-cafe-400 hover:text-coqui-600 p-1 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResetMode(true);
                      setError('');
                    }}
                    className="mt-2 text-sm text-coqui-600/60 hover:text-coqui-700 font-medium py-2.5 px-1 transition-colors duration-200"
                  >
                    Forgot your password?
                  </button>
                </div>

                {/* Error message -- warm flamboyan, not harsh red */}
                {error && (
                  <p role="alert" className="text-sm text-flamboyan-700 bg-flamboyan-50/80 border border-flamboyan-200/60 rounded-xl px-4 py-3 animate-stagger-fade-in">
                    {error}
                  </p>
                )}

                {/* Sign In button -- golden call to action, staggered last */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-atardecer-400 hover:bg-atardecer-500 active:bg-atardecer-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-atardecer-400 focus:ring-offset-2 focus:ring-offset-cafe-50 shadow-sm hover:shadow-md animate-stagger-fade-in"
                  style={{ animationDelay: '0.9s' }}
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

          {/* Footer text below card -- on the dark background */}
          <p
            className="text-center text-xs text-coqui-200/50 mt-6 tracking-wide animate-stagger-fade-in"
            style={{ animationDelay: '1.0s' }}
          >
            Casa Coqu&iacute; &middot; Puerto Rico
          </p>
        </div>
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
