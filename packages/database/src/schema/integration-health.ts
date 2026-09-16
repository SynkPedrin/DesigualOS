import { index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';

/**
 * integration-health.ts — saúde das fontes externas, com FRESCOR declarado.
 *
 * Incidente que obriga isto (16/09/2026): o webhook do ClickUp apontava para uma
 * URL de ngrok que não existia mais. O ClickUp suspendeu depois de 102 falhas
 * consecutivas e parou de entregar evento em 11/09. Durante CINCO DIAS o sistema
 * seguiu respondendo com naturalidade sobre a operação, sem nenhum sinal de que
 * não recebia mudança nenhuma — a resposta "o que mudou desde ontem" era
 * estruturalmente impossível e ninguém foi avisado.
 *
 * A lição não é "consertar o webhook": é que ausência de evento parecia igual a
 * ausência de mudança. Aqui o silêncio passa a ser um estado observável, e o
 * agente pode dizer que o conhecimento está atrasado em vez de fingir frescor.
 */
export const integrationHealth = pgTable(
  'integration_health',
  {
    ...idColumn,
    /** 'clickup.webhook' | 'clickup.api' | 'vault' | 'otto.node' ... */
    source: text('source').notNull(),
    /** 'ok' | 'degraded' | 'down' | 'unknown' */
    status: text('status').notNull().default('unknown'),
    /** Último evento REAL recebido desta fonte. É o que define frescor. */
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    /** Última vez que a saúde foi checada (diferente de ter recebido evento). */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /** Última reconciliação de fallback disparada por este monitor. */
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
    /** Janela, em minutos, sem evento que caracteriza atraso para esta fonte. */
    staleAfterMinutes: integer('stale_after_minutes').notNull().default(360),
    detail: text('detail'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    sourceIdx: index('integration_health_source_idx').on(table.source),
    unico: unique('integration_health_source_unique').on(table.source),
  }),
);
