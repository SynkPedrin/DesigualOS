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
 *
 * `min-w-0 flex-1 w-full`: some callers (Hoje, Calendário) put PageHeader inside a flex row
 * next to another element (a date label, a view toggle). Without an explicit grow/fill rule
 * the banner was shrinking to its own content width instead of filling the row - measured
 * 08/10/2026, banner came out a third of the width of every other page's title card.
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
    <div className={cn('relative w-full min-w-0 flex-1 overflow-hidden rounded-lg border border-grafite-elevado', className)}>
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
