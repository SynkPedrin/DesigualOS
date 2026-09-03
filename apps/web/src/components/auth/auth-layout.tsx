'use client';

import Image from 'next/image';
import { useBrandAssets } from '@/hooks/use-brand-assets';

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { logoSrc, wallpaperSrc } = useBrandAssets();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-carbono px-4">
      <Image src={wallpaperSrc} alt="" fill priority sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-carbono/70" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Image src={logoSrc} alt="desigual OS" width={200} height={67} priority className="h-auto w-[200px]" />
        </div>
        <div className="rounded-lg border border-grafite-elevado bg-carbono/90 p-8 shadow-elevated backdrop-blur-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
