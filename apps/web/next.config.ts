import type { NextConfig } from 'next';
import { securityHeaders } from '@salon/security/headers';

const development = process.env.NODE_ENV !== 'production';

const nextConfig: NextConfig = {
  transpilePackages: ['@salon/ui', '@salon/config', '@salon/db', '@salon/booking', '@salon/security'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Only the booking page loads Turnstile, so only it may talk to Cloudflare's challenge host.
        source: '/book',
        headers: securityHeaders({ development, turnstile: true, analytics: true }),
      },
      {
        source: '/((?!book$|_next/static|_next/image).*)',
        headers: securityHeaders({ development, analytics: true }),
      },
    ];
  },
};

export default nextConfig;
