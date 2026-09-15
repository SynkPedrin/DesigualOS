import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { agentNameEnum } from './enums';
import { clients } from './clients';
import { users } from './identity';

/**
 * Checkpoint do Agent Runtime V2: estado completo da execução após cada
 * transição de fase (seção 70 da spec V2). Com isto uma execução longa
 * sobrevive a restart do worker e o trace responde "em que fase parou,
 * com quais observações e qual score" sem depender de RAM de processo.
 */
export const agentExecutionStates = pgTable(
  'agent_execution_states',
  {
    ...idColumn,
    /** execution_id de negócio (EXE-...), único: 1 checkpoint vivo por execução (upsert). */
    executionId: text('execution_id').notNull().unique(),
    agent: agentNameEnum('agent').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id'),
    phase: text('phase').notNull(),
    taskClass: text('task_class'),
    iterations: integer('iterations').notNull().default(0),
    evaluatorScore: numeric('evaluator_score', { precision: 4, scale: 3 }),
    /** AgentExecutionState completo (goal, plan, observations, toolCalls...). */
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    agentIdx: index('agent_execution_states_agent_idx').on(table.agent),
    userIdx: index('agent_execution_states_user_id_idx').on(table.userId),
    clientIdx: index('agent_execution_states_client_id_idx').on(table.clientId),
  }),
);

/**
 * Outcome de cada execução relevante (seções 66-68 da spec V2): é de onde
 * saem os KPIs de qualidade e aprendizado (first-attempt success, média de
 * iterações, tool failure rate). NUNCA inventar números: uma linha só
 * existe porque uma execução real terminou.
 */
export const agentOutcomes = pgTable(
  'agent_outcomes',
  {
    ...idColumn,
    executionId: text('execution_id').notNull().unique(),
    agent: agentNameEnum('agent').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id'),
    goalCompletion: boolean('goal_completion').notNull(),
    firstAttemptSuccess: boolean('first_attempt_success').notNull(),
    iterations: integer('iterations').notNull(),
    toolFailures: integer('tool_failures').notNull().default(0),
    evaluatorScore: numeric('evaluator_score', { precision: 4, scale: 3 }),
    latencyMs: integer('latency_ms'),
    taskClass: text('task_class'),
    /** Feedback explícito do usuário quando existir ('approved', 'rejected', ...). */
    userFeedback: text('user_feedback'),
    ...timestampColumns,
  },
  (table) => ({
    agentIdx: index('agent_outcomes_agent_idx').on(table.agent),
    clientIdx: index('agent_outcomes_client_id_idx').on(table.clientId),
    createdIdx: index('agent_outcomes_created_at_idx').on(table.createdAt),
  }),
);


/**
 * Evidência de 1a classe (seções 24-26 da spec V2): cada informação REAL recuperada que
 * ancora uma afirmação factual do turno, com origem, confiança e validade temporal
 * rastreáveis. É o que separa "resposta fundamentada" de "resposta plausível": o
 * evaluator reprova turno factual sobre estado real que chega sem nenhuma linha aqui.
 * NUNCA inventada: uma linha só existe porque algo foi recuperado de fato.
 */
export const agentEvidence = pgTable(
  'agent_evidence',
  {
    ...idColumn,
    executionId: text('execution_id').notNull(),
    agent: agentNameEnum('agent').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    /** clickup_task | clickup_comment | document | database | obsidian | memory | user_message | web | tool_result */
    type: text('type').notNull(),
    /** Rótulo legível da fonte. */
    source: text('source').notNull(),
    /** Id na origem quando existir (id da task, id da memória). */
    sourceId: text('source_id'),
    /** 0..1: dado ao vivo = 1; memória herda a confiança dela. */
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),
    /** Para dado com validade temporal (operacional ao vivo): quando era verdade. */
    validAt: timestamp('valid_at', { withTimezone: true }),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    executionIdx: index('agent_evidence_execution_id_idx').on(table.executionId),
    agentIdx: index('agent_evidence_agent_idx').on(table.agent),
    clientIdx: index('agent_evidence_client_id_idx').on(table.clientId),
  }),
);
