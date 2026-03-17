'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider } from '@/hooks/useAuth';
import useAuth from '@/hooks/useAuth';
import usePush from '@/hooks/usePush';
import useNotifications from '@/hooks/useNotifications';
import ForegroundToast from '@/components/guest/ForegroundToast';
import PushPermissionGate from '@/components/guest/PushPermissionGate';
import HelpDrawer from '@/components/ui/HelpDrawer';
import { getHelpContext } from '@/lib/help-articles';

// ─── Nav icons ────────────────────────────────────────────────────────────────
function HomeIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.75}
      className="w-6 h-6" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function GuideIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.75}
      className="w-6 h-6" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function InfoIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.75}
      className="w-6 h-6" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  );
}

function BellIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.75}
      className="w-6 h-6" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

// ─── Bottom nav ───────────────────────────────────────────────────────────────
function BottomNav({ code, onOpenGuide, unreadCount }) {
  const pathname = usePathname();

  const tabs = [
    {
      label: 'Home',
      href: `/g/${code}`,
      icon: HomeIcon,
      match: (p) => p === `/g/${code}`,
    },
    {
      label: 'Info',
      href: `/g/${code}/access`,
      icon: InfoIcon,
      match: (p) =>
        p.startsWith(`/g/${code}/access`) ||
        p.startsWith(`/g/${code}/parking`) ||
        p.startsWith(`/g/${code}/rules`) ||
        p.startsWith(`/g/${code}/laundry`),
    },
    {
      label: 'Alerts',
      href: `/g/${code}/notifications`,
      icon: BellIcon,
      match: (p) =>
        p.startsWith(`/g/${code}/notifications`) ||
        p.startsWith(`/g/${code}/notification-settings`),
      badge: unreadCount,
    },
    {
      label: 'Guide',
      href: null,
      icon: GuideIcon,
      match: () => false,
      isGuide: true,
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 shadow-lg safe-area-bottom"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Main navigation"
    >
      <div className="flex items-stretch justify-around max-w-lg mx-auto">
        {tabs.map((tab) => {
          const active = tab.match(pathname);

          if (tab.isGuide) {
            return (
              <button
                key="guide"
                onClick={onOpenGuide}
                className="flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] px-1 py-2
                  text-xs font-medium transition-colors text-gray-400 hover:text-gray-600 active:text-green-600"
              >
                <tab.icon active={false} />
                <span>{tab.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={tab.label}
              href={tab.href}
              className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] px-1 py-2
                text-xs font-medium transition-colors
                ${active ? 'text-green-600' : 'text-gray-400 hover:text-gray-600 active:text-green-600'}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="relative">
                <tab.icon active={active} />
                {tab.badge > 0 && (
                  <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 rounded-full bg-red-500
                    text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Inner layout (has access to auth + push context) ────────────────────────
const GUEST_CODE_KEY = 'casa-coqui-guest-code';

function GuestLayoutInner({ children, code }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { foregroundMsg, requestPermission, permission, pushCapable } = usePush({ bookingCode: code });
  const { unreadCount } = useNotifications({ bookingCode: code });
  const [helpOpen, setHelpOpen] = useState(false);

  // Persist guest booking code so PWA can restore session from root
  useEffect(() => {
    if (user) {
      localStorage.setItem(GUEST_CODE_KEY, code);
    }
  }, [user, code]);

  // Listen for NOTIFICATION_CLICK from the service worker so tapping a
  // notification while the app is already open navigates to the deep link.
  useEffect(() => {
    function handleSWMessage(event) {
      if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.url) {
        const url = event.data.url;
        // Only navigate to guest portal paths to prevent open redirect
        if (url.startsWith(`/g/`)) {
          router.push(url);
        }
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleSWMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
    };
  }, [router]);

  const isOnboarding =
    pathname.endsWith('/checkin') ||
    pathname.endsWith('/join') ||
    pathname.endsWith('/get-started') ||
    pathname.endsWith('/setup');

  const pageKey = getHelpContext(pathname, code);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Foreground toast — global, above all content */}
      {!isOnboarding && (
        <ForegroundToast foregroundMsg={foregroundMsg} code={code} />
      )}

      {/* Top header — hidden during onboarding */}
      {!isOnboarding && (
        <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-4 h-14 max-w-lg mx-auto w-full">
            <div className="flex items-center gap-2">
              <span className="text-green-600" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                  <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-1.72-1.72V5.25a.75.75 0 00-.75-.75h-1.5a.75.75 0 00-.75.75v1.79l-4.72-4.72a.75.75 0 00-1.06 0l-8.69 8.69a.75.75 0 001.06 1.06l8.16-8.16z" />
                  <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198c.031-.028.061-.056.091-.086L12 5.432z" />
                </svg>
              </span>
              <span className="text-lg font-semibold text-gray-900 tracking-tight">Casa Coqui</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Notification bell shortcut in header (shows badge) */}
              <Link
                href={`/g/${code}/notifications`}
                className="relative p-2 text-gray-400 hover:text-gray-600 transition rounded-lg hover:bg-gray-50"
                aria-label="Notifications"
              >
                <BellIcon active={pathname.startsWith(`/g/${code}/notifications`)} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[14px] h-3.5 rounded-full bg-red-500
                    text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
              <div className="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                #{code}
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Page content */}
      <main className={`flex-1 ${!isOnboarding ? 'pb-20' : ''} max-w-lg mx-auto w-full`}>
        {!isOnboarding ? (
          <PushPermissionGate bookingCode={code} compact>
            {children}
          </PushPermissionGate>
        ) : (
          children
        )}
      </main>

      {!isOnboarding && (
        <BottomNav
          code={code}
          onOpenGuide={() => setHelpOpen(true)}
          unreadCount={unreadCount}
        />
      )}

      <HelpDrawer
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        pageKey={pageKey}
      />
    </div>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────
export default function GuestLayoutClient({ children, code }) {
  return (
    <AuthProvider>
      <GuestLayoutInner code={code}>
        {children}
      </GuestLayoutInner>
    </AuthProvider>
  );
}
