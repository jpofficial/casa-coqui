'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

import { detectPlatform, isStandalone as checkStandalone } from '@/lib/platform';

// ─── Platform detection ──────────────────────────────────────────────────────
function usePlatform() {
  const [platform, setPlatform] = useState('ios');
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const plat = detectPlatform();
    setPlatform(plat === 'android' ? 'android' : 'ios');
    setIsStandalone(checkStandalone());
  }, []);

  return { platform, isStandalone };
}

// ─── Video demo section ─────────────────────────────────────────────────────
function InstallVideoSection() {
  const [videoError, setVideoError] = useState(false);

  if (videoError) return null;

  return (
    <div className="mb-8">
      <div className="rounded-2xl overflow-hidden bg-gray-100 shadow-sm border border-gray-200">
        <video
          src="/videos/save-home.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setVideoError(true)}
          className="w-full h-auto"
        />
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">
        Step-by-step details below
      </p>
    </div>
  );
}

// ─── Phone frame wrapper ─────────────────────────────────────────────────────
function PhoneFrame({ children }) {
  return (
    <div className="mx-auto w-56 rounded-[2rem] border-[3px] border-gray-800 bg-gray-900 p-1.5 shadow-xl">
      {/* Notch */}
      <div className="mx-auto mb-1 h-5 w-24 rounded-b-xl bg-gray-800" />
      {/* Screen */}
      <div className="rounded-[1.25rem] bg-white overflow-hidden">
        {children}
      </div>
      {/* Home indicator */}
      <div className="mx-auto mt-1.5 h-1 w-16 rounded-full bg-gray-600" />
    </div>
  );
}

// ─── Safari share sheet mockup ───────────────────────────────────────────────
function SafariShareStep() {
  return (
    <PhoneFrame>
      {/* Safari URL bar */}
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-2 border-b border-gray-200">
        <div className="flex-1 bg-white rounded-lg px-2 py-1 text-[9px] text-gray-400 border border-gray-200 truncate">
          casacoqui.com/g/abc123
        </div>
        {/* Share button highlighted */}
        <div className="relative">
          <div className="absolute -inset-1.5 bg-green-100 rounded-lg animate-pulse" />
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-blue-500 relative">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H16.5m-3-3v9m0-9l3 3m-3-3l-3 3" />
          </svg>
        </div>
      </div>
      {/* Page content preview */}
      <div className="p-3 h-28 flex flex-col items-center justify-center gap-1.5">
        <img src="/icons/icon-192x192.png" alt="Casa Coqui" className="w-10 h-10 rounded-lg" />
        <span className="text-[10px] font-semibold text-gray-900">Casa Coqui</span>
        <span className="text-[8px] text-gray-400">Your guest portal</span>
      </div>
    </PhoneFrame>
  );
}

// ─── iOS "Add to Home Screen" option mockup ──────────────────────────────────
function SafariAddToHomeStep() {
  return (
    <PhoneFrame>
      {/* Share sheet */}
      <div className="h-16 bg-gray-50 flex items-end px-3 pb-1">
        <span className="text-[8px] text-gray-400">Share options</span>
      </div>
      <div className="bg-white border-t border-gray-200">
        <ShareRow icon="copy" label="Copy" />
        <ShareRow icon="bookmark" label="Add Bookmark" />
        <div className="relative">
          <div className="absolute inset-0 bg-green-50 border border-green-300 rounded-lg mx-1" />
          <ShareRow icon="add-home" label="Add to Home Screen" highlighted />
        </div>
        <ShareRow icon="print" label="Print" />
      </div>
    </PhoneFrame>
  );
}

// ─── iOS confirmation dialog mockup ──────────────────────────────────────────
function SafariConfirmStep() {
  return (
    <PhoneFrame>
      <div className="p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <button className="text-[10px] text-blue-500">Cancel</button>
          <span className="text-[10px] font-semibold text-gray-900">Add to Home Screen</span>
          <div className="relative">
            <div className="absolute -inset-1 bg-green-100 rounded-md animate-pulse" />
            <span className="text-[10px] font-semibold text-blue-500 relative">Add</span>
          </div>
        </div>
        {/* Preview */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5 mb-3">
          <img src="/icons/icon-192x192.png" alt="Casa Coqui" className="w-10 h-10 rounded-xl" />
          <div>
            <p className="text-[10px] font-semibold text-gray-900">Casa Coqui</p>
            <p className="text-[8px] text-gray-400">casacoqui.com</p>
          </div>
        </div>
      </div>
      {/* Home screen preview */}
      <div className="bg-gradient-to-b from-gray-100 to-gray-200 px-4 py-3 flex flex-col items-center gap-1">
        <img src="/icons/icon-192x192.png" alt="Casa Coqui" className="w-11 h-11 rounded-xl shadow-sm" />
        <span className="text-[8px] font-medium text-gray-700">Casa Coqui</span>
      </div>
    </PhoneFrame>
  );
}

// ─── Share row helper ────────────────────────────────────────────────────────
function ShareRow({ icon, label, highlighted }) {
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2.5 relative ${highlighted ? 'z-10' : ''}`}>
      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${highlighted ? 'bg-green-500' : 'bg-gray-200'}`}>
        {icon === 'add-home' && (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke={highlighted ? 'white' : 'currentColor'} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        )}
        {icon === 'copy' && (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3 text-gray-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75" />
          </svg>
        )}
        {icon === 'bookmark' && (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3 text-gray-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
          </svg>
        )}
        {icon === 'print' && (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3 text-gray-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18" />
          </svg>
        )}
      </div>
      <span className={`text-[10px] ${highlighted ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</span>
    </div>
  );
}

// ─── Chrome menu mockup ──────────────────────────────────────────────────────
function ChromeMenuStep() {
  return (
    <PhoneFrame>
      {/* Chrome URL bar */}
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-2 border-b border-gray-200">
        <div className="flex-1 bg-white rounded-full px-2 py-1 text-[9px] text-gray-400 border border-gray-200 truncate">
          casacoqui.com/g/abc123
        </div>
        <div className="relative">
          <div className="absolute -inset-1.5 bg-green-100 rounded-lg animate-pulse" />
          <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="w-4 h-4 text-gray-600 relative">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </div>
      </div>
      {/* Page content */}
      <div className="p-3 h-28 flex flex-col items-center justify-center gap-1.5">
        <img src="/icons/icon-192x192.png" alt="Casa Coqui" className="w-10 h-10 rounded-lg" />
        <span className="text-[10px] font-semibold text-gray-900">Casa Coqui</span>
        <span className="text-[8px] text-gray-400">Your guest portal</span>
      </div>
    </PhoneFrame>
  );
}

// ─── Chrome "Install app" option mockup ──────────────────────────────────────
function ChromeInstallStep() {
  return (
    <PhoneFrame>
      {/* Dropdown menu */}
      <div className="h-8 bg-gray-100" />
      <div className="mx-2 bg-white rounded-lg shadow-lg border border-gray-200">
        <ChromeMenuItem label="New tab" />
        <ChromeMenuItem label="New incognito tab" />
        <div className="border-t border-gray-100" />
        <ChromeMenuItem label="Bookmarks" />
        <ChromeMenuItem label="History" />
        <div className="border-t border-gray-100" />
        <div className="relative">
          <div className="absolute inset-0 bg-green-50 border border-green-300 rounded mx-0.5" />
          <ChromeMenuItem label="Install app" highlighted />
        </div>
        <ChromeMenuItem label="Add to Home screen" />
        <div className="border-t border-gray-100" />
        <ChromeMenuItem label="Settings" />
      </div>
    </PhoneFrame>
  );
}

// ─── Chrome confirm dialog mockup ────────────────────────────────────────────
function ChromeConfirmStep() {
  return (
    <PhoneFrame>
      <div className="h-24 bg-gray-100" />
      {/* Install dialog */}
      <div className="mx-3 bg-white rounded-xl shadow-xl border border-gray-200 p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <img src="/icons/icon-192x192.png" alt="Casa Coqui" className="w-10 h-10 rounded-xl" />
          <div>
            <p className="text-[10px] font-semibold text-gray-900">Install Casa Coqui?</p>
            <p className="text-[8px] text-gray-400">casacoqui.com</p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <span className="text-[10px] text-gray-500">Cancel</span>
          <div className="relative">
            <div className="absolute -inset-1 bg-green-100 rounded-md animate-pulse" />
            <span className="text-[10px] font-bold text-blue-600 relative">Install</span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

// ─── Chrome menu item helper ─────────────────────────────────────────────────
function ChromeMenuItem({ label, highlighted }) {
  return (
    <div className={`px-3 py-2 relative ${highlighted ? 'z-10' : ''}`}>
      <span className={`text-[10px] ${highlighted ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</span>
    </div>
  );
}

// ─── Step card ───────────────────────────────────────────────────────────────
function StepCard({ number, title, description, children }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center flex-shrink-0 text-sm font-bold">
          {number}
        </div>
        <div className="flex-1 pt-1">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
      {children && (
        <div className="flex justify-center">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function InstallGuidePage({ params }) {
  const code = params.code;
  const { platform, isStandalone } = usePlatform();
  const [activeTab, setActiveTab] = useState(null);

  useEffect(() => {
    setActiveTab(platform);
    localStorage.setItem(`install_guide_seen_${code}`, '1');
  }, [platform, code]);

  if (isStandalone) {
    return (
      <div className="px-4 py-12 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 text-green-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">You&apos;re already using the app!</h1>
        <p className="text-sm text-gray-500">
          Casa Coqui is installed and ready to go.
        </p>
        <Link
          href={`/g/${code}`}
          className="inline-block mt-6 px-6 py-3 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition"
        >
          Back to Portal
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/g/${code}`}
          className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Install Casa Coqui</h1>
          <p className="text-xs text-gray-500">Get the full app experience in 3 easy steps</p>
        </div>
      </div>

      {/* Video demo */}
      <InstallVideoSection />

      {/* Platform toggle */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-8">
        <button
          onClick={() => setActiveTab('ios')}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'ios'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          iPhone / iPad
        </button>
        <button
          onClick={() => setActiveTab('android')}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'android'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Android
        </button>
      </div>

      {/* iOS Steps */}
      {activeTab === 'ios' && (
        <div className="flex flex-col gap-8">
          <StepCard
            number={1}
            title="Tap the Share button"
            description="Look for the square with an arrow at the bottom of Safari."
          >
            <SafariShareStep />
          </StepCard>

          <StepCard
            number={2}
            title='Scroll down and tap "Add to Home Screen"'
            description="You may need to scroll down in the share menu to see it."
          >
            <SafariAddToHomeStep />
          </StepCard>

          <StepCard
            number={3}
            title='Tap "Add" in the top right'
            description="Casa Coqui will appear on your home screen with this icon."
          >
            <SafariConfirmStep />
          </StepCard>
        </div>
      )}

      {/* Android Steps */}
      {activeTab === 'android' && (
        <div className="flex flex-col gap-8">
          <StepCard
            number={1}
            title="Tap the three-dot menu"
            description="In the top-right corner of Chrome."
          >
            <ChromeMenuStep />
          </StepCard>

          <StepCard
            number={2}
            title='Tap "Install app"'
            description='You may also see "Add to Home screen" — either works.'
          >
            <ChromeInstallStep />
          </StepCard>

          <StepCard
            number={3}
            title='Tap "Install" to confirm'
            description="Casa Coqui will appear on your home screen with this icon."
          >
            <ChromeConfirmStep />
          </StepCard>
        </div>
      )}

      {/* Result preview */}
      <div className="mt-8 bg-green-50 border border-green-200 rounded-xl p-4 text-center">
        <p className="text-xs text-green-700 font-medium mb-3">When done, you&apos;ll see this on your home screen:</p>
        <div className="inline-flex flex-col items-center gap-1.5">
          <img src="/icons/icon-192x192.png" alt="Casa Coqui" className="w-14 h-14 rounded-2xl shadow-md" />
          <span className="text-[11px] font-medium text-gray-700">Casa Coqui</span>
        </div>
      </div>

      {/* Back button */}
      <div className="mt-6">
        <Link
          href={`/g/${code}`}
          className="block w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm text-center hover:bg-green-700 transition"
        >
          Back to Portal
        </Link>
      </div>
    </div>
  );
}
