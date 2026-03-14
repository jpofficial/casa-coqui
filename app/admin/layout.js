'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { AuthProvider } from '@/hooks/useAuth';
import useAuth from '@/hooks/useAuth';
import { canAccessRoute, getDefaultRedirect } from '@/lib/roles';
import usePush from '@/hooks/usePush';

function AdminLayoutInner({ children }) {
  const { user, loading, role, isStaff, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { requestPermission, supported: pushSupported } = usePush();

  const isLoginPage = pathname === '/admin/login';
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  // Register FCM token for staff push notifications
  useEffect(() => {
    if (!user || !isStaff || !pushSupported) return;
    requestPermission({ staffId: user.uid });
  }, [user, isStaff, pushSupported, requestPermission]);

  useEffect(() => {
    if (loading || isLoginPage) return;

    if (!isStaff) {
      router.replace('/admin/login');
      return;
    }

    // Route guard: redirect if role can't access current path
    if (role && !canAccessRoute(role, pathname)) {
      router.replace(getDefaultRedirect(role));
    }
  }, [loading, isStaff, role, router, isLoginPage, pathname]);

  // Close More menu when clicking outside
  useEffect(() => {
    if (!moreOpen) return;
    function handleClickOutside(e) {
      if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [moreOpen]);

  // Close More menu on route change
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Login page renders without the admin shell
  if (isLoginPage) {
    return children;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-cafe-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-coqui-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-coqui-800/60">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isStaff) {
    return null;
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/admin/login');
  }

  // Cleaner and Maintenance get a simplified shell
  if (role === 'cleaner' || role === 'maintenance') {
    const badgeConfig = {
      cleaner: { label: 'Cleaning', bg: 'bg-atardecer-100', text: 'text-atardecer-800' },
      maintenance: { label: 'Maintenance', bg: 'bg-flamboyan-100', text: 'text-flamboyan-800' },
    };
    const badge = badgeConfig[role];
    return (
      <div className="min-h-screen bg-cafe-50 flex flex-col">
        <header className="bg-white/80 backdrop-blur-sm border-b border-cafe-200 px-4 py-3.5 flex items-center justify-between sticky top-0 z-40 shadow-brand">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-xl text-coqui-700">Casa Coqui</span>
            <span className={`${badge.bg} ${badge.text} text-xs font-semibold px-2.5 py-0.5 rounded-full`}>
              {badge.label}
            </span>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-sm text-coqui-800/50 hover:text-coqui-800 active:text-coqui-900 transition-colors min-h-[44px] px-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1" />
            </svg>
            Sign out
          </button>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  // Full admin/co-host shell
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
      href: '/admin/stays',
      label: 'Active Stays',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      href: '/admin/assignments',
      label: 'Tasks',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
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

  const allMoreLinks = [
    { href: '/admin/bookings', label: 'Bookings' },
    { href: '/admin/notify', label: 'Guest Notifications' },
    { href: '/admin/cleaning', label: 'Cleaning' },
    { href: '/admin/community', label: 'Community Board' },
    { href: '/admin/expenses', label: 'Expenses' },
    { href: '/admin/supplies', label: 'Supplies' },
    { href: '/admin/receipts', label: 'Receipts' },
    { href: '/admin/revenue', label: 'Revenue' },
    { href: '/admin/settings', label: 'Settings' },
    { href: '/admin/team', label: 'Team' },
  ];

  // Filter nav items by role
  const filteredNavTabs = navTabs.filter(
    (tab) => tab.href === '/admin/more' || canAccessRoute(role, tab.href)
  );
  const moreLinks = allMoreLinks.filter((link) => canAccessRoute(role, link.href));

  const isMoreActive = moreLinks.some((l) => pathname === l.href);

  function isTabActive(href) {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  return (
    <div className="min-h-screen bg-cafe-50 flex flex-col">
      {/* Top Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-cafe-200 px-4 py-3.5 flex items-center justify-between sticky top-0 z-40 shadow-brand">
        <div className="flex items-center gap-2.5">
          <span className="font-display text-xl text-coqui-700">Casa Coqui</span>
          <span className="bg-coqui-100 text-coqui-700 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
            Host
          </span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-sm text-coqui-800/50 hover:text-coqui-800 active:text-coqui-900 transition-colors min-h-[44px] px-2"
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
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-cafe-200 z-40 safe-area-pb shadow-brand-lg">
        <div className="flex items-stretch">
          {filteredNavTabs.map((tab) => {
            const active =
              tab.href === '/admin/more'
                ? isMoreActive
                : isTabActive(tab.href);

            if (tab.href === '/admin/more') {
              // Hide More tab if no links available
              if (moreLinks.length === 0) return null;

              return (
                <div key="more" className="flex-1 relative" ref={moreRef}>
                  <button
                    type="button"
                    onClick={() => setMoreOpen((prev) => !prev)}
                    className={`w-full flex flex-col items-center justify-center gap-1 py-2.5 min-h-[60px] transition-all duration-200 ${
                      active || moreOpen
                        ? 'text-coqui-600'
                        : 'text-coqui-800/30 active:text-coqui-800/50'
                    }`}
                  >
                    {tab.icon}
                    <span className="text-[10px] font-semibold leading-none">{tab.label}</span>
                  </button>
                  {/* More dropdown — opens upward on tap */}
                  {moreOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-48 bg-white rounded-xl shadow-brand-lg border border-cafe-200 overflow-hidden z-50 animate-admin-in">
                      {moreLinks.map((link) => {
                        const isActive = pathname === link.href;
                        return (
                          <Link
                            key={link.href}
                            href={link.href}
                            className={`block px-4 py-3 text-sm transition-colors border-b border-cafe-100 last:border-0 ${
                              isActive
                                ? 'bg-coqui-50 text-coqui-700 font-medium'
                                : 'text-coqui-900 hover:bg-cafe-100 active:bg-cafe-200'
                            }`}
                          >
                            {link.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[60px] transition-all duration-200 ${
                  active
                    ? 'text-coqui-600'
                    : 'text-coqui-800/30 active:text-coqui-800/50'
                }`}
              >
                {tab.icon}
                <span className="text-[10px] font-semibold leading-none">{tab.label}</span>
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
