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
  | 'client.updated'
  /**
   * Vocabulário de NEGÓCIO do MCP (MAIÚSCULO, sem ponto — nunca colide com o
   * do webhook acima). Cada Claude de funcionário já escolhe o tipo ao
   * registrar (`log_operational_event`); aqui só falta decidir quem merece
   * virar sinal, exatamente como já acontece para o vocabulário do webhook.
   */
  | 'CLIENT_DECISION'
  | 'STRATEGY_CHANGED'
  | 'CREATIVE_REJECTED'
  | 'ERROR_FOUND'
  | 'QA_FAILED';

export interface NormalizedEvent {
  type: OperationalEventType;
  entityId?: string | null;
  entityName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  actor?: string | null;
  occurredAt?: Date | null;
  /** Texto já pronto (evento de MCP sempre traz; webhook nunca). Vira o corpo do sinal quando existe. */
  summary?: string | null;
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
    /**
     * O QUATRO DE CIMA SÃO DO WEBHOOK; OS CINCO ABAIXO SÃO DO MCP — mesma
     * ponte, vocabulário diferente. `summary` já vem pronto de quem registrou
     * (o Claude do funcionário escreveu a frase pensando em quem lê depois —
     * ver §10 em mcp-domain/events.ts), então é ele que vira o corpo do
     * sinal, não um template genérico como os de cima.
     */
    case 'CLIENT_DECISION':
      return {
        updatesState: true,
        reason: 'decisão de cliente registrada: quem acompanha a conta precisa saber',
        signal: {
          rule: 'mcp.client_decision',
          agent: 'bento',
          severity: 'medium',
          confidence: 0.8,
          title: `Decisão registrada${clientSuffix(event)}`,
          body: event.summary ?? `Decisão registrada sobre ${label(event)}.`,
          recommendedAction: 'Conferir se afeta entrega em andamento',
          clientId: event.clientId ?? null,
          entityType: 'decision',
          entityId: event.entityId ?? null,
          dedupeKey: `mcp.client_decision:${event.entityId ?? event.summary ?? label(event)}`,
        },
      };
    case 'STRATEGY_CHANGED':
      return {
        updatesState: true,
        reason: 'mudança de estratégia: pode invalidar peça em produção',
        signal: {
          rule: 'mcp.strategy_changed',
          agent: 'bento',
          severity: 'high',
          confidence: 0.85,
          title: `Estratégia mudou${clientSuffix(event)}`,
          body: event.summary ?? `A estratégia mudou para ${label(event)}.`,
          recommendedAction: 'Checar peças em produção antes de entregar',
          clientId: event.clientId ?? null,
          entityType: 'strategy',
          entityId: event.entityId ?? null,
          dedupeKey: `mcp.strategy_changed:${event.entityId ?? event.summary ?? label(event)}`,
        },
      };
    case 'CREATIVE_REJECTED':
      return {
        updatesState: true,
        reason: 'criativo rejeitado (relatado pelo Claude do funcionário): exige revisão',
        signal: {
          rule: 'mcp.creative_rejected',
          agent: 'otto',
          severity: 'medium',
          confidence: 0.8,
          title: `Criativo rejeitado${clientSuffix(event)}`,
          body: event.summary ?? `O criativo "${label(event)}" foi rejeitado.`,
          recommendedAction: 'Revisar com base no motivo da rejeição e reenviar',
          clientId: event.clientId ?? null,
          entityType: 'creative',
          entityId: event.entityId ?? null,
          dedupeKey: `mcp.creative_rejected:${event.entityId ?? event.summary ?? label(event)}`,
        },
      };
    case 'ERROR_FOUND':
      return {
        updatesState: true,
        reason: 'erro relatado: pode já estar afetando entrega',
        signal: {
          rule: 'mcp.error_found',
          agent: 'bento',
          severity: 'high',
          confidence: 0.85,
          title: `Erro encontrado${clientSuffix(event)}`,
          body: event.summary ?? `Um erro foi relatado em ${label(event)}.`,
          recommendedAction: 'Investigar e confirmar se já afetou o cliente',
          clientId: event.clientId ?? null,
          entityType: 'error',
          entityId: event.entityId ?? null,
          dedupeKey: `mcp.error_found:${event.entityId ?? event.summary ?? label(event)}`,
        },
      };
    case 'QA_FAILED':
      return {
        updatesState: true,
        reason: 'QA reprovou: não deveria seguir pro cliente sem correção',
        signal: {
          rule: 'mcp.qa_failed',
          agent: 'bento',
          severity: 'medium',
          confidence: 0.8,
          title: `QA reprovou${clientSuffix(event)}`,
          body: event.summary ?? `QA reprovou ${label(event)}.`,
          recommendedAction: 'Corrigir antes de reenviar ao cliente',
          clientId: event.clientId ?? null,
          entityType: 'qa',
          entityId: event.entityId ?? null,
          dedupeKey: `mcp.qa_failed:${event.entityId ?? event.summary ?? label(event)}`,
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
