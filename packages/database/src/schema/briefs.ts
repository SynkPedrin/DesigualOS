import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { clients } from './clients';
import { users } from './identity';
import { demands } from './demands';
import { conversationThreads } from './communications';
import { briefStatusEnum, briefVersionSourceEnum } from './enums';
import type { BriefContent } from '@desigual-os/types';

/**
 * briefs.ts — Brief + BriefVersion (P1-E/G, 06/10/2026). Nunca sobrescrito
 * silenciosamente: toda mudança de conteúdo é uma LINHA NOVA em
 * `brief_versions`, nunca um UPDATE no conteúdo existente.
 *
 * `externalTaskId`/`externalTaskProvider` (P1-G) vivem aqui, não numa
 * migration separada — rastreiam a task criada no TaskProvider quando o
 * brief aprovado vai pra produção (plano de execução §P1.7).
 */
export const briefs = pgTable(
  'briefs',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    demandId: uuid('demand_id').notNull().references(() => demands.id, { onDelete: 'cascade' }),
    conversationThreadId: uuid('conversation_thread_id').references(() => conversationThreads.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    approvedVersionId: uuid('approved_version_id').references((): AnyPgColumn => briefVersions.id, { onDelete: 'set null' }),
    status: briefStatusEnum('status').notNull().default('draft'),
    /** Task criada no provider da empresa quando o brief aprovado foi
     *  enviado pra produção (P1-G) — `null` até isso acontecer. */
    externalTaskId: text('external_task_id'),
    externalTaskProvider: text('external_task_provider'),
    ...timestampColumns,
  },
  (table) => ({
    organizationIdx: index('briefs_organization_id_idx').on(table.organizationId),
    clientIdx: index('briefs_client_id_idx').on(table.clientId),
    demandIdx: index('briefs_demand_id_idx').on(table.demandId),
  }),
);

export const briefVersions = pgTable(
  'brief_versions',
  {
    ...idColumn,
    briefId: uuid('brief_id').notNull().references(() => briefs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: jsonb('content').$type<BriefContent>().notNull().default({}),
    source: briefVersionSourceEnum('source').notNull(),
    /** Trechos da conversa que embasaram a extração — auditável, nunca
     *  alucinação sem rastro (P1-F). */
    sourceEvidence: jsonb('source_evidence').$type<Record<string, unknown> | null>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    briefIdx: index('brief_versions_brief_id_idx').on(table.briefId),
    versionUnique: unique('brief_versions_brief_id_version_unique').on(table.briefId, table.version),
  }),
);
