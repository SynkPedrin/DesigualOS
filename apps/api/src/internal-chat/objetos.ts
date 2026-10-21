import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  getAccountSummary,
  getTask,
  listEntities,
  listLinkedAccounts,
  resolvePeriod,
  type MediaPeriod,
} from '@desigual-os/tool-gateway';
import type { AuthenticatedUser } from '../auth/middleware';
import type { WorkspaceModule } from '@desigual-os/types';
import { resolveEnabledModulesCached } from '../auth/require-module';
import { resolveClickUpAccess } from '../integrations/access';
import { AcessoNegado, DadoInvalido, UUID, type ObjetoParaGravar } from './service';

/**
 * OBJETOS COMPARTILHÁVEIS (Hub 2.0, 21/10/2026). Uma referência tipada a algo
 * da operação dentro de uma mensagem. Para cada tipo, um RESOLVEDOR:
 *
 *   validar(quem envia)  → confere que a pessoa pode ver o objeto e monta o
 *                          resumo do momento (snapshot) que vai na mensagem;
 *   atual(quem lê)       → confere que QUEM LÊ pode ver o objeto e devolve os
 *                          dados de agora. Sem acesso, devolve só o estado
 *                          ('sem_acesso' / 'removido'), nunca os dados.
 *
 * Compartilhar NÃO concede acesso. O snapshot só carrega o que quem enviou
 * podia ver, e a tela mostra o snapshot apenas para quem tem acesso ao objeto.
 * Objeto alheio à organização de trabalho é sempre "não encontrado".
 */

export type TipoDeObjeto = 'task' | 'client' | 'demand' | 'media_account' | 'campaign' | 'adset' | 'ad' | 'report' | 'media_alert';
export const TIPOS_DE_OBJETO: readonly TipoDeObjeto[] = ['task', 'client', 'demand', 'media_account', 'campaign', 'adset', 'ad', 'report', 'media_alert'];

export interface PedidoDeObjeto {
  type: TipoDeObjeto;
  id: string;
  context?: Record<string, unknown> | undefined;
}

export interface Contexto {
  user: AuthenticatedUser;
  organizationId: string;
}

export type EstadoAtual =
  | { state: 'ok'; data: Record<string, unknown>; fetched_at: string }
  | { state: 'sem_acesso' | 'removido' | 'indisponivel'; message: string };

const PERIODOS: readonly MediaPeriod[] = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'];

async function temModulo(userId: string, modulo: WorkspaceModule): Promise<boolean> {
  return (await resolveEnabledModulesCached(userId)).modules.has(modulo);
}

/** Cliente desta organização, visível para a pessoa (membro ativo da organização). */
async function clienteDaOrganizacao(organizationId: string, clientId: string) {
  if (!UUID.test(clientId)) return null;
  const [c] = await db.select({ id: schema.clients.id, name: schema.clients.name, clickupListId: schema.clients.clickupListId })
    .from(schema.clients).where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt))).limit(1);
  return c ?? null;
}

// --- cache curto do "atual": a mesma tarefa aberta por 5 pessoas não vira 5 chamadas ao ClickUp
const cache = new Map<string, { at: number; valor: Record<string, unknown> }>();
const CACHE_MS = 60_000;
async function comCache(chave: string, buscar: () => Promise<Record<string, unknown>>): Promise<{ data: Record<string, unknown>; at: number }> {
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.at < CACHE_MS) return { data: hit.valor, at: hit.at };
  const valor = await buscar();
  if (cache.size > 2000) cache.clear();
  cache.set(chave, { at: Date.now(), valor });
  return { data: valor, at: Date.now() };
}

// ---------------------------------------------------------------------------
// Tarefa do ClickUp
// ---------------------------------------------------------------------------

const PRIORIDADE: Record<number, string> = { 1: 'Urgente', 2: 'Alta', 3: 'Normal', 4: 'Baixa' };

async function tarefa(ctx: Contexto, taskId: string) {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(taskId)) throw new AcessoNegado('Tarefa não encontrada.');
  const acesso = await resolveClickUpAccess(ctx.user.id);
  if (!acesso) throw new DadoInvalido('O ClickUp não está conectado.');
  const t = await getTask({ apiKey: acesso.token, teamId: acesso.teamId }, taskId).catch(() => null);
  if (!t) throw new AcessoNegado('Tarefa não encontrada.');
  // A fronteira é a mesma das telas de tarefa: a lista tem de ser de um cliente DESTA organização.
  const [cliente] = t.listId
    ? await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients)
      .where(and(eq(schema.clients.clickupListId, t.listId), eq(schema.clients.organizationId, ctx.organizationId), isNull(schema.clients.deletedAt))).limit(1)
    : [];
  if (!cliente) throw new AcessoNegado('Tarefa não encontrada.');
  return {
    name: t.name,
    status: t.status,
    priority: t.priority ? PRIORIDADE[t.priority] ?? null : null,
    due_date: t.dueDate,
    assignees: t.assignees.map((a) => a.username).filter(Boolean),
    client: { id: cliente.id, name: cliente.name },
    url: `https://app.clickup.com/t/${t.id}`,
  };
}

// ---------------------------------------------------------------------------
// Mídia (conta, campanha, conjunto/grupo, anúncio, alerta)
// ---------------------------------------------------------------------------

function periodoDe(context?: Record<string, unknown>): MediaPeriod {
  const p = context?.period;
  return typeof p === 'string' && (PERIODOS as readonly string[]).includes(p) ? (p as MediaPeriod) : 'last_7d';
}

async function exigirMidia(ctx: Contexto) {
  if (!(await temModulo(ctx.user.id, 'meta_ads'))) throw new AcessoNegado('Sem acesso à Mídia.');
}

const escopo = (ctx: Contexto) => ({ organizationId: ctx.organizationId, clientIds: null as string[] | null });

async function contaDeMidia(ctx: Contexto, accountId: string) {
  await exigirMidia(ctx);
  const contas = await listLinkedAccounts(escopo(ctx));
  const conta = contas.find((c) => c.accountId === accountId);
  if (!conta) throw new AcessoNegado('Conta de anúncios não encontrada.');
  return conta;
}

async function resumoDaConta(ctx: Contexto, accountId: string, context?: Record<string, unknown>) {
  const conta = await contaDeMidia(ctx, accountId);
  const periodo = periodoDe(context);
  const r = await getAccountSummary(escopo(ctx), accountId, resolvePeriod(periodo), false);
  return {
    name: conta.name ?? conta.label ?? accountId,
    platform: conta.provider,
    client: { id: conta.clientId, name: conta.clientName },
    currency: r?.currency ?? conta.currency,
    period: periodo,
    range: r?.range ?? null,
    metrics: r ? metricas(r.current) : null,
    result_kinds: r?.resultKinds ?? [],
    synced_at: r?.lastSyncedAt ?? conta.lastSyncedAt,
  };
}

function metricas(m: { spend: number | null; impressions: number | null; clicks: number | null; results: number | null; ctr: number | null; cpc: number | null; costPerResult: number | null; roas?: number | null }) {
  return { spend: m.spend, impressions: m.impressions, clicks: m.clicks, results: m.results, ctr: m.ctr, cpc: m.cpc, cost_per_result: m.costPerResult, roas: m.roas ?? null };
}

async function entidadeDeMidia(ctx: Contexto, level: 'campaign' | 'adset' | 'ad', entityId: string, context?: Record<string, unknown>) {
  const accountId = typeof context?.account_id === 'string' ? context.account_id : '';
  if (!accountId) throw new DadoInvalido('Faltou a conta de anúncios do item compartilhado.');
  const conta = await contaDeMidia(ctx, accountId);
  const periodo = periodoDe(context);
  const linhas = await listEntities(escopo(ctx), accountId, { level, range: resolvePeriod(periodo), limit: 1000 });
  const e = linhas?.find((l) => l.id === entityId);
  if (!e) throw new AcessoNegado('Item de mídia não encontrado.');
  return {
    name: e.name,
    level,
    platform: conta.provider,
    status: e.effectiveStatus ?? e.status,
    objective: e.objective,
    account: { id: accountId, name: conta.name ?? conta.label ?? accountId },
    client: { id: conta.clientId, name: conta.clientName },
    currency: conta.currency,
    period: periodo,
    range: resolvePeriod(periodo),
    metrics: metricas(e),
  };
}

async function alerta(ctx: Contexto, alertId: string) {
  await exigirMidia(ctx);
  if (!UUID.test(alertId)) throw new AcessoNegado('Alerta não encontrado.');
  const [a] = await db.select().from(schema.mediaAlertEvents)
    .where(and(eq(schema.mediaAlertEvents.id, alertId), eq(schema.mediaAlertEvents.organizationId, ctx.organizationId))).limit(1);
  if (!a) throw new AcessoNegado('Alerta não encontrado.');
  const cliente = a.clientId ? await clienteDaOrganizacao(ctx.organizationId, a.clientId) : null;
  return {
    title: a.title, detail: a.detail, severity: a.severity, status: a.status,
    fired_at: a.firedAt?.toISOString?.() ?? null,
    client: cliente ? { id: cliente.id, name: cliente.name } : null,
  };
}

// ---------------------------------------------------------------------------
// Relatório, cliente, quinzena
// ---------------------------------------------------------------------------

async function relatorio(ctx: Contexto, reportId: string) {
  if (!UUID.test(reportId)) throw new AcessoNegado('Relatório não encontrado.');
  if (!(await temModulo(ctx.user.id, 'relatorios'))) throw new AcessoNegado('Sem acesso a Relatórios.');
  const [r] = await db.select({ report: schema.clientReports, clientName: schema.clients.name, authorName: schema.users.name })
    .from(schema.clientReports)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.clientReports.clientId))
    .leftJoin(schema.users, eq(schema.users.id, schema.clientReports.requestedBy))
    .where(and(eq(schema.clientReports.id, reportId), eq(schema.clientReports.organizationId, ctx.organizationId), isNull(schema.clients.deletedAt))).limit(1);
  if (!r) throw new AcessoNegado('Relatório não encontrado.');
  const rep = r.report;
  return {
    title: `Relatório de ${r.clientName}`,
    client: { id: rep.clientId, name: r.clientName },
    channels: rep.channels,
    period_start: rep.periodStart, period_end: rep.periodEnd, period_days: rep.periodDays,
    status: rep.status,
    author: r.authorName,
    created_at: rep.createdAt.toISOString(),
    // O PDF continua no armazenamento do relatório; a mensagem só aponta.
    has_pdf: Boolean(rep.storageUrl) && rep.status === 'ready',
  };
}

async function cliente(ctx: Contexto, clientId: string) {
  const c = await clienteDaOrganizacao(ctx.organizationId, clientId);
  if (!c) throw new AcessoNegado('Cliente não encontrado.');
  return { name: c.name };
}

async function quinzena(ctx: Contexto, demandId: string) {
  if (!UUID.test(demandId)) throw new AcessoNegado('Quinzena não encontrada.');
  if (!(await temModulo(ctx.user.id, 'demandas'))) throw new AcessoNegado('Sem acesso a Quinzenas.');
  const [d] = await db.select({ demand: schema.demands, clientName: schema.clients.name })
    .from(schema.demands).leftJoin(schema.clients, eq(schema.clients.id, schema.demands.clientId))
    .where(and(eq(schema.demands.id, demandId), eq(schema.demands.organizationId, ctx.organizationId))).limit(1);
  if (!d) throw new AcessoNegado('Quinzena não encontrada.');
  return {
    title: d.demand.title, status: d.demand.status, priority: d.demand.priority,
    due_date: d.demand.dueDate ? new Date(d.demand.dueDate).toISOString() : null,
    client: d.demand.clientId ? { id: d.demand.clientId, name: d.clientName } : null,
  };
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

async function resolver(ctx: Contexto, tipo: TipoDeObjeto, id: string, context?: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (tipo) {
    case 'task': return tarefa(ctx, id);
    case 'client': return cliente(ctx, id);
    case 'demand': return quinzena(ctx, id);
    case 'media_account': return resumoDaConta(ctx, id, context);
    case 'campaign': case 'adset': case 'ad': return entidadeDeMidia(ctx, tipo, id, context);
    case 'report': return relatorio(ctx, id);
    case 'media_alert': return alerta(ctx, id);
  }
}

function provedorDe(tipo: TipoDeObjeto, dados: Record<string, unknown>): string | null {
  if (tipo === 'task') return 'clickup';
  const plataforma = dados.platform;
  return typeof plataforma === 'string' ? plataforma : null;
}

/** Contexto guardado: só chaves conhecidas (não deixa o cliente enfiar qualquer coisa no banco). */
function contextoLimpo(tipo: TipoDeObjeto, context?: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = {};
  if (['media_account', 'campaign', 'adset', 'ad'].includes(tipo)) {
    limpo.period = periodoDe(context);
    if (typeof context?.account_id === 'string') limpo.account_id = context.account_id.slice(0, 40);
  }
  return limpo;
}

/** Valida cada objeto com a permissão de QUEM ENVIA e monta o que vai para o banco. */
export async function validarObjetos(ctx: Contexto, pedidos: PedidoDeObjeto[]): Promise<ObjetoParaGravar[]> {
  if (pedidos.length > 5) throw new DadoInvalido('No máximo 5 itens compartilhados por mensagem.');
  return Promise.all(pedidos.map(async (p) => {
    if (!TIPOS_DE_OBJETO.includes(p.type)) throw new DadoInvalido('Tipo de item desconhecido.');
    const context = contextoLimpo(p.type, p.context);
    const snapshot = await resolver(ctx, p.type, p.id, context).catch((erro) => {
      if (erro instanceof AcessoNegado) throw new DadoInvalido(`Você não tem acesso a esse item (${erro.message}).`);
      throw erro;
    });
    return { objectType: p.type, objectId: p.id, provider: provedorDe(p.type, snapshot), context, snapshot: { ...snapshot, captured_at: new Date().toISOString() }, snapshotVersion: 1 };
  }));
}

/** Os dados de AGORA, com a permissão de QUEM LÊ. */
export async function estadoAtual(ctx: Contexto, objeto: { objectType: string; objectId: string; context: Record<string, unknown> }): Promise<EstadoAtual> {
  const tipo = objeto.objectType as TipoDeObjeto;
  if (!TIPOS_DE_OBJETO.includes(tipo)) return { state: 'indisponivel', message: 'Tipo de item desconhecido.' };
  try {
    // A permissão é conferida a cada leitura, ANTES do cache: o cache só guarda dados, nunca decide acesso.
    if (tipo === 'task') await resolveClickUpAccess(ctx.user.id);
    const chave = `${ctx.organizationId}:${tipo}:${objeto.objectId}:${JSON.stringify(objeto.context)}`;
    const temAcesso = await podeVer(ctx, tipo, objeto.objectId, objeto.context);
    if (!temAcesso) return { state: 'sem_acesso', message: 'Você não tem acesso a este item.' };
    const { data, at } = await comCache(chave, () => resolver(ctx, tipo, objeto.objectId, objeto.context));
    return { state: 'ok', data, fetched_at: new Date(at).toISOString() };
  } catch (erro) {
    if (erro instanceof AcessoNegado) return { state: 'removido', message: 'Este item não existe mais ou saiu do seu alcance.' };
    if (erro instanceof DadoInvalido) return { state: 'indisponivel', message: erro.message };
    return { state: 'indisponivel', message: 'Não foi possível consultar agora. Tente de novo em instantes.' };
  }
}

/**
 * Checagem barata de acesso de quem LÊ (sem buscar os dados no provedor):
 * usada também para decidir se o SNAPSHOT pode aparecer na tela.
 */
export async function podeVer(ctx: Contexto, tipo: TipoDeObjeto, id: string, context: Record<string, unknown>): Promise<boolean> {
  switch (tipo) {
    case 'client': return Boolean(await clienteDaOrganizacao(ctx.organizationId, id));
    case 'demand': return temModulo(ctx.user.id, 'demandas');
    case 'report': return temModulo(ctx.user.id, 'relatorios');
    case 'media_account': case 'campaign': case 'adset': case 'ad': case 'media_alert': {
      if (!(await temModulo(ctx.user.id, 'meta_ads'))) return false;
      if (tipo === 'media_alert') return true;
      const accountId = tipo === 'media_account' ? id : String(context.account_id ?? '');
      const contas = await listLinkedAccounts(escopo(ctx));
      return contas.some((c) => c.accountId === accountId);
    }
    case 'task': return (await resolveClickUpAccess(ctx.user.id)) !== null;
  }
}

/** Para cada objeto de uma lista de mensagens: o leitor pode ver o snapshot? (uma vez por tipo/conta) */
export async function visibilidadeDosObjetos(ctx: Contexto, objetos: Array<{ id: string; objectType: string; objectId: string; context: Record<string, unknown> }>): Promise<Set<string>> {
  const visiveis = new Set<string>();
  const memo = new Map<string, Promise<boolean>>();
  await Promise.all(objetos.map(async (o) => {
    const tipo = o.objectType as TipoDeObjeto;
    if (!TIPOS_DE_OBJETO.includes(tipo)) return;
    const chave = tipo === 'client' ? `client:${o.objectId}` : ['campaign', 'adset', 'ad'].includes(tipo) ? `media:${String(o.context.account_id)}` : tipo === 'media_account' ? `media:${o.objectId}` : tipo;
    if (!memo.has(chave)) memo.set(chave, podeVer(ctx, tipo, o.objectId, o.context).catch(() => false));
    if (await memo.get(chave)) visiveis.add(o.id);
  }));
  return visiveis;
}

/** Tarefas do ClickUp que a pessoa pode compartilhar: as das listas dos clientes desta organização. */
export async function clientesComLista(organizationId: string) {
  return db.select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(and(eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)))
    .orderBy(desc(schema.clients.name));
}
