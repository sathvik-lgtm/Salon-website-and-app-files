import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@salon/ui', '@salon/config', '@salon/db', '@salon/booking', '@salon/security'],
  poweredByHeader: false,
  // Served at <domain>/admin via a Cloudflare route to this Worker (see docs/DEPLOYMENT.md).
  basePath: '/admin',
  async headers() {
    return [
      {
        // Every page and API response: never indexed, and never kept by a browser or proxy cache,
        // because they show private bookings and customer details. (Static files keep their own caching.)
        source: '/((?!_next/static|_next/image|icons/).*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
