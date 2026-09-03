import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { users } from './identity';

/**
 * Conexão OAuth de um colaborador com uma ferramenta externa (hoje só o
 * ClickUp). Substitui, para o acesso por pessoa, a decisão anterior de "uma
 * API key única compartilhada" (ver comentário em
 * packages/tool-gateway/src/clickup-client.ts): o Endrigo pediu OAuth por
 * colaborador pra que cada um conecte/reconecte sozinho em
 * Configurações > Integrações, sem depender do Admin.
 *
 * O token NUNCA é gravado em claro: `accessTokenEncrypted` guarda um
 * envelope AES-256-GCM (ver apps/api/src/lib/token-crypto.ts). Ninguém lê
 * esta coluna diretamente sem passar pelo decrypt.
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    ...idColumn,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Vocabulário aberto de propósito: 'clickup' hoje, whatsapp/google/slack depois. */
    provider: text('provider').notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    /** Id do workspace/team no provedor (ClickUp: team id). */
    externalWorkspaceId: text('external_workspace_id'),
    externalWorkspaceName: text('external_workspace_name'),
    /** connected | revoked | error — `revoked` preserva o histórico em vez de apagar a linha. */
    status: text('status').notNull().default('connected'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({ userProviderUnique: unique().on(table.userId, table.provider) }),
);
