'use client';

import { useTheme } from '@/hooks/use-theme';

/** Real light/dark asset pairs (both provided by the design side): a black-wordmark logo and
 * a light wallpaper for light theme, alongside the original white-wordmark logo and dark
 * wallpaper used everywhere else. */
export function useBrandAssets() {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';

  return {
    logoSrc: isLight ? '/brand/desigual-os-logo-black.png' : '/brand/desigual-os-logo.png',
    wallpaperSrc: isLight ? '/brand/fundo-light.png' : '/brand/fundo.png',
  };
}
