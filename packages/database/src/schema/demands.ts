import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { clients } from './clients';
import { users } from './identity';
import { conversationThreads } from './communications';
import { demandPriorityEnum, demandSourceEnum, demandStatusEnum } from './enums';

/**
 * demands.ts — "o cliente pediu algo" (P1-D, 06/10/2026). Distinta de Task
 * (produção, vive no TaskProvider/ClickUp) e de Brief (especificação,
 * briefs.ts) — é o elo entre comunicação e trabalho, o ponto de partida do
 * core workflow (plano de execução §20).
 *
 * Nasce de conversa (`conversationThreadId` preenchido) OU manual — nunca
 * espera o adapter de WhatsApp estar pronto pra existir (ver nota de
 * paralelismo no plano de execução §3).
 */
export const demands = pgTable(
  'demands',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    conversationThreadId: uuid('conversation_thread_id').references(() => conversationThreads.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    /** Responsável pela demanda — resolvido por `client_users.responsibility`
     *  (P0-C) no momento da criação, reatribuível depois. `null` = sem
     *  responsável definido para este cliente ainda (`[FALTA]`, não um
     *  palpite). */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    source: demandSourceEnum('source').notNull(),
    status: demandStatusEnum('status').notNull().default('new'),
    priority: demandPriorityEnum('priority').notNull().default('normal'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    dueDate: timestamp('due_date', { withTimezone: true }),
    /**
     * Espelho no ClickUp (08/10/2026) — "Campanhas" na interface: quando o
     * cliente já tem `clickup_list_id`, a demanda ganha uma tarefa espelhada
     * lá na criação. `null` quando o cliente não tem ClickUp conectado ou a
     * chamada falhou — nunca um link inventado.
     */
    clickupTaskId: text('clickup_task_id'),
    clickupTaskUrl: text('clickup_task_url'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    organizationIdx: index('demands_organization_id_idx').on(table.organizationId),
    clientIdx: index('demands_client_id_idx').on(table.clientId),
    ownerIdx: index('demands_owner_id_idx').on(table.ownerId),
    statusIdx: index('demands_status_idx').on(table.status),
  }),
);

/**
 * demand_files.ts (inline, mesma tabela lógica) — anexos de uma demanda
 * ("Campanha" na UI): briefing, documento, imagem, compactado. Mesmo padrão
 * de `project_files` (conversation.ts) — bucket público `user-uploads`,
 * `kind` validado por Zod na rota, não por enum do banco (ver nota lá).
 */
export const demandFiles = pgTable(
  'demand_files',
  {
    ...idColumn,
    demandId: uuid('demand_id').notNull().references(() => demands.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    filename: text('filename').notNull(),
    storageUrl: text('storage_url').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    demandIdx: index('demand_files_demand_id_idx').on(table.demandId),
  }),
);
