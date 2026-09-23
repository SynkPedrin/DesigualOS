import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { AGENT_TASK_STATUSES } from '@desigual-os/types';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { clients } from './clients';
import { users } from './identity';
import { conversations } from './conversation';

/**
 * agent_tasks — persistência real do handoff Bento -> Jarbas (missão de
 * fechamento de persistência, 24/09/2026).
 *
 * Substitui o InMemoryAgentTaskStore (packages/agent-runtime/src/
 * agent-task.ts) — mesma interface `AgentTaskStore`, implementação nova
 * (`PostgresAgentTaskStore`, apps/worker/src/processors/
 * agent-task-postgres-store.ts). Nada na lógica de dispatch/máquina de
 * estado/versionamento/retry muda: só onde ela mora.
 *
 * `dispatchKey` é UNIQUE — é a chave de idempotência (§33/§5): dois
 * INSERTs concorrentes com a mesma chave colidem no banco, não em RAM de
 * processo, então "mesmo dispatch lógico = uma tarefa só" sobrevive a
 * múltiplos workers.
 */
export const agentTaskStatusEnum = pgEnum('agent_task_status', AGENT_TASK_STATUSES);

export const agentTasks = pgTable(
  'agent_tasks',
  {
    ...idColumn,
    dispatchKey: text('dispatch_key').notNull(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    /** Conversa que originou o handoff (§4-§6 da missão de fechamento de chat) — permite achar "a última tarefa do Jarbas desta conversa" sem taskId em mãos. Nullable: nem todo dispatch nasce de uma conversa (ex.: canário/script). */
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    assignedAgent: text('assigned_agent').notNull().default('jarbas'),
    objective: text('objective').notNull(),
    scope: text('scope').notNull(),
    entityRefs: jsonb('entity_refs').$type<Array<{ type: string; id: string }>>().notNull().default([]),
    timeWindowStart: text('time_window_start'),
    timeWindowEnd: text('time_window_end'),
    constraints: jsonb('constraints').$type<string[]>().notNull().default([]),
    /** O pedido ORIGINAL do funcionário — nunca a paráfrase do Bento (§17/§29). */
    originalUserRequest: text('original_user_request').notNull(),
    status: agentTaskStatusEnum('status').notNull().default('assigned'),
    /** Versão do ESCOPO (§15-16/§38) — incrementa em updateScope, nunca decrementa. */
    version: integer('version').notNull().default(1),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    nextEligibleRetryAt: timestamp('next_eligible_retry_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    dispatchKeyUnique: unique('agent_tasks_dispatch_key_unique').on(table.dispatchKey),
    organizationIdx: index('agent_tasks_organization_id_idx').on(table.organizationId),
    clientIdx: index('agent_tasks_client_id_idx').on(table.clientId),
    statusIdx: index('agent_tasks_status_idx').on(table.status),
    updatedAtIdx: index('agent_tasks_updated_at_idx').on(table.updatedAt),
    /** "última tarefa do Jarbas nesta conversa, para este cliente" (§5/§6) — as três chaves juntas, nunca conversationId sozinho, pra troca de cliente na mesma conversa não vazar tarefa do cliente anterior. */
    conversationLookupIdx: index('agent_tasks_org_client_conversation_idx').on(table.organizationId, table.clientId, table.conversationId),
    /** Consulta de "quem está elegível pra retry agora" (§12/§25). */
    retryIdx: index('agent_tasks_next_eligible_retry_at_idx').on(table.nextEligibleRetryAt),
  }),
);

/**
 * agent_task_results — separado de `agent_tasks` de propósito (§7/§19):
 * escrita do resultado e escrita de memória são preocupações distintas, e
 * um resultado grande (metricFacts, comparisons, sourceTrace) não precisa
 * inflar toda leitura de status da tarefa. 1:N por design mesmo que hoje
 * só 1 resultado "vigente" exista por vez — `taskVersion` é o que decide
 * qual é o vigente, nunca um DELETE do anterior (histórico consultável).
 */
export const agentTaskResults = pgTable(
  'agent_task_results',
  {
    ...idColumn,
    taskId: uuid('task_id').notNull().references(() => agentTasks.id, { onDelete: 'cascade' }),
    /** Precisa bater com agentTasks.version NO MOMENTO da leitura (§16) — resultado de versão velha é stale. */
    taskVersion: integer('task_version').notNull(),
    /** JarbasAnalysisResult inteiro (schemaVersion, claims, metricFacts, recommendations...). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    ...timestampColumns,
  },
  (table) => ({
    taskIdx: index('agent_task_results_task_id_idx').on(table.taskId),
    /** Um resultado por (task, versão) — nunca dois "vigentes" pra mesma versão. */
    taskVersionUnique: unique('agent_task_results_task_id_version_unique').on(table.taskId, table.taskVersion),
  }),
);
