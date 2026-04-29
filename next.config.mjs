/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'node-ical'],
    // Ensure pricing.db + schema/migrations get bundled into the
    // serverless function output on Vercel. Without this, the tracer
    // skips them (they're not statically imported), the API reads an
    // empty schema, and the rate calendar renders with no data.
    outputFileTracingIncludes: {
      '/api/pricing/**/*': [
        './tools/pricing/pricing.db',
        './tools/pricing/schema.sql',
        './tools/pricing/migrate-*.sql',
      ],
    },
  },
};

export default nextConfig;
