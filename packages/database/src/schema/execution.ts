import { index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import {
  agentNameEnum,
  executionComplexityEnum,
  executionStatusEnum,
  queuePriorityEnum,
} from './enums';
import { clients } from './clients';
import { conversations, messages } from './conversation';
import { users } from './identity';

/**
 * Saída do AI Router (seção 6.2) para uma mensagem, antes de virar um plano.
 */
export const routerDecisions = pgTable(
  'router_decisions',
  {
    ...idColumn,
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    intent: text('intent').notNull(),
    primaryAgent: agentNameEnum('primary_agent').notNull(),
    requiredTools: jsonb('required_tools').$type<string[]>().notNull().default([]),
    contextRefs: jsonb('context_refs').$type<string[]>().notNull().default([]),
    estimatedComplexity: executionComplexityEnum('estimated_complexity').notNull(),
    workflow: jsonb('workflow').$type<string[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index('router_decisions_conversation_id_idx').on(table.conversationId),
  }),
);

export const executionPlans = pgTable('execution_plans', {
  ...idColumn,
  routerDecisionId: uuid('router_decision_id')
    .notNull()
    .references(() => routerDecisions.id, { onDelete: 'cascade' }),
  steps: jsonb('steps').$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A unidade central de rastreabilidade do sistema (regra de ouro 7).
 * executionId é a chave de negócio legível (ex: EXE-2026-000982).
 */
export const executions = pgTable('executions', {
  ...idColumn,
  executionId: text('execution_id').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  agent: agentNameEnum('agent').notNull(),
  intent: text('intent').notNull(),
  status: executionStatusEnum('status').notNull().default('pending'),
  priority: queuePriorityEnum('priority').notNull().default('P2'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  tokensInput: integer('tokens_input').notNull().default(0),
  tokensOutput: integer('tokens_output').notNull().default(0),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }),
  actualCost: numeric('actual_cost', { precision: 12, scale: 6 }),
  ...timestampColumns,
});

export const executionSteps = pgTable(
  'execution_steps',
  {
    ...idColumn,
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    agent: agentNameEnum('agent').notNull(),
    status: executionStatusEnum('status').notNull().default('pending'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb('output').$type<Record<string, unknown> | null>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ executionStepUnique: unique().on(table.executionId, table.stepIndex) }),
);
