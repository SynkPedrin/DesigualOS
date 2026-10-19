import { index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';

/**
 * ENTITY GRAPH (migração 0051) — a ponte "mesma pessoa/entidade" entre o
 * Desigual OS e os sistemas de fora.
 *
 * Antes disto a única ligação ClickUp <-> Desigual era `users.clickup_email`
 * (texto solto, sem verificação) e `people.clickup_user_id` (ilha populada por
 * script, sem ligação com `users`). Consequência: o webhook do ClickUp gravava
 * evento com `actor: null` porque não havia como saber QUEM mexeu, e o
 * `get_my_tasks` do MCP filtrava por nome (fraco).
 *
 * Cada linha diz: "dentro desta organização, a entidade DESIGUAL de tipo X com
 * id Y é a mesma que a origem Z chama de external_id". Ex.: a pessoa (users.id)
 * que o ClickUp chama de user 12345678.
 *
 * `desigualId` NÃO tem FK de propósito: é polimórfico (users.id quando
 * entity_type='person', clients.id quando 'client', texto externo quando
 * 'task'). FK polimórfica não existe em Postgres; a integridade é garantida
 * por quem escreve (resolução em packages/database/src/entity-resolution.ts),
 * que só grava id que acabou de ler da tabela correspondente.
 *
 * Idempotência: unique (organization_id, source, entity_type, external_id) —
 * reresolver a mesma pessoa não duplica o vínculo.
 */
export const entityLinks = pgTable(
  'entity_links',
  {
    ...idColumn,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** 'person' | 'client' | 'task'. */
    entityType: text('entity_type').notNull(),
    /** Id INTERNO da entidade (users.id, clients.id...). Sem FK polimórfica — ver header. */
    desigualId: uuid('desigual_id').notNull(),
    /** 'clickup' | 'claude-mcp' | 'desigual'. */
    source: text('source').notNull(),
    /** Id da entidade na origem (ClickUp user id como texto, list id, ...). */
    externalId: text('external_id').notNull(),
    /** Como o vínculo nasceu ('email', 'backfill', 'webhook') + dados da origem. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    unico: unique('entity_links_org_source_type_external_unique').on(
      table.organizationId,
      table.source,
      table.entityType,
      table.externalId,
    ),
    orgIdx: index('entity_links_organization_id_idx').on(table.organizationId),
    desigualIdx: index('entity_links_desigual_id_idx').on(table.desigualId),
  }),
);
