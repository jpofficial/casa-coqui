'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { where } from 'firebase/firestore';
import { auth as firebaseAuth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import usePush from '@/hooks/usePush';
import { useCollection } from '@/hooks/useFirestore';
import InviteForm from '@/components/guest/InviteForm';
import PushPermissionExplainer from '@/components/guest/PushPermissionExplainer';
import { detectPlatform, isStandalone as checkStandalone, isPushCapable } from '@/lib/platform';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// ─── Shared primitives ────────────────────────────────────────────────────────

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

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}

// ─── Progress dots ────────────────────────────────────────────────────────────

function ProgressDots({ total, current }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={[
            'rounded-full transition-all duration-300',
            i < current
              ? 'w-2 h-2 bg-green-600'
              : i === current
                ? 'w-3 h-3 bg-green-600 ring-2 ring-green-200'
                : 'w-2 h-2 bg-gray-200',
          ].join(' ')}
          aria-hidden="true"
        />
      ))}
      <span className="sr-only">
        Step {current + 1} of {total}
      </span>
    </div>
  );
}

// ─── Step header ─────────────────────────────────────────────────────────────

function StepHeader({ icon, heading, subtext }) {
  return (
    <div className="text-center mb-6">
      {icon && (
        <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          {icon}
        </div>
      )}
      <h1 className="text-xl font-bold text-gray-900">{heading}</h1>
      {subtext && (
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{subtext}</p>
      )}
    </div>
  );
}

// ─── Step actions ─────────────────────────────────────────────────────────────

function StepActions({ onNext, onSkip, nextLabel, skipLabel, nextDisabled = false, nextLoading = false, savingLabel = 'Saving...' }) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <button
        onClick={onNext}
        disabled={nextDisabled || nextLoading}
        className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm
          hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {nextLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            {savingLabel}
          </span>
        ) : nextLabel}
      </button>
      {onSkip && (
        <button
          onClick={onSkip}
          className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition"
        >
          {skipLabel}
        </button>
      )}
    </div>
  );
}

// ─── Install guide sub-components ─────────────────────────────────────────────

function InstallStep({ number, title, description }) {
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

function IOSInstallGuide({ code, locale }) {
  return (
    <div className="flex flex-col gap-3">
      <InstallStep
        number={1}
        title={t(locale, 'iosStep1Title')}
        description={t(locale, 'iosStep1Desc')}
      />
      <InstallStep
        number={2}
        title={t(locale, 'iosStep2Title')}
        description={t(locale, 'iosStep2Desc')}
      />
      <InstallStep
        number={3}
        title={t(locale, 'iosStep3Title')}
        description={t(locale, 'iosStep3Desc')}
      />
      <a
        href={`/g/${code}/install-guide`}
        className="text-xs text-green-600 font-medium mt-1 inline-flex items-center gap-1"
      >
        {t(locale, 'needHelpGuide')}
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>
    </div>
  );
}

function AndroidInstallGuide({ onInstallClick, canInstall, code, locale }) {
  if (canInstall) {
    return (
      <div className="flex flex-col gap-3">
        <button
          onClick={onInstallClick}
          className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm
            hover:bg-green-700 active:bg-green-800 transition"
        >
          {t(locale, 'installApp')}
        </button>
        <p className="text-xs text-gray-400 text-center">
          {t(locale, 'noAppStore')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <InstallStep
        number={1}
        title={t(locale, 'androidMenuTitle')}
        description={t(locale, 'androidMenuDesc')}
      />
      <InstallStep
        number={2}
        title={t(locale, 'androidAddTitle')}
        description={t(locale, 'androidAddDesc')}
      />
      <InstallStep
        number={3}
        title={t(locale, 'androidTapTitle')}
        description={t(locale, 'androidTapDesc')}
      />
      <a
        href={`/g/${code}/install-guide`}
        className="text-xs text-green-600 font-medium mt-1 inline-flex items-center gap-1"
      >
        {t(locale, 'needHelpGuide')}
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>
    </div>
  );
}

// ─── Step 1: Parking / Vehicle ─────────────────────────────────────────────────

function ParkingStep({ locale, onNext, onSkip }) {
  const [hasVehicle, setHasVehicle] = useState('');
  const [vehicle, setVehicle] = useState({ make: '', model: '', color: '', plate: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const vehicleOptions = [
    { value: 'yes', label: t(locale, 'yes') },
    { value: 'no', label: t(locale, 'no') },
    { value: 'unsure', label: t(locale, 'notSureYet') },
  ];

  function setVehicleField(field, value) {
    setVehicle((prev) => ({ ...prev, [field]: value }));
  }

  async function handleNext() {
    setSaving(true);
    setSaveError('');
    try {
      const token = await firebaseAuth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const body = { hasVehicle: hasVehicle || 'unsure' };
      if (hasVehicle === 'yes') {
        body.vehicle = {
          make: vehicle.make.trim() || null,
          model: vehicle.model.trim() || null,
          color: vehicle.color.trim() || null,
          plate: vehicle.plate.trim() || null,
        };
      }

      const res = await fetch('/api/guests/vehicle', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setSaveError(json.error || 'Could not save vehicle info.');
        return;
      }
      onNext();
    } catch (err) {
      console.error('[Setup/ParkingStep] Save error:', err);
      setSaveError('Something went wrong. You can update this later from the Parking page.');
      // Still allow advancing
      onNext();
    } finally {
      setSaving(false);
    }
  }

  const canAdvance = hasVehicle !== '';
  const needsVehicleDetails = hasVehicle === 'yes';
  const vehicleDetailsComplete = !needsVehicleDetails || (vehicle.make.trim() && vehicle.model.trim() && vehicle.color.trim());

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-7 h-7 text-green-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
          </svg>
        }
        heading={t(locale, 'carQuestion')}
        subtext={t(locale, 'carSubtext')}
      />

      {/* Radio cards */}
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Vehicle option">
        {vehicleOptions.map(({ value, label }) => {
          const selected = hasVehicle === value;
          return (
            <label
              key={value}
              className={[
                'relative flex items-center justify-center rounded-xl border p-3.5 cursor-pointer transition select-none',
                selected
                  ? 'border-green-600 bg-green-50 ring-2 ring-green-600'
                  : 'border-gray-200 bg-white hover:border-gray-300',
              ].join(' ')}
            >
              <input
                type="radio"
                name="hasVehicle"
                value={value}
                checked={selected}
                onChange={() => setHasVehicle(value)}
                className="sr-only"
              />
              <span
                className={[
                  'text-sm font-medium text-center leading-snug',
                  selected ? 'text-green-800' : value === 'unsure' ? 'text-gray-400 italic' : 'text-gray-800',
                ].join(' ')}
              >
                {label}
              </span>
            </label>
          );
        })}
      </div>

      {/* Vehicle detail fields — expand when "Yes" is selected */}
      <div
        className={`overflow-hidden transition-all duration-300 ${needsVehicleDetails ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
        aria-hidden={!needsVehicleDetails}
      >
        <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-3 border border-gray-100">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t(locale, 'vehicleDetails')}</p>
          <Field label={t(locale, 'make')}>
            <Input
              type="text"
              placeholder="e.g., Toyota"
              value={vehicle.make}
              onChange={(e) => setVehicleField('make', e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label={t(locale, 'model')}>
            <Input
              type="text"
              placeholder="e.g., Camry"
              value={vehicle.model}
              onChange={(e) => setVehicleField('model', e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label={t(locale, 'color')}>
            <Input
              type="text"
              placeholder="e.g., Silver"
              value={vehicle.color}
              onChange={(e) => setVehicleField('color', e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label={t(locale, 'licensePlate')}>
            <Input
              type="text"
              placeholder={t(locale, 'plateHint')}
              value={vehicle.plate}
              onChange={(e) => setVehicleField('plate', e.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>
      </div>

      {saveError && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-4 py-3 border border-amber-100">
          {saveError}
        </p>
      )}

      <p className="text-xs text-gray-400 text-center -mt-1">
        {t(locale, 'updateFromParking')}
      </p>

      <StepActions
        onNext={handleNext}
        onSkip={onSkip}
        nextLabel={t(locale, 'next')}
        skipLabel={t(locale, 'skip')}
        savingLabel={t(locale, 'saving')}
        nextDisabled={!canAdvance || (needsVehicleDetails && !vehicleDetailsComplete)}
        nextLoading={saving}
      />
    </div>
  );
}

// ─── Step 2: Invite Group ─────────────────────────────────────────────────────

function InviteStep({ locale, code, onNext, onSkip }) {
  const [inviteSent, setInviteSent] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-7 h-7 text-green-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
          </svg>
        }
        heading={t(locale, 'travelingWithOthers')}
        subtext={t(locale, 'inviteSubtext')}
      />

      {/* Benefits list */}
      <div className="bg-green-50 border border-green-100 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium text-green-900">{t(locale, 'eachPersonGets')}</p>
        <ul className="text-xs text-green-800 space-y-1.5">
          <li className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {t(locale, 'benefitLaundry')}
          </li>
          <li className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {t(locale, 'benefitAlerts')}
          </li>
          <li className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {t(locale, 'benefitAccess')}
          </li>
        </ul>
      </div>

      {inviteSent && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
          {t(locale, 'inviteSentMsg')}
        </div>
      )}

      <InviteForm code={code} onSent={() => setInviteSent(true)} />

      <p className="text-xs text-gray-400 text-center -mt-1">
        {t(locale, 'inviteLater')}
      </p>

      <StepActions
        onNext={onNext}
        onSkip={onSkip}
        nextLabel={t(locale, 'next')}
        skipLabel={t(locale, 'skipForNow')}
      />
    </div>
  );
}

// ─── Step 3: Save to Phone (PWA install) ──────────────────────────────────────

function InstallVideo({ label }) {
  const [videoError, setVideoError] = useState(false);

  if (videoError) return null;

  return (
    <div className="flex flex-col items-center">
      {label && (
        <p className="text-xs font-medium text-gray-500 mb-2">{label}</p>
      )}
      <div className="w-48 rounded-[1.75rem] overflow-hidden border-[3px] border-gray-800 bg-gray-900 shadow-xl">
        <video
          src="/videos/save-home.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setVideoError(true)}
          className="w-full h-auto rounded-[1.5rem]"
        />
      </div>
    </div>
  );
}

function InstallStep_({ locale, code, platform, onNext, onSkip }) {
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    function handleBeforeInstall(e) {
      e.preventDefault();
      setInstallPrompt(e);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  async function handleAndroidInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  const isDesktop = platform === 'desktop' || platform === 'unknown';

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-7 h-7 text-green-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
          </svg>
        }
        heading={t(locale, 'saveToPhone')}
      />

      {/* Value props */}
      <div className="flex flex-col gap-1.5 -mt-2">
        {[
          { icon: '📸', text: t(locale, 'installBenefitCheckin') },
          { icon: '🔔', text: t(locale, 'installBenefitAlerts') },
          { icon: '🧺', text: t(locale, 'installBenefitLaundry') },
        ].map((b) => (
          <div key={b.text} className="flex items-center gap-2">
            <span className="text-sm">{b.icon}</span>
            <p className="text-xs text-gray-600">{b.text}</p>
          </div>
        ))}
      </div>

      {/* Video demo — always visible */}
      <div className="pt-2">
        <InstallVideo label={t(locale, 'installWatchVideo')} />
      </div>

      {/* Minimal steps */}
      <div className="flex items-center justify-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-bold">1</span>
          {t(locale, 'miniStep1')}
        </span>
        <span className="text-gray-300">&rsaquo;</span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-bold">2</span>
          {t(locale, 'miniStep2')}
        </span>
        <span className="text-gray-300">&rsaquo;</span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-bold">3</span>
          {t(locale, 'miniStep3')}
        </span>
      </div>

      {/* Desktop hint */}
      {isDesktop && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
          <p className="text-sm font-medium text-amber-900">
            {t(locale, 'bestOnPhone')}
          </p>
        </div>
      )}

      {/* Need help link + reassurance */}
      <div className="flex flex-col items-center gap-2">
        <a
          href={`/g/${code}/install-guide`}
          className="text-xs text-green-600 font-medium inline-flex items-center gap-1"
        >
          {t(locale, 'needHelpGuide')}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </a>
        <p className="text-xs text-gray-400">
          {t(locale, 'installOnlyOnce')}
        </p>
      </div>

      <StepActions
        onNext={onNext}
        onSkip={onSkip}
        nextLabel={t(locale, 'next')}
        skipLabel={t(locale, 'illDoLater')}
      />
    </div>
  );
}

// ─── Step 4: Enable Notifications ─────────────────────────────────────────────

function NotificationsStep({ locale, code, onNext, onSkip }) {
  const { requestPermission, permission } = usePush({ bookingCode: code });

  // Auto-advance when permission becomes granted
  useEffect(() => {
    if (permission === 'granted') {
      const timer = setTimeout(() => onNext(), 1200);
      return () => clearTimeout(timer);
    }
  }, [permission, onNext]);

  async function handleEnable() {
    await requestPermission({ bookingCode: code });
  }

  if (permission === 'granted') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-7 h-7 text-green-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold text-gray-900">{t(locale, 'notifsEnabled')}</p>
          <p className="text-sm text-gray-500 mt-1">{t(locale, 'takingToFinal')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PushPermissionExplainer
        onEnable={handleEnable}
        onDismiss={onSkip}
      />
    </div>
  );
}

// ─── Completion screen ────────────────────────────────────────────────────────

function CompletionScreen({ locale, code, firstName }) {
  const router = useRouter();

  useEffect(() => {
    localStorage.setItem(`welcome_seen_${code}`, '1');
    localStorage.setItem(`getstarted_seen_${code}`, '1');
    localStorage.setItem(`setup_complete_${code}`, String(Date.now()));
  }, [code]);

  return (
    <div className="flex flex-col min-h-[60vh]">
      {/* Warm green gradient hero */}
      <div className="rounded-2xl overflow-hidden mb-6" style={{ background: 'linear-gradient(135deg, #166534 0%, #15803d 50%, #16a34a 100%)' }}>
        <div className="px-6 py-10 text-center text-white">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-8 h-8 text-white">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t(locale, 'allSet')}{firstName ? `, ${firstName}` : ''}!
          </h1>
          <p className="text-sm italic text-green-100 mt-2">
            {t(locale, 'bienvenidos')}
          </p>
        </div>
      </div>

      {/* Quick portal preview */}
      <div className="flex flex-col gap-3 mb-8">
        {[
          { label: t(locale, 'portalCheckin'), desc: t(locale, 'portalCheckinDesc'), color: 'bg-green-50 text-green-700' },
          { label: t(locale, 'portalParking'), desc: t(locale, 'portalParkingDesc'), color: 'bg-amber-50 text-amber-700' },
          { label: t(locale, 'portalLaundry'), desc: t(locale, 'portalLaundryDesc'), color: 'bg-teal-50 text-teal-700' },
          { label: t(locale, 'portalRules'), desc: t(locale, 'portalRulesDesc'), color: 'bg-indigo-50 text-indigo-700' },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.color.split(' ')[0]}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{item.label}</p>
              <p className="text-xs text-gray-500">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => router.push(`/g/${code}`)}
        className="w-full py-4 rounded-xl bg-green-600 text-white font-semibold text-base
          hover:bg-green-700 active:bg-green-800 transition shadow-sm"
      >
        {t(locale, 'goToPortal')}
      </button>
    </div>
  );
}

// ─── Step ID constants ────────────────────────────────────────────────────────

const STEP_PARKING = 'parking';
const STEP_INVITE = 'invite';
const STEP_INSTALL = 'install';
const STEP_NOTIFICATIONS = 'notifications';
const STEP_COMPLETE = 'complete';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SetupPage({ params }) {
  const code = params.code;
  const { user, loading: authLoading } = useAuth();
  const { locale } = useLocale();

  // Platform detection — safe SSR defaults, resolved on mount
  const [platform, setPlatform] = useState('unknown');
  const [standalone, setStandalone] = useState(false);
  const [pushCapable, setPushCapable] = useState(false);
  const [platformReady, setPlatformReady] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setStandalone(checkStandalone());
    setPushCapable(isPushCapable());
    setPlatformReady(true);
  }, []);

  // Check if current user is primary guest
  const { data: members, loading: membersLoading } = useCollection('booking_members', [
    where('bookingCode', '==', code),
  ]);
  const isPrimary = members.some((m) => m.role === 'primary' && m.uid === user?.uid);

  // Derive visible steps once platform + members are ready
  const [steps, setSteps] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    if (!platformReady || membersLoading) return;

    const notifPermission = typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default';

    // Conditions for skipping each optional step:
    //   install   — skip if already in standalone mode
    //   notifs    — skip if iOS + not standalone, or already granted, or not push capable
    const includeInstall = !standalone;
    const includeNotifications = pushCapable && notifPermission !== 'granted';

    const visibleSteps = [STEP_PARKING];
    if (isPrimary) visibleSteps.push(STEP_INVITE);
    if (includeInstall) visibleSteps.push(STEP_INSTALL);
    if (includeNotifications) visibleSteps.push(STEP_NOTIFICATIONS);
    visibleSteps.push(STEP_COMPLETE);

    setSteps(visibleSteps);
    setCurrentStepIndex(0);
  }, [platformReady, membersLoading, standalone, pushCapable, isPrimary]);

  // Extract first name from user display name for completion screen
  const firstName = user?.displayName?.split(' ')[0] || '';

  function goNext() {
    setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  }

  function goSkip() {
    setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  }

  // Loading state — wait for platform detection + members
  const isLoading = authLoading || !platformReady || membersLoading || !steps;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">{t(locale, 'settingUp')}</p>
        </div>
      </div>
    );
  }

  const currentStepId = steps[currentStepIndex];
  // Total steps excluding the completion screen for the progress indicator
  const progressTotal = steps.length - 1;
  const progressCurrent = Math.min(currentStepIndex, progressTotal - 1);
  const isCompleteScreen = currentStepId === STEP_COMPLETE;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-6 pb-10">

        {/* Progress indicator — hidden on completion */}
        {!isCompleteScreen && progressTotal > 1 && (
          <ProgressDots total={progressTotal} current={progressCurrent} />
        )}

        {/* Animated step wrapper */}
        <div
          key={currentStepId}
          className="animate-fade-in"
          style={{ animation: 'fadeSlideIn 0.25s ease-out both' }}
        >
          {currentStepId === STEP_PARKING && (
            <ParkingStep locale={locale} onNext={goNext} onSkip={goSkip} />
          )}

          {currentStepId === STEP_INVITE && (
            <InviteStep locale={locale} code={code} onNext={goNext} onSkip={goSkip} />
          )}

          {currentStepId === STEP_INSTALL && (
            <InstallStep_ locale={locale} code={code} platform={platform} onNext={goNext} onSkip={goSkip} />
          )}

          {currentStepId === STEP_NOTIFICATIONS && (
            <NotificationsStep locale={locale} code={code} onNext={goNext} onSkip={goSkip} />
          )}

          {currentStepId === STEP_COMPLETE && (
            <CompletionScreen locale={locale} code={code} firstName={firstName} />
          )}
        </div>
      </div>

      {/* Inline CSS for step transition animation */}
      <style jsx>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
