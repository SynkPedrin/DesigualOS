import { boolean, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { clients } from './clients';
import { integrationConnections } from './integrations';

/**
 * client_google_ads_accounts — mapeamento cliente↔Google Ads Customer ID
 * (Part G do prompt de refinamento "FINAL PRODUCT REFINEMENT", §43-45,
 * 06/10/2026). MESMA separação de `client_meta_accounts`: esta tabela é só o
 * VÍNCULO explícito; quem está autorizado a falar com o Google Ads é
 * `integration_connections` (provider='google_ads'), uma coisa por
 * colaborador que conectou — nunca por cliente.
 *
 * `loginCustomerId` existe porque contas de cliente numa agência normalmente
 * vivem sob um Manager Account (MCC): toda chamada à Google Ads API que
 * atravessa um MCC precisa do header `login-customer-id` apontando pra ELE,
 * não pro customerId da conta final. Null quando o customerId é uma conta
 * de nível raiz, acessível direto pelo token (sem MCC no meio).
 *
 * REGRA FUNDAMENTAL idêntica à do Meta (§34/§43): "3Net usa somente o
 * Customer ID da 3Net" — nenhuma query a este provider roda sem um
 * `client_id` resolvendo pra exatamente UMA linha aqui.
 */
export const clientGoogleAdsAccounts = pgTable(
  'client_google_ads_accounts',
  {
    ...idColumn,
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    /** Dígitos do Customer ID, sem hífen (Google devolve/exige "1234567890", não "123-456-7890"). */
    customerId: text('customer_id').notNull(),
    loginCustomerId: text('login_customer_id'),
    connectionId: uuid('connection_id').references(() => integrationConnections.id, { onDelete: 'set null' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    label: text('label'),
    ...timestampColumns,
  },
  (table) => ({
    clientCustomerUnique: unique('client_google_ads_accounts_client_id_customer_id_unique').on(table.clientId, table.customerId),
    clientIdx: index('client_google_ads_accounts_client_id_idx').on(table.clientId),
  }),
);
