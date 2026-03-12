export const ROLES = {
  admin: {
    label: 'Admin',
    allowedRoutes: '*',
    defaultRedirect: '/admin',
  },
  cohost: {
    label: 'Co-host',
    allowedRoutes: [
      '/admin',
      '/admin/bookings',
      '/admin/messages',
      '/admin/maintenance',
      '/admin/calendar',
      '/admin/notify',
    ],
    defaultRedirect: '/admin',
  },
  cleaner: {
    label: 'Cleaner',
    allowedRoutes: ['/admin/cleaning'],
    defaultRedirect: '/admin/cleaning',
  },
};

export function canAccessRoute(role, pathname) {
  const config = ROLES[role];
  if (!config) return false;
  if (config.allowedRoutes === '*') return true;
  return config.allowedRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  );
}

export function getDefaultRedirect(role) {
  const config = ROLES[role];
  return config?.defaultRedirect || '/admin/login';
}
