'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { AuthProvider } from '@/hooks/useAuth';
import useAuth from '@/hooks/useAuth';

function AdminLayoutInner({ children }) {
  const { user, loading, isAdmin, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (!loading && !isAdmin && !isLoginPage) {
      router.replace('/admin/login');
    }
  }, [loading, isAdmin, router, isLoginPage]);

  // Login page renders without the admin shell
  if (isLoginPage) {
    return children;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const navTabs = [
    {
      href: '/admin',
      label: 'Dashboard',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
        </svg>
      ),
    },
    {
      href: '/admin/bookings',
      label: 'Bookings',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      href: '/admin/messages',
      label: 'Messages',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 16a2 2 0 01-2 2H7l-4 4V6a2 2 0 012-2h14a2 2 0 012 2v10z" />
        </svg>
      ),
    },
    {
      href: '/admin/more',
      label: 'More',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      ),
    },
  ];

  const moreLinks = [
    { href: '/admin/notify', label: 'Broadcast' },
    { href: '/admin/maintenance', label: 'Maintenance' },
    { href: '/admin/expenses', label: 'Expenses' },
    { href: '/admin/supplies', label: 'Supplies' },
    { href: '/admin/receipts', label: 'Receipts' },
    { href: '/admin/revenue', label: 'Revenue' },
    { href: '/admin/calendar', label: 'Calendar' },
    { href: '/admin/settings', label: 'Settings' },
  ];

  const isMoreActive = moreLinks.some((l) => pathname === l.href);

  function isTabActive(href) {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/admin/login');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <span className="text-green-600 font-bold text-xl">Casa Coqui</span>
          <span className="text-gray-400 text-sm font-medium">Admin</span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 active:text-gray-900 transition-colors min-h-[44px] px-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1" />
          </svg>
          Sign out
        </button>
      </header>

      {/* Page content */}
      <main className="flex-1 pb-20">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 safe-area-pb">
        <div className="flex items-stretch">
          {navTabs.map((tab) => {
            const active =
              tab.href === '/admin/more'
                ? isMoreActive
                : isTabActive(tab.href);

            if (tab.href === '/admin/more') {
              return (
                <div key="more" className="flex-1 relative group">
                  <button className={`w-full flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors ${active ? 'text-green-600' : 'text-gray-400'}`}>
                    {tab.icon}
                    <span className="text-[10px] font-medium leading-none">{tab.label}</span>
                  </button>
                  {/* More dropdown — opens upward on tap via focus-within */}
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
                key={tab.href}
                href={tab.href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors ${active ? 'text-green-600' : 'text-gray-400'}`}
              >
                {tab.icon}
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
              </Link>
            );
          })}
        </div>
        {/* iOS safe area spacer */}
        <div className="h-safe-b" style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
      </nav>
    </div>
  );
}

export default function AdminLayout({ children }) {
  return (
    <AuthProvider>
      <AdminLayoutInner>{children}</AdminLayoutInner>
    </AuthProvider>
  );
}
