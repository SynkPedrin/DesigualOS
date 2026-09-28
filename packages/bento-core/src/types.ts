import { z } from 'zod';

/**
 * Bento core — o loop novo (missão de release OpenAI + ClickUp MCP,
 * "BENTO CORE CUTOVER"): USER MESSAGE → resource state → OpenAI Responses
 * → structured action → policy → single write provider → execute →
 * read-back → persist state → resposta.
 *
 * Todo este pacote é ADITIVO e roda atrás de `BENTO_OPENAI_CORE_ENABLED`
 * (ver apps/worker/src/processors/bento-openai-core.ts) — com a flag
 * desligada (default), o caminho antigo (bento-action-guard.ts) continua
 * byte a byte como hoje. Ligar a flag é decisão operacional separada do
 * código estar pronto (ver CLAUDE_RELEASE_HANDOFF.md).
 */

/** §3 da missão: estado estruturado por conversa, persistido entre turnos. */
export interface SelectedResourceRef {
  resourceType: 'CLICKUP_TASK';
  resourceId: string;
  title: string | null;
}

export interface ConversationResourceState {
  version: 1;
  focusedResource: SelectedResourceRef | null;
  selectedResources: SelectedResourceRef[];
  recentCreatedResources: SelectedResourceRef[];
  recentUpdatedResources: SelectedResourceRef[];
  lastExecution: { operation: string; resourceIds: string[]; verified: boolean; at: string } | null;
  client: { id: string; name: string } | null;
  assignee: { name: string; memberId: number | null } | null;
  dueDate: string | null;
  /** §23 da missão: proveniência de cada afirmação usada na resposta. */
  sources: string[];
  updatedAt: string;
}

export function emptyResourceState(): ConversationResourceState {
  return {
    version: 1,
    focusedResource: null,
    selectedResources: [],
    recentCreatedResources: [],
    recentUpdatedResources: [],
    lastExecution: null,
    client: null,
    assignee: null,
    dueDate: null,
    sources: [],
    updatedAt: new Date().toISOString(),
  };
}

/** §2 da missão: a ÚNICA coisa que o modelo produz — nunca uma mutação direta. */
export const structuredActionSchema = z.object({
  intent: z.enum(['read_tasks', 'get_task', 'create_task', 'update_task', 'comment_task', 'delete_task', 'analyze_tasks']),
  target: z
    .object({
      resourceType: z.literal('CLICKUP_TASK'),
      /** null quando o alvo precisa ser resolvido pelo ConversationResourceState (ex: "essa task") antes da policy. */
      resourceId: z.string().nullable(),
    })
    .nullable(),
  changes: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      dueDate: z.string().optional(),
      assignee: z.string().optional(),
      /**
       * D.11/F-17: operação sobre o responsável, de primeira classe.
       * Ausente = 'add' (default semântico — compatível com o comportamento
       * histórico do executor, que sempre adicionava a pessoa indicada).
       */
      assigneeOperation: z.enum(['add', 'remove', 'replace']).optional(),
      /**
       * Status pedido em linguagem natural ("concluída", "em andamento", "em
       * revisão"). Quem traduz pro status REAL da lista é o executor, lendo os
       * status que aquela lista tem — o modelo nunca inventa nome de coluna.
       * Destravado em 28/09/2026 junto da remoção do hard deny de conclusão.
       */
      status: z.string().optional(),
      comment: z.string().optional(),
    })
    .nullable(),
  /** §4 da missão: quantas entidades o PEDIDO pede — nunca inferido de quantos atributos o briefing tem. */
  requestedCardinality: z.number().int().min(0),
  /** Por que o modelo entendeu esse intent — auditável, não é a resposta pro usuário. */
  reasoning: z.string(),
});

export type StructuredAction = z.output<typeof structuredActionSchema>;

/** §10 da missão: contrato único de todo write, qualquer provider. */
export type WriteProvider = 'MCP' | 'LEGACY_GATEWAY';

export interface WriteEnvelope {
  success: boolean;
  verified: boolean;
  provider: WriteProvider | null;
  resourceIds: string[];
  operation: string;
  changes: Record<string, unknown>;
  error: string | null;
  retryable: boolean;
  sources: string[];
}

export function failedEnvelope(operation: string, error: string, retryable = false): WriteEnvelope {
  return { success: false, verified: false, provider: null, resourceIds: [], operation, changes: {}, error, retryable, sources: [] };
}

/** §4: o contrato de cardinalidade fica visível end-to-end, não só um log. */
export interface CardinalityRecord {
  requestedCardinality: number;
  plannedCardinality: number;
  executedCardinality: number;
  blocked: boolean;
  blockReason: string | null;
}

export function evaluateCardinality(requested: number, planned: number): CardinalityRecord {
  // planned > requested sem pedido explícito de split é EXATAMENTE o P0-01
  // da auditoria (um pedido virou N tasks). requested === 0 é um caso
  // válido (ex: intent puramente de leitura, sem mutação nenhuma).
  const blocked = planned > requested;
  return {
    requestedCardinality: requested,
    plannedCardinality: planned,
    executedCardinality: 0,
    blocked,
    blockReason: blocked
      ? `plano com ${planned} mutações excede o pedido (${requested}) — bloqueado até confirmação explícita`
      : null,
  };
}
