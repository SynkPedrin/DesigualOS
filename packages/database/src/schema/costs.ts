import { bigint, date, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './_shared';
import { agentNameEnum } from './enums';
import { clients } from './clients';
import { executions } from './execution';
import { users } from './identity';

export const tokenUsage = pgTable('token_usage', {
  ...idColumn,
  executionId: uuid('execution_id')
    .notNull()
    .references(() => executions.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Agregação por modelo e período, usada nos gráficos de consumo do dashboard
 * (seção 11, mockup 1). Recalculada periodicamente pelo Token & Cost Engine.
 */
export const modelUsage = pgTable('model_usage', {
  ...idColumn,
  model: text('model').notNull(),
  agent: agentNameEnum('agent'),
  totalInputTokens: bigint('total_input_tokens', { mode: 'number' }).notNull().default(0),
  totalOutputTokens: bigint('total_output_tokens', { mode: 'number' }).notNull().default(0),
  totalCost: numeric('total_cost', { precision: 12, scale: 6 }).notNull().default('0'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const costRecords = pgTable('cost_records', {
  ...idColumn,
  executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  agent: agentNameEnum('agent'),
  kind: text('kind').notNull(),
  amount: numeric('amount', { precision: 12, scale: 6 }).notNull(),
  currency: text('currency').notNull().default('BRL'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const economyRecords = pgTable('economy_records', {
  ...idColumn,
  executionId: uuid('execution_id')
    .notNull()
    .references(() => executions.id, { onDelete: 'cascade' }),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }).notNull(),
  actualCost: numeric('actual_cost', { precision: 12, scale: 6 }).notNull(),
  savedAmount: numeric('saved_amount', { precision: 12, scale: 6 }).notNull(),
  savedPercentage: numeric('saved_percentage', { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
