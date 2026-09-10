import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './_shared';
import { agentNameEnum } from './enums';
import { executions } from './execution';
import { users } from './identity';

/**
 * Toda chamada de ferramenta passa pelo Tool Gateway (seção 6.6) e vira uma
 * linha aqui, com approvedBy/approvedAt preenchidos quando a ação é crítica
 * (publicar no Instagram, alterar orçamento no Meta, deletar tarefas).
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    ...idColumn,
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
    agent: agentNameEnum('agent').notNull(),
    tool: text('tool').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    executionIdx: index('tool_calls_execution_id_idx').on(table.executionId),
  }),
);

export const toolResults = pgTable('tool_results', {
  ...idColumn,
  toolCallId: uuid('tool_call_id')
    .notNull()
    .references(() => toolCalls.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  output: jsonb('output').$type<Record<string, unknown> | null>(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
