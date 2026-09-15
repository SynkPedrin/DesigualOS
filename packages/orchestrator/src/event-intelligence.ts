import type { SignalCandidate } from './proactivity';

/**
 * event-intelligence.ts — a ponte EVENTO → INTELIGÊNCIA OPERACIONAL (§37-39).
 *
 * O event-store já persiste e deduplica; a proactivity já detecta e não faz spam.
 * O que faltava era a decisão, por evento, entre "isto só atualiza o estado" e
 * "isto merece a atenção de um humano AGORA, com uma próxima ação". Regra de
 * ouro (§37): nem todo evento vira mensagem. Conclusão de tarefa atualiza o
 * estado e cala a boca; tarefa que virou atrasada ou criativo rejeitado geram
 * sinal com próxima ação. Puro e determinístico — testável sem rede.
 */

export type OperationalEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.completed'
  | 'task.overdue'
  | 'comment.created'
  | 'briefing.updated'
  | 'creative.approved'
  | 'creative.rejected'
  | 'client.updated';

export interface NormalizedEvent {
  type: OperationalEventType;
  entityId?: string | null;
  entityName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  actor?: string | null;
  occurredAt?: Date | null;
}

export interface EventReaction {
  /** Todo evento de mudança atualiza o estado operacional (o Bento "sabe" o que houve). */
  updatesState: boolean;
  /** Sinal proativo quando o evento merece atenção humana (§39). null = só estado, sem alerta. */
  signal: SignalCandidate | null;
  /** Motivo legível da decisão, pro trace. */
  reason: string;
}

function dayKey(event: NormalizedEvent): string {
  const d = event.occurredAt ?? new Date();
  return d.toISOString().slice(0, 10);
}
function label(event: NormalizedEvent): string {
  return event.entityName ?? event.entityId ?? 'item';
}
function clientSuffix(event: NormalizedEvent): string {
  return event.clientName ? ` (${event.clientName})` : '';
}

/**
 * Decide a reação a UM evento normalizado. O sinal (quando existe) sai pronto
 * pro emitSignal da proactivity, que aplica as três portas (severidade, dedup,
 * cooldown) — então isto NÃO precisa se preocupar com spam, só com pertinência.
 */
export function reactToEvent(event: NormalizedEvent): EventReaction {
  switch (event.type) {
    case 'task.overdue':
      return {
        updatesState: true,
        reason: 'tarefa passou do prazo e continua aberta: risco operacional com próxima ação',
        signal: {
          rule: 'event.task_overdue',
          agent: 'bento',
          severity: 'high',
          confidence: 0.9,
          title: `Tarefa atrasada: ${label(event)}${clientSuffix(event)}`,
          body: `A tarefa "${label(event)}" passou do prazo e continua aberta.`,
          recommendedAction: 'Repactuar o prazo ou concluir hoje; checar se ela bloqueia outras',
          clientId: event.clientId ?? null,
          entityType: 'task',
          entityId: event.entityId ?? null,
          dedupeKey: `event.task_overdue:${event.entityId ?? label(event)}:${dayKey(event)}`,
        },
      };
    case 'creative.rejected':
      return {
        updatesState: true,
        reason: 'criativo rejeitado: exige revisão com base no feedback',
        signal: {
          rule: 'event.creative_rejected',
          agent: 'otto',
          severity: 'medium',
          confidence: 0.85,
          title: `Criativo rejeitado${clientSuffix(event)}`,
          body: `O criativo "${label(event)}" foi rejeitado.`,
          recommendedAction: 'Revisar com base no motivo da rejeição e reenviar; registrar o aprendizado por cliente',
          clientId: event.clientId ?? null,
          entityType: 'creative',
          entityId: event.entityId ?? null,
          dedupeKey: `event.creative_rejected:${event.entityId ?? label(event)}`,
        },
      };
    // Eventos que ATUALIZAM o estado mas NÃO geram alerta (§37): não viram mensagem.
    case 'task.completed':
      return { updatesState: true, signal: null, reason: 'conclusão: atualiza estado e pode destravar dependentes, sem alerta' };
    case 'creative.approved':
      return { updatesState: true, signal: null, reason: 'aprovação: boa notícia, sem ação pendente' };
    case 'task.created':
    case 'task.updated':
    case 'comment.created':
    case 'briefing.updated':
    case 'client.updated':
      return { updatesState: true, signal: null, reason: 'mudança registrada no estado operacional; sem alerta por si só' };
    default:
      return { updatesState: false, signal: null, reason: 'evento não reconhecido' };
  }
}

/** Conveniência: dado um lote de eventos, os sinais que devem ir ao emitSignal. */
export function signalsFromEvents(events: NormalizedEvent[]): SignalCandidate[] {
  return events.map(reactToEvent).map((r) => r.signal).filter((s): s is SignalCandidate => s !== null);
}
