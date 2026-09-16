import { db, schema } from '@desigual-os/database';
import { and, eq } from 'drizzle-orm';
import { derivarCampanhas } from './campaign-derivation.js';

/**
 * campaign-sync.ts — mantém o registro de campanhas VIVO.
 *
 * Reconciliação completa é cara e roda de tempos em tempos; entre uma e outra a
 * fonte muda o tempo inteiro. Duas saídas, nesta ordem de esforço:
 *
 *  - INCREMENTAL: o webhook do ClickUp (taskCreated/taskUpdated) atualiza a
 *    campanha daquela lista na hora;
 *  - AUTOCURA: se alguém citar uma campanha e ela não estiver no registro, o
 *    turno re-sincroniza o cliente ANTES de desistir. Esse é o ponto que a
 *    operação cobrou: se existe na fonte e o índice não achou, o sistema tem
 *    que se recuperar sozinho, não transferir a falha pra quem perguntou.
 *
 * Sem dependência de ClickUp aqui dentro: o chamador injeta `buscarTasks`, o
 * que mantém o context-engine testável e sem acoplar a HTTP.
 */

export interface TaskDaFonte {
  id: string;
  name: string;
  description?: string;
  status?: string | null;
  closed: boolean;
  updatedAt?: Date | null;
}

export type BuscarTasksDaLista = (listId: string) => Promise<TaskDaFonte[]>;

export interface ResultadoDeSync {
  clientId: string;
  campanhas: number;
  novas: number;
  atualizadas: number;
}

/**
 * Re-deriva TODAS as campanhas de um cliente a partir da lista dele. É
 * idempotente por (cliente, nome normalizado), então rodar demais só custa
 * tempo — nunca duplica nem perde histórico.
 */
export async function sincronizarCampanhasDoCliente(
  clientId: string,
  listId: string,
  buscarTasks: BuscarTasksDaLista,
): Promise<ResultadoDeSync> {
  const tasks = await buscarTasks(listId);
  const derivadas = derivarCampanhas(tasks);

  const existentes = await db
    .select({ normalizedName: schema.campaigns.normalizedName })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.clientId, clientId))
    .catch(() => []);
  const jaConhecidas = new Set(existentes.map((e) => e.normalizedName));

  let novas = 0;
  let atualizadas = 0;
  const agora = new Date();

  for (const c of derivadas) {
    if (jaConhecidas.has(c.normalizedName)) atualizadas += 1;
    else novas += 1;

    await db
      .insert(schema.campaigns)
      .values({
        clientId,
        canonicalName: c.canonicalName,
        normalizedName: c.normalizedName,
        aliases: c.aliases,
        status: c.openTaskCount > 0 ? 'active' : 'historical',
        sourceType: 'clickup',
        sourceListId: listId,
        taskRefs: c.taskRefs,
        recentTasks: c.recentTasks,
        taskCount: c.taskCount,
        openTaskCount: c.openTaskCount,
        lastSourceUpdateAt: c.lastSourceUpdateAt,
        lastSyncAt: agora,
        updatedAt: agora,
      })
      .onConflictDoUpdate({
        target: [schema.campaigns.clientId, schema.campaigns.normalizedName],
        set: {
          canonicalName: c.canonicalName,
          aliases: c.aliases,
          status: c.openTaskCount > 0 ? 'active' : 'historical',
          taskRefs: c.taskRefs,
          recentTasks: c.recentTasks,
          taskCount: c.taskCount,
          openTaskCount: c.openTaskCount,
          lastSourceUpdateAt: c.lastSourceUpdateAt,
          lastSyncAt: agora,
          updatedAt: agora,
        },
      })
      .catch(() => undefined);
  }

  await db
    .insert(schema.clientKnowledgeSync)
    .values({
      clientId, source: 'campaigns', status: derivadas.length > 0 ? 'ok' : 'empty',
      documentCount: derivadas.length, lastSyncAt: agora, updatedAt: agora,
    })
    .onConflictDoUpdate({
      target: [schema.clientKnowledgeSync.clientId, schema.clientKnowledgeSync.source],
      set: {
        status: derivadas.length > 0 ? 'ok' : 'empty',
        documentCount: derivadas.length, lastSyncAt: agora, updatedAt: agora,
      },
    })
    .catch(() => undefined);

  return { clientId, campanhas: derivadas.length, novas, atualizadas };
}

/** Quanto tempo um sync de cliente vale antes de valer a pena refazer. */
const FRESCOR_MINIMO_MS = 5 * 60_000;

/**
 * Autocura: só re-sincroniza se o último sync deste cliente já passou da
 * validade. Impede que uma pergunta mal formulada, repetida, vire tempestade de
 * chamadas ao ClickUp no meio do turno de quem está trabalhando.
 */
export async function precisaResincronizar(clientId: string, agora = new Date()): Promise<boolean> {
  const [linha] = await db
    .select({ lastSyncAt: schema.clientKnowledgeSync.lastSyncAt })
    .from(schema.clientKnowledgeSync)
    .where(and(eq(schema.clientKnowledgeSync.clientId, clientId), eq(schema.clientKnowledgeSync.source, 'campaigns')))
    .catch(() => []);
  if (!linha?.lastSyncAt) return true;
  return agora.getTime() - linha.lastSyncAt.getTime() > FRESCOR_MINIMO_MS;
}
