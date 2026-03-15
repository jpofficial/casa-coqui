import GuestLayoutClient from './guest-layout-client';

export async function generateMetadata({ params }) {
  const { code } = params;
  return {
    manifest: `/api/manifest/${code}`,
  };
}

export default function GuestLayout({ children, params }) {
  return (
    <GuestLayoutClient code={params.code}>
      {children}
    </GuestLayoutClient>
  );
}
