'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCollection } from '@/hooks/useFirestore';
import { where } from 'firebase/firestore';
import useAuth from '@/hooks/useAuth';
import InviteForm from '@/components/guest/InviteForm';

// ─── Platform detection ──────────────────────────────────────────────────────
function usePlatform() {
  const [platform, setPlatform] = useState('other');
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) {
      setPlatform('ios');
    } else if (/Android/.test(ua)) {
      setPlatform('android');
    }

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone === true;
    setIsStandalone(standalone);
  }, []);

  return { platform, isStandalone };
}

// ─── Feature cards ───────────────────────────────────────────────────────────
const features = [
  {
    title: 'Parking Alerts',
    description: 'Get notified instantly if someone parks in your spot',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
      </svg>
    ),
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    title: 'Laundry Status',
    description: 'Check washer & dryer availability in real time',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    ),
    color: 'text-teal-600',
    bg: 'bg-teal-50',
  },
  {
    title: 'Host Messages',
    description: 'Important updates delivered straight to you',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  {
    title: 'Community Board',
    description: 'Post updates for other guests to see',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
      </svg>
    ),
    color: 'text-rose-600',
    bg: 'bg-rose-50',
  },
];

// ─── iOS install steps ───────────────────────────────────────────────────────
function IOSInstallGuide({ code }) {
  return (
    <div className="flex flex-col gap-3">
      <Step number={1} title="Tap the Share button" description="At the bottom of Safari (the square with the arrow)" />
      <Step number={2} title='Tap "Add to Home Screen"' description="Scroll down in the share menu to find it" />
      <Step number={3} title='Tap "Add"' description="Casa Coqui will appear on your home screen" />
      <a
        href={`/g/${code}/install-guide`}
        className="text-xs text-green-600 font-medium mt-1 inline-flex items-center gap-1"
      >
        Need help? See step-by-step guide
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>
    </div>
  );
}

// ─── Android install steps ───────────────────────────────────────────────────
function AndroidInstallGuide({ onInstallClick, canInstall, code }) {
  if (canInstall) {
    return (
      <div className="flex flex-col gap-3">
        <button
          onClick={onInstallClick}
          className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm
            hover:bg-green-700 active:bg-green-800 transition"
        >
          Install App
        </button>
        <p className="text-xs text-gray-400 text-center">
          No app store needed — installs instantly
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Step number={1} title="Tap the menu button" description='The three dots ( &#8942; ) in the top-right of Chrome' />
      <Step number={2} title='"Install app" or "Add to Home Screen"' description="Select it from the dropdown menu" />
      <Step number={3} title='Tap "Install"' description="Casa Coqui will appear on your home screen" />
      <a
        href={`/g/${code}/install-guide`}
        className="text-xs text-green-600 font-medium mt-1 inline-flex items-center gap-1"
      >
        Need help? See step-by-step guide
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>
    </div>
  );
}

// ─── Step component ──────────────────────────────────────────────────────────
function Step({ number, title, description }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0 text-xs font-bold">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function GetStartedPage({ params }) {
  const code = params.code;
  const router = useRouter();
  const { user } = useAuth();
  const { platform, isStandalone } = usePlatform();

  // Track Android beforeinstallprompt
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    function handleBeforeInstall(e) {
      e.preventDefault();
      setInstallPrompt(e);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  async function handleInstallClick() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  // Check if current user is primary guest
  const { data: members } = useCollection('booking_members', [
    where('bookingCode', '==', code),
  ]);

  const isPrimary = members.some(
    (m) => m.role === 'primary' && m.uid === user?.uid
  );

  // Invite sent feedback
  const [inviteSent, setInviteSent] = useState(false);

  function handleContinue() {
    localStorage.setItem(`getstarted_seen_${code}`, '1');
    router.push(`/g/${code}`);
  }

  return (
    <div className="px-4 py-8 flex flex-col gap-8">
      {/* Header */}
      <section className="text-center">
        <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-8 h-8 text-green-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">You&apos;re all set!</h1>
        <p className="text-sm text-gray-500 mt-1">
          Just a couple of things to make your stay even better.
        </p>
      </section>

      {/* Invite section — primary guests only */}
      {isPrimary && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center text-cyan-600">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Traveling with others?</h2>
              <p className="text-xs text-gray-500">Give them their own portal access</p>
            </div>
          </div>

          {inviteSent && (
            <div className="mb-3 bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
              Invite sent! They&apos;ll receive an email with their access link.
            </div>
          )}

          <InviteForm code={code} onSent={() => setInviteSent(true)} />

          <p className="text-xs text-gray-400 mt-2 text-center">
            You can always do this later from the portal home.
          </p>
        </section>
      )}

      {/* PWA install section */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add to your home screen</h2>
            <p className="text-xs text-gray-500">One tap, no app store, no storage used</p>
          </div>
        </div>

        {/* Loss-aversion pitch */}
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
          <p className="text-sm text-amber-900 font-medium">
            Don&apos;t miss parking alerts or host messages
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            Installing the app enables push notifications so you&apos;ll never miss an important update during your stay.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {features.map((feat) => (
            <div key={feat.title} className="bg-white rounded-xl border border-gray-100 p-3 flex flex-col gap-1.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${feat.bg} ${feat.color}`}>
                {feat.icon}
              </div>
              <p className="text-xs font-semibold text-gray-900">{feat.title}</p>
              <p className="text-[11px] text-gray-500 leading-snug">{feat.description}</p>
            </div>
          ))}
        </div>

        {/* Platform-specific install guide */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          {isStandalone ? (
            <div className="flex items-center gap-3 text-green-700">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold">You&apos;re already using the app!</p>
                <p className="text-xs text-green-600 mt-0.5">Push notifications are ready to go.</p>
              </div>
            </div>
          ) : platform === 'ios' ? (
            <>
              <p className="text-sm font-semibold text-gray-900 mb-3">How to install on iPhone</p>
              <IOSInstallGuide code={code} />
            </>
          ) : platform === 'android' ? (
            <>
              <p className="text-sm font-semibold text-gray-900 mb-3">How to install on Android</p>
              <AndroidInstallGuide onInstallClick={handleInstallClick} canInstall={!!installPrompt} code={code} />
            </>
          ) : (
            <div className="text-center py-2">
              <p className="text-sm text-gray-600">
                For the best experience, open this page on your phone and add it to your home screen.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Continue button */}
      <section className="flex flex-col gap-2">
        <button
          onClick={handleContinue}
          className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm
            hover:bg-green-700 active:bg-green-800 transition"
        >
          Continue to Your Portal
        </button>
        <button
          onClick={handleContinue}
          className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition"
        >
          I&apos;ll set this up later
        </button>
      </section>
    </div>
  );
}
