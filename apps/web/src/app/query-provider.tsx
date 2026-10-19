'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // 3 em vez de 1: uma falha transitória (recompilação do dev server,
            // service worker reativando após hot-reload) não pode virar "Falha
            // ao carregar" permanente numa demo — isso já aconteceu.
            retry: 3,
            retryDelay: (tentativa) => Math.min(1000 * 2 ** tentativa, 8000),
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
