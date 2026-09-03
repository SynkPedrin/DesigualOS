import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { queuePriorityEnum } from './enums';
import { executions } from './execution';

/**
 * Espelho em banco dos jobs do BullMQ (seção 6.7), para auditoria e consulta.
 * A fila de fato (com retry, timeout, circuit breaker) roda no Redis.
 */
export const jobs = pgTable('jobs', {
  ...idColumn,
  queueName: text('queue_name').notNull(),
  executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
  priority: queuePriorityEnum('priority').notNull().default('P2'),
  status: text('status').notNull().default('waiting'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  ...timestampColumns,
});

export const jobAttempts = pgTable('job_attempts', {
  ...idColumn,
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
