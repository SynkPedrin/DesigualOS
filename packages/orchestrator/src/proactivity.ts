import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
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
  entityType?: string | null;
  entityId?: string | null;
  /** Identidade do PROBLEMA. Mesmo problema = mesma chave, mesmo em varreduras diferentes. */
  dedupeKey: string;
}

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
export async function emitSignal(candidate: SignalCandidate, now: Date = new Date()): Promise<SignalOutcome> {
  try {
    if (SEVERITY_ORDER[candidate.severity] < SEVERITY_ORDER[MIN_SEVERITY]) {
      return { status: 'suppressed', reason: `severidade ${candidate.severity} abaixo do piso` };
    }
    if (candidate.confidence < MIN_CONFIDENCE) {
      return { status: 'suppressed', reason: `confianca ${candidate.confidence} abaixo do piso` };
    }

    const [existing] = await db
      .select({
        id: schema.proactiveSignals.id,
        cooldownUntil: schema.proactiveSignals.cooldownUntil,
        status: schema.proactiveSignals.status,
      })
      .from(schema.proactiveSignals)
      .where(eq(schema.proactiveSignals.dedupeKey, candidate.dedupeKey));

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
      const cooldown = new Date(now.getTime() + COOLDOWN_HOURS[candidate.severity] * 3_600_000);
      await db
        .update(schema.proactiveSignals)
        .set({
          severity: candidate.severity,
          confidence: candidate.confidence.toFixed(3),
          title: candidate.title,
          body: candidate.body,
          recommendedAction: candidate.recommendedAction ?? null,
          status: 'pending',
          cooldownUntil: cooldown,
          updatedAt: now,
        })
        .where(eq(schema.proactiveSignals.id, existing.id));
      return { status: 'created', signalId: existing.id };
    }

    const cooldown = new Date(now.getTime() + COOLDOWN_HOURS[candidate.severity] * 3_600_000);
    const [created] = await db
      .insert(schema.proactiveSignals)
      .values({
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
        dedupeKey: candidate.dedupeKey,
        cooldownUntil: cooldown,
        status: 'pending',
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

/** Sinais pendentes, do mais grave pro menos grave. */
export async function listPendingSignals(limit = 20): Promise<OpenSignal[]> {
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
    .where(eq(schema.proactiveSignals.status, 'pending'))
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
