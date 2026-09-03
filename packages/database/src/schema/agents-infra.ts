import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { agentNameEnum, nodeStatusEnum, nodeTypeEnum, toolAccessEnum } from './enums';

export const agents = pgTable('agents', {
  ...idColumn,
  name: agentNameEnum('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  ...timestampColumns,
});

/**
 * Uma máquina física registrada no Node Registry (ver Fase 03).
 * nodeId é a chave de negócio usada nos payloads de registro e heartbeat
 * (ex: NODE_BENTO_01), distinta do id uuid interno.
 */
export const nodes = pgTable('nodes', {
  ...idColumn,
  nodeId: text('node_id').notNull().unique(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'restrict' }),
  type: nodeTypeEnum('type').notNull(),
  privateHost: text('private_host').notNull(),
  version: text('version').notNull(),
  status: nodeStatusEnum('status').notNull().default('offline'),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  ...timestampColumns,
});

export const nodeCapabilities = pgTable(
  'node_capabilities',
  {
    ...idColumn,
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    ...timestampColumns,
  },
  (table) => ({ nodeCapabilityUnique: unique().on(table.nodeId, table.capability) }),
);

/**
 * Matriz de permissões do Tool Gateway (seção 6.6 do prompt mestre),
 * como dados, nunca hardcoded no código.
 */
export const agentTools = pgTable(
  'agent_tools',
  {
    ...idColumn,
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    access: toolAccessEnum('access').notNull().default('none'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    ...timestampColumns,
  },
  (table) => ({ agentToolUnique: unique().on(table.agentId, table.tool) }),
);
