import { boolean, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { clients } from './clients';

/**
 * client_meta_accounts — mapeamento real clientId (Desigual OS) -> Meta Ads
 * accountId (missão de fechamento de operabilidade em chat, 23/09/2026).
 *
 * Fonte autoritativa do mapa completo continua sendo `clientData.js`, do
 * lado do agentes-desigual (fora deste repositório) — esta tabela NÃO o
 * duplica por inteiro. É o registro mínimo, explícito e deliberado que
 * permite ao handoff Bento -> Jarbas resolver clientId -> accountId sem
 * adivinhar (§1/§2 da missão de fechamento de chat).
 *
 * Um cliente pode ter mais de uma conta (múltiplas contas de mídia por
 * cliente é real na operação da agência) — `isPrimary` decide qual conta
 * usar quando o pedido não especifica uma. Mais de uma linha `isPrimary`
 * pra um mesmo cliente é tratado como estado ambíguo pelo resolver (nunca
 * escolhido por ordem de inserção ou qualquer outro critério implícito) —
 * não há constraint de banco pra "no máximo um primary" porque a UNIQUE
 * parcial exigiria um índice condicional específico de Postgres; a
 * verificação vive na camada de aplicação (resolveMetaAccountId), que é
 * onde o caso ambíguo já precisa virar BLOCKED_NEEDS_DATA de qualquer jeito.
 */
export const clientMetaAccounts = pgTable(
  'client_meta_accounts',
  {
    ...idColumn,
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    label: text('label'),
    ...timestampColumns,
  },
  (table) => ({
    clientAccountUnique: unique('client_meta_accounts_client_id_account_id_unique').on(table.clientId, table.accountId),
    clientIdx: index('client_meta_accounts_client_id_idx').on(table.clientId),
  }),
);
