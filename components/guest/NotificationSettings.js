'use client';

import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import usePush from '@/hooks/usePush';
import { detectPlatform, isStandalone } from '@/lib/platform';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// ─── Category toggle configuration ───────────────────────────────────────────
// locked: true = user cannot disable this category
function getCategories(locale) {
  return [
    {
      key: 'parking',
      label: t(locale, 'notifSettings_parkingLabel'),
      description: t(locale, 'notifSettings_parkingDesc'),
      locked: false,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
        </svg>
      ),
    },
    {
      key: 'laundry',
      label: t(locale, 'notifSettings_laundryLabel'),
      description: t(locale, 'notifSettings_laundryDesc'),
      locked: false,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
      ),
    },
    {
      key: 'announcement',
      label: t(locale, 'notifSettings_announcementLabel'),
      description: t(locale, 'notifSettings_announcementDesc'),
      locked: true,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
    },
    {
      key: 'community',
      label: t(locale, 'notifSettings_communityLabel'),
      description: t(locale, 'notifSettings_communityDesc'),
      locked: false,
      color: 'text-rose-600',
      bg: 'bg-rose-50',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
        </svg>
      ),
    },
    {
      key: 'maintenance',
      label: t(locale, 'notifSettings_maintenanceLabel'),
      description: t(locale, 'notifSettings_maintenanceDesc'),
      locked: false,
      color: 'text-red-600',
      bg: 'bg-red-50',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l5.654-4.654m5.14-5.633l4.14-4.14a2.25 2.25 0 013.182 0l.354.354a2.25 2.25 0 010 3.182l-4.14 4.14M16.5 9.75l-4.94 4.94" />
        </svg>
      ),
    },
  ];
}

// Default: everything enabled — uses a stable key list (locale-independent)
const CATEGORY_KEYS = ['parking', 'laundry', 'announcement', 'community', 'maintenance'];
const DEFAULT_PREFS = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, true]));

/**
 * NotificationSettings — per-category push preference toggles for guests.
 * Preferences are stored in `notification_prefs/{bookingCode}` in Firestore.
 *
 * Props:
 *   bookingCode  {string}
 */
export default function NotificationSettings({ bookingCode }) {
  const { permission, requestPermission, supported, pushCapable } = usePush({ bookingCode });
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const { locale } = useLocale();

  const CATEGORIES = getCategories(locale);
  const platform = detectPlatform();
  const sa = isStandalone();

  // Load saved prefs from Firestore
  useEffect(() => {
    if (!bookingCode) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'notification_prefs', bookingCode));
        if (snap.exists()) {
          setPrefs({ ...DEFAULT_PREFS, ...snap.data() });
        }
      } catch (err) {
        console.warn('[NotificationSettings] load prefs error:', err);
      } finally {
        setLoadingPrefs(false);
      }
    })();
  }, [bookingCode]);

  async function handleToggle(key) {
    if (!bookingCode) return;
    // Locked categories cannot be toggled
    const cat = CATEGORIES.find((c) => c.key === key);
    if (cat?.locked) return;

    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated); // optimistic

    setSaving(true);
    try {
      await setDoc(doc(db, 'notification_prefs', bookingCode), updated, { merge: true });
    } catch (err) {
      console.warn('[NotificationSettings] save prefs error:', err);
      setPrefs(prefs); // revert
    } finally {
      setSaving(false);
    }
  }

  async function handleEnablePush() {
    setEnabling(true);
    try {
      await requestPermission({ bookingCode });
    } finally {
      setEnabling(false);
    }
  }

  const pushGranted = permission === 'granted';
  const pushDenied = permission === 'denied';
  const iosNotInstalled = platform === 'ios' && !sa;

  return (
    <div className="flex flex-col gap-4">
      {/* Push permission status card */}
      <PermissionStatusCard
        granted={pushGranted}
        denied={pushDenied}
        supported={supported}
        pushCapable={pushCapable}
        iosNotInstalled={iosNotInstalled}
        platform={platform}
        enabling={enabling}
        locale={locale}
        onEnable={handleEnablePush}
      />

      {/* Category toggles */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest px-1 mb-2">
          {t(locale, 'notifSettings_types')}
        </h2>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          {loadingPrefs
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
                  pushGranted={pushGranted}
                  locale={locale}
                  onToggle={() => handleToggle(cat.key)}
                />
              ))}
        </div>
        {saving && (
          <p className="text-xs text-gray-400 text-right mt-1.5 pr-1">{t(locale, 'notifSettings_saving')}</p>
        )}
      </div>

      {/* In-app notification note */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3.5">
        <p className="text-xs text-gray-500 leading-relaxed">
          {t(locale, 'notifSettings_inAppNote')}
        </p>
      </div>
    </div>
  );
}

// ─── Permission status card ───────────────────────────────────────────────────
function PermissionStatusCard({
  granted, denied, supported, pushCapable,
  iosNotInstalled, platform, enabling, onEnable, locale,
}) {
  // iOS not installed must come before !supported because iOS Safari doesn't
  // expose the Notification API outside standalone mode.
  if (iosNotInstalled) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-900">{t(locale, 'push_iosInstallRequired')}</p>
          <p className="text-xs text-amber-700 mt-0.5">
            {t(locale, 'push_iosInstallRequiredDesc')}
          </p>
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

  if (denied) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700">{t(locale, 'push_blocked')}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {t(locale, 'push_blockedDesc').replace('{browser}', platform === 'ios' ? 'Safari' : 'Chrome')}
          </p>
        </div>
      </div>
    );
  }

  if (granted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-green-800">{t(locale, 'push_enabledTitle')}</p>
          <p className="text-xs text-green-600 mt-0.5">
            {t(locale, 'push_enabledDesc')}
          </p>
        </div>
      </div>
    );
  }

  // Default — not yet asked
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-green-50 text-green-600 flex items-center justify-center flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{t(locale, 'push_notEnabled')}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {t(locale, 'push_notEnabledDesc')}
        </p>
        <button
          onClick={onEnable}
          disabled={enabling || !pushCapable}
          className="mt-3 text-xs font-semibold bg-green-600 text-white px-4 py-2 rounded-lg
            hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60"
        >
          {enabling ? t(locale, 'push_enabling') : t(locale, 'push_enablePushNotifications')}
        </button>
      </div>
    </div>
  );
}

// ─── Single category toggle row ───────────────────────────────────────────────
function CategoryRow({ cat, enabled, pushGranted, onToggle, locale }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${cat.bg} ${cat.color}`}>
        {cat.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-gray-900">{cat.label}</p>
          {cat.locked && (
            <span className="text-[10px] font-semibold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase tracking-wide">
              {t(locale, 'notifSettings_required')}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{cat.description}</p>
      </div>
      {/* Toggle */}
      <button
        onClick={onToggle}
        disabled={cat.locked}
        role="switch"
        aria-checked={cat.locked ? true : enabled}
        aria-label={`${cat.label} notifications`}
        className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 mt-1
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500
          ${cat.locked
            ? 'bg-green-400 cursor-not-allowed opacity-70'
            : enabled
              ? 'bg-green-500 cursor-pointer'
              : 'bg-gray-200 cursor-pointer'
          }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform
            ${cat.locked || enabled ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}
