import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@desigual-os/types'],
  images: {
    // User avatars and message attachments live in Supabase Storage, a different origin
    // than the app itself; next/image refuses unconfigured remote hosts otherwise.
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/**' }],
  },
};

export default nextConfig;
