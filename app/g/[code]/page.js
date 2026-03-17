'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { where } from 'firebase/firestore';
import { auth as firebaseAuth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import WifiQuickView from '@/components/guest/WifiQuickView';
import LaundryQuickStatus from '@/components/guest/LaundryQuickStatus';
import CommunityPreview from '@/components/guest/CommunityPreview';
import { resolveUnitDisplayName } from '@/lib/units';

// ─── Skeletons ────────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
      <div className="w-10 h-10 bg-gray-200 rounded-lg mb-3" />
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-100 rounded w-full" />
    </div>
  );
}

function WelcomeSkeleton() {
  return (
    <div className="animate-pulse px-4 pt-6 pb-2">
      <div className="h-7 bg-gray-200 rounded w-2/3 mb-2" />
      <div className="h-4 bg-gray-100 rounded w-1/2" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3">
        <div className="h-3 bg-gray-100 rounded w-16 mb-2" />
        <div className="flex gap-2">
          <div className="flex-1 bg-gray-50 rounded-lg h-16" />
          <div className="flex-1 bg-gray-50 rounded-lg h-16" />
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3">
        <div className="h-3 bg-gray-100 rounded w-24 mb-2" />
        <div className="h-3 bg-gray-50 rounded w-full mb-1.5" />
        <div className="h-3 bg-gray-50 rounded w-3/4" />
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3">
        <div className="h-3 bg-gray-100 rounded w-12 mb-2" />
        <div className="flex gap-1.5">
          <div className="flex-1 bg-gray-50 rounded-lg h-10" />
          <div className="flex-1 bg-gray-50 rounded-lg h-10" />
        </div>
      </div>
    </div>
  );
}

function FullPageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-green-200 border-t-green-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading your portal...</p>
      </div>
    </div>
  );
}

// ─── Card definitions ────────────────────────────────────────────────────────
// "Your Stay" cards — daily-use tools shown prominently after check-in
function getStayCards(code) {
  return [
    {
      id: 'parking',
      title: 'Parking',
      description: 'Your designated spot and map',
      href: `/g/${code}/parking`,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
        </svg>
      ),
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      id: 'laundry',
      title: 'Laundry',
      description: 'Update washer and dryer status',
      href: `/g/${code}/laundry`,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
      ),
      color: 'text-teal-600',
      bg: 'bg-teal-50',
    },
    {
      id: 'community',
      title: 'Community Board',
      description: 'Posts and updates from the property',
      href: `/g/${code}/community`,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
        </svg>
      ),
      color: 'text-rose-600',
      bg: 'bg-rose-50',
    },
    {
      id: 'maintenance',
      title: 'Maintenance',
      description: 'Submit a repair request',
      href: `/g/${code}/maintenance`,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l5.654-4.654m5.14-5.633l4.14-4.14a2.25 2.25 0 013.182 0l.354.354a2.25 2.25 0 010 3.182l-4.14 4.14M16.5 9.75l-4.94 4.94" />
        </svg>
      ),
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      id: 'invite',
      title: 'Invite Group',
      description: 'Invite your travel companions',
      href: `/g/${code}/invite`,
      primaryOnly: true,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
        </svg>
      ),
      color: 'text-cyan-600',
      bg: 'bg-cyan-50',
    },
  ];
}

// "Arrival Info" cards — reference items for arrival/logistics
function getArrivalCards(code, hasCheckedIn) {
  return [
    {
      id: 'checkin-guide',
      title: hasCheckedIn ? 'Check-In Guide' : 'Check-In Guide',
      description: hasCheckedIn
        ? 'Completed — tap to review'
        : 'Step-by-step arrival instructions',
      href: `/g/${code}/checkin`,
      icon: hasCheckedIn ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
          <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: hasCheckedIn ? 'text-green-600' : 'text-green-600',
      bg: hasCheckedIn ? 'bg-green-50' : 'bg-green-50',
      completed: hasCheckedIn,
    },
    {
      id: 'access',
      title: 'Access Codes',
      description: 'WiFi, gate code, and lockbox',
      href: `/g/${code}/access`,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
        </svg>
      ),
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      id: 'rules',
      title: 'House Rules',
      description: 'Guidelines for a great stay',
      href: `/g/${code}/rules`,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
  ];
}

// ─── Individual quick-access card ─────────────────────────────────────────────
function NavCard({ card }) {
  const inner = (
    <div
      className={`relative bg-white rounded-xl shadow-sm p-4 flex flex-col gap-2 h-full border border-gray-50
        hover:shadow-md active:scale-95 transition-all duration-150 cursor-pointer`}
    >
      {card.completed && (
        <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
          Done
        </span>
      )}
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.bg} ${card.color}`}>
        {card.icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900 leading-snug">{card.title}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-snug">{card.description}</p>
      </div>
    </div>
  );

  return (
    <Link href={card.href} className="h-full block">
      {inner}
    </Link>
  );
}

// ─── Compact utility links (Install App, Contact Host) ───────────────────────
function UtilityLink({ href, icon, label, external }) {
  const cls = "flex items-center gap-2 px-3 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {icon}
        <span>{label}</span>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 text-gray-300 ml-auto">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>
    );
  }

  return (
    <Link href={href} className={cls}>
      {icon}
      <span>{label}</span>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 text-gray-300 ml-auto">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function GuestHome({ params }) {
  const code = params.code;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const { data: bookings, loading } = useCollection('bookings', [
    where('code', '==', code),
  ]);
  const { data: settings } = useDocument('settings', 'property');
  const { data: checkinData } = useDocument('checkins', code);

  // Install App banner — hidden after user visits install guide
  const [installGuideSeen, setInstallGuideSeen] = useState(true);
  useEffect(() => {
    setInstallGuideSeen(!!localStorage.getItem(`install_guide_seen_${code}`));
    // Redirect to setup wizard if not yet completed
    if (!localStorage.getItem(`setup_complete_${code}`) && !localStorage.getItem(`getstarted_seen_${code}`)) {
      router.push(`/g/${code}/setup`);
    }
  }, [code, router]);

  // Check if current user is the primary guest (must be before early returns)
  const { data: members, loading: membersLoading } = useCollection('booking_members', [
    where('bookingCode', '==', code),
  ]);

  // For legacy bookings with no booking_members docs, backfill via API
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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            bookingCode: code,
            name: booking.guestName || '',
            email: booking.guestEmail || '',
          }),
        });
      } catch (err) {
        console.error('Backfill booking_members error:', err);
      }
    })();
  }, [membersLoading, members, user, bookings, code]);

  const isPrimary = members.some(
    (m) => m.role === 'primary' && m.uid === user?.uid
  );

  // Not authenticated → redirect straight to check-in
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/g/${code}/checkin`);
    }
  }, [authLoading, user, router, code]);

  if (!authLoading && !user) {
    return <FullPageLoader />;
  }

  const booking = bookings?.[0] ?? null;
  const hasCheckedIn = !!checkinData?.checkedIn;

  // Gate: if the booking exists but is no longer active, show a clear message
  if (!loading && booking && booking.status !== 'active') {
    return (
      <div className="px-4 pt-12 pb-4 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-8 h-8 text-gray-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Booking no longer active</h1>
        <p className="text-sm text-gray-500">
          This guest portal is no longer available. If you think this is a mistake, please contact your host.
        </p>
      </div>
    );
  }

  const guestName = booking?.guestName ?? booking?.name ?? null;
  const unitLabel = resolveUnitDisplayName(booking, settings);
  const propertyPhotos = settings?.propertyPhotos ?? [];
  const propertyName = settings?.propertyName || 'Casa Coqui';

  const stayCards = getStayCards(code).filter(
    (card) => !card.primaryOnly || isPrimary
  );
  const arrivalCards = getArrivalCards(code, hasCheckedIn);

  return (
    <>
    {/* Welcome overlay removed — replaced by /setup wizard */}
    <div className="px-4 pt-5 pb-4">
      {/* Property photos */}
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

      {/* Welcome section */}
      {loading ? (
        <WelcomeSkeleton />
      ) : (
        <section className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">
            {guestName ? `Welcome, ${guestName.split(' ')[0]}` : 'Welcome to Casa Coqui'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {unitLabel
              ? `Your home for this trip — ${unitLabel}`
              : 'Your home for this trip'}
          </p>

          {/* Booking-not-found notice */}
          {!loading && !booking && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              We could not find a booking for this link. Please contact your host.
            </div>
          )}
        </section>
      )}

      {/* ── Live dashboard (shown after check-in) ────────────────────────── */}
      {loading || membersLoading ? (
        <DashboardSkeleton />
      ) : hasCheckedIn ? (
        <section className="mb-6 flex flex-col gap-3">
          {/* Install App banner — hides once user visits install guide */}
          {!installGuideSeen && (
            <Link href={`/g/${code}/install-guide`}>
              <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-3 hover:bg-indigo-100 active:scale-[0.99] transition-all cursor-pointer">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-600 text-white flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-indigo-900">Add Casa Coqui to Home Screen</p>
                  <p className="text-xs text-indigo-600">Quick access — works like a native app</p>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-indigo-400 flex-shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </Link>
          )}

          {/* Laundry real-time status */}
          <LaundryQuickStatus code={code} />

          {/* Community board latest post */}
          <CommunityPreview code={code} dateFrom={booking?.checkInDate} dateTo={booking?.checkOutDate} />

          {/* Quick action: Report Parking Issue */}
          <Link href={`/g/${code}/community?type=parking`}>
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 hover:bg-amber-100 active:scale-[0.99] transition-all cursor-pointer">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-100 text-amber-600 flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4.5 h-4.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">Report Parking Issue</p>
                <p className="text-xs text-amber-700">Photo required — alerts all guests</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-amber-400 flex-shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </Link>
        </section>
      ) : (
        /* Pre-check-in CTA */
        <section className="mb-6">
          <Link href={`/g/${code}/checkin`}>
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 flex items-center gap-3 hover:bg-green-100 active:scale-[0.99] transition-all cursor-pointer">
              <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-white">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-green-900">Complete Your Check-In</p>
                <p className="text-xs text-green-700 mt-0.5">Tap here to share your arrival details</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-green-400 ml-auto flex-shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </Link>
        </section>
      )}

      {/* ── Your Stay — daily-use tools ──────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Your Stay
        </h2>

        {loading || membersLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {stayCards.map((card) => (
              <NavCard key={card.id} card={card} />
            ))}
          </div>
        )}
      </section>

      {/* ── Arrival Info — reference cards ────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Arrival Info
        </h2>

        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {arrivalCards.map((card) => (
              <NavCard key={card.id} card={card} />
            ))}
          </div>
        )}
      </section>

      {/* ── More — utility links ─────────────────────────────────────────── */}
      <section className="mb-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
          More
        </h2>
        <div className="flex flex-col gap-3">
          {/* WiFi credentials — inline with copy buttons */}
          <WifiQuickView settings={settings} booking={booking} />

          <div className="bg-white rounded-xl shadow-sm border border-gray-50 divide-y divide-gray-50">
          <UtilityLink
            href="https://www.airbnb.com/guest/messages"
            label="Contact Host on Airbnb"
            external
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5 text-gray-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
            }
          />
          </div>
        </div>
      </section>

      {/* Help footer */}
      <footer className="mt-8 text-center">
        <p className="text-xs text-gray-400">
          Need help?{' '}
          <a
            href="sms:+1?body=Hi%2C%20I%20need%20help%20with%20my%20stay%20at%20Casa%20Coqui."
            className="text-green-600 font-medium underline underline-offset-2"
          >
            Text your host
          </a>
        </p>
      </footer>
    </div>
    </>
  );
}
