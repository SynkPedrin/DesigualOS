import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'event-store' });

/**
 * event-store.ts — persistência idempotente de acontecimentos da operação.
 *
 * Antes disto o webhook do ClickUp era processado e DESCARTADO: o sistema reagia ao evento
 * (invalidava a UI, respondia menção) mas não guardava nada. Consequência direta: perguntas
 * como "o que mudou desde ontem?" ou "o que aconteceu hoje?" eram irrespondíveis, porque
 * não havia histórico nenhum — só o estado atual do ClickUp.
 *
 * IDEMPOTÊNCIA é o ponto central: integração externa reentrega evento (o ClickUp reentrega
 * em retry), e o mesmo acontecimento não pode ser contado nem memorizado duas vezes. A
 * garantia é o índice único `(source, external_id)` no banco, não uma checagem em memória.
 */

export type EventSource = 'clickup' | 'chat' | 'whatsapp' | 'meta_ads' | 'studio' | 'system';

export interface RecordEventInput {
  source: EventSource;
  /** Tipo normalizado, ex: 'task.created', 'task.status_changed', 'comment.created'. */
  type: string;
  /** Id do evento na origem. Sem ele não há como deduplicar — ver nota abaixo. */
  externalId?: string | null;
  clientId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actor?: string | null;
  payload?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  occurredAt?: Date | null;
}

export type RecordEventOutcome =
  | { status: 'recorded'; eventId: string }
  /** Já existia (reentrega do provedor). Não é erro: é a idempotência funcionando. */
  | { status: 'duplicate'; eventId: string }
  | { status: 'failed'; reason: string };

/**
 * Grava o evento. NUNCA lança: o webhook precisa responder 200 rápido, e perder um evento é
 * ruim, mas derrubar a rota pública é pior (o provedor passa a considerar o endpoint doente
 * e suspende a assinatura — já aconteceu neste projeto).
 */
export async function recordOperationalEvent(input: RecordEventInput): Promise<RecordEventOutcome> {
  try {
    // Sem externalId não existe chave natural de dedup. Em vez de recusar o evento, gera uma
    // chave estável a partir do conteúdo: reentrega idêntica colide e é detectada; evento
    // legitimamente novo com o mesmo corpo (raro) é o preço aceitável.
    const externalId =
      input.externalId ??
      `${input.type}:${input.entityId ?? 'no-entity'}:${input.occurredAt?.getTime() ?? 'no-time'}`;

    const inserted = await db
      .insert(schema.operationalEvents)
      .values({
        source: input.source,
        type: input.type,
        externalId,
        clientId: input.clientId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actor: input.actor ?? null,
        payload: input.payload ?? {},
        raw: input.raw ?? null,
        occurredAt: input.occurredAt ?? null,
      })
      // A dedup é do BANCO (índice único source+external_id), não daqui: duas entregas
      // simultâneas do mesmo evento não podem passar as duas por uma checagem em memória.
      .onConflictDoNothing({
        target: [schema.operationalEvents.source, schema.operationalEvents.externalId],
      })
      .returning({ id: schema.operationalEvents.id });

    if (inserted.length > 0) {
      return { status: 'recorded', eventId: inserted[0]!.id };
    }

    const [existing] = await db
      .select({ id: schema.operationalEvents.id })
      .from(schema.operationalEvents)
      .where(
        and(
          eq(schema.operationalEvents.source, input.source),
          eq(schema.operationalEvents.externalId, externalId),
        ),
      );
    return { status: 'duplicate', eventId: existing?.id ?? 'desconhecido' };
  } catch (error) {
    const reason = (error as Error).message;
    logger.error({ error, type: input.type, source: input.source }, 'Falha ao gravar evento operacional');
    return { status: 'failed', reason };
  }
}

export interface PendingEvent {
  id: string;
  source: string;
  type: string;
  clientId: string | null;
  entityType: string | null;
  entityId: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date | null;
}

/** Eventos ainda não processados pelo pipeline de memória/proatividade. */
export async function claimUnprocessedEvents(limit = 50): Promise<PendingEvent[]> {
  const rows = await db
    .select({
      id: schema.operationalEvents.id,
      source: schema.operationalEvents.source,
      type: schema.operationalEvents.type,
      clientId: schema.operationalEvents.clientId,
      entityType: schema.operationalEvents.entityType,
      entityId: schema.operationalEvents.entityId,
      actor: schema.operationalEvents.actor,
      payload: schema.operationalEvents.payload,
      occurredAt: schema.operationalEvents.occurredAt,
    })
    .from(schema.operationalEvents)
    .where(isNull(schema.operationalEvents.processedAt))
    .orderBy(schema.operationalEvents.createdAt)
    .limit(limit);
  return rows.map((r) => ({ ...r, payload: r.payload as Record<string, unknown> }));
}

export async function markEventProcessed(eventId: string, error?: string): Promise<void> {
  await db
    .update(schema.operationalEvents)
    .set({ processedAt: new Date(), processingError: error ?? null })
    .where(eq(schema.operationalEvents.id, eventId));
}

/**
 * "O que mudou desde X?" — a pergunta que era irrespondível antes de existir event store.
 */
export async function eventsSince(since: Date, clientId?: string | null): Promise<PendingEvent[]> {
  const conditions = [sql`${schema.operationalEvents.createdAt} >= ${since.toISOString()}`];
  if (clientId) conditions.push(eq(schema.operationalEvents.clientId, clientId));
  const rows = await db
    .select({
      id: schema.operationalEvents.id,
      source: schema.operationalEvents.source,
      type: schema.operationalEvents.type,
      clientId: schema.operationalEvents.clientId,
      entityType: schema.operationalEvents.entityType,
      entityId: schema.operationalEvents.entityId,
      actor: schema.operationalEvents.actor,
      payload: schema.operationalEvents.payload,
      occurredAt: schema.operationalEvents.occurredAt,
    })
    .from(schema.operationalEvents)
    .where(and(...conditions))
    .orderBy(schema.operationalEvents.createdAt)
    .limit(200);
  return rows.map((r) => ({ ...r, payload: r.payload as Record<string, unknown> }));
}
