import { and, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { organizacaoDaEscrita } from '@desigual-os/auth';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'proactivity' });

/**
 * proactivity.ts — decide se um acontecimento merece a atenção de um humano ANTES de
 * alguém perguntar, e garante que isso não vire spam.
 *
 * A parte difícil de proatividade não é detectar: é NÃO incomodar. Por isso todo sinal
 * passa por três portas antes de existir:
 *   1. severidade mínima — ruído não vira notificação;
 *   2. deduplicação por chave — o mesmo problema não é anunciado duas vezes;
 *   3. cooldown — problema que persiste não é reanunciado a cada varredura.
 * Sem isso, "3 entregas prioritárias amanhã" viraria 3 avisos por hora, e a reação natural
 * do time é desligar a notificação inteira — o que destrói o recurso.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Quanto tempo o mesmo sinal fica em silêncio depois de emitido, por severidade. */
const COOLDOWN_HOURS: Record<Severity, number> = {
  low: 72,
  medium: 24,
  high: 8,
  critical: 2,
};

export interface SignalCandidate {
  /** Regra que detectou, ex: 'task.prioritaria_amanha_nao_iniciada'. */
  rule: string;
  /** Agente que fala com o humano sobre isso. */
  agent: 'bento' | 'jarbas' | 'suzy' | 'otto';
  severity: Severity;
  /** 0..1 — quanta certeza de que é de fato um problema. */
  confidence: number;
  title: string;
  body: string;
  recommendedAction?: string | null;
  clientId?: string | null;
  /** Fronteira de tenant (migração 0045). proactive_signals não tem user_id pra deduzir — sem isto, sinal sem cliente fica sem dono nenhum. */
  organizationId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Identidade do PROBLEMA. Mesmo problema = mesma chave, mesmo em varreduras diferentes. */
  dedupeKey: string;
  /**
   * Silêncio depois de emitido, sobrepondo o padrão por severidade. Existe
   * para o sinal POR TAREFA: com o padrão, uma atrasada urgente (critical, 2h)
   * voltaria a avisar a mesma pessoa quatro vezes num dia.
   */
  cooldownHoras?: number;
}

/**
 * A chave que de fato vai para o banco: a do produtor, com a EMPRESA na frente.
 *
 * O índice único de `proactive_signals.dedupe_key` é global e as chaves dos
 * produtores não levavam empresa (`prioritaria_atrasada:2026-10-14`,
 * `mcp.client_decision:<resumo>`): duas empresas com o mesmo problema no
 * mesmo dia colidiam, e a segunda era silenciada como "já anunciado".
 * Corrigido aqui, na porta única, e não em cada produtor — vale para os de
 * hoje e para os que ainda não existem. Sem migração: o índice continua
 * global, as chaves é que deixam de colidir. Sinal sem empresa fica num
 * espaço próprio e nunca encontra destinatário.
 */
export function chaveDoSinal(organizationId: string | null, dedupeKey: string): string {
  return `${organizationId ?? 'sem-empresa'}:${dedupeKey}`;
}

/**
 * `live`: o sinal nasce `pending`, pronto para ser entregue.
 * `shadow`: nasce `shadow` — registrado e medido, invisível para quem lista
 * pendências e para a entrega. É o estágio A da proatividade do Bento.
 */
export type ModoDoSinal = 'live' | 'shadow';

export type SignalOutcome =
  | { status: 'created'; signalId: string }
  /** Já existe e ainda está em cooldown: silêncio deliberado. */
  | { status: 'suppressed'; reason: string }
  | { status: 'failed'; reason: string };

/** Piso de severidade+confiança pra virar sinal. Abaixo disto, é observação, não alerta. */
const MIN_SEVERITY: Severity = 'medium';
const MIN_CONFIDENCE = 0.6;

/**
 * Registra um sinal, se ele passar pelas três portas.
 * NUNCA lança: proatividade é efeito colateral e não pode derrubar quem a chamou.
 */
export async function emitSignal(
  candidate: SignalCandidate,
  now: Date = new Date(),
  opcoes: { modo?: ModoDoSinal } = {},
): Promise<SignalOutcome> {
  try {
    if (SEVERITY_ORDER[candidate.severity] < SEVERITY_ORDER[MIN_SEVERITY]) {
      return { status: 'suppressed', reason: `severidade ${candidate.severity} abaixo do piso` };
    }
    if (candidate.confidence < MIN_CONFIDENCE) {
      return { status: 'suppressed', reason: `confianca ${candidate.confidence} abaixo do piso` };
    }
    const modo = opcoes.modo ?? 'live';
    const statusNovo = modo === 'shadow' ? 'shadow' : 'pending';
    const horasDeSilencio = candidate.cooldownHoras ?? COOLDOWN_HOURS[candidate.severity];

    /**
     * `candidate.organizationId` primeiro: quando o sinal nasce de um evento
     * de operational_events (reactToEvent), a organização já é conhecida na
     * origem — não precisa ser re-derivada. Isso é o que resolve o sinal SEM
     * cliente (erro geral, decisão de agência): `organizacaoDaEscrita` só
     * teria `clientId` pra tentar, e sem cliente ela não tem segundo caminho
     * pra `proactive_signals` (a tabela não tem `user_id`). Sinal que não vem
     * de um evento (produtor futuro, direto) cai no fallback por cliente.
     *
     * Resolvida ANTES da busca por duplicata: a empresa faz parte da chave.
     */
    const organizationId = candidate.organizationId ?? await organizacaoDaEscrita({ clientId: candidate.clientId ?? null });
    const chave = chaveDoSinal(organizationId, candidate.dedupeKey);

    const [existing] = await db
      .select({
        id: schema.proactiveSignals.id,
        cooldownUntil: schema.proactiveSignals.cooldownUntil,
        status: schema.proactiveSignals.status,
      })
      .from(schema.proactiveSignals)
      .where(eq(schema.proactiveSignals.dedupeKey, chave));

    if (existing) {
      // Sinal já resolvido/descartado pelo humano: não ressuscita só porque a condição
      // ainda aparece na varredura. Quem decidiu ignorar decidiu.
      if (existing.status === 'dismissed' || existing.status === 'resolved') {
        return { status: 'suppressed', reason: `sinal ja ${existing.status}` };
      }
      if (existing.cooldownUntil && existing.cooldownUntil > now) {
        return { status: 'suppressed', reason: `em cooldown ate ${existing.cooldownUntil.toISOString()}` };
      }
      // Fora do cooldown: reabre o mesmo sinal em vez de criar linha nova.
      const cooldown = new Date(now.getTime() + horasDeSilencio * 3_600_000);
      await db
        .update(schema.proactiveSignals)
        .set({
          severity: candidate.severity,
          confidence: candidate.confidence.toFixed(3),
          title: candidate.title,
          body: candidate.body,
          recommendedAction: candidate.recommendedAction ?? null,
          status: statusNovo,
          cooldownUntil: cooldown,
          updatedAt: now,
        })
        .where(eq(schema.proactiveSignals.id, existing.id));
      return { status: 'created', signalId: existing.id };
    }

    const cooldown = new Date(now.getTime() + horasDeSilencio * 3_600_000);

    const [created] = await db
      .insert(schema.proactiveSignals)
      .values({
        organizationId,
        rule: candidate.rule,
        agent: candidate.agent,
        clientId: candidate.clientId ?? null,
        entityType: candidate.entityType ?? null,
        entityId: candidate.entityId ?? null,
        severity: candidate.severity,
        confidence: candidate.confidence.toFixed(3),
        title: candidate.title,
        body: candidate.body,
        recommendedAction: candidate.recommendedAction ?? null,
        dedupeKey: chave,
        cooldownUntil: cooldown,
        status: statusNovo,
      })
      .onConflictDoNothing({ target: [schema.proactiveSignals.dedupeKey] })
      .returning({ id: schema.proactiveSignals.id });

    if (!created) return { status: 'suppressed', reason: 'corrida: sinal criado em paralelo' };
    logger.info({ rule: candidate.rule, severity: candidate.severity, clientId: candidate.clientId }, 'Sinal proativo criado');
    return { status: 'created', signalId: created.id };
  } catch (error) {
    return { status: 'failed', reason: (error as Error).message };
  }
}

export interface OpenSignal {
  id: string;
  rule: string;
  agent: string;
  severity: string;
  title: string;
  body: string;
  recommendedAction: string | null;
  clientId: string | null;
  createdAt: Date;
}

/**
 * Sinais pendentes, do mais grave pro menos grave. Com `organizationId`, só os
 * daquela empresa — quem for entregar sinal a pessoas passa a empresa sempre.
 */
export async function listPendingSignals(limit = 20, organizationId?: string): Promise<OpenSignal[]> {
  return db
    .select({
      id: schema.proactiveSignals.id,
      rule: schema.proactiveSignals.rule,
      agent: schema.proactiveSignals.agent,
      severity: schema.proactiveSignals.severity,
      title: schema.proactiveSignals.title,
      body: schema.proactiveSignals.body,
      recommendedAction: schema.proactiveSignals.recommendedAction,
      clientId: schema.proactiveSignals.clientId,
      createdAt: schema.proactiveSignals.createdAt,
    })
    .from(schema.proactiveSignals)
    .where(
      organizationId
        ? and(eq(schema.proactiveSignals.status, 'pending'), eq(schema.proactiveSignals.organizationId, organizationId))
        : eq(schema.proactiveSignals.status, 'pending'),
    )
    .orderBy(
      sql`CASE ${schema.proactiveSignals.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      schema.proactiveSignals.createdAt,
    )
    .limit(limit);
}

export async function markSignalDelivered(signalId: string): Promise<void> {
  await db
    .update(schema.proactiveSignals)
    .set({ status: 'delivered', deliveredAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.proactiveSignals.id, signalId));
}

export async function resolveSignal(signalId: string, status: 'resolved' | 'dismissed'): Promise<void> {
  await db
    .update(schema.proactiveSignals)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.proactiveSignals.id, signalId));
}

// ---------------------------------------------------------------------------
// REGRAS DE DETECÇÃO
// ---------------------------------------------------------------------------

export interface TaskForRules {
  id: string;
  name: string;
  status: string | null;
  statusType: string | null;
  priority: string | null;
  dueDate: number | null;
  assignees: string[];
  listId: string | null;
  clientId?: string | null;
  clientName?: string | null;
}

/**
 * Regras sobre estado de tarefa. Todas derivadas de dado real — nenhuma heurística sobre
 * "o que provavelmente está acontecendo".
 *
 * `startOfTomorrow`/`endOfTomorrow` entram por parâmetro (resolvidos pelo relógio real no
 * chamador) pra que a regra seja testável e não dependa de fuso implícito.
 */
export function detectTaskSignals(
  tasks: TaskForRules[],
  window: { startOfToday: number; startOfTomorrow: number; endOfTomorrow: number },
): SignalCandidate[] {
  const concluida = (t: TaskForRules) => t.statusType === 'done' || t.statusType === 'closed';
  const emAberto = tasks.filter((t) => !concluida(t));
  const sinais: SignalCandidate[] = [];

  // 1. Entrega prioritária vence amanhã e ainda não saiu do lugar.
  const prioritariasAmanha = emAberto.filter(
    (t) =>
      (t.priority === 'urgent' || t.priority === 'high') &&
      t.dueDate !== null &&
      t.dueDate >= window.startOfTomorrow &&
      t.dueDate <= window.endOfTomorrow,
  );
  if (prioritariasAmanha.length > 0) {
    sinais.push({
      rule: 'task.prioritaria_vence_amanha',
      agent: 'bento',
      severity: prioritariasAmanha.length >= 3 ? 'high' : 'medium',
      confidence: 0.95,
      title: `${prioritariasAmanha.length} entrega(s) prioritária(s) vencem amanhã`,
      body: prioritariasAmanha
        .slice(0, 6)
        .map((t) => `- ${t.name}${t.clientName ? ` (${t.clientName})` : ''} — status: ${t.status ?? 'sem status'}${t.assignees.length ? `, resp: ${t.assignees.join(', ')}` : ', SEM RESPONSÁVEL'}`)
        .join('\n'),
      recommendedAction: 'Confirmar ordem de execução e destravar o que depende de aprovação',
      // Chave por DIA: o mesmo alerta não repete hoje, mas volta amanhã se o problema
      // continuar — que é o comportamento certo pra prazo.
      dedupeKey: `prioritaria_amanha:${new Date(window.startOfTomorrow).toISOString().slice(0, 10)}`,
    });
  }

  // 2. Tarefa aberta sem responsável: ninguém vai executar.
  const semResponsavel = emAberto.filter((t) => t.assignees.length === 0);
  if (semResponsavel.length >= 5) {
    sinais.push({
      rule: 'task.sem_responsavel',
      agent: 'bento',
      severity: semResponsavel.length >= 20 ? 'high' : 'medium',
      confidence: 0.9,
      title: `${semResponsavel.length} tarefas abertas sem responsável`,
      body: semResponsavel
        .slice(0, 6)
        .map((t) => `- ${t.name}${t.clientName ? ` (${t.clientName})` : ''}`)
        .join('\n'),
      recommendedAction: 'Distribuir responsáveis antes que o prazo chegue',
      dedupeKey: `sem_responsavel:${new Date(window.startOfToday).toISOString().slice(0, 10)}`,
    });
  }

  // 3. Atrasada de prioridade alta: já passou do prazo e continua aberta.
  const atrasadaPrioritaria = emAberto.filter(
    (t) =>
      (t.priority === 'urgent' || t.priority === 'high') &&
      t.dueDate !== null &&
      t.dueDate < window.startOfToday,
  );
  if (atrasadaPrioritaria.length > 0) {
    sinais.push({
      rule: 'task.prioritaria_atrasada',
      agent: 'bento',
      severity: 'critical',
      confidence: 0.95,
      title: `${atrasadaPrioritaria.length} entrega(s) prioritária(s) ATRASADA(S)`,
      body: atrasadaPrioritaria
        .slice(0, 6)
        .map((t) => `- ${t.name}${t.clientName ? ` (${t.clientName})` : ''} — venceu e continua aberta`)
        .join('\n'),
      recommendedAction: 'Repactuar prazo com o cliente ou realocar quem executa',
      dedupeKey: `prioritaria_atrasada:${new Date(window.startOfToday).toISOString().slice(0, 10)}`,
    });
  }

  return sinais;
}

/** Sinais já entregues recentemente — usado pra não repetir no chat. */
export async function recentlyDelivered(hours = 12): Promise<number> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await db
    .select({ id: schema.proactiveSignals.id })
    .from(schema.proactiveSignals)
    .where(and(eq(schema.proactiveSignals.status, 'delivered'), gt(schema.proactiveSignals.deliveredAt, since)));
  return rows.length;
}

// ---------------------------------------------------------------------------
// RISCO POR TAREFA (Bento 3.1, 14/10/2026)
//
// As três regras acima AGREGAM ("3 entregas prioritárias vencem amanhã"): boas
// para o gestor, sem dono para avisar. Estas olham uma tarefa por vez, para o
// aviso chegar a quem pode agir: o responsável, ou a gestão quando não há.
//
// Fato é determinístico (data, campo de responsável, prioridade); o modelo não
// entra aqui. O impacto é uma regra explicável, não só "dias de atraso": uma
// tarefa de prioridade baixa atrasada um dia pesa menos que uma urgente que
// vence amanhã. Cada sinal leva os motivos em texto — é o que torna a
// prioridade auditável por quem recebe.
// ---------------------------------------------------------------------------

export type EventoDeTarefa = 'TASK_OVERDUE' | 'TASK_DUE_SOON' | 'TASK_UNASSIGNED';

export interface TarefaParaRisco extends TaskForRules {
  /** E-mails dos responsáveis no ClickUp, para achar a pessoa no OS. */
  assigneeEmails?: string[];
  url?: string | null;
}

export interface RiscoDeTarefa {
  evento: EventoDeTarefa;
  tarefa: TarefaParaRisco;
  severity: Severity;
  /** 0..100. Ordena dentro da mesma severidade. */
  pontuacao: number;
  motivos: string[];
}

const PESO_DA_PRIORIDADE: Record<string, number> = { urgent: 2, high: 1.5, normal: 1, low: 0.6 };
const DIA_MS = 86_400_000;

/**
 * Janela de dias no fuso da operação. Os limites entram prontos (calculados
 * por quem conhece o relógio e o fuso), como em detectTaskSignals.
 */
export interface JanelaDeRisco {
  startOfToday: number;
  startOfTomorrow: number;
  endOfTomorrow: number;
  /** Fim do terceiro dia a partir de hoje: "sem dono e vence logo". */
  endOfDay3: number;
}

function severidadePorPontuacao(p: number): Severity {
  if (p >= 75) return 'critical';
  if (p >= 50) return 'high';
  if (p >= 25) return 'medium';
  return 'low';
}

export function avaliarRiscosDaTarefa(t: TarefaParaRisco, janela: JanelaDeRisco): RiscoDeTarefa[] {
  if (t.statusType === 'done' || t.statusType === 'closed') return [];
  const peso = PESO_DA_PRIORIDADE[t.priority ?? ''] ?? 1;
  const rotuloPrioridade = t.priority ? `prioridade ${t.priority}` : 'sem prioridade definida';
  const riscos: RiscoDeTarefa[] = [];

  if (t.dueDate !== null && t.dueDate < janela.startOfToday) {
    const dias = Math.max(1, Math.ceil((janela.startOfToday - t.dueDate) / DIA_MS));
    // Atraso pesa, mas satura: 10 dias não é dez vezes pior que 1 para decidir
    // o que fazer hoje, e sem teto uma tarefa esquecida há meses passaria
    // sempre na frente da entrega urgente de amanhã.
    const pontuacao = Math.min(100, Math.round((30 + Math.min(dias, 7) * 4) * peso));
    const motivos = [`venceu há ${dias} dia(s)`, rotuloPrioridade];
    if (t.assignees.length === 0) motivos.push('sem responsável');
    riscos.push({ evento: 'TASK_OVERDUE', tarefa: t, pontuacao, severity: severidadePorPontuacao(pontuacao), motivos });
  } else if (t.dueDate !== null && t.dueDate >= janela.startOfToday && t.dueDate <= janela.endOfTomorrow) {
    const hoje = t.dueDate < janela.startOfTomorrow;
    const pontuacao = Math.min(100, Math.round((hoje ? 35 : 25) * peso + (t.assignees.length === 0 ? 20 : 0)));
    const motivos = [hoje ? 'vence hoje' : 'vence amanhã', rotuloPrioridade];
    if (t.assignees.length === 0) motivos.push('sem responsável');
    riscos.push({ evento: 'TASK_DUE_SOON', tarefa: t, pontuacao, severity: severidadePorPontuacao(pontuacao), motivos });
  }

  // Sem dono e com prazo perto: ninguém vai pegar sozinho. Sem prazo nenhum, o
  // agregado `task.sem_responsavel` já cobre — avisar uma por uma seria ruído.
  if (t.assignees.length === 0 && t.dueDate !== null && t.dueDate >= janela.startOfToday && t.dueDate <= janela.endOfDay3) {
    const pontuacao = Math.min(100, Math.round(30 * peso + 10));
    riscos.push({
      evento: 'TASK_UNASSIGNED',
      tarefa: t,
      pontuacao,
      severity: severidadePorPontuacao(pontuacao),
      motivos: ['sem responsável', 'vence em até 3 dias', rotuloPrioridade],
    });
  }
  return riscos;
}

const REGRA_DO_EVENTO: Record<EventoDeTarefa, string> = {
  TASK_OVERDUE: 'task.atrasada',
  TASK_DUE_SOON: 'task.vence_logo',
  TASK_UNASSIGNED: 'task.sem_dono_prazo_curto',
};
export const REGRAS_POR_TAREFA = Object.values(REGRA_DO_EVENTO);

/**
 * Os sinais por tarefa, já no formato do emitSignal.
 *
 * IDENTIDADE DO SINAL: tarefa + evento + o prazo que a tarefa tem AGORA + o dia.
 * O prazo entra porque prazo remarcado é outro problema (avisar de novo é o
 * certo); o dia entra porque o mesmo atraso pode lembrar uma vez por dia, não
 * mais. Com o cooldown de 24h, é no máximo um aviso por tarefa por dia.
 */
export function sinaisDeRiscoPorTarefa(
  tarefas: TarefaParaRisco[],
  janela: JanelaDeRisco,
  organizationId: string,
): Array<SignalCandidate & { risco: RiscoDeTarefa }> {
  const dia = new Date(janela.startOfToday).toISOString().slice(0, 10);
  return tarefas
    .flatMap((t) => avaliarRiscosDaTarefa(t, janela))
    .filter((r) => r.severity !== 'low')
    .map((r) => {
      const t = r.tarefa;
      const prazo = t.dueDate !== null ? new Date(t.dueDate).toISOString().slice(0, 10) : 'sem-prazo';
      return {
        rule: REGRA_DO_EVENTO[r.evento],
        agent: 'bento' as const,
        severity: r.severity,
        confidence: 0.95,
        title: `${t.name}${t.clientName ? ` (${t.clientName})` : ''}`,
        body: r.motivos.join(' · '),
        recommendedAction:
          r.evento === 'TASK_UNASSIGNED'
            ? 'Definir quem executa'
            : r.evento === 'TASK_OVERDUE'
              ? 'Concluir ou repactuar o prazo'
              : 'Confirmar que sai no prazo',
        clientId: t.clientId ?? null,
        organizationId,
        entityType: 'clickup_task',
        entityId: t.id,
        dedupeKey: `${REGRA_DO_EVENTO[r.evento]}:${t.id}:${prazo}:${dia}`,
        cooldownHoras: 24,
        risco: r,
      };
    });
}

/**
 * Resolve, numa empresa, os sinais destas regras que NÃO apareceram na
 * varredura atual: a tarefa foi concluída, ganhou dono ou teve o prazo
 * remarcado. Sem isto o sinal ficaria aberto para sempre e a lista de
 * pendências mentiria. Devolve quantos foram resolvidos.
 */
export async function resolverSinaisAusentes(params: {
  organizationId: string;
  regras: string[];
  chavesAtivas: string[];
  now?: Date;
}): Promise<number> {
  const condicoes = [
    eq(schema.proactiveSignals.organizationId, params.organizationId),
    inArray(schema.proactiveSignals.rule, params.regras),
    inArray(schema.proactiveSignals.status, ['pending', 'delivered', 'shadow']),
  ];
  if (params.chavesAtivas.length > 0) condicoes.push(notInArray(schema.proactiveSignals.dedupeKey, params.chavesAtivas));
  const linhas = await db
    .update(schema.proactiveSignals)
    .set({ status: 'resolved', updatedAt: params.now ?? new Date() })
    .where(and(...condicoes))
    .returning({ id: schema.proactiveSignals.id });
  return linhas.length;
}
