import { createHash } from 'node:crypto';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'clickup-cache-de-lista' });

/**
 * CACHE DAS TAREFAS DE UMA LISTA DO CLICKUP.
 *
 * A tela de Clientes seleciona o primeiro cliente sozinha e, com ele, busca as
 * tarefas dele no ClickUp. Medido em 09/10/2026, em três cargas seguidas da
 * mesma tela: 12,6s, 8,3s e 5,8s — e uma quarta que não respondeu em 18s. Toda
 * carga pagava a ida inteira ao ClickUp, porque esta rota não tinha cache
 * nenhum. O portão de captura recusou /clients nas TRÊS resoluções por causa
 * disso: o esqueleto ainda estava lá quando a foto foi tirada.
 *
 * O comentário da rota dizia, com razão, que o ClickUp é a fonte de verdade e
 * que a tela não deve mostrar cópia velha. Isto não contradiz aquilo, e é a
 * mesma conciliação que `consultarComCache` (routes.ts) já faz para a consulta
 * agregada:
 *
 * - até 60s, serve o guardado sem ir ao ClickUp;
 * - entre 60s e 10min, serve o guardado E relê em segundo plano;
 * - o webhook de tarefa alterada ESVAZIA tudo, então uma mudança feita no
 *   ClickUp aparece na leitura seguinte, não daqui a um minuto.
 *
 * É por causa da última linha que "mais rápido" e "mais atualizado" cabem
 * juntos. Sem o webhook, isto seria só cópia velha com outro nome.
 */
const FRESCO_MS = 60_000;
const VALIDADE_MS = 600_000;
const LIMITE_DE_LISTAS = 200;

interface Guardado<T> {
  em: number;
  tarefas: T;
  renovando: boolean;
}

const listasEmCache = new Map<string, Guardado<unknown>>();

/**
 * O token entra como hash, nunca inteiro.
 *
 * Duas pessoas com acesso diferente ao mesmo `listId` não podem compartilhar
 * entrada: quem perdeu acesso no ClickUp continuaria lendo pelo cache de quem
 * tem. E a chave vive em memória de um processo que loga — token em claro numa
 * chave de mapa é token a um `console.log` de distância.
 */
export function chaveDaLista(token: string, listId: string, incluirFechadas: boolean): string {
  const credencial = createHash('sha256').update(token).digest('hex').slice(0, 12);
  return `${listId}|${credencial}|${incluirFechadas ? 'com-fechadas' : 'so-abertas'}`;
}

export async function tarefasDaListaComCache<T>(
  token: string,
  listId: string,
  incluirFechadas: boolean,
  buscar: () => Promise<T>,
): Promise<T> {
  const chave = chaveDaLista(token, listId, incluirFechadas);
  const agora = Date.now();
  const guardado = listasEmCache.get(chave) as Guardado<T> | undefined;

  if (guardado && agora - guardado.em < VALIDADE_MS) {
    if (agora - guardado.em >= FRESCO_MS && !guardado.renovando) {
      guardado.renovando = true;
      /**
       * `void` com `.catch` obrigatório: releitura que falha em segundo plano
       * não pode virar unhandled rejection e derrubar o processo. Falhou, o
       * cache segue com o valor anterior e a próxima chamada tenta de novo —
       * nunca pior do que não ter cache.
       */
      void buscar()
        .then((tarefas) => listasEmCache.set(chave, { em: Date.now(), tarefas, renovando: false }))
        .catch((error) => {
          guardado.renovando = false;
          logger.warn(
            { error, listId },
            'Releitura em segundo plano das tarefas da lista falhou; servindo o cache anterior',
          );
        });
    }
    return guardado.tarefas;
  }

  const tarefas = await buscar();
  // Teto de memória: uma carteira grande não pode virar vazamento.
  if (listasEmCache.size >= LIMITE_DE_LISTAS) {
    const maisAntiga = listasEmCache.keys().next().value;
    if (maisAntiga !== undefined) listasEmCache.delete(maisAntiga);
  }
  listasEmCache.set(chave, { em: Date.now(), tarefas, renovando: false });
  return tarefas;
}

/**
 * Chamado pelo webhook de tarefa alterada. Esvazia tudo em vez de procurar a
 * entrada certa: descobrir em quais listas aquela tarefa aparece custaria mais
 * do que a releitura, e o evento é raro perto do número de leituras.
 */
export function esquecerTarefasDaLista(): void {
  listasEmCache.clear();
}
