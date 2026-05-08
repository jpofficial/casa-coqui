'use client';

import { useState } from 'react';
import usePush from '@/hooks/usePush';
import useStaffNotificationPrefs from '@/hooks/useStaffNotificationPrefs';
import { detectPlatform, isStandalone } from '@/lib/platform';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// ─── Category toggle configuration for staff ────────────────────────────────
function getCategories(locale) {
  return [
    {
      key: 'maintenance',
      label: t(locale, 'staffNotifSettings_maintenanceLabel'),
      description: t(locale, 'staffNotifSettings_maintenanceDesc'),
      color: 'text-red-600',
      bg: 'bg-red-50',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l5.654-4.654m5.14-5.633l4.14-4.14a2.25 2.25 0 013.182 0l.354.354a2.25 2.25 0 010 3.182l-4.14 4.14M16.5 9.75l-4.94 4.94" />
        </svg>
      ),
    },
    {
      key: 'cleaning',
      label: t(locale, 'staffNotifSettings_cleaningLabel'),
      description: t(locale, 'staffNotifSettings_cleaningDesc'),
      color: 'text-atardecer-600',
      bg: 'bg-atardecer-50',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
      ),
    },
    {
      key: 'assignment',
      label: t(locale, 'staffNotifSettings_assignmentLabel'),
      description: t(locale, 'staffNotifSettings_assignmentDesc'),
      color: 'text-coqui-600',
      bg: 'bg-coqui-50',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
    },
  ];
}

// ─── Permission status card (mirrors guest pattern) ──────────────────────────
function PermissionStatusCard({ permission, supported, onEnable, enabling, locale }) {
  const platform = detectPlatform();
  const sa = isStandalone();
  const iosNotInstalled = platform === 'ios' && !sa;

  if (iosNotInstalled) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-900">{t(locale, 'admin_staffNotif_iosInstall')}</p>
          <p className="text-xs text-amber-700 mt-0.5">{t(locale, 'admin_staffNotif_iosInstallDesc')}</p>
        </div>
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3.5">
        <p className="text-sm text-gray-500">{t(locale, 'push_notSupported')}</p>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700">{t(locale, 'admin_staffNotif_blocked')}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {t(locale, 'admin_staffNotif_blockedDesc').replace('{browser}', platform === 'ios' ? 'Safari' : 'Chrome')}
          </p>
        </div>
      </div>
    );
  }

  if (permission === 'granted') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-green-800">{t(locale, 'admin_staffNotif_enabled')}</p>
          <p className="text-xs text-green-600 mt-0.5">{t(locale, 'staffNotifSettings_enabledDesc')}</p>
        </div>
      </div>
    );
  }

  // Default — not yet asked
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-coqui-50 text-coqui-600 flex items-center justify-center flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{t(locale, 'admin_staffNotif_enableTitle')}</p>
        <p className="text-xs text-gray-500 mt-0.5">{t(locale, 'admin_staffNotif_enableDesc')}</p>
        <button
          onClick={onEnable}
          disabled={enabling}
          className="mt-3 text-xs font-semibold bg-coqui-600 text-white px-4 py-2 rounded-lg
            hover:bg-coqui-700 active:bg-coqui-800 transition disabled:opacity-60"
        >
          {enabling ? t(locale, 'admin_staffNotif_enabling') : t(locale, 'admin_staffNotif_enableBtn')}
        </button>
      </div>
    </div>
  );
}

// ─── Single category toggle row ──────────────────────────────────────────────
function CategoryRow({ cat, enabled, onToggle }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${cat.bg} ${cat.color}`}>
        {cat.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{cat.label}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{cat.description}</p>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={enabled}
        aria-label={`${cat.label} notifications`}
        className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 mt-1
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coqui-500
          ${enabled ? 'bg-coqui-500 cursor-pointer' : 'bg-gray-200 cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform
            ${enabled ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

/**
 * StaffNotificationSettings — per-category push preference toggles for staff.
 * Mirrors the guest NotificationSettings pattern.
 * Preferences stored in `staff_notification_prefs/{staffId}` in Firestore.
 *
 * Props:
 *   staffId  {string}
 */
export default function StaffNotificationSettings({ staffId }) {
  const { permission, requestPermission, supported } = usePush({ staffId });
  const { prefs, loading, updatePref } = useStaffNotificationPrefs({ staffId });
  const [enabling, setEnabling] = useState(false);
  const [saving, setSaving] = useState(false);
  const { locale } = useLocale();

  const CATEGORIES = getCategories(locale);

  async function handleToggle(key) {
    setSaving(true);
    try {
      await updatePref(key, !prefs[key]);
    } finally {
      setSaving(false);
    }
  }

  async function handleEnablePush() {
    setEnabling(true);
    try {
      await requestPermission({ staffId });
    } finally {
      setEnabling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t(locale, 'staffNotifSettings_title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t(locale, 'staffNotifSettings_subtitle')}</p>
      </div>

      {/* Push permission status card */}
      <PermissionStatusCard
        permission={permission}
        supported={supported}
        enabling={enabling}
        locale={locale}
        onEnable={handleEnablePush}
      />

      {/* Category toggles */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest px-1 mb-2">
          {t(locale, 'staffNotifSettings_types')}
        </h2>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          {loading
            ? Array.from({ length: CATEGORIES.length }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5 animate-pulse">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="h-3.5 bg-gray-200 rounded w-1/2 mb-1.5" />
                    <div className="h-3 bg-gray-100 rounded w-3/4" />
                  </div>
                  <div className="w-10 h-6 rounded-full bg-gray-100 flex-shrink-0" />
                </div>
              ))
            : CATEGORIES.map((cat) => (
                <CategoryRow
                  key={cat.key}
                  cat={cat}
                  enabled={prefs[cat.key] ?? true}
                  onToggle={() => handleToggle(cat.key)}
                />
              ))}
        </div>
        {saving && (
          <p className="text-xs text-gray-400 text-right mt-1.5 pr-1">{t(locale, 'staffNotifSettings_saving')}</p>
        )}
      </div>

      {/* In-app notification note */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3.5">
        <p className="text-xs text-gray-500 leading-relaxed">
          {t(locale, 'staffNotifSettings_inAppNote')}
        </p>
      </div>
    </div>
  );
}
