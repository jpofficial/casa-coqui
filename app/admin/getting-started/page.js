'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import usePush from '@/hooks/usePush';
import { ROLES, getDefaultRedirect } from '@/lib/roles';

const ROLE_STEPS = {
  cohost: [
    'View active guest stays and operations on your Dashboard',
    'Manage and complete tasks assigned to you in the Tasks tab',
    'Monitor the community board and calendar for upcoming activity',
  ],
  cleaner: [
    'Your cleaning jobs appear automatically when guests check out',
    'Follow the step-by-step cleaning wizard from start to finish',
    'Take before and after photos to document each cleaning',
  ],
  maintenance: [
    'Guest maintenance requests will appear as tasks assigned to you',
    'Update task status as you work — guests can see your progress',
    'Add completion notes when you finish a repair',
  ],
};

const ROLE_COLORS = {
  cohost: { bg: 'bg-coqui-100', text: 'text-coqui-700' },
  cleaner: { bg: 'bg-atardecer-100', text: 'text-atardecer-800' },
  maintenance: { bg: 'bg-flamboyan-100', text: 'text-flamboyan-800' },
};

export default function GettingStartedPage() {
  const { user, role, displayName, setNeedsOnboarding } = useAuth();
  const { permission, requestPermission, supported: pushSupported } = usePush();
  const router = useRouter();

  const [showIOS, setShowIOS] = useState(false);
  const [showAndroid, setShowAndroid] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);

  const roleConfig = ROLES[role];
  const roleLabel = roleConfig?.label || role;
  const colors = ROLE_COLORS[role] || ROLE_COLORS.cohost;
  const steps = ROLE_STEPS[role] || ROLE_STEPS.cohost;

  async function handleGetStarted() {
    setDismissing(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        onboardingComplete: true,
      });
      setNeedsOnboarding(false);
    } catch (err) {
      console.error('[GettingStarted] Failed to complete onboarding:', err);
      setNeedsOnboarding(false);
    }
    router.replace(getDefaultRedirect(role));
  }

  async function handleEnableNotifications() {
    setNotifLoading(true);
    await requestPermission({ staffId: user?.uid });
    setNotifLoading(false);
  }

  return (
    <div className="min-h-screen bg-cafe-50 p-4 pb-8">
      <div className="max-w-md mx-auto space-y-5 pt-4">

        {/* Welcome Header */}
        <div className="text-center mb-2">
          <div className={`w-14 h-14 rounded-full ${colors.bg} flex items-center justify-center mx-auto mb-4`}>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-7 h-7 ${colors.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h1 className="font-display text-2xl text-coqui-900">
            Welcome, {displayName || 'Team Member'}
          </h1>
          <p className="text-sm text-coqui-800/60 mt-1.5">
            You&apos;ve joined Casa Coqui as a{' '}
            <span className={`inline-block font-semibold px-2 py-0.5 rounded-full text-xs ${colors.bg} ${colors.text}`}>
              {roleLabel}
            </span>
          </p>
        </div>

        {/* Role Overview */}
        <div className="bg-white rounded-xl shadow-brand border border-cafe-100 p-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-3">
            What You&apos;ll Do
          </h2>
          <ul className="space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-coqui-800/80">
                <span className="flex-none w-6 h-6 rounded-full bg-coqui-100 text-coqui-700 text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Install on Phone */}
        <div className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-1">
              Install on Your Phone
            </h2>
            <p className="text-xs text-coqui-800/50">
              Add Casa Coqui to your home screen for quick access
            </p>
          </div>

          {/* iOS */}
          <div className="border-t border-cafe-100">
            <button
              onClick={() => setShowIOS(!showIOS)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left"
            >
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5 text-coqui-800/40" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
                <span className="text-sm font-semibold text-coqui-900">iPhone / iPad</span>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-5 h-5 text-coqui-800/30 transition-transform duration-200 ${showIOS ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showIOS && (
              <div className="px-5 pb-4 space-y-2 text-sm text-coqui-800/70">
                <p>1. Open this page in <strong>Safari</strong></p>
                <p>2. Tap the <strong>Share</strong> button (box with arrow) at the bottom</p>
                <p>3. Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong></p>
                <p>4. Tap <strong>&quot;Add&quot;</strong> in the top-right corner</p>
              </div>
            )}
          </div>

          {/* Android */}
          <div className="border-t border-cafe-100">
            <button
              onClick={() => setShowAndroid(!showAndroid)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left"
            >
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5 text-coqui-800/40" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.523 15.341a.605.605 0 010-.857l2.946-2.946H8.308a.607.607 0 010-1.214h12.161l-2.946-2.946a.605.605 0 01.857-.857l3.983 3.984a.607.607 0 010 .857l-3.983 3.979a.605.605 0 01-.857 0z" />
                  <path d="M1 18.5V5.5C1 4.12 2.12 3 3.5 3h9c1.38 0 2.5 1.12 2.5 2.5v3h-1.2V5.5c0-.72-.58-1.3-1.3-1.3h-9c-.72 0-1.3.58-1.3 1.3v13c0 .72.58 1.3 1.3 1.3h9c.72 0 1.3-.58 1.3-1.3v-3H15v3c0 1.38-1.12 2.5-2.5 2.5h-9C2.12 21 1 19.88 1 18.5z" />
                </svg>
                <span className="text-sm font-semibold text-coqui-900">Android</span>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-5 h-5 text-coqui-800/30 transition-transform duration-200 ${showAndroid ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showAndroid && (
              <div className="px-5 pb-4 space-y-2 text-sm text-coqui-800/70">
                <p>1. Open this page in <strong>Chrome</strong></p>
                <p>2. Tap the <strong>three-dot menu</strong> in the top-right</p>
                <p>3. Tap <strong>&quot;Add to Home Screen&quot;</strong> or <strong>&quot;Install App&quot;</strong></p>
                <p>4. Tap <strong>&quot;Install&quot;</strong> to confirm</p>
              </div>
            )}
          </div>
        </div>

        {/* Push Notifications */}
        {pushSupported && (
          <div className="bg-coqui-50 rounded-xl border border-coqui-100 p-5">
            <h2 className="text-xs font-bold uppercase tracking-widest text-coqui-700 mb-2">
              Stay in the Loop
            </h2>
            <p className="text-sm text-coqui-800/70 mb-4">
              Enable notifications so you never miss a task assignment or update.
            </p>
            {permission === 'granted' ? (
              <div className="flex items-center gap-2 text-sm text-coqui-700 font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Notifications enabled
              </div>
            ) : (
              <button
                onClick={handleEnableNotifications}
                disabled={notifLoading}
                className="w-full bg-coqui-600 hover:bg-coqui-700 active:bg-coqui-800 active:scale-[0.98] disabled:opacity-40 text-white font-semibold rounded-xl px-4 py-3 text-sm transition-all duration-200"
              >
                {notifLoading ? 'Requesting...' : 'Enable Notifications'}
              </button>
            )}
          </div>
        )}

        {/* Get Started Button */}
        <button
          onClick={handleGetStarted}
          disabled={dismissing}
          className="w-full bg-atardecer-400 hover:bg-atardecer-500 active:bg-atardecer-600 active:scale-[0.98] disabled:opacity-40 text-white font-semibold rounded-xl px-4 py-3.5 text-base transition-all duration-200 shadow-sm hover:shadow-md"
        >
          {dismissing ? 'Loading...' : 'Get Started'}
        </button>

      </div>
    </div>
  );
}
