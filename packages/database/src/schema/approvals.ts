import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './_shared';
import { organizations } from './organizations';
import { clients } from './clients';
import { users } from './identity';
import { approvalResourceTypeEnum, approvalStatusEnum } from './enums';

/**
 * approvals.ts — aprovação GENÉRICA de recurso de negócio (P1-I,
 * 06/10/2026). `resourceId` é texto solto, não FK — `resourceType` decide
 * qual tabela ele aponta, por convenção (polimórfico), não vínculo de
 * banco. Separado do gate de tool-call da IA (schema/tools.ts
 * `agent_tools.requires_approval`): problemas diferentes, nunca misturados.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    resourceType: approvalResourceTypeEnum('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    version: text('version'),
    requestedBy: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    /** `null` até alguém reivindicar — resolução é um claim atômico
     *  (UPDATE ... WHERE resolved_at IS NULL), mesmo padrão de
     *  `approveToolCall` em packages/tool-gateway/src/gateway.ts. */
    approverId: uuid('approver_id').references(() => users.id, { onDelete: 'set null' }),
    status: approvalStatusEnum('status').notNull().default('pending'),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    organizationIdx: index('approval_requests_organization_id_idx').on(table.organizationId),
    resourceIdx: index('approval_requests_resource_idx').on(table.resourceType, table.resourceId),
    statusIdx: index('approval_requests_status_idx').on(table.status),
  }),
);
