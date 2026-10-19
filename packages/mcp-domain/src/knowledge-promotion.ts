import { createHash } from 'node:crypto';
import type { McpEventType } from './events.js';

/**
 * knowledge-promotion.ts — quais acontecimentos viram MEMÓRIA, e com qual kind.
 *
 * O buraco que isto fecha (estado medido em 01/10/2026): `operational_events`
 * já acumulava o vocabulário rico do negócio — CLIENT_DECISION, CLIENT_FEEDBACK,
 * PROCESS_LEARNING... — mas nada disso jamais chegava à tabela `memories`, que
 * é de onde o Bento e o Claude do funcionário leem. O evento respondia "o que
 * aconteceu"; a pergunta "o que sabemos sobre este cliente" ficava sem resposta.
 *
 * O que mora aqui é PURO: o mapa tipo→kind e a chave de deduplicação. A escrita
 * em si mora em apps/mcp/src/tools/promocao-de-conhecimento.ts, porque mcp-domain
 * não toca banco.
 *
 * O que isto NÃO faz:
 *  - não promove tipo operacional puro (TASK_CREATED, WORK_LOGGED...): eles já
 *    são visíveis via get_recent_events e virar memória duplicaria ruído;
 *  - não promove MCP_TOOL_CALLED: telemetria de uso não é conhecimento;
 *  - não afrouxa o filtro do §10 (`deveRegistrar`): quem barra hipótese é ele,
 *    na entrada, antes de qualquer promoção sequer ser considerada.
 */

export interface PromocaoDeEvento {
  /** Kind da memória, na convenção pontuada do repo (client.*, process.*). */
  kind: string;
}

/**
 * O mapa. Só tipos cujo CONTEÚDO é conhecimento durável entram aqui:
 *
 *  - CLIENT_DECISION / STRATEGY_CHANGED → `client.decision`: o que foi decidido
 *    é fato institucional mesmo quando muda depois — a supersessão cuida disso.
 *  - CLIENT_FEEDBACK → `client.feedback`, mesmo kind que `save_client_feedback`
 *    já grava, para as duas portas convergirem na mesma leitura.
 *  - PREFERENCE_LEARNED → `client.preference`, o kind que briefing-retrieval e
 *    knowledge-consolidation já consomem.
 *  - PROCESS_LEARNING → `process.learning`, mesmo kind de `save_learning`.
 *  - CAMPAIGN_INSIGHT → `client.fact`: um achado de campanha é um fato
 *    aprendido sobre o cliente, não uma decisão nem uma preferência.
 */
const PROMOCOES: Partial<Record<McpEventType, PromocaoDeEvento>> = {
  CLIENT_DECISION: { kind: 'client.decision' },
  STRATEGY_CHANGED: { kind: 'client.decision' },
  CLIENT_FEEDBACK: { kind: 'client.feedback' },
  PREFERENCE_LEARNED: { kind: 'client.preference' },
  PROCESS_LEARNING: { kind: 'process.learning' },
  CAMPAIGN_INSIGHT: { kind: 'client.fact' },
};

/** Este tipo de evento vira memória? Null = operacional puro, fica só no evento. */
export function promocaoParaTipo(eventType: McpEventType): PromocaoDeEvento | null {
  return PROMOCOES[eventType] ?? null;
}

/**
 * Normalização e chave de deduplicação de memória.
 *
 * É O MESMO ALGORITMO de `computeDedupeKey` em
 * packages/orchestrator/src/memory-engine.ts — byte a byte, travado por vetor de
 * teste com o hash do canônico. Ele não é importado porque mcp-domain é puro
 * (sem banco) e apps/mcp não pode depender do orchestrator (architecture.test.ts
 * do apps/mcp proíbe, para o control plane não herdar o pipeline serial do
 * Bento). Se o canônico mudar, mude aqui junto: memória gravada pelo MCP com
 * chave divergente fura a deduplicação contra memória gravada pelo pipeline.
 */
function normalizarParaHash(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function chaveDedupeDeMemoria(input: {
  kind: string;
  content: string;
  clientId?: string | null;
  agentId?: string | null;
}): string {
  const base = [
    input.kind,
    input.clientId ?? 'no-client',
    input.agentId ?? 'no-agent',
    normalizarParaHash(input.content),
  ].join('|');
  return createHash('sha256').update(base).digest('hex').slice(0, 32);
}

/**
 * Importância do evento → importância numérica da memória (0..1, coluna que o
 * recall usa pra ordenar e cortar). LOW não é zero: telemetria baixa ainda é
 * recuperável; ela só perde na ordenação para o que é HIGH.
 */
export function importanciaDeMemoria(importance: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'): string {
  switch (importance) {
    case 'CRITICAL': return '0.900';
    case 'HIGH': return '0.700';
    case 'NORMAL': return '0.500';
    default: return '0.300';
  }
}
