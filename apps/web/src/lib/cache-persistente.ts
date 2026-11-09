import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';

/**
 * AS TELAS ABREM COM O QUE JÁ ESTAVA NELAS (04/11/2026, "deixe ele bem rápido, quase instantâneo").
 *
 * Toda abertura do sistema (ou recarga) começava do zero: cada tela esperava o servidor, que fica a ~270 ms do banco
 * por consulta. Agora o último resultado das telas de trabalho fica guardado NESTE navegador (IndexedDB) e é mostrado
 * na hora; a busca de sempre corre por trás e substitui o que mudou. Nada de dado novo nasce daqui: é o mesmo que a
 * pessoa já via, de no máximo um dia atrás.
 *
 * PRIVACIDADE: guardado por usuário. Entrar com outra conta descarta o que era da anterior; sair apaga. Só as
 * famílias de consulta abaixo (trabalho do dia a dia), nunca tudo.
 */

const BANCO = 'desigual-os-cache';
const LOJA = 'consultas';
const CHAVE = 'telas';
const VALIDADE_MS = 24 * 60 * 60 * 1000;
/**
 * Primeiro pedaço da chave de consulta das telas que vale guardar. Notificações NÃO: a primeira leva do sino é o
 * acervo (não toca som); vinda de um cache velho, o que chegou com o sistema fechado tocaria tudo de uma vez ao abrir.
 */
const FAMILIAS = new Set(['work', 'me', 'internal-chat', 'gestao', 'today', 'clients', 'calendar']);

interface Guardado { userId: string; salvoEm: number; estado: DehydratedState }

function abrir(): Promise<IDBDatabase | null> {
  return new Promise((ok) => {
    try {
      if (typeof indexedDB === 'undefined') return ok(null);
      const pedido = indexedDB.open(BANCO, 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => ok(null);
      pedido.onblocked = () => ok(null);
    } catch {
      ok(null);
    }
  });
}

async function operar<T>(modo: IDBTransactionMode, fazer: (loja: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const banco = await abrir();
  if (!banco) return null;
  return new Promise((ok) => {
    try {
      const pedido = fazer(banco.transaction(LOJA, modo).objectStore(LOJA));
      pedido.onsuccess = () => { ok(pedido.result); banco.close(); };
      pedido.onerror = () => { ok(null); banco.close(); };
    } catch {
      ok(null);
      banco.close();
    }
  });
}

/** Põe no cache o que estava guardado para esta pessoa. Nunca sobrescreve dado mais novo que já esteja na tela. */
export async function restaurarCache(client: QueryClient, userId: string): Promise<void> {
  const g = await operar<Guardado | undefined>('readonly', (l) => l.get(CHAVE) as IDBRequest<Guardado | undefined>);
  if (!g) return;
  if (g.userId !== userId || Date.now() - g.salvoEm > VALIDADE_MS) {
    await esquecerCache();
    return;
  }
  try {
    hydrate(client, g.estado);
  } catch {
    await esquecerCache();
  }
}

/**
 * Guarda o estado das telas a cada mudança, agrupado (no máximo uma gravação a cada 3 s; a página fechando grava na
 * hora). Devolve a função que para de guardar.
 */
export function persistirCache(client: QueryClient, userId: string): () => void {
  let pendente: ReturnType<typeof setTimeout> | null = null;
  const gravar = () => {
    pendente = null;
    try {
      const estado = dehydrate(client, {
        shouldDehydrateQuery: (q) => q.state.status === 'success' && FAMILIAS.has(String(q.queryKey[0])),
      });
      void operar('readwrite', (l) => l.put({ userId, salvoEm: Date.now(), estado } satisfies Guardado, CHAVE));
    } catch {
      // Dado que não se deixa copiar (não deveria existir nas telas guardadas): fica sem cache, a tela segue normal.
    }
  };
  const agendar = () => { if (!pendente) pendente = setTimeout(gravar, 3_000); };
  const cancelar = client.getQueryCache().subscribe((e) => { if (e.type === 'updated' && e.action.type === 'success') agendar(); });
  const aoSair = () => { if (pendente) { clearTimeout(pendente); gravar(); } };
  window.addEventListener('pagehide', aoSair);
  return () => {
    cancelar();
    window.removeEventListener('pagehide', aoSair);
    if (pendente) clearTimeout(pendente);
  };
}

export async function esquecerCache(): Promise<void> {
  await operar('readwrite', (l) => l.delete(CHAVE));
}
