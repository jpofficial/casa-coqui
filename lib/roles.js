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
      '/admin/getting-started',
      '/admin/stays',
      '/admin/assignments',
      '/admin/calendar',
      '/admin/cleaning',
      '/admin/community',
      '/admin/maintenance',
      '/admin/messages',
      '/admin/hours',
      '/admin/staff-messages',
      '/admin/staff-notifications',
      '/admin/notification-settings',
    ],
    defaultRedirect: '/admin',
  },
  cleaner: {
    label: 'Cleaner',
    allowedRoutes: ['/admin/cleaning', '/admin/getting-started', '/admin/staff-notifications', '/admin/notification-settings'],
    defaultRedirect: '/admin/cleaning',
  },
  maintenance: {
    label: 'Maintenance',
    allowedRoutes: ['/admin/assignments', '/admin/getting-started', '/admin/staff-notifications', '/admin/notification-settings'],
    defaultRedirect: '/admin/assignments',
  },
};

/** All roles that can be invited by admin */
export const INVITABLE_ROLES = ['cohost', 'cleaner', 'maintenance'];

export function canAccessRoute(role, pathname) {
  const config = ROLES[role];
  if (!config) return false;
  if (config.allowedRoutes === '*') return true;
  return config.allowedRoutes.some(
    (route) => {
      if (route === '/admin') return pathname === '/admin';
      return pathname === route || pathname.startsWith(route + '/');
    }
  );
}

export function getDefaultRedirect(role) {
  const config = ROLES[role];
  return config?.defaultRedirect || '/admin/login';
}
