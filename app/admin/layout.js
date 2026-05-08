import AdminLayoutClient from './admin-layout-client';

export const metadata = {
  manifest: '/manifest-admin.json',
};

export default function AdminLayout({ children }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
