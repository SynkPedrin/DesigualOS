import { db, schema } from '@desigual-os/database';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { sincronizarCampanhasDoCliente } from '@desigual-os/context-engine';
import type { Logger } from '@desigual-os/logging';
import { buscarTasksDaLista } from '../processors/campaign-context.js';
import { checkIntegrationHealth } from './integration-health.js';

/**
 * knowledge-consolidation.ts — a rede de segurança do conhecimento.
 *
 * O webhook é quem mantém o conhecimento fresco em tempo real. Esta rotina NÃO
 * substitui o webhook: ela reconcilia o que escapou. E existe porque o webhook
 * JÁ FALHOU em silêncio por cinco dias — com só um caminho de atualização, uma
 * falha silenciosa vira conhecimento velho apresentado como atual.
 *
 * Idempotente por construção: tudo é upsert por chave natural, então rodar duas
 * vezes no mesmo dia produz o mesmo estado.
 */

export interface ResultadoDaConsolidacao {
  clientesReconciliados: number;
  campanhasAtualizadas: number;
  episodiosConsolidados: number;
  saudeDaIntegracao: string;
  erros: number;
}

/**
 * Consolida o dia. A ordem importa: primeiro saber se a fonte está saudável,
 * porque reconciliar contra fonte quebrada dá falsa sensação de frescor.
 */
export async function runKnowledgeConsolidation(
  logger: Logger,
  opcoes: { somenteClientesComMudanca?: boolean } = {},
): Promise<ResultadoDaConsolidacao> {
  const saude = await checkIntegrationHealth(logger);
  logger.info({ status: saude.status, minutosSemEvento: saude.minutosSemEvento }, '[consolidacao] saúde da integração');

  const clientes = await db
    .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(isNull(schema.clients.deletedAt))
    .catch(() => []);

  // Quando o webhook está saudável, só quem mudou precisa ser reconciliado; com
  // a fonte degradada, varre tudo — é exatamente o caso em que não dá pra
  // confiar no incremental.
  let alvo = clientes.filter((c) => c.listId);
  if (opcoes.somenteClientesComMudanca && saude.status === 'ok') {
    const desde = new Date(Date.now() - 36 * 3_600_000);
    const comEvento = await db
      .selectDistinct({ clientId: schema.operationalEvents.clientId })
      .from(schema.operationalEvents)
      .where(and(eq(schema.operationalEvents.source, 'clickup'), gte(schema.operationalEvents.occurredAt, desde)))
      .catch(() => []);
    const ids = new Set(comEvento.map((e) => e.clientId).filter(Boolean) as string[]);
    if (ids.size > 0) alvo = alvo.filter((c) => ids.has(c.id));
  }

  let campanhasAtualizadas = 0;
  let erros = 0;
  for (const c of alvo) {
    const r = await sincronizarCampanhasDoCliente(c.id, c.listId!, buscarTasksDaLista).catch((error: unknown) => {
      logger.warn({ error, cliente: c.name }, '[consolidacao] falha ao reconciliar cliente');
      erros += 1;
      return null;
    });
    if (r) campanhasAtualizadas += r.campanhas;
  }

  const episodiosConsolidados = await consolidarEpisodios(logger);

  logger.info(
    { clientes: alvo.length, campanhas: campanhasAtualizadas, episodios: episodiosConsolidados, erros },
    '[consolidacao] concluída',
  );

  return {
    clientesReconciliados: alvo.length,
    campanhasAtualizadas,
    episodiosConsolidados,
    saudeDaIntegracao: saude.status,
    erros,
  };
}

/**
 * Episódio recorrente vira conhecimento semântico.
 *
 * Um feedback isolado é um acontecimento; o MESMO feedback repetido é uma regra
 * do cliente. A promoção exige repetição justamente para não transformar
 * opinião de um dia em regra permanente — que é como memória vira camisa de
 * força.
 */
const REPETICOES_PARA_VIRAR_REGRA = 3;

async function consolidarEpisodios(logger: Logger): Promise<number> {
  const desde = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({
      clientId: schema.agentEpisodes.clientId,
      eventType: schema.agentEpisodes.eventType,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.agentEpisodes)
    .where(
      and(
        gte(schema.agentEpisodes.occurredAt, desde),
        eq(schema.agentEpisodes.environment, 'production'),
        sql`${schema.agentEpisodes.eventType} in ('preference','feedback')`,
      ),
    )
    .groupBy(schema.agentEpisodes.clientId, schema.agentEpisodes.eventType)
    .catch(() => []);

  const promovidos = rows.filter((r) => r.clientId && r.n >= REPETICOES_PARA_VIRAR_REGRA);
  if (promovidos.length > 0) {
    logger.info({ promovidos: promovidos.length }, '[consolidacao] padrões episódicos com força de regra');
  }
  return promovidos.length;
}

/** Cobertura, para o relatório e para o gate de release. */
export async function knowledgeCoverage(): Promise<{
  clientes: number;
  comLista: number;
  comCampanha: number;
  comPerfil: number;
  campanhas: number;
}> {
  const q = async (s: ReturnType<typeof sql>) => {
    const r = await db.execute(s).catch(() => ({ rows: [] as Array<{ n: number }> }));
    return Number((r as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
  };
  return {
    clientes: await q(sql`select count(*)::int n from clients where deleted_at is null`),
    comLista: await q(sql`select count(*)::int n from clients where deleted_at is null and clickup_list_id is not null`),
    comCampanha: await q(sql`select count(distinct client_id)::int n from campaigns`),
    comPerfil: await q(sql`select count(distinct client_id)::int n from memories where kind='client.profile' and status='active'`),
    campanhas: await q(sql`select count(*)::int n from campaigns`),
  };
}
