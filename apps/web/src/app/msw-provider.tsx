'use client';

import { useEffect, useState } from 'react';

const API_MODE = process.env.NEXT_PUBLIC_API_MODE ?? 'mock';

/**
 * Boots the MSW browser worker before rendering children when running in mock mode.
 * A no-op passthrough in live mode. No component outside this file ever touches src/mocks.
 */
/** Uma vez por aba: sem isto, um unregister que não resolve viraria laço de recarga. */
const CHAVE_DE_RECARGA = 'desigual-os:msw-limpo';

function jaRecarregou(): boolean {
  try {
    return sessionStorage.getItem(CHAVE_DE_RECARGA) === '1';
  } catch {
    // Navegação privada / storage bloqueado: sem memória, não recarrega — é
    // melhor seguir com dado fictício visível que entrar em laço de reload.
    return true;
  }
}

function marcarRecarga(valor: '1' | null): void {
  try {
    if (valor === null) sessionStorage.removeItem(CHAVE_DE_RECARGA);
    else sessionStorage.setItem(CHAVE_DE_RECARGA, valor);
  } catch {
    /* idem acima */
  }
}

/**
 * O SERVICE WORKER DO MSW SOBREVIVE À TROCA DE MODO — e `unregister()` sozinho
 * não resolve.
 *
 * O caso real (07/10/2026): `.env.local` com `NEXT_PUBLIC_API_MODE=live`, API
 * de pé, e mesmo assim a tela mostrava "Clínica Belá" e "G4 Educação" (nomes
 * que só existem em src/mocks). A foto de perfil voltava ao normal a cada F5 —
 * o mock de `POST /me/avatar` devolve um data URI que só vive no cache do
 * React Query — e o convite "funcionava" sem nunca chegar e-mail nenhum,
 * porque o mock de `POST /admin/invite` responde 201 sem falar com a API.
 *
 * A versão anterior deste código já chamava `unregister()`, e não bastava:
 * `unregister()` tira o worker do REGISTRO, mas a página que já está aberta
 * continua sendo CONTROLADA pelo worker antigo até uma nova navegação. Ou
 * seja, a aba inteira segue com todo `fetch` interceptado, servindo mentira
 * com a env certa — que é o pior formato possível de defeito, porque tudo
 * parece funcionar.
 *
 * Por isso aqui, depois de desregistrar, a página recarrega UMA vez quando
 * ainda está sob controle do worker. A marca em `sessionStorage` é o que
 * impede isso de virar laço.
 */
async function limparWorkerDeMock(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const registros = await navigator.serviceWorker.getRegistrations().catch(() => []);
  const doMsw = registros.filter((registro) =>
    [registro.active, registro.waiting, registro.installing].some((worker) =>
      worker?.scriptURL.includes('mockServiceWorker'),
    ),
  );

  if (doMsw.length === 0) {
    // Nada preso: a aba está limpa, e a marca pode valer para uma troca futura.
    marcarRecarga(null);
    return;
  }

  await Promise.all(doMsw.map((registro) => registro.unregister().catch(() => false)));

  const aindaControlada = navigator.serviceWorker.controller?.scriptURL.includes('mockServiceWorker');
  if (!aindaControlada || jaRecarregou()) return;

  marcarRecarga('1');
  window.location.reload();
}

export function MswProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(API_MODE !== 'mock');

  useEffect(() => {
    if (API_MODE !== 'mock') {
      void limparWorkerDeMock();
      return;
    }
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
