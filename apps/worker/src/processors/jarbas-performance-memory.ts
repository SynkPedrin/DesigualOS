import { rememberFact, type RememberInput, type RememberOutcome } from '@desigual-os/orchestrator';
import type { PerformanceMemoryEvent } from '@desigual-os/types';

/**
 * jarbas-performance-memory.ts — adaptador fino pro motor de memória
 * REAL (§17-22).
 *
 * NÃO é Company Memory V2 — é uma função pura de mapeamento chamando
 * `rememberFact`, o mesmo motor já usado por Bento (client-fact.ts,
 * preference-memory.ts) e Otto. Nenhuma tabela nova, nenhuma lógica de
 * supersessão nova: `subject` é o que já garante que uma REJEIÇÃO
 * substitui a hipótese anterior do MESMO aspecto (mesmo mecanismo de
 * `cliente:<id>:<aspecto>` já documentado em memory-engine.ts).
 *
 * Regra de qualidade (§19): só os 12 tipos de evento definidos em
 * `PerformanceMemoryEventType` podem virar memória — nunca "toda frase do
 * chat", nunca comentário genérico.
 */

/**
 * Aspecto do subject: rejeição/aceitação de HIPÓTESE usa a entidade como
 * chave (uma nova hipótese pro mesmo entityId aposenta o veredito
 * anterior sobre ELA, mas não sobre outras hipóteses da mesma campanha).
 * Eventos sem entityId (ex.: mudança de KPI-alvo do cliente inteiro) usam
 * só o tipo como aspecto.
 */
function buildSubject(event: PerformanceMemoryEvent): string | null {
  const aspecto = event.entityId ? `${event.eventType}:${event.entityId}` : event.eventType;
  return `cliente:${event.clientId}:jarbas:${aspecto}`;
}

export function toRememberInput(event: PerformanceMemoryEvent): RememberInput {
  const partes = [event.observation];
  if (event.hypothesis) partes.push(`Hipótese: ${event.hypothesis}`);
  if (event.recommendation) partes.push(`Recomendação: ${event.recommendation}`);
  if (event.decision) partes.push(`Decisão: ${event.decision}`);
  if (event.outcome) partes.push(`Resultado observado: ${event.outcome}`);

  return {
    kind: `jarbas.${event.eventType}`,
    content: partes.join(' — '),
    subject: buildSubject(event),
    clientId: event.clientId,
    agentId: 'jarbas',
    sourceType: 'agent',
    confidence: event.confidence === 'high' ? 0.9 : event.confidence === 'medium' ? 0.6 : 0.3,
    metadata: { organizationId: event.organizationId, entityType: event.entityType, entityId: event.entityId, sourceRefs: event.sourceRefs },
  };
}

export async function recordPerformanceMemory(event: PerformanceMemoryEvent): Promise<RememberOutcome> {
  return rememberFact(toRememberInput(event));
}
