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
    if (process.env.NODE_ENV === 'production') {
      // NEXT_PUBLIC_API_MODE não foi setada como 'live' num build de produção - o app
      // inteiro está servindo dados fake do MSW sem ninguém ter pedido isso de propósito.
      // console.error de propósito (não warn): isso é um erro de configuração de deploy,
      // não um estado válido de produção, e precisa aparecer bem alto em qualquer
      // ferramenta de log de erro de frontend (Sentry etc).
      console.error(
        '[desigual-os] NEXT_PUBLIC_API_MODE não está setada como "live" em produção. ' +
          'O app subiu servindo dados fictícios do MSW (modo demonstração). ' +
          'Configure NEXT_PUBLIC_API_MODE=live e NEXT_PUBLIC_API_URL no ambiente de deploy.',
      );
    }
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
