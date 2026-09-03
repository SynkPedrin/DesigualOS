'use client';

import { useEffect, useState } from 'react';

const API_MODE = process.env.NEXT_PUBLIC_API_MODE ?? 'mock';

/**
 * Boots the MSW browser worker before rendering children when running in mock mode.
 * A no-op passthrough in live mode. No component outside this file ever touches src/mocks.
 */
export function MswProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(API_MODE !== 'mock');

  useEffect(() => {
    if (API_MODE !== 'mock') return;
    let cancelled = false;
    import('@/mocks/browser').then(({ startWorkerOnce }) => {
      startWorkerOnce().then(() => {
        if (!cancelled) setReady(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
