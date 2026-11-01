import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@salon/ui', '@salon/config', '@salon/db', '@salon/booking', '@salon/security'],
  poweredByHeader: false,
};

export default nextConfig;
