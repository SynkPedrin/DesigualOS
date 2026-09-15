import {
  claimUnprocessedEvents,
  emitSignal,
  markEventProcessed,
  reactToEvent,
  type NormalizedEvent,
  type OperationalEventType,
  type PendingEvent,
  type SignalCandidate,
  type SignalOutcome,
} from '@desigual-os/orchestrator';
import type { Logger } from '@desigual-os/logging';

/**
 * operational-events.ts — o processador que faltava entre o EVENT STORE e a
 * PROATIVIDADE (§37-39).
 *
 * O webhook do ClickUp já gravava evento (event-store) e o event-intelligence
 * já sabia decidir o que cada evento merece (reactToEvent), mas nada ligava as
 * duas pontas: `claimUnprocessedEvents` e `emitSignal` não tinham NENHUM
 * chamador, então todo evento gravado ficava com `processed_at` nulo pra
 * sempre e nenhum sinal proativo nascia de evento. Este processador é essa
 * ponte, e só ela — a decisão de "isto merece atenção humana?" continua toda
 * em reactToEvent, e as portas de anti-spam (severidade, dedup, cooldown)
 * continuam todas em emitSignal.
 *
 * As dependências são injetáveis pelo mesmo motivo do resto do worker: o teste
 * exercita a orquestração sem banco nem Redis.
 */

export interface OperationalEventsDeps {
  claim: (limit: number) => Promise<PendingEvent[]>;
  emit: (candidate: SignalCandidate) => Promise<SignalOutcome>;
  markProcessed: (eventId: string, error?: string) => Promise<void>;
}

export const defaultOperationalEventsDeps: OperationalEventsDeps = {
  claim: claimUnprocessedEvents,
  emit: emitSignal,
  markProcessed: markEventProcessed,
};

/** Tipos que o event-intelligence sabe interpretar. O resto é registrado e ignorado. */
const KNOWN_TYPES: readonly OperationalEventType[] = [
  'task.created',
  'task.updated',
  'task.completed',
  'task.overdue',
  'comment.created',
  'briefing.updated',
  'creative.approved',
  'creative.rejected',
  'client.updated',
];

function isKnownType(type: string): type is OperationalEventType {
  return (KNOWN_TYPES as readonly string[]).includes(type);
}

/**
 * PendingEvent (linha do banco) -> NormalizedEvent (entrada do
 * event-intelligence). O nome legível da entidade vem do payload quando o
 * produtor mandou; sem ele o reactToEvent cai no entityId, que é o
 * comportamento certo — nunca inventar um nome bonito pra um id.
 */
export function normalizePendingEvent(event: PendingEvent): NormalizedEvent | null {
  if (!isKnownType(event.type)) return null;
  const payload = event.payload ?? {};
  const nome = typeof payload.name === 'string' ? payload.name : typeof payload.task_name === 'string' ? payload.task_name : null;
  const cliente = typeof payload.client_name === 'string' ? payload.client_name : null;
  return {
    type: event.type,
    entityId: event.entityId,
    entityName: nome,
    clientId: event.clientId,
    clientName: cliente,
    actor: event.actor,
    occurredAt: event.occurredAt,
  };
}

export interface ProcessEventsResult {
  claimed: number;
  /** Eventos cujo tipo o event-intelligence não conhece (marcados como processados mesmo assim). */
  unknown: number;
  signalsCreated: number;
  /** Sinais barrados pelas portas do emitSignal (dedup/cooldown/severidade) — silêncio deliberado. */
  signalsSuppressed: number;
  /** Eventos que só atualizam estado e, por decisão, NÃO viram alerta (§37). */
  stateOnly: number;
}

/**
 * Processa um lote de eventos pendentes. NUNCA lança: proatividade é efeito
 * colateral e não pode derrubar o worker. Falha num evento marca aquele evento
 * com o erro e segue pros outros.
 */
export async function processPendingEvents(
  logger: Logger,
  deps: OperationalEventsDeps = defaultOperationalEventsDeps,
  limit = 50,
): Promise<ProcessEventsResult> {
  const result: ProcessEventsResult = { claimed: 0, unknown: 0, signalsCreated: 0, signalsSuppressed: 0, stateOnly: 0 };

  let pendentes: PendingEvent[];
  try {
    pendentes = await deps.claim(limit);
  } catch (error) {
    logger.error({ error }, '[eventos] não consegui ler a fila de eventos pendentes');
    return result;
  }
  result.claimed = pendentes.length;
  if (pendentes.length === 0) return result;

  for (const pendente of pendentes) {
    try {
      const normalizado = normalizePendingEvent(pendente);
      if (!normalizado) {
        result.unknown += 1;
        // Marcado como processado de propósito: tipo desconhecido não é erro
        // recuperável, e deixá-lo pendente faria o lote seguinte reprocessá-lo
        // pra sempre, escondendo os eventos novos atrás dele.
        await deps.markProcessed(pendente.id);
        continue;
      }

      const reacao = reactToEvent(normalizado);
      if (reacao.signal) {
        const outcome = await deps.emit(reacao.signal);
        if (outcome.status === 'created') result.signalsCreated += 1;
        else result.signalsSuppressed += 1;
        logger.info(
          { event_id: pendente.id, type: pendente.type, rule: reacao.signal.rule, outcome: outcome.status },
          '[eventos] evento virou sinal proativo',
        );
      } else {
        result.stateOnly += 1;
        logger.debug({ event_id: pendente.id, type: pendente.type, reason: reacao.reason }, '[eventos] evento só atualiza estado');
      }

      await deps.markProcessed(pendente.id);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      logger.error({ error, event_id: pendente.id, type: pendente.type }, '[eventos] falha ao processar evento');
      // O erro fica gravado NA LINHA do evento: um evento problemático não
      // pode travar a fila nem sumir sem deixar rastro.
      await deps.markProcessed(pendente.id, motivo).catch(() => undefined);
    }
  }

  logger.info({ ...result }, '[eventos] lote de eventos operacionais processado');
  return result;
}
