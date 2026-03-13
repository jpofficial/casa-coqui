'use client';

import Link from 'next/link';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { where } from 'firebase/firestore';
import useAuth from '@/hooks/useAuth';

// ─── Card skeleton ────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
      <div className="w-10 h-10 bg-gray-200 rounded-lg mb-3" />
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-100 rounded w-full" />
    </div>
  );
}

// ─── Welcome skeleton ─────────────────────────────────────────────────────────
function WelcomeSkeleton() {
  return (
    <div className="animate-pulse px-4 pt-6 pb-2">
      <div className="h-7 bg-gray-200 rounded w-2/3 mb-2" />
      <div className="h-4 bg-gray-100 rounded w-1/2" />
    </div>
  );
}

// ─── Quick-access card data ───────────────────────────────────────────────────
function getNavCards(code) {
  return [
    {
      id: 'checkin-guide',
      title: 'Check-In Guide',
      description: 'Step-by-step arrival instructions',
      href: `/g/${code}/checkin`,
      phase2: false,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      id: 'parking',
      title: 'Parking',
      description: 'Your designated spot and map',
      href: `/g/${code}/parking`,
      phase2: false,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
        </svg>
      ),
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      id: 'rules',
      title: 'House Rules',
      description: 'Guidelines for a great stay',
      href: `/g/${code}/rules`,
      phase2: false,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      id: 'access',
      title: 'Access Codes',
      description: 'WiFi, gate code, and lockbox',
      href: `/g/${code}/access`,
      phase2: false,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
        </svg>
      ),
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      id: 'laundry',
      title: 'Laundry',
      description: 'Real-time washer and dryer status',
      href: `/g/${code}/laundry`,
      phase2: false,
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
      title: 'Community',
      description: 'Announcements and local tips',
      href: `/g/${code}/community`,
      phase2: false,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
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
      phase2: false,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l5.654-4.654m5.14-5.633l4.14-4.14a2.25 2.25 0 013.182 0l.354.354a2.25 2.25 0 010 3.182l-4.14 4.14M16.5 9.75l-4.94 4.94" />
        </svg>
      ),
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      id: 'chat',
      title: 'Message Host',
      description: 'Direct chat with your host',
      href: `/g/${code}/chat`,
      phase2: false,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
    },
  ];
}

// ─── Individual quick-access card ─────────────────────────────────────────────
function NavCard({ card }) {
  const inner = (
    <div
      className={`relative bg-white rounded-xl shadow-sm p-4 flex flex-col gap-2 h-full border border-gray-50
        ${card.phase2 ? 'opacity-70' : 'hover:shadow-md active:scale-95 transition-all duration-150 cursor-pointer'}`}
    >
      {card.phase2 && (
        <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
          Soon
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

  if (card.phase2) {
    return <div className="h-full">{inner}</div>;
  }

  return (
    <Link href={card.href} className="h-full block">
      {inner}
    </Link>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function GuestHome({ params }) {
  const code = params.code;
  const { user, loading: authLoading } = useAuth();

  const { data: bookings, loading } = useCollection('bookings', [
    where('code', '==', code),
  ]);
  const { data: settings } = useDocument('settings', 'property');

  // If not authenticated, prompt guest to verify first
  if (!authLoading && !user) {
    return (
      <div className="px-4 pt-12 pb-4 text-center">
        <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-8 h-8 text-green-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Welcome to Casa Coqui</h1>
        <p className="text-sm text-gray-500 mb-6">Verify your phone number to access your guest portal.</p>
        <Link
          href={`/g/${code}/checkin`}
          className="inline-block bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-xl px-6 py-3 text-sm transition-colors"
        >
          Get Started
        </Link>
      </div>
    );
  }

  const booking = bookings?.[0] ?? null;

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
  const unitLabel = booking?.unit ? `Unit ${booking.unit}` : null;
  const propertyPhotos = settings?.propertyPhotos ?? [];
  const propertyName = settings?.propertyName || 'Casa Coqui';

  const cards = getNavCards(code);

  return (
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

      {/* Quick-access grid */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Quick Access
        </h2>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {cards.map((card) => (
              <NavCard key={card.id} card={card} />
            ))}
          </div>
        )}
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
  );
}
