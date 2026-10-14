/**
 * bento-varredura.ts — o Bento acompanha a operação sem esperar pergunta.
 * Bento 3.1, P0, 14/10/2026.
 *
 * Liga peças que já existiam e não conversavam: as regras de
 * `proactivity.ts` (ninguém chamava), `proactive_signals` com dedupe e
 * cooldown (sinal nascia e não chegava a ninguém) e `notifications` (o sino
 * do OS). O fluxo, por empresa:
 *
 *   ClickUp (tarefas abertas das listas dos clientes da empresa)
 *     → risco por tarefa + agregados   (determinístico: data, prioridade, dono)
 *     → emitSignal                     (empresa na chave, cooldown, piso)
 *     → resolve o que sumiu            (concluída, ganhou dono, prazo remarcado)
 *     → destinatário                   (responsável; sem dono → gestão da empresa)
 *     → notificação interna agrupada   (uma por pessoa por varredura, idempotente)
 *
 * Nenhum modelo de linguagem: os fatos são data e campo, e o "porquê" de cada
 * prioridade sai das regras, em texto, no próprio aviso.
 *
 * TRÊS ESTÁGIOS, por flag (nada muda com as flags ausentes):
 *   BENTO_PROACTIVE_MONITORING=off      (padrão) nada roda.
 *   BENTO_PROACTIVE_MONITORING=shadow   detecta e registra sinais com status
 *                                        `shadow`: medidos, invisíveis, sem aviso.
 *   BENTO_PROACTIVE_MONITORING=on       sinais `pending`; aviso só se também
 *   BENTO_PROACTIVE_NOTIFICATIONS=true  e a empresa estiver liberada.
 *   BENTO_PROACTIVE_ORGS=<uuid,uuid>    liberação gradual por empresa (vazio =
 *                                        todas). Vale para o aviso, não para a
 *                                        detecção.
 *
 * O que NÃO faz, de propósito: não muda prazo, dono, prioridade nem status;
 * não manda WhatsApp nem e-mail; não chama ação externa nenhuma.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { getRedisConnection } from '@desigual-os/orchestrator';
import {
  REGRAS_POR_TAREFA,
  chaveDoSinal,
  detectTaskSignals,
  emitSignal,
  markSignalDelivered,
  resolverSinaisAusentes,
  sinaisDeRiscoPorTarefa,
  type JanelaDeRisco,
  type SignalCandidate,
  type TarefaParaRisco,
} from '@desigual-os/orchestrator';
import { escopoOperacional } from '@desigual-os/context-engine';
import { queryOperationTasks, resolveClickUpCredentials } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

// ------------------------------------------------------------------ config

export type ModoDeMonitoramento = 'off' | 'shadow' | 'on';

export interface ConfigDaProatividade {
  monitoramento: ModoDeMonitoramento;
  notificacoes: boolean;
  /** null = todas as empresas liberadas para aviso. */
  empresasLiberadas: Set<string> | null;
}

export function lerConfigDaProatividade(env: NodeJS.ProcessEnv = process.env): ConfigDaProatividade {
  const bruto = (env.BENTO_PROACTIVE_MONITORING ?? '').trim().toLowerCase();
  const monitoramento: ModoDeMonitoramento = bruto === 'shadow' ? 'shadow' : bruto === 'on' || bruto === 'true' ? 'on' : 'off';
  const notificacoes = ['true', '1', 'on'].includes((env.BENTO_PROACTIVE_NOTIFICATIONS ?? '').trim().toLowerCase());
  const lista = (env.BENTO_PROACTIVE_ORGS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { monitoramento, notificacoes, empresasLiberadas: lista.length > 0 ? new Set(lista) : null };
}

/** O aviso sai para esta empresa? Só com monitoramento `on`, aviso ligado e empresa liberada. */
export function avisoLiberado(config: ConfigDaProatividade, organizationId: string): boolean {
  if (config.monitoramento !== 'on' || !config.notificacoes) return false;
  return config.empresasLiberadas === null || config.empresasLiberadas.has(organizationId);
}

// ------------------------------------------------------------------ tempo

const FUSO = 'America/Sao_Paulo';

/** Meia-noite (epoch ms) do dia `deslocamento` a partir de hoje, no fuso da operação. */
function meiaNoiteNoFuso(agora: Date, deslocamento: number, fuso = FUSO): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const comoUtc = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute), Number(partes.second));
  const deslocamentoDoFuso = comoUtc - Math.floor(agora.getTime() / 1000) * 1000;
  return Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day) + deslocamento) - deslocamentoDoFuso;
}

export function janelaDeRisco(agora: Date, fuso = FUSO): JanelaDeRisco {
  const startOfToday = meiaNoiteNoFuso(agora, 0, fuso);
  const startOfTomorrow = meiaNoiteNoFuso(agora, 1, fuso);
  return {
    startOfToday,
    startOfTomorrow,
    endOfTomorrow: meiaNoiteNoFuso(agora, 2, fuso) - 1,
    endOfDay3: meiaNoiteNoFuso(agora, 3, fuso) - 1,
  };
}

// ------------------------------------------------------------------ pessoas

/**
 * Papel de gestão na empresa. Texto livre em organization_members.role, e
 * produção usa "MANAGER" em maiúsculas (medido na primeira varredura real,
 * 14/10/2026): comparar só 'owner'/'admin' deixou o gestor sem a visão da
 * equipe e mandou tudo para a conta de QA.
 */
export function ehPapelDeGestao(role: string | null | undefined): boolean {
  return ['owner', 'admin', 'manager'].includes((role ?? '').trim().toLowerCase());
}

export interface PessoasDaEmpresa {
  porEmail: Map<string, string>;
  porClickupId: Map<number, string>;
  gestores: string[];
}

/** Quem pode receber aviso desta empresa: só membro ativo dela. */
export async function pessoasDaEmpresa(organizationId: string): Promise<PessoasDaEmpresa> {
  const membros = await db
    .select({ userId: schema.users.id, email: schema.users.clickupEmail, role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.users.active, true), isNull(schema.users.deletedAt)));
  const membrosIds = new Set(membros.map((m) => m.userId));
  const porEmail = new Map<string, string>();
  for (const m of membros) if (m.email) porEmail.set(m.email.trim().toLowerCase(), m.userId);

  const links = await db
    .select({ externalId: schema.entityLinks.externalId, desigualId: schema.entityLinks.desigualId })
    .from(schema.entityLinks)
    .where(and(eq(schema.entityLinks.organizationId, organizationId), eq(schema.entityLinks.source, 'clickup'), eq(schema.entityLinks.entityType, 'person')));
  const porClickupId = new Map<number, string>();
  for (const l of links) {
    const id = Number(l.externalId);
    if (Number.isFinite(id) && membrosIds.has(l.desigualId)) porClickupId.set(id, l.desigualId);
  }
  const gestores = membros.filter((m) => ehPapelDeGestao(m.role)).map((m) => m.userId);
  return { porEmail, porClickupId, gestores };
}

/** Quem age sobre a tarefa: os responsáveis que existem no OS; sem nenhum, a gestão. */
export function destinatariosDaTarefa(
  tarefa: Pick<TarefaParaRisco, 'assigneeEmails'> & { assigneeIds?: number[] },
  pessoas: PessoasDaEmpresa,
): string[] {
  const achados = new Set<string>();
  for (const id of tarefa.assigneeIds ?? []) {
    const u = pessoas.porClickupId.get(id);
    if (u) achados.add(u);
  }
  for (const email of tarefa.assigneeEmails ?? []) {
    const u = pessoas.porEmail.get(email);
    if (u) achados.add(u);
  }
  return achados.size > 0 ? [...achados] : [...pessoas.gestores];
}

// ------------------------------------------------------------------ aviso

const ORDEM_SEVERIDADE: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const MAX_ITENS_NO_AVISO = 8;

export interface ItemDoAviso {
  signalId: string;
  severity: string;
  pontuacao: number;
  titulo: string;
  motivos: string;
  acao: string | null;
}

/** Uma notificação por pessoa: o mais grave primeiro, o motivo de cada um dito. */
export function montarAviso(itens: ItemDoAviso[]): { title: string; body: string; dedupeKey: string } {
  const ordenados = [...itens].sort(
    (a, b) => (ORDEM_SEVERIDADE[a.severity] ?? 9) - (ORDEM_SEVERIDADE[b.severity] ?? 9) || b.pontuacao - a.pontuacao,
  );
  const title =
    ordenados.length === 1 ? `Bento: ${ordenados[0]!.titulo}` : `Bento: ${ordenados.length} tarefas precisam da sua atenção`;
  const linhas = ordenados
    .slice(0, MAX_ITENS_NO_AVISO)
    .map((i) => `• ${i.titulo} — ${i.motivos}${i.acao ? `. ${i.acao}.` : ''}`);
  if (ordenados.length > MAX_ITENS_NO_AVISO) linhas.push(`e mais ${ordenados.length - MAX_ITENS_NO_AVISO}.`);
  // Mesmo conjunto de sinais = mesmo aviso: retry do job ou duas varreduras
  // juntas batem no índice único (user_id, dedupe_key) e não duplicam.
  const assinatura = createHash('sha256').update(ordenados.map((i) => i.signalId).sort().join(',')).digest('hex').slice(0, 24);
  return { title, body: linhas.join('\n'), dedupeKey: `bento-alerta:${assinatura}` };
}

// ------------------------------------------------------------------ varredura

export interface RelatorioDaVarredura {
  organizationId: string;
  modo: ModoDeMonitoramento;
  tarefasLidas: number;
  truncado: boolean;
  candidatos: number;
  criados: number;
  suprimidos: number;
  falhas: number;
  resolvidos: number;
  avisosEnviados: number;
  pessoasAvisadas: number;
  sinaisSemDestinatario: number;
  duracaoMs: number;
  pulado?: string;
}

interface DepsDaVarredura {
  agora?: Date;
  config?: ConfigDaProatividade;
  /** Para teste: lê as tarefas sem passar pela API do ClickUp. */
  lerTarefas?: (organizationId: string, listIds: string[]) => Promise<{ tasks: Array<TarefaParaRisco & { assigneeIds?: number[] }>; truncated: boolean }>;
}

const TRAVA_MS = 10 * 60_000;

async function credencialDaEmpresa(organizationId: string) {
  const daEmpresa = await resolveClickUpCredentials(organizationId).catch(() => null);
  if (daEmpresa) return daEmpresa;
  // Mesmo fallback do estado da operação (execute-job.ts): a credencial da casa.
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  return apiKey && teamId ? { apiKey, teamId } : null;
}

async function lerTarefasDoClickUp(organizationId: string, listIds: string[]) {
  const cfg = await credencialDaEmpresa(organizationId);
  if (!cfg) throw new Error('sem credencial do ClickUp para esta empresa');
  const r = await queryOperationTasks(cfg, { listIds, includeClosed: false });
  return { tasks: r.tasks as Array<TarefaParaRisco & { assigneeIds?: number[] }>, truncated: r.truncated };
}

/** Uma empresa. Nunca lança: falha vira relatório com `pulado`. */
export async function varrerEmpresa(organizationId: string, logger: Logger, deps: DepsDaVarredura = {}): Promise<RelatorioDaVarredura> {
  const inicio = Date.now();
  const agora = deps.agora ?? new Date();
  const config = deps.config ?? lerConfigDaProatividade();
  const relatorio: RelatorioDaVarredura = {
    organizationId,
    modo: config.monitoramento,
    tarefasLidas: 0,
    truncado: false,
    candidatos: 0,
    criados: 0,
    suprimidos: 0,
    falhas: 0,
    resolvidos: 0,
    avisosEnviados: 0,
    pessoasAvisadas: 0,
    sinaisSemDestinatario: 0,
    duracaoMs: 0,
  };
  const fim = (pulado?: string) => ({ ...relatorio, ...(pulado ? { pulado } : {}), duracaoMs: Date.now() - inicio });
  if (config.monitoramento === 'off') return fim('monitoramento desligado');

  // Uma varredura por empresa por vez, entre processos: duas réplicas do
  // worker (ou um job que atrasou) não podem varrer a mesma empresa juntas.
  const redis = getRedisConnection();
  const trava = `bento:varredura:${organizationId}`;
  const dono = randomUUID();
  const pegou = await redis.set(trava, dono, 'PX', TRAVA_MS, 'NX').catch(() => null);
  if (pegou !== 'OK') return fim('outra varredura em andamento');

  try {
    const clientes = escopoOperacional(
      await db
        .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
        .from(schema.clients)
        .where(and(eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt), isNotNull(schema.clients.clickupListId))),
    );
    const porLista = new Map(clientes.map((c) => [c.listId!, c]));
    if (porLista.size === 0) return fim('nenhum cliente com lista do ClickUp');

    const lidas = await (deps.lerTarefas ?? lerTarefasDoClickUp)(organizationId, [...porLista.keys()]);
    relatorio.tarefasLidas = lidas.tasks.length;
    relatorio.truncado = lidas.truncated;
    const tarefas = lidas.tasks.map((t) => {
      const cliente = t.listId ? porLista.get(t.listId) : undefined;
      return { ...t, clientId: cliente?.id ?? null, clientName: cliente?.name ?? null };
    });

    const janela = janelaDeRisco(agora);
    const porTarefa = sinaisDeRiscoPorTarefa(tarefas, janela, organizationId);
    const agregados: SignalCandidate[] = detectTaskSignals(tarefas, janela).map((s) => ({ ...s, organizationId }));
    const candidatos: SignalCandidate[] = [...porTarefa, ...agregados];
    relatorio.candidatos = candidatos.length;

    const modo = config.monitoramento === 'shadow' ? 'shadow' : 'live';
    for (const c of candidatos) {
      const r = await emitSignal(c, agora, { modo });
      if (r.status === 'created') relatorio.criados += 1;
      else if (r.status === 'suppressed') relatorio.suprimidos += 1;
      else relatorio.falhas += 1;
    }

    // Truncado = a leitura não viu tudo; resolver o que "sumiu" seria fechar
    // sinal de tarefa que só não coube na página.
    const chavesAtivas = candidatos.map((c) => chaveDoSinal(organizationId, c.dedupeKey));
    if (!lidas.truncated) {
      relatorio.resolvidos = await resolverSinaisAusentes({
        organizationId,
        regras: [...REGRAS_POR_TAREFA, ...new Set(agregados.map((a) => a.rule))],
        chavesAtivas,
        now: agora,
      }).catch(() => 0);
    }

    if (avisoLiberado(config, organizationId)) {
      await entregarAvisos(organizationId, porTarefa, chavesAtivas, relatorio, logger);
    }
    return fim();
  } catch (error) {
    logger.warn({ organizationId, err: String(error) }, '[bento-varredura] empresa pulada');
    return fim(`erro: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
  } finally {
    // Só solta a trava se ainda for dela (não apaga a de outra varredura que
    // pegou depois de esta ter estourado o prazo).
    const atual = await redis.get(trava).catch(() => null);
    if (atual === dono) await redis.del(trava).catch(() => undefined);
  }
}

async function entregarAvisos(
  organizationId: string,
  porTarefa: ReturnType<typeof sinaisDeRiscoPorTarefa>,
  chavesAtivas: string[],
  relatorio: RelatorioDaVarredura,
  logger: Logger,
): Promise<void> {
  if (chavesAtivas.length === 0) return;
  // Entrega o que está pendente — inclusive o que nasceu em shadow e continua
  // valendo agora que o aviso foi ligado. `delivered` não volta.
  const abertos = await db
    .select({
      id: schema.proactiveSignals.id,
      dedupeKey: schema.proactiveSignals.dedupeKey,
      severity: schema.proactiveSignals.severity,
      title: schema.proactiveSignals.title,
      body: schema.proactiveSignals.body,
      recommendedAction: schema.proactiveSignals.recommendedAction,
    })
    .from(schema.proactiveSignals)
    .where(
      and(
        eq(schema.proactiveSignals.organizationId, organizationId),
        inArray(schema.proactiveSignals.dedupeKey, chavesAtivas),
        inArray(schema.proactiveSignals.status, ['pending', 'shadow']),
      ),
    );
  if (abertos.length === 0) return;

  const pessoas = await pessoasDaEmpresa(organizationId);
  const riscoPorChave = new Map(porTarefa.map((c) => [chaveDoSinal(organizationId, c.dedupeKey), c.risco]));

  const porPessoa = new Map<string, ItemDoAviso[]>();
  for (const s of abertos) {
    const risco = riscoPorChave.get(s.dedupeKey);
    const destinatarios = risco ? destinatariosDaTarefa(risco.tarefa, pessoas) : [...pessoas.gestores];
    if (destinatarios.length === 0) {
      relatorio.sinaisSemDestinatario += 1;
      continue;
    }
    const item: ItemDoAviso = {
      signalId: s.id,
      severity: s.severity,
      pontuacao: risco?.pontuacao ?? 50,
      titulo: s.title,
      // Agregado (ex.: "3 entregas prioritárias vencem amanhã"): o corpo já
      // lista as tarefas, uma por linha — vão as três primeiras.
      motivos: risco ? s.body : s.body.split('\n').slice(0, 3).map((l) => l.replace(/^- /, '')).join('; '),
      acao: s.recommendedAction,
    };
    for (const u of destinatarios) porPessoa.set(u, [...(porPessoa.get(u) ?? []), item]);
  }

  const entregues = new Set<string>();
  for (const [userId, itens] of porPessoa) {
    const aviso = montarAviso(itens);
    const inseridos = await db
      .insert(schema.notifications)
      .values({ userId, organizationId, type: 'bento_alerta', title: aviso.title, body: aviso.body, link: '/tasks', dedupeKey: aviso.dedupeKey })
      .onConflictDoNothing()
      .returning({ id: schema.notifications.id })
      .catch((error: unknown) => {
        logger.warn({ organizationId, err: String(error) }, '[bento-varredura] aviso não gravado');
        return null;
      });
    if (inseridos === null) continue;
    if (inseridos.length > 0) relatorio.avisosEnviados += 1;
    relatorio.pessoasAvisadas += 1;
    for (const i of itens) entregues.add(i.signalId);
  }
  for (const id of entregues) await markSignalDelivered(id).catch(() => undefined);
}

/** Todas as empresas com cliente ligado ao ClickUp, uma de cada vez. */
export async function varrerOperacao(logger: Logger, deps: DepsDaVarredura = {}): Promise<RelatorioDaVarredura[]> {
  const config = deps.config ?? lerConfigDaProatividade();
  if (config.monitoramento === 'off') return [];
  const empresas = await db
    .selectDistinct({ id: schema.clients.organizationId })
    .from(schema.clients)
    .where(and(isNotNull(schema.clients.organizationId), isNull(schema.clients.deletedAt), isNotNull(schema.clients.clickupListId)));
  const relatorios: RelatorioDaVarredura[] = [];
  // Em série, não em paralelo: o limite do ClickUp é por token, e a casa usa
  // o mesmo token para várias empresas.
  for (const e of empresas) {
    if (!e.id) continue;
    relatorios.push(await varrerEmpresa(e.id, logger, { ...deps, config }));
  }
  logger.info({ relatorios }, `[bento-varredura] ${relatorios.length} empresa(s) varrida(s) (modo ${config.monitoramento})`);
  return relatorios;
}
