'use client';

import { useEffect, useRef, useState } from 'react';
import { useMe } from '@/hooks/use-me';
import { useUpdateMe } from '@/hooks/use-update-me';
import { ThemeContext } from '@/hooks/use-theme';
import type { Theme } from '@/lib/api/contracts';

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Applies the theme preference to <html data-theme> (see tokens.css). Defaults to 'system'
 * before login/signup, where there is no /me yet. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { data: me } = useMe();
  const updateMe = useUpdateMe();
  // Wins over `me` once the user interacts, so the toggle feels instant instead of waiting on
  // the PATCH /me round-trip; useUpdateMe's onSuccess keeps `me` in sync anyway.
  const [localTheme, setLocalTheme] = useState<Theme | null>(null);
  const theme = localTheme ?? me?.theme ?? 'system';
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');
  const hasAppliedOnce = useRef(false);

  useEffect(() => {
    function applyAttribute() {
      const resolved = theme === 'system' ? resolveSystemTheme() : theme;
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    }

    function apply() {
      // First paint sets the theme outright — nothing to cross-fade from yet, and animating
      // it would just be a flash of the wrong theme. Every change after that gets the
      // View Transitions cross-fade (see tokens.css for the animation-duration override),
      // with a plain instant swap on browsers that don't support it yet (Firefox).
      if (hasAppliedOnce.current && document.startViewTransition) {
        const transition = document.startViewTransition(applyAttribute);
        // Toggling again before the ~0.45s cross-fade finishes aborts the prior transition by
        // spec (only one can run at a time) — expected, not an error, but its promises reject
        // with InvalidStateError and the browser reports that as an unhandled rejection unless
        // something is listening.
        transition.ready.catch(() => {});
        transition.finished.catch(() => {});
      } else {
        applyAttribute();
      }
      hasAppliedOnce.current = true;
    }

    apply();
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);

  function setTheme(next: Theme) {
    setLocalTheme(next);
    updateMe.mutate({ theme: next });
  }

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}
