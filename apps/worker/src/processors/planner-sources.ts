import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';
import { precisaResincronizar } from '@desigual-os/context-engine';
import { buscarTasksDaLista } from './campaign-context';
import { buscarEventosRecentes, formatRecentEventsBlock, type EventoRecente } from './recent-events';
import { formatLiveTasksBlock, type PlanoDeRecuperacao, type TarefaLive } from './retrieval-planner';

/**
 * planner-sources.ts — executa o que o retrieval-planner decidiu.
 *
 * O planner (puro, determinístico) SUGERE fontes; este coletor é onde os
 * guards existentes VETAM e onde toda falha degrada sem derrubar o turno —
 * o mesmo contrato do resto do dispatch: fonte nova é reforço, nunca
 * pré-requisito.
 *
 * Tudo roda num Promise.all: com o Postgres remoto a ~300ms de RTT, cada
 * gather sequencial seria pago em latência de turno.
 */

export interface FontesDoPlano {
  eventos: EventoRecente[];
  blocoEventos: string;
  /**
   * Null = não consultou (plano não pediu, ou o guard vetou). Array — mesmo
   * vazio — = consultou ao vivo; o formato decide se vira bloco (lista vazia
   * não vira afirmação de "0 tarefas", ver formatLiveTasksBlock).
   */
  tarefasLive: TarefaLive[] | null;
  blocoTarefasLive: string;
}

export const FONTES_VAZIAS: FontesDoPlano = { eventos: [], blocoEventos: '', tarefasLive: null, blocoTarefasLive: '' };

/** O clickup_list_id do cliente, ou null. Falha de banco = sem lista. */
export async function listIdDoCliente(clientId: string): Promise<string | null> {
  const [c] = await db
    .select({ listId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .catch(() => []);
  return c?.listId ?? null;
}

/**
 * A consulta AO VIVO respeitando a janela. O planner sugere; quem veta é o
 * MESMO guard da autocura de campanha (`precisaResincronizar`, frescor de
 * 5min): registro sincronizado há menos de 5min significa que o bloco de
 * campanha já carrega o estado recente, e bater no ClickUp de novo seria
 * latência e custo sem dado novo. Sem lista, sem consulta.
 */
async function buscarTarefasLiveComGuard(
  clientId: string,
  listId: string | null,
  organizationId: string | null,
): Promise<TarefaLive[] | null> {
  if (!listId) return null;
  const janelaAberta = await precisaResincronizar(clientId).catch(() => false);
  if (!janelaAberta) return null;
  // buscarTasksDaLista já degrada por dentro: provedor ausente ou falha de
  // rede voltam [], nunca exceção.
  return buscarTasksDaLista(listId, organizationId);
}

export async function coletarFontesDoPlano(
  plano: PlanoDeRecuperacao,
  params: {
    clientId: string | null;
    /** Já resolvido pelo chamador quando o plano pede live (evita query dupla). */
    listId?: string | null;
    organizationId?: string | null;
    userId?: string | null;
  },
): Promise<FontesDoPlano> {
  if (!plano.incluirEventosRecentes && !plano.consultarTarefasLive) return FONTES_VAZIAS;

  const [eventos, tarefasLive] = await Promise.all([
    plano.incluirEventosRecentes
      ? buscarEventosRecentes({
          clientId: params.clientId,
          organizationId: params.organizationId ?? null,
          userId: params.userId ?? null,
        }).catch(() => [] as EventoRecente[])
      : Promise.resolve([] as EventoRecente[]),
    plano.consultarTarefasLive && params.clientId
      ? buscarTarefasLiveComGuard(params.clientId, params.listId ?? null, params.organizationId ?? null).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    eventos,
    blocoEventos: formatRecentEventsBlock(eventos),
    tarefasLive,
    blocoTarefasLive: tarefasLive ? formatLiveTasksBlock(tarefasLive) : '',
  };
}
