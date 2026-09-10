import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { agentNameEnum } from './enums';
import { executions, executionSteps } from './execution';

/**
 * Um workflow multi agente (seção 6.3), sempre amarrado a uma única
 * execution (um único execution_id para toda a cadeia).
 */
export const workflows = pgTable(
  'workflows',
  {
    ...idColumn,
    name: text('name').notNull(),
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('pending'),
    definition: jsonb('definition').$type<string[]>().notNull(),
    ...timestampColumns,
  },
  (table) => ({
    executionIdx: index('workflows_execution_id_idx').on(table.executionId),
  }),
);

export const workflowSteps = pgTable('workflow_steps', {
  ...idColumn,
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  agent: agentNameEnum('agent').notNull(),
  status: text('status').notNull().default('pending'),
  executionStepId: uuid('execution_step_id').references(() => executionSteps.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
