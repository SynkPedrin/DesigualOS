import { db, schema } from '@desigual-os/database';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { sincronizarCampanhasDoCliente } from '@desigual-os/context-engine';
import { aspectoDoTexto, rememberFact } from '@desigual-os/orchestrator';
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

/**
 * Episódio recorrente vira REGRA — de verdade, não como contagem.
 *
 * A primeira versão contava episódios por (cliente, tipo) e devolvia um número.
 * Isso é o erro que a spec chama pelo nome: três feedbacks QUAISQUER não são
 * uma preferência. Um pedido sobre headline e outro sobre paleta são dois
 * assuntos, por mais que ambos sejam "feedback".
 *
 * Aqui o agrupamento é por ASPECTO (a mesma tabela que a extração de
 * preferência usa), que é a aproximação barata e determinística de "mesma
 * intenção". E exige recorrência REAL: três episódios em pelo menos dois dias
 * distintos, para que uma rajada de correções numa única sessão não vire regra
 * permanente do cliente.
 *
 * O que sai daqui é memória semântica com proveniência: o subject por aspecto
 * dá supersessão de graça, e os source_refs apontam para os episódios que a
 * sustentam — é o que permite responder "de onde tirou isso".
 */
async function consolidarEpisodios(logger: Logger): Promise<number> {
  const desde = new Date(Date.now() - 30 * 86_400_000);
  const episodios = await db
    .select({
      id: schema.agentEpisodes.id,
      clientId: schema.agentEpisodes.clientId,
      summary: schema.agentEpisodes.summary,
      occurredAt: schema.agentEpisodes.occurredAt,
      environment: schema.agentEpisodes.environment,
    })
    .from(schema.agentEpisodes)
    .where(
      and(
        gte(schema.agentEpisodes.occurredAt, desde),
        sql`${schema.agentEpisodes.eventType} in ('preference','feedback')`,
      ),
    )
    .catch((erro: unknown) => {
      logger.error({ erro }, '[consolidacao] leitura de episódios falhou');
      return [];
    });

  type EpisodioDoGrupo = { id: string; clientId: string | null; summary: string; occurredAt: Date; environment: string };
  /** (cliente|ambiente|aspecto) -> episódios que sustentam a regra. */
  const grupos = new Map<string, { clientId: string; environment: string; aspecto: string; itens: EpisodioDoGrupo[] }>();
  for (const e of episodios) {
    if (!e.clientId) continue;
    const aspecto = aspectoDoTexto(e.summary);
    if (!aspecto) continue;
    const chave = `${e.clientId}|${e.environment}|${aspecto}`;
    const atual = grupos.get(chave);
    if (atual) atual.itens.push(e);
    else grupos.set(chave, { clientId: e.clientId, environment: e.environment, aspecto, itens: [e] });
  }

  let promovidos = 0;
  for (const g of grupos.values()) {
    if (g.itens.length < REPETICOES_PARA_VIRAR_REGRA) continue;
    // Dias DISTINTOS: rajada numa sessão só é correção, não padrão.
    const dias = new Set(g.itens.map((i) => i.occurredAt.toISOString().slice(0, 10)));
    if (dias.size < 2) continue;

    const maisRecente = [...g.itens].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0]!;
    const r = await rememberFact({
      kind: 'client.preference',
      clientId: g.clientId,
      // A formulação mais recente é a que vale: é como a regra é dita hoje.
      content: maisRecente.summary,
      subject: `cliente:${g.clientId}:consolidado:${g.aspecto}`,
      sourceType: 'agent',
      sourceId: maisRecente.id,
      // Recorrência aumenta a confiança, com teto: padrão observado é forte,
      // não é certeza.
      confidence: Math.min(0.95, 0.7 + g.itens.length * 0.05),
      importance: 0.9,
      environment: g.environment,
      metadata: {
        aspect: g.aspecto,
        consolidado_de: g.itens.length,
        dias_distintos: dias.size,
        source_refs: g.itens.map((i) => `episode:${i.id}`).slice(0, 20),
      },
    }).catch((erro: unknown) => {
      logger.warn({ erro, aspecto: g.aspecto }, '[consolidacao] falha ao promover regra');
      return null;
    });

    if (r && r.status !== 'skipped') {
      promovidos += 1;
      logger.info(
        { cliente: g.clientId, aspecto: g.aspecto, episodios: g.itens.length, dias: dias.size, status: r.status },
        '[consolidacao] episódios recorrentes promovidos a regra do cliente',
      );
    }
  }
  return promovidos;
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
