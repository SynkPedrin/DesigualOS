import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { agentNameEnum } from './enums';
import { clients } from './clients';
import { conversations } from './conversation';
import { users } from './identity';
import { organizations } from './organizations';

/**
 * Automação agendada criada pelo usuário (pedido do usuário, 2026-09-03:
 * "todo dia às 8h o Bento analisa o ClickUp e me entrega o que precisa ser
 * feito"). `schedule` é um padrão cron (ver apps/worker/src/automations -
 * dono do BullMQ repeatable job correspondente); a API só lê/escreve esta
 * tabela e pede pro worker (re)registrar o job via fila dedicada.
 *
 * Cada disparo posta a resposta como mensagem normal na `conversationId`
 * desta automação (criada uma vez, reaproveitada em toda execução) - é
 * assim que a automação "fala" no chat do agente e gera notificação como
 * qualquer outra resposta de chat, sem duplicar aquele pipeline.
 */
export const automations = pgTable(
  'automations',
  {
    ...idColumn,
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agent: agentNameEnum('agent').notNull(),
    prompt: text('prompt').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    schedule: text('schedule').notNull(),
    scheduleLabel: text('schedule_label').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    estimatedMinutesSaved: integer('estimated_minutes_saved'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    createdByIdx: index('automations_created_by_idx').on(table.createdBy),
    organizationIdx: index('automations_organization_id_idx').on(table.organizationId),
  }),
);

export const automationRuns = pgTable('automation_runs', {
  ...idColumn,
  automationId: uuid('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('dispatched'),
  /** Id legível da execution (executions.execution_id, ex: EXE-2026-000982), não uma FK -
   * a resposta de verdade do agente chega como mensagem na conversa, não é lida daqui. */
  executionCode: text('execution_code'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
