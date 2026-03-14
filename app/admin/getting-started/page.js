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

  const [showSafari, setShowSafari] = useState(false);
  const [showChrome, setShowChrome] = useState(false);
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

          {/* Safari */}
          <div className="border-t border-cafe-100">
            <button
              onClick={() => setShowSafari(!showSafari)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-coqui-900">Safari</span>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-5 h-5 text-coqui-800/30 transition-transform duration-200 ${showSafari ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showSafari && (
              <div className="px-5 pb-5 space-y-4">
                {/* Step 1 */}
                <div className="flex gap-3">
                  <span className="flex-none w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                  <div>
                    <p className="text-sm text-coqui-800/80 leading-relaxed">
                      Tap the <strong>Share</strong> button at the bottom of the screen
                    </p>
                    <div className="mt-2 inline-flex items-center gap-1.5 bg-gray-100 rounded-lg px-3 py-2">
                      <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M12 3v9m0-9l-3 3m3-3l3 3" />
                      </svg>
                      <span className="text-xs text-gray-500 font-medium">Share</span>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-3">
                  <span className="flex-none w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                  <div>
                    <p className="text-sm text-coqui-800/80 leading-relaxed">
                      Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong>
                    </p>
                    <div className="mt-2 inline-flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      <span className="text-xs text-gray-600 font-medium">Add to Home Screen</span>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-3">
                  <span className="flex-none w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                  <div>
                    <p className="text-sm text-coqui-800/80 leading-relaxed">
                      Tap <strong>&quot;Add&quot;</strong> in the top-right corner to confirm
                    </p>
                    <div className="mt-2 inline-flex items-center bg-blue-500 rounded-lg px-3.5 py-1.5">
                      <span className="text-xs text-white font-semibold">Add</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Chrome */}
          <div className="border-t border-cafe-100">
            <button
              onClick={() => setShowChrome(!showChrome)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" opacity="0.2" />
                    <circle cx="12" cy="12" r="4" />
                    <path d="M21.17 8H12M3.95 6.06L8.54 14M9.47 20.06L14.06 12" strokeWidth="2" stroke="currentColor" fill="none" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-coqui-900">Chrome</span>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-5 h-5 text-coqui-800/30 transition-transform duration-200 ${showChrome ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showChrome && (
              <div className="px-5 pb-5 space-y-4">
                {/* Step 1 */}
                <div className="flex gap-3">
                  <span className="flex-none w-6 h-6 rounded-full bg-amber-100 text-amber-600 text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                  <div>
                    <p className="text-sm text-coqui-800/80 leading-relaxed">
                      Tap the <strong>More</strong> menu button
                    </p>
                    <div className="mt-2 inline-flex items-center gap-1.5 bg-gray-100 rounded-lg px-3 py-2">
                      <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                      <span className="text-xs text-gray-500 font-medium">More</span>
                    </div>
                    <p className="text-xs text-coqui-800/40 mt-1.5">
                      Three dots at the top-right (Android) or bottom-right (iPhone)
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-3">
                  <span className="flex-none w-6 h-6 rounded-full bg-amber-100 text-amber-600 text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                  <div>
                    <p className="text-sm text-coqui-800/80 leading-relaxed">
                      Tap <strong>&quot;Add to Home Screen&quot;</strong>
                    </p>
                    <div className="mt-2 inline-flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 0v2m0-2h2m-2 0h-2" />
                      </svg>
                      <span className="text-xs text-gray-600 font-medium">Add to Home Screen</span>
                    </div>
                    <p className="text-xs text-coqui-800/40 mt-1.5">
                      On Android, this may say <strong>&quot;Install App&quot;</strong> instead
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-3">
                  <span className="flex-none w-6 h-6 rounded-full bg-amber-100 text-amber-600 text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                  <div>
                    <p className="text-sm text-coqui-800/80 leading-relaxed">
                      Tap <strong>&quot;Add&quot;</strong> or <strong>&quot;Install&quot;</strong> to confirm
                    </p>
                    <div className="mt-2 inline-flex items-center bg-blue-500 rounded-lg px-3.5 py-1.5">
                      <span className="text-xs text-white font-semibold">Add</span>
                    </div>
                  </div>
                </div>
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
