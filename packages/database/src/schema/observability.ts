import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './_shared';
import { agentNameEnum, nodeStatusEnum } from './enums';
import { clients } from './clients';
import { nodes } from './agents-infra';
import { users } from './identity';

/**
 * Rastreabilidade de toda ação relevante (regra de ouro 7). timestamp é o
 * nome de coluna pedido pelo prompt mestre (seção 8); representa o mesmo
 * papel que createdAt nas outras tabelas.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    ...idColumn,
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    agent: agentNameEnum('agent'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    result: text('result').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    userIdx: index('audit_logs_user_id_idx').on(table.userId),
    clientIdx: index('audit_logs_client_id_idx').on(table.clientId),
  }),
);

export const notifications = pgTable(
  'notifications',
  {
    ...idColumn,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /**
     * Pra onde a notificação leva ao ser clicada (caminho interno, ex:
     * "/studio?asset=<id>"). Pedido do Endrigo: "ao clicar, abrir diretamente
     * a Galeria do Studio". Null = notificação puramente informativa.
     */
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('notifications_user_id_idx').on(table.userId),
  }),
);

export const systemEvents = pgTable('system_events', {
  ...idColumn,
  source: text('source').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Histórico de heartbeats (seção 6.1), usado para calcular a máquina de
 * estados de saúde (warning 10s, degraded 30s, offline 60s sem heartbeat).
 */
export const healthChecks = pgTable(
  'health_checks',
  {
    ...idColumn,
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    status: nodeStatusEnum('status').notNull(),
    cpu: integer('cpu'),
    ram: integer('ram'),
    disk: integer('disk'),
    gpu: integer('gpu'),
    vram: integer('vram'),
    temperature: integer('temperature'),
    latencyMs: integer('latency_ms'),
    queueDepth: integer('queue_depth'),
    activeJob: text('active_job'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nodeIdx: index('health_checks_node_id_idx').on(table.nodeId),
  }),
);
