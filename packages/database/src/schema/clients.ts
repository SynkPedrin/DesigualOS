import { jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, softDeleteColumn, timestampColumns } from './_shared';
import { users } from './identity';

export const clients = pgTable('clients', {
  ...idColumn,
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status').notNull().default('active'),
  /**
   * LISTA do ClickUp que representa este cliente. Conferido na estrutura real
   * da agência (03/09/2026): o espaço "Espaço DESIGUAL" tem folders
   * "CLIENTES ATIVOS/PONTUAIS/INATIVOS", e cada LISTA dentro deles é um
   * cliente (46 no total). Não é space nem folder - foi verificado na API
   * antes de fechar esse mapeamento.
   *
   * O ClickUp é a FONTE DE VERDADE (decisão do Endrigo): esta coluna é só a
   * chave de correlação que deixa o sync ser idempotente (reimportar não
   * duplica). Null = cliente criado à mão, sem espelho no ClickUp.
   */
  clickupListId: text('clickup_list_id').unique(),
  ...timestampColumns,
  ...softDeleteColumn,
});

export const clientUsers = pgTable(
  'client_users',
  {
    ...idColumn,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('viewer'),
    ...timestampColumns,
  },
  (table) => ({ clientUserUnique: unique().on(table.clientId, table.userId) }),
);

/**
 * Branding geral do cliente, usado em toda a aplicação (não só no Studio).
 * Ver também studio_brand_kits em schema/studio.ts para os dados
 * específicos injetados nos jobs de geração de mídia.
 */
export const clientBrandKits = pgTable('client_brand_kits', {
  ...idColumn,
  clientId: uuid('client_id')
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: 'cascade' }),
  logoUrl: text('logo_url'),
  colors: jsonb('colors').$type<string[]>().notNull().default([]),
  fonts: jsonb('fonts').$type<string[]>().notNull().default([]),
  toneOfVoice: text('tone_of_voice'),
  ...timestampColumns,
});
