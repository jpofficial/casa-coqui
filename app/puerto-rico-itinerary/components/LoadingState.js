'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

const PHRASES = [
  'Crafting your San Juan itinerary…',
  'Pairing activities to your taste…',
  'Considering neighborhood walks…',
  'Adding a little local magic…',
  'Almost there — checking everything…',
];

// Tiny coqui frog SVG — simplified silhouette, ~24x24 viewport
function CoquiSVG({ className }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Body */}
      <ellipse cx="24" cy="28" rx="13" ry="10" fill="currentColor" />
      {/* Head */}
      <ellipse cx="24" cy="17" rx="9" ry="8" fill="currentColor" />
      {/* Left eye dome */}
      <ellipse cx="19" cy="13" rx="4" ry="4" fill="currentColor" />
      {/* Right eye dome */}
      <ellipse cx="29" cy="13" rx="4" ry="4" fill="currentColor" />
      {/* Eye shine left */}
      <circle cx="20" cy="12" r="1.5" fill="white" opacity="0.7" />
      {/* Eye shine right */}
      <circle cx="30" cy="12" r="1.5" fill="white" opacity="0.7" />
      {/* Front left leg */}
      <path d="M13 31 Q8 35 5 38" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* Front right leg */}
      <path d="M35 31 Q40 35 43 38" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* Hind left leg */}
      <path d="M14 34 Q9 40 6 44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Hind right leg */}
      <path d="M34 34 Q39 40 42 44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default function LoadingState() {
  const prefersReduced = useReducedMotion();
  const [phraseIndex, setPhraseIndex] = useState(0);

  // Rotate copy every 1.8 s
  useEffect(() => {
    const id = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % PHRASES.length);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  // ----------------------------------------------------------------
  // When reduced-motion is on: everything is static — simple fade in.
  // ----------------------------------------------------------------
  if (prefersReduced) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-cafe-50 px-6 text-center">
        <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-atardecer-100 text-atardecer-600">
          <CoquiSVG className="h-12 w-12" />
        </div>
        <h2 className="mb-3 font-display text-2xl font-bold text-coqui-900">
          {PHRASES[phraseIndex]}
        </h2>
        <p className="text-sm text-cafe-700">Your Puerto Rico adventure is being crafted.</p>
        <div className="mt-6 h-1 w-48 overflow-hidden rounded-full bg-atardecer-100">
          <div className="h-full w-1/3 rounded-full bg-atardecer-400" />
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------
  // Full kinetic version
  // ----------------------------------------------------------------
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-cafe-50 px-6 text-center">

      {/* ── Breathing background gradient ────────────────────────────
          Two overlapping radial blobs that pulse in / out slowly,
          creating warm atardecer depth without overwhelming the white bg. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2 }}
      >
        {/* Primary warm blob — centre */}
        <motion.div
          className="absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(248,203,92,0.22) 0%, rgba(245,183,49,0.10) 45%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.18, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Secondary cooler blob — upper-left offset */}
        <motion.div
          className="absolute -left-16 -top-16 h-[340px] w-[340px] rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(38,169,181,0.12) 0%, transparent 65%)',
          }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />
        {/* Tertiary warm bloom — lower-right */}
        <motion.div
          className="absolute -bottom-12 -right-12 h-[280px] w-[280px] rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(233,160,14,0.14) 0%, transparent 60%)',
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 2.5 }}
        />
      </motion.div>

      {/* ── Content wrapper ───────────────────────────────────────── */}
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center">

        {/* ── Coqui frog with glow orbit ───────────────────────────── */}
        <div className="relative mb-8 flex h-24 w-24 items-center justify-center">
          {/* Outer glow ring */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(245,183,49,0.35) 0%, transparent 70%)',
            }}
            animate={{ scale: [1, 1.35, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Orbiting dot */}
          <motion.div
            className="absolute h-3 w-3"
            animate={{ rotate: 360 }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: '50% 50%' }}
          >
            <span
              className="absolute -top-10 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full bg-atardecer-400 shadow-sm"
              style={{ boxShadow: '0 0 8px 2px rgba(245,183,49,0.6)' }}
            />
          </motion.div>

          {/* Frog pill */}
          <motion.div
            className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-brand-md"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <CoquiSVG className="h-11 w-11 text-coqui-600" />
          </motion.div>
        </div>

        {/* ── Rotating copy phrases ────────────────────────────────── */}
        <div className="mb-2 h-16 w-full overflow-hidden flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.h2
              key={phraseIndex}
              className="font-display text-xl font-bold leading-snug text-coqui-900 sm:text-2xl"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
            >
              {PHRASES[phraseIndex]}
            </motion.h2>
          </AnimatePresence>
        </div>

        {/* ── Supporting copy ──────────────────────────────────────── */}
        <motion.p
          className="mb-8 text-sm text-cafe-700"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
        >
          Your Puerto Rico adventure is being crafted.
        </motion.p>

        {/* ── Shimmer progress hint ────────────────────────────────── */}
        <motion.div
          className="w-56 overflow-hidden rounded-full bg-atardecer-100"
          style={{ height: '3px' }}
          initial={{ opacity: 0, scaleX: 0.6 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.7, duration: 0.6 }}
        >
          <motion.div
            className="h-full rounded-full"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, #f5b731 40%, #f8cb5c 55%, transparent 100%)',
              width: '60%',
            }}
            animate={{ x: ['-100%', '260%'] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
              repeatDelay: 0.4,
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}
