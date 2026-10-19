import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { clients } from './clients';
import { organizations } from './organizations';
import { users } from './identity';

/**
 * client_reports — Relatórios PDF de performance por cliente (Part H do
 * prompt de refinamento "FINAL PRODUCT REFINEMENT", §46-51, 06/10/2026).
 *
 * ASSÍNCRONO, mesmo padrão de `motion_renders`/`studio_jobs`: gerar o PDF
 * cruza duas chamadas de API externa por canal (período atual + período
 * anterior, pra comparação) mais a renderização em si — longo demais pra
 * seguro numa requisição HTTP síncrona. A rota só cria a linha com
 * `status='queued'` e enfileira; o worker processa e grava o resultado aqui.
 *
 * `channels` é o que foi PEDIDO (ex.: ['meta', 'google_ads']); o PDF gerado
 * diz, pra cada canal pedido, se havia conta conectada ou não — nunca finge
 * dado de um canal sem mídia vinculada (regra geral do prompt: nada de UI
 * falsa, vale também pro PDF).
 */
export const clientReports = pgTable(
  'client_reports',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    /** 'queued' | 'processing' | 'ready' | 'failed'. Texto e não enum: estado operacional ganha valores (mesma decisão de organization_connectors.status). */
    status: text('status').notNull().default('queued'),
    channels: jsonb('channels').$type<string[]>().notNull(),
    periodDays: integer('period_days').notNull().default(30),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    storageUrl: text('storage_url'),
    errorMessage: text('error_message'),
    ...timestampColumns,
  },
  (table) => ({
    clientIdx: index('client_reports_client_id_idx').on(table.clientId),
    organizationIdx: index('client_reports_organization_id_idx').on(table.organizationId),
  }),
);
