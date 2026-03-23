'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { where } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth as firebaseAuth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import { isStandalone as checkStandalone } from '@/lib/platform';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import LaundryQuickStatus from '@/components/guest/LaundryQuickStatus';
import CommunityPreview from '@/components/guest/CommunityPreview';
import { resolveUnitDisplayName, resolveUnitWifi } from '@/lib/units';

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr, locale) {
  const loc = locale === 'es' ? 'es-PR' : 'en-US';
  return new Date(dateStr).toLocaleDateString(loc, { month: 'short', day: 'numeric' });
}

// ── Copy button (inline, for WiFi) ───────────────────────────────────────────
function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); }
    catch { const el = document.createElement('textarea'); el.value = value; el.style.position = 'fixed'; el.style.opacity = '0'; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  return (
    <button onClick={handleCopy} className={`p-1 rounded transition-colors ${copied ? 'text-coqui-600' : 'text-gray-300 hover:text-gray-500'}`}>
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
      )}
    </button>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────
function StayCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-brand border border-gray-100 p-5 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-2/3 mb-1" />
      <div className="h-4 bg-gray-100 rounded w-1/2 mb-4" />
      <div className="flex gap-6 mb-4">
        <div><div className="h-2.5 bg-gray-100 rounded w-12 mb-1" /><div className="h-4 bg-gray-200 rounded w-14" /></div>
        <div><div className="h-2.5 bg-gray-100 rounded w-12 mb-1" /><div className="h-4 bg-gray-200 rounded w-14" /></div>
      </div>
      <div className="border-t border-gray-100 pt-3">
        <div className="h-3 bg-gray-100 rounded w-10 mb-1.5" />
        <div className="h-4 bg-gray-200 rounded w-3/4" />
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl shadow-brand border border-gray-100 p-4">
          <div className="w-10 h-10 bg-gray-200 rounded-xl mb-2.5" />
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </div>
      ))}
    </div>
  );
}

function FullPageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-coqui-200 border-t-coqui-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading your portal...</p>
      </div>
    </div>
  );
}

// ─── Nav card (simplified — icon + title only) ───────────────────────────────
function NavCard({ href, icon, title, color, bg, completed, locale }) {
  return (
    <Link href={href} className="block h-full">
      <div className={`relative bg-white rounded-2xl shadow-brand p-4 h-full border border-gray-100
        hover:shadow-brand-md active:scale-[0.98] transition-all duration-150`}>
        {completed && (
          <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold bg-coqui-100 text-coqui-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
            {t(locale, 'done')}
          </span>
        )}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bg} ${color} mb-2.5`}>
          {icon}
        </div>
        <p className="text-sm font-semibold text-gray-900 leading-snug">{title}</p>
      </div>
    </Link>
  );
}

// ─── Compact link row ────────────────────────────────────────────────────────
function QuickLink({ href, icon, label, external }) {
  const cls = "flex items-center gap-3 px-1 py-2.5 text-sm text-gray-700 hover:text-gray-900 transition-colors";
  const chevron = (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-gray-300 ml-auto flex-shrink-0">
      {external
        ? <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      }
    </svg>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {icon}{label}{chevron}
      </a>
    );
  }
  return <Link href={href} className={cls}>{icon}{label}{chevron}</Link>;
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function GuestHome({ params }) {
  const code = params.code;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { locale } = useLocale();

  const { data: bookings, loading } = useCollection('bookings', [
    where('code', '==', code),
  ]);
  const { data: settings } = useDocument('settings', 'property');
  const { data: checkinData } = useDocument('checkins', code);

  // ── Session auto-recovery ──────────────────────────────────────────
  const recovering = useRef(false);
  const [showRecoveryLoader, setShowRecoveryLoader] = useState(false);

  useEffect(() => {
    if (authLoading || user || recovering.current) return;
    recovering.current = true;
    setShowRecoveryLoader(true);

    (async () => {
      try {
        const { user: anonUser } = await signInAnonymously(firebaseAuth);
        const tokenResult = await anonUser.getIdTokenResult();
        if (tokenResult.claims.bookingCode === code) {
          localStorage.setItem('casa-coqui-guest-code', code);
          setShowRecoveryLoader(false);
          recovering.current = false;
          return;
        }

        const idToken = await anonUser.getIdToken();
        const res = await fetch('/api/guests/set-claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ bookingCode: code }),
        });
        const json = await res.json();
        if (!json.success) {
          router.replace(`/g/${code}/checkin`);
          setShowRecoveryLoader(false);
          recovering.current = false;
          return;
        }

        await anonUser.getIdToken(true);
        localStorage.setItem('casa-coqui-guest-code', code);
        setShowRecoveryLoader(false);
        recovering.current = false;
      } catch (err) {
        console.error('[GuestHome] Session recovery failed:', err);
        router.replace(`/g/${code}/checkin`);
        setShowRecoveryLoader(false);
        recovering.current = false;
      }
    })();
  }, [authLoading, user, code, router]);

  // ── Install banner + setup redirect ──────────────────────────────
  const [installGuideSeen, setInstallGuideSeen] = useState(true);
  useEffect(() => {
    if (authLoading || showRecoveryLoader) return;
    const standalone = checkStandalone();
    if (standalone) { setInstallGuideSeen(true); return; }
    setInstallGuideSeen(!!localStorage.getItem(`install_guide_seen_${code}`));
    if (!user) return;
    if (!localStorage.getItem(`setup_complete_${code}`) && !localStorage.getItem(`getstarted_seen_${code}`)) {
      router.push(`/g/${code}/setup`);
    }
  }, [code, router, authLoading, showRecoveryLoader, user]);

  // ── Primary guest check ────────────────────────────────────────────
  const { data: members, loading: membersLoading } = useCollection('booking_members', [
    where('bookingCode', '==', code),
  ]);

  const didBackfill = useRef(false);
  useEffect(() => {
    if (membersLoading || !user || !bookings?.length || didBackfill.current) return;
    if (members.length > 0) return;
    const booking = bookings[0];
    if (booking.status !== 'active') return;
    didBackfill.current = true;
    (async () => {
      try {
        const idToken = await firebaseAuth.currentUser.getIdToken();
        await fetch('/api/guests/link-member', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ bookingCode: code, name: booking.guestName || '', email: booking.guestEmail || '' }),
        });
      } catch (err) { console.error('Backfill booking_members error:', err); }
    })();
  }, [membersLoading, members, user, bookings, code]);

  const isPrimary = members.some((m) => m.role === 'primary' && m.uid === user?.uid);

  if (authLoading || showRecoveryLoader || !user) return <FullPageLoader />;

  const booking = bookings?.[0] ?? null;
  const hasCheckedIn = !!checkinData?.checkedIn;

  // Inactive booking gate
  if (!loading && booking && booking.status !== 'active') {
    return (
      <div className="px-4 pt-12 pb-4 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-8 h-8 text-gray-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">{t(locale, 'bookingInactive')}</h1>
        <p className="text-sm text-gray-500">{t(locale, 'bookingInactiveDesc')}</p>
      </div>
    );
  }

  const guestName = booking?.guestName ?? booking?.name ?? null;
  const unitLabel = resolveUnitDisplayName(booking, settings);
  const propertyPhotos = settings?.propertyPhotos ?? [];
  const propertyName = settings?.propertyName || 'Casa Coqui';
  const wifi = resolveUnitWifi(booking, settings);

  return (
    <div className="px-4 pt-5 pb-4">
      {/* ── 1. Property photos ──────────────────────────────────────────── */}
      {propertyPhotos.length > 0 && (
        <div className="mb-4 -mx-4">
          <div className="flex gap-2 overflow-x-auto px-4 pb-2 snap-x snap-mandatory">
            {propertyPhotos.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`${propertyName} photo ${i + 1}`}
                className="w-72 h-44 object-cover rounded-xl flex-shrink-0 snap-center border border-gray-100"
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 2. Stay Card (boarding-pass style — info + WiFi) ─────────────── */}
      {loading ? <StayCardSkeleton /> : (
        <section className="mb-5">
          <div className="bg-white rounded-2xl shadow-brand border border-gray-100 p-5">
            {/* Greeting */}
            <h1 className="text-lg font-bold text-gray-900 leading-tight">
              {guestName ? `${t(locale, 'welcomeName')} ${guestName.split(' ')[0]}` : t(locale, 'welcomeGeneric')}
            </h1>
            <p className="font-display text-base text-gray-500 mt-0.5">
              {unitLabel || propertyName}
            </p>

            {/* Dates */}
            {booking?.checkInDate && booking?.checkOutDate && (
              <div className="flex gap-6 mt-3">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{t(locale, 'checkInLabel')}</p>
                  <p className="text-sm font-bold text-gray-900">{formatDate(booking.checkInDate, locale)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{t(locale, 'checkOutLabel')}</p>
                  <p className="text-sm font-bold text-gray-900">{formatDate(booking.checkOutDate, locale)}</p>
                </div>
              </div>
            )}

            {/* WiFi — integrated into the card */}
            {(wifi.ssid || wifi.password) && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">WiFi</p>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {wifi.ssid && (
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-mono font-semibold text-gray-900">{wifi.ssid}</span>
                      <CopyBtn value={wifi.ssid} />
                    </div>
                  )}
                  {wifi.password && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider mr-0.5">{t(locale, 'wifi_password')}</span>
                      <span className="text-sm font-mono font-semibold text-gray-900">{wifi.password}</span>
                      <CopyBtn value={wifi.password} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Booking not found */}
            {!booking && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                {t(locale, 'bookingNotFound')}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 3. Check-in CTA (pre-check-in only) ──────────────────────────── */}
      {!loading && !membersLoading && !hasCheckedIn && (
        <section className="mb-5">
          <Link href={`/g/${code}/checkin`}>
            <div className="bg-coqui-50 border-2 border-coqui-200 rounded-2xl p-4 flex items-center gap-3 hover:bg-coqui-100 active:scale-[0.98] transition-all shadow-brand">
              <div className="w-10 h-10 rounded-full bg-coqui-500 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-white">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-coqui-900">{t(locale, 'completeCheckIn')}</p>
                <p className="text-xs text-coqui-700 mt-0.5">{t(locale, 'completeCheckInDesc')}</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-coqui-400 ml-auto flex-shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </Link>
        </section>
      )}

      {/* ── 4. Your Stay — 2x2 action grid ──────────────────────────────── */}
      <section className="mb-5">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t(locale, 'yourStay')}
        </h2>

        {loading ? <GridSkeleton /> : (
          <div className="grid grid-cols-2 gap-3">
            {/* Check-In Guide — post-check-in goes to access page (checkin page redirects back) */}
            <NavCard
              href={hasCheckedIn ? `/g/${code}/access` : `/g/${code}/checkin`}
              title={t(locale, 'checkInGuide')}
              color="text-coqui-600"
              bg="bg-coqui-50"
              completed={hasCheckedIn}
              locale={locale}
              icon={hasCheckedIn ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 011.65 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
                </svg>
              )}
            />

            {/* Community Board */}
            <NavCard
              href={`/g/${code}/community`}
              title={t(locale, 'communityBoard')}
              color="text-flamboyan-600"
              bg="bg-flamboyan-50"
              locale={locale}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
                </svg>
              }
            />

            {/* Maintenance */}
            <NavCard
              href={`/g/${code}/maintenance`}
              title={t(locale, 'maintenance')}
              color="text-red-600"
              bg="bg-red-50"
              locale={locale}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l5.654-4.654m5.14-5.633l4.14-4.14a2.25 2.25 0 013.182 0l.354.354a2.25 2.25 0 010 3.182l-4.14 4.14M16.5 9.75l-4.94 4.94" />
                </svg>
              }
            />

            {/* House Rules */}
            <NavCard
              href={`/g/${code}/rules`}
              title={t(locale, 'houseRules')}
              color="text-blue-600"
              bg="bg-blue-50"
              locale={locale}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              }
            />
          </div>
        )}
      </section>

      {/* ── 5. Quick links ───────────────────────────────────────────────── */}
      <section className="mb-5">
        <div className="bg-white rounded-2xl shadow-brand border border-gray-100 divide-y divide-gray-100 px-3">
          {/* Invite — primary guests only, post-check-in */}
          {hasCheckedIn && isPrimary && (
            <QuickLink
              href={`/g/${code}/invite`}
              label={t(locale, 'inviteGroup')}
              icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5 text-caribe-500"><path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" /></svg>}
            />
          )}

          {/* Report Parking */}
          {hasCheckedIn && (
            <QuickLink
              href={`/g/${code}/community?type=parking`}
              label={t(locale, 'reportParkingCta')}
              icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5 text-amber-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>}
            />
          )}

          {/* Message Host */}
          <QuickLink
            href="https://www.airbnb.com/guest/messages"
            label={t(locale, 'messageHostCta')}
            external
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5 text-atardecer-500"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>}
          />

          {/* Install App — subtle inline link */}
          {!installGuideSeen && (
            <QuickLink
              href={`/g/${code}/install-guide`}
              label={t(locale, 'installBanner')}
              icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5 text-indigo-500"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>}
            />
          )}
        </div>
      </section>

      {/* ── 6. Live status — laundry + community (post-check-in) ──────────── */}
      {hasCheckedIn && (
        <section className="mb-5 flex flex-col gap-3">
          <LaundryQuickStatus code={code} />
          <CommunityPreview code={code} dateFrom={booking?.checkInDate} dateTo={booking?.checkOutDate} />
        </section>
      )}

      {/* ── 7. Footer ────────────────────────────────────────────────────── */}
      <footer className="pt-2 pb-2 text-center">
        <p className="text-xs text-gray-400">
          {t(locale, 'needHelp')}{' '}
          <a
            href="sms:+1?body=Hi%2C%20I%20need%20help%20with%20my%20stay%20at%20Casa%20Coqui."
            className="text-coqui-500 font-medium underline underline-offset-2"
          >
            {t(locale, 'textHost')}
          </a>
        </p>
      </footer>
    </div>
  );
}
