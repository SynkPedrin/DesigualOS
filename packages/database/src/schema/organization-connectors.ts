import { index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';

/**
 * organization_connectors — as credenciais da plataforma de tarefas DE CADA
 * empresa (white label, 01/10/2026).
 *
 * Até aqui o ClickUp era um só: a chave global da agência em CLICKUP_API_KEY.
 * Com subcontas (migração 0049), cada empresa conecta a plataforma DELA —
 * ClickUp, Jira, Monday, Trello — e a linha aqui é o que diz qual e com que
 * credencial. Sem linha, vale o fallback de env (o comportamento de sempre da
 * Desigual); quem decide isso é `resolveTaskProvider` no tool-gateway.
 *
 * `credentials` é jsonb porque o shape depende do provider: ClickUp pede
 * { apiKey, teamId }; Jira pedirá { baseUrl, email, apiToken }. A validação do
 * shape é do adapter daquele provider (zod, no resolver) — coluna jsonb aceita
 * qualquer chave, e é por isso que NENHUMA leitura daqui pode pular a
 * validação.
 *
 * NUNCA devolver isto numa rota sem mascarar: o GET da API mostra só os 4
 * últimos caracteres da chave (apps/api/src/connectors/routes.ts).
 */
export const organizationConnectors = pgTable(
  'organization_connectors',
  {
    ...idColumn,
    /** Cascade: a config morre com a empresa — credencial órfã é credencial vazada esperando. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** 'clickup' hoje; 'jira' | 'monday' | 'trello' quando o adapter existir. */
    provider: text('provider').notNull(),
    credentials: jsonb('credentials').notNull(),
    /** 'ativa' | 'desativada' | 'erro'. Texto e não enum: estado operacional ganha valores. */
    status: text('status').notNull().default('ativa'),
    ...timestampColumns,
  },
  (table) => ({
    /** Uma plataforma de tarefas por empresa. Trocar de plataforma é UPDATE/DELETE, nunca segunda linha. */
    orgProviderUnique: unique().on(table.organizationId, table.provider),
    orgIdx: index('organization_connectors_organization_id_idx').on(table.organizationId),
  }),
);
