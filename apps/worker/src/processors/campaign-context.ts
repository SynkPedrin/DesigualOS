import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';
import {
  precisaResincronizar,
  resolverEntidade,
  sincronizarCampanhasDoCliente,
  type BuscarTasksDaLista,
} from '@desigual-os/context-engine';

/**
 * campaign-context.ts — a campanha citada no turno vira contexto REAL.
 *
 * Caso relatado (16/09/2026): a Tammy pediu legenda para a "campanha de
 * aniversário do Jardim Europa 5". A campanha existe — 253 tasks na Cosentino,
 * atualizada no mesmo dia — e o Otto entregou uma legenda do Jardim do Lago, em
 * Penápolis. Cliente errado, campanha errada, conteúdo inventado.
 *
 * Duas causas, as duas estruturais:
 *   1. campanha não era entidade, então não havia o que resolver;
 *   2. sem campanha, o texto caiu no matcher de CLIENTE, que casou pela palavra
 *      solta "jardim" e escolheu outro cliente com confiança total.
 *
 * Aqui a campanha é resolvida ANTES da criação e carrega o que já existe dentro
 * dela. É a ordem que a spec pede: resolve -> retrieve -> verify -> create. A
 * criatividade começa depois do contexto, nunca no lugar dele.
 */

export interface CampanhaDoTurno {
  id: string;
  clientId: string;
  canonicalName: string;
  status: string;
  taskCount: number;
  openTaskCount: number;
  lastSourceUpdateAt: Date | null;
  recentTasks: Array<{ id: string; name: string; status: string | null; closed: boolean; updatedAt: string | null }>;
}

export interface CampaignTurnContext {
  /** Resolvida sem ambiguidade. */
  campanha: CampanhaDoTurno | null;
  /** Empate real: o agente PERGUNTA qual, nunca escolhe. */
  ambiguas: Array<{ canonicalName: string; clientId: string }>;
  /** Casou, mas pertence a outro cliente que não o do turno. Nunca usada. */
  foraDoEscopo: Array<{ canonicalName: string; clientId: string }>;
  /** O texto cita campanha específica? Usado pra decidir se improvisar é aceitável. */
  citouCampanha: boolean;
}

const VAZIO: CampaignTurnContext = { campanha: null, ambiguas: [], foraDoEscopo: [], citouCampanha: false };

/**
 * Sinal de que o pedido é sobre uma campanha específica. Não decide QUAL — só
 * diz que existe uma, o que muda a régua: com campanha citada, responder só com
 * contexto de marca é falha, não estilo.
 */
const CITA_CAMPANHA = /\bcampanh|\blan[çc]amento\b|\bempreendimento\b|\bfase\s+\d|\ba[çc][ãa]o de\b/i;

export async function resolveCampaignTurnContext(params: {
  message: string;
  clientId?: string | null;
  /**
   * AUTOCURA (a exigência central deste release): quando o pedido cita uma
   * campanha e o registro não a tem, re-sincroniza o cliente contra a FONTE e
   * tenta de novo, antes de dizer que não existe. Se o conteúdo está no ClickUp
   * e o índice não achou, o defeito é do sistema — quem perguntou não tem que
   * pagar por ele. Injetado para o context-engine não depender de HTTP.
   */
  buscarTasks?: BuscarTasksDaLista;
}): Promise<CampaignTurnContext> {
  const citouCampanha = CITA_CAMPANHA.test(params.message);

  let ctx = await tentarResolver(params.message, params.clientId ?? null, citouCampanha);

  const valeTentarDeNovo =
    citouCampanha && !ctx.campanha && ctx.ambiguas.length === 0 && ctx.foraDoEscopo.length === 0;
  if (valeTentarDeNovo && params.clientId && params.buscarTasks) {
    const listId = await listaDoCliente(params.clientId);
    if (listId && (await precisaResincronizar(params.clientId).catch(() => false))) {
      await sincronizarCampanhasDoCliente(params.clientId, listId, params.buscarTasks).catch(() => null);
      ctx = await tentarResolver(params.message, params.clientId, citouCampanha);
    }
  }
  return ctx;
}

async function listaDoCliente(clientId: string): Promise<string | null> {
  const [c] = await db
    .select({ listId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .catch(() => []);
  return c?.listId ?? null;
}

async function tentarResolver(
  message: string,
  clientId: string | null,
  citouCampanha: boolean,
): Promise<CampaignTurnContext> {
  const params = { message, clientId };
  const linhas = await db
    .select({
      id: schema.campaigns.id,
      clientId: schema.campaigns.clientId,
      canonicalName: schema.campaigns.canonicalName,
      aliases: schema.campaigns.aliases,
      status: schema.campaigns.status,
      taskCount: schema.campaigns.taskCount,
      openTaskCount: schema.campaigns.openTaskCount,
      lastSourceUpdateAt: schema.campaigns.lastSourceUpdateAt,
      recentTasks: schema.campaigns.recentTasks,
    })
    .from(schema.campaigns)
    .catch(() => []);

  if (linhas.length === 0) return { ...VAZIO, citouCampanha };

  const r = resolverEntidade(
    params.message,
    linhas.map((l) => ({ id: l.id, canonicalName: l.canonicalName, aliases: l.aliases ?? [], ownerId: l.clientId, __row: l })),
    { ownerId: params.clientId ?? null },
  );

  const comoResumo = (e: { __row: (typeof linhas)[number] }) => ({
    canonicalName: e.__row.canonicalName,
    clientId: e.__row.clientId,
  });

  if (!r.resolvida) {
    return {
      campanha: null,
      ambiguas: r.ambiguas.map((a) => comoResumo(a as never)),
      foraDoEscopo: r.foraDoEscopo.map((a) => comoResumo(a as never)),
      citouCampanha,
    };
  }

  const row = (r.resolvida as unknown as { __row: (typeof linhas)[number] }).__row;
  return {
    campanha: {
      id: row.id,
      clientId: row.clientId,
      canonicalName: row.canonicalName,
      status: row.status,
      taskCount: row.taskCount,
      openTaskCount: row.openTaskCount,
      lastSourceUpdateAt: row.lastSourceUpdateAt,
      recentTasks: row.recentTasks ?? [],
    },
    ambiguas: [],
    foraDoEscopo: r.foraDoEscopo.map((a) => comoResumo(a as never)),
    citouCampanha,
  };
}

/** Nome do cliente dono, para o bloco poder dizer de quem é a campanha. */
export async function nomeDoCliente(clientId: string): Promise<string | null> {
  const [c] = await db
    .select({ name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .catch(() => []);
  return c?.name ?? null;
}

/**
 * Bloco de campanha pro prompt. Quatro estados, todos explícitos — inclusive os
 * dois que antes não existiam e viravam improviso silencioso.
 */
export function formatCampaignBlock(
  ctx: CampaignTurnContext,
  nomes: { campanhaDe?: string | null; foraDoEscopo?: Record<string, string> } = {},
): string {
  if (ctx.ambiguas.length > 1) {
    return [
      'CAMPANHA DO TURNO: AMBÍGUA.',
      `Mais de uma campanha casa com o que foi escrito: ${ctx.ambiguas.map((a) => a.canonicalName).join(', ')}.`,
      'PERGUNTE qual antes de produzir. NÃO escolha por conta própria.',
    ].join('\n');
  }

  if (!ctx.campanha) {
    if (ctx.foraDoEscopo.length > 0) {
      const nome = ctx.foraDoEscopo[0]!.canonicalName;
      const dono = nomes.foraDoEscopo?.[ctx.foraDoEscopo[0]!.clientId] ?? 'outro cliente';
      return [
        'CAMPANHA DO TURNO: PERTENCE A OUTRO CLIENTE.',
        `A campanha "${nome}" existe, mas é do cliente ${dono}, e não do cliente deste turno.`,
        'NÃO use o contexto dela aqui. Confirme com quem pediu de qual cliente se trata.',
      ].join('\n');
    }
    if (ctx.citouCampanha) {
      return [
        'CAMPANHA DO TURNO: NÃO ENCONTRADA no registro de campanhas.',
        'O pedido cita uma campanha específica e ela não foi localizada. NÃO invente o conteúdo dela',
        'e NÃO entregue peça genérica de marca como se fosse daquela campanha. Diga que não localizou',
        'a campanha com esse nome e peça o nome como aparece no ClickUp.',
      ].join('\n');
    }
    return '';
  }

  const c = ctx.campanha;
  const linhas = [
    `CAMPANHA DO TURNO: ${c.canonicalName}${nomes.campanhaDe ? ` (cliente ${nomes.campanhaDe})` : ''}.`,
    `Situação: ${c.status === 'active' ? 'ATIVA' : 'HISTÓRICA (encerrada)'} — ${c.openTaskCount} de ${c.taskCount} tarefas em aberto.`,
  ];
  if (c.lastSourceUpdateAt) {
    linhas.push(`Última movimentação na fonte: ${c.lastSourceUpdateAt.toISOString().slice(0, 10)}.`);
  }
  if (c.recentTasks.length > 0) {
    linhas.push('', 'O QUE JÁ EXISTE NESTA CAMPANHA (ClickUp, mais recente primeiro):');
    for (const t of c.recentTasks.slice(0, 18)) {
      linhas.push(`- ${t.name}${t.status ? ` [${t.status}]` : ''}`);
    }
  }
  linhas.push(
    '',
    'A CAMPANHA JÁ ESTÁ RESOLVIDA: não pergunte qual é, não ofereça lista de campanhas para',
    'escolher e não trate o pedido como ambíguo. Use ISTO como contexto da peça. Se algo',
    'específico faltar, entregue o que dá com o que está aqui e diga o que falta, nomeando esta',
    'campanha. Entregar só discurso genérico de marca é falha.',
  );
  return linhas.join('\n');
}

/**
 * Leitura da lista no ClickUp para a autocura. Vive aqui, e não no
 * context-engine, porque é o worker que tem credencial de ClickUp — o
 * context-engine continua sem dependência de rede e testável sem mock de HTTP.
 */
export async function buscarTasksDaLista(listId: string) {
  const { queryOperationTasks } = await import('@desigual-os/tool-gateway');
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return [];
  const page = await queryOperationTasks({ apiKey, teamId }, { listIds: [listId], includeClosed: true, subtasks: true }).catch(() => null);
  return (page?.tasks ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? '',
    status: t.status,
    // O ClickUp marca encerramento no tipo do status; `closed` é o que decide
    // se a campanha ainda está viva.
    closed: t.statusType === 'closed' || t.statusType === 'done',
    updatedAt: t.updatedAt ? new Date(t.updatedAt) : null,
  }));
}
