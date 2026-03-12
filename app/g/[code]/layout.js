'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuthProvider } from '@/hooks/useAuth';

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

function CheckInIcon({ active }) {
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
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
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

function MoreIcon({ active }) {
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
        d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
      />
    </svg>
  );
}

function BottomNav({ code }) {
  const pathname = usePathname();

  const moreLinks = [
    { href: `/g/${code}/rules`, label: 'House Rules' },
    { href: `/g/${code}/laundry`, label: 'Laundry' },
    { href: `/g/${code}/community`, label: 'Community' },
    { href: `/g/${code}/maintenance`, label: 'Maintenance' },
    { href: `/g/${code}/chat`, label: 'Message Host' },
  ];

  const isMoreActive = moreLinks.some((l) => pathname.startsWith(l.href));

  const tabs = [
    {
      label: 'Home',
      href: `/g/${code}`,
      icon: HomeIcon,
      match: (p) => p === `/g/${code}`,
    },
    {
      label: 'Check-In',
      href: `/g/${code}/checkin`,
      icon: CheckInIcon,
      match: (p) => p.startsWith(`/g/${code}/checkin`),
    },
    {
      label: 'Info',
      href: `/g/${code}/access`,
      icon: InfoIcon,
      match: (p) => p.startsWith(`/g/${code}/access`) || p.startsWith(`/g/${code}/parking`),
    },
    {
      label: 'More',
      href: null,
      icon: MoreIcon,
      match: () => isMoreActive,
      isMore: true,
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

          if (tab.isMore) {
            return (
              <div key="more" className="flex-1 relative group">
                <button
                  className={`w-full flex flex-col items-center justify-center gap-0.5 min-h-[56px] px-1 py-2 text-xs font-medium transition-colors
                    ${active ? 'text-green-600' : 'text-gray-400 hover:text-gray-600 active:text-green-600'}`}
                >
                  <tab.icon active={active} />
                  <span>{tab.label}</span>
                </button>
                <div className="absolute bottom-full right-0 mb-1 w-44 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden opacity-0 pointer-events-none group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity z-50">
                  {moreLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 border-b border-gray-50 last:border-0"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
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

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Top header */}
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
            <div className="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
              #{code}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 pb-20 max-w-lg mx-auto w-full">
          {children}
        </main>

        <BottomNav code={code} />
      </div>
    </AuthProvider>
  );
}
