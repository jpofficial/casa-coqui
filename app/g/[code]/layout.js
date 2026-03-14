'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuthProvider } from '@/hooks/useAuth';
import HelpDrawer from '@/components/ui/HelpDrawer';
import { getHelpContext } from '@/lib/help-articles';

function HomeIcon({ active }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.75}
      className="w-6 h-6"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
      />
    </svg>
  );
}

function GuideIcon({ active }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.75}
      className="w-6 h-6"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
      />
    </svg>
  );
}

function InfoIcon({ active }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.75}
      className="w-6 h-6"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
      />
    </svg>
  );
}

function BottomNav({ code, onOpenGuide }) {
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
      match: (p) => p.startsWith(`/g/${code}/access`) || p.startsWith(`/g/${code}/parking`),
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
                className="flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] px-1 py-2 text-xs font-medium transition-colors text-gray-400 hover:text-gray-600 active:text-green-600"
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
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] px-1 py-2 text-xs font-medium transition-colors
                ${active ? 'text-green-600' : 'text-gray-400 hover:text-gray-600 active:text-green-600'}`}
              aria-current={active ? 'page' : undefined}
            >
              <tab.icon active={active} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function GuestLayout({ children, params }) {
  const code = params.code;
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);

  // Clean, chrome-free layout for check-in and join flows
  const isOnboarding = pathname.endsWith('/checkin') || pathname.endsWith('/join') || pathname.endsWith('/get-started');

  const pageKey = getHelpContext(pathname, code);

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Top header — hidden during onboarding */}
        {!isOnboarding && (
          <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm">
            <div className="flex items-center justify-between px-4 h-14 max-w-lg mx-auto w-full">
              <div className="flex items-center gap-2">
                <span className="text-green-600" aria-hidden="true">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-7 h-7"
                  >
                    <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-1.72-1.72V5.25a.75.75 0 00-.75-.75h-1.5a.75.75 0 00-.75.75v1.79l-4.72-4.72a.75.75 0 00-1.06 0l-8.69 8.69a.75.75 0 001.06 1.06l8.16-8.16z" />
                    <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198c.031-.028.061-.056.091-.086L12 5.432z" />
                  </svg>
                </span>
                <span className="text-lg font-semibold text-gray-900 tracking-tight">
                  Casa Coqui
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                  #{code}
                </div>
                <button
                  onClick={() => setHelpOpen(true)}
                  className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
                  aria-label="Open help"
                  title="Help"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-green-600">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.06-1.06 3.5 3.5 0 014.753.45A3.5 3.5 0 0113.5 9.5a2.25 2.25 0 01-2.25 2.25.75.75 0 01-.75-.75v-1a.75.75 0 01.75-.75A.75.75 0 0012 8.5a2 2 0 00-3.06-1.56zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </header>
        )}

        {/* Page content */}
        <main className={`flex-1 ${!isOnboarding ? 'pb-20' : ''} max-w-lg mx-auto w-full`}>
          {children}
        </main>

        {!isOnboarding && <BottomNav code={code} onOpenGuide={() => setHelpOpen(true)} />}

        {/* Help drawer — always mounted, visibility controlled by isOpen */}
        <HelpDrawer
          isOpen={helpOpen}
          onClose={() => setHelpOpen(false)}
          pageKey={pageKey}
        />
      </div>
    </AuthProvider>
  );
}
