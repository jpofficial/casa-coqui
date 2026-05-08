import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { code } = params;

  const manifest = {
    name: 'Casa Coqui',
    short_name: 'Casa Coqui',
    description: 'Guest portal for Casa Coqui',
    start_url: `/g/${code}`,
    scope: '/',
    display: 'standalone',
    background_color: '#fdfbf7',
    theme_color: '#137a47',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
    },
  });
}
