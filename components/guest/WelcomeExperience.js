'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Bioluminescent particle config ──────────────────────────────────────────
const PARTICLES = [
  { top: '25%', left: '15%', w: 3, delay: '0s', cls: 'animate-biolum-float' },
  { top: '60%', left: '82%', w: 2, delay: '2s', cls: 'animate-biolum-pulse' },
  { top: '38%', left: '72%', w: 4, delay: '1s', cls: 'animate-firefly-wander' },
  { top: '72%', left: '28%', w: 2, delay: '3s', cls: 'animate-biolum-float' },
  { top: '18%', left: '88%', w: 3, delay: '4s', cls: 'animate-biolum-pulse' },
  { top: '50%', left: '8%', w: 2, delay: '1.5s', cls: 'animate-firefly-wander' },
];

export default function WelcomeExperience({ onComplete }) {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);
  const exitingRef = useRef(false);

  const dismiss = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, 600);
  }, [onComplete]);

  // Auto-dismiss — shorter for reduced-motion users
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(dismiss, reducedMotion ? 2000 : 4000);
    return () => clearTimeout(timer);
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden cursor-pointer
        transition-opacity duration-[600ms] ease-out
        ${exiting ? 'opacity-0' : 'opacity-100'}`}
      onClick={dismiss}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && dismiss()}
      role="button"
      tabIndex={0}
      aria-label="Welcome — tap to continue to your portal"
    >
      {/* L0: Deep jungle gradient (El Yunque canopy) */}
      <div className="absolute inset-0 bg-landing-gradient animate-gradient-shift" />

      {/* L1: Beach warmth — Cabo Rojo golden glow at bottom */}
      <div
        className="absolute inset-0 animate-warm-pulse pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% 90%, rgba(245,183,49,0.1) 0%, transparent 70%)',
        }}
      />

      {/* L2: Ambient light (cloud shadow passing over canopy) */}
      <div
        className="absolute inset-0 animate-ambient-light pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 30% 40%, rgba(26,154,90,0.12) 0%, transparent 60%)',
        }}
      />

      {/* L3: El Yunque mist — dual-layer for depth */}
      <div
        className="absolute inset-0 animate-mist-drift pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 140% 60% at 50% 75%, rgba(253,251,247,0.06) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 animate-mist-drift-reverse pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 100% 40% at 60% 30%, rgba(253,251,247,0.04) 0%, transparent 60%)',
        }}
      />

      {/* L4: Bioluminescent particles (Mosquito Bay, Vieques) */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            className={`absolute rounded-full ${p.cls}`}
            style={{
              top: p.top,
              left: p.left,
              width: p.w,
              height: p.w,
              backgroundColor: 'rgba(38,169,181,0.6)',
              animationDelay: p.delay,
            }}
          />
        ))}
      </div>

      {/* L5: Caribbean wave shimmer at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-20 pointer-events-none">
        <div
          className="absolute inset-0 animate-wave-lap"
          style={{
            background: 'linear-gradient(to top, rgba(38,169,181,0.05) 0%, transparent 100%)',
          }}
        />
        <div
          className="absolute inset-0 animate-wave-lap-slow"
          style={{
            background: 'linear-gradient(to top, rgba(245,183,49,0.04) 0%, transparent 100%)',
          }}
        />
      </div>

      {/* ─── Text reveal ─── */}
      <div className="relative z-10 flex flex-col items-center text-center px-8">
        {/* "Bienvenidos" — rises through the mist */}
        <h1
          className="text-[2.5rem] sm:text-5xl text-cafe-50 tracking-wide animate-fade-in-up"
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            animationDelay: '0.4s',
          }}
        >
          Bienvenidos
        </h1>

        {/* "a Casa Coquí" — follows with warm gold accent */}
        <p
          className="text-lg sm:text-2xl text-cafe-100/90 tracking-[0.2em] mt-1 animate-fade-in-up"
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            animationDelay: '1.1s',
          }}
        >
          a Casa Coqu<span className="text-atardecer-400">&iacute;</span>
        </p>

        {/* Gold shimmer line — expands from center */}
        <div
          className="mt-6 h-px w-20 animate-welcome-line-expand"
          style={{
            background: 'linear-gradient(90deg, transparent, #f5b731, transparent)',
            animationDelay: '1.6s',
          }}
        />
      </div>

      {/* Skip hint */}
      <p
        className="absolute bottom-12 text-[10px] text-cafe-200/40 tracking-[0.25em] uppercase animate-stagger-fade-in"
        style={{ animationDelay: '2.5s' }}
      >
        Tap to continue
      </p>
    </div>
  );
}
