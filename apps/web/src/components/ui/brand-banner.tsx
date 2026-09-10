'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useBrandAssets } from '@/hooks/use-brand-assets';
import { cn } from '@/lib/utils';

/**
 * Full-bleed textured background, with a dark overlay for WCAG AA contrast and content on
 * top. Two backgrounds supported: the static brand wallpaper (default), or a looping motion
 * video (`videoSrc`) for a more dynamic title card - falls back to the wallpaper if the video
 * fails to load (slow network, corrupt file) instead of showing a broken player.
 */
export function BrandBanner({
  children,
  className,
  videoSrc,
}: {
  children: React.ReactNode;
  className?: string;
  videoSrc?: string;
}) {
  const { wallpaperSrc } = useBrandAssets();
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-grafite-elevado', className)}>
      {videoSrc && !videoFailed ? (
        <video
          key={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
          onError={() => setVideoFailed(true)}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      ) : (
        <Image src={wallpaperSrc} alt="" fill sizes="100vw" className="object-cover" priority />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-carbono/95 via-carbono/80 to-carbono/40" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
