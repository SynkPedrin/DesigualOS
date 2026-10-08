import { db, schema } from '@desigual-os/database';
import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';

/**
 * recent-events.ts — o EVENT STORE vira contexto de turno.
 *
 * `operational_events` já era gravado (webhook do ClickUp, ferramentas do MCP)
 * e já era lido — mas só pelo MCP (get_recent_events) e pelo processador de
 * proatividade. O WORKER nunca lia eventos no turno, então "o que mudou na
 * Cosentino essa semana?" era respondida sem a única fonte que guarda a
 * trajetória. Este módulo é a leitura que faltava; QUANDO ler é decisão do
 * retrieval-planner.ts.
 *
 * Telemetria: procuramos um tipo MCP_TOOL_CALLED de leitura pra filtrar e ele
 * NÃO EXISTE nesta base (os writers são o webhook — 'task.*' — e o MCP, que
 * grava vocabulário de negócio tipo CLIENT_DECISION). Nada a filtrar; se um
 * writer de telemetria nascer, o filtro entra aqui.
 */

export interface EventoRecente {
  id: string;
  type: string;
  summary: string | null;
  actor: string | null;
  occurredAt: Date | null;
  createdAt: Date | null;
  clientId: string | null;
  importance: string | null;
  source: string;
}

/** Quantos eventos entram no bloco do turno. */
export const EVENTOS_RECENTES_LIMITE = 10;

/**
 * Últimos N eventos do cliente (ou da empresa, quando o turno é global).
 * Mesma fronteira de visibilidade do get_recent_events do MCP: PRIVATE só
 * aparece pra quem registrou. Sem escopo (nem cliente nem org) não há query —
 * varrer a tabela inteira num turno não é opção.
 */
export async function buscarEventosRecentes(params: {
  clientId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  limit?: number;
}): Promise<EventoRecente[]> {
  const escopo = params.clientId
    ? eq(schema.operationalEvents.clientId, params.clientId)
    : params.organizationId
      ? eq(schema.operationalEvents.organizationId, params.organizationId)
      : null;
  if (!escopo) return [];

  const visibilidade = params.userId
    ? or(
        isNull(schema.operationalEvents.visibility),
        ne(schema.operationalEvents.visibility, 'PRIVATE'),
        eq(schema.operationalEvents.userId, params.userId),
      )!
    : or(isNull(schema.operationalEvents.visibility), ne(schema.operationalEvents.visibility, 'PRIVATE'))!;

  const linhas = await db
    .select({
      id: schema.operationalEvents.id,
      type: schema.operationalEvents.type,
      summary: schema.operationalEvents.summary,
      actor: schema.operationalEvents.actor,
      occurredAt: schema.operationalEvents.occurredAt,
      createdAt: schema.operationalEvents.createdAt,
      clientId: schema.operationalEvents.clientId,
      importance: schema.operationalEvents.importance,
      source: schema.operationalEvents.source,
    })
    .from(schema.operationalEvents)
    .where(and(escopo, visibilidade))
    .orderBy(desc(schema.operationalEvents.occurredAt))
    .limit(params.limit ?? EVENTOS_RECENTES_LIMITE)
    .catch(() => []);
  return linhas;
}

/**
 * Bloco pro prompt. Evento sem `summary` é o caso do webhook do ClickUp (o
 * payload do provedor não traz frase legível — mesmo aviso do MCP): entra
 * pelo tipo + entidade, e o bloco proíbe inventar autor.
 */
export function formatRecentEventsBlock(eventos: EventoRecente[]): string {
  if (eventos.length === 0) return '';
  const linhas = [
    'EVENTOS RECENTES DA OPERAÇÃO (o que aconteceu, mais recente primeiro):',
  ];
  for (const e of eventos) {
    const quando = (e.occurredAt ?? e.createdAt)?.toISOString().slice(0, 10) ?? 'sem data';
    const autor = e.actor ? ` — por ${e.actor}` : '';
    const corpo = e.summary?.trim() || `${e.type} (${e.source})`;
    linhas.push(`- [${quando}] ${corpo.slice(0, 220)}${autor}`);
  }
  linhas.push(
    '',
    'São FATOS registrados no event store. Responda "o que mudou/aconteceu" a partir DELES, com data.',
    'Evento sem autor nomeado veio do webhook do ClickUp: NÃO invente quem mexeu.',
    'O que não está aqui não foi registrado — diga isso em vez de completar com suposição.',
  );
  return linhas.join('\n');
}
