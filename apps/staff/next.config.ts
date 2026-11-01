import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@salon/ui', '@salon/config'],
  poweredByHeader: false,
};

export default nextConfig;
