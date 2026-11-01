import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@salon/ui', '@salon/config'],
  poweredByHeader: false,
  // Served at <domain>/admin via a Cloudflare route to this Worker (see docs/DEPLOYMENT.md).
  basePath: '/admin',
};

export default nextConfig;
