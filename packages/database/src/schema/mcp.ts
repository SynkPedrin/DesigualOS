import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { users } from './identity';

/**
 * mcp.ts — as tabelas do DESIGUAL OS MCP (migração 0044).
 *
 * O MCP é a superfície pela qual o Claude de cada funcionário fala com o
 * Desigual OS. Essas três tabelas existem para uma coisa só: saber QUEM está
 * chamando, com qual permissão, e conseguir cortar o acesso a qualquer momento.
 *
 * A §4 da missão proíbe o caminho fácil — uma API key global no cliente Claude.
 * Com key global não há "quem": toda chamada é a mesma chamada, a auditoria não
 * distingue funcionários e revogar o acesso de uma pessoa significa trocar a
 * chave de todo mundo.
 */

/**
 * Cliente OAuth registrado dinamicamente (RFC 7591). O Claude se registra
 * sozinho na primeira conexão; uma linha por superfície (Web, Desktop, ...).
 */
export const mcpClients = pgTable('mcp_clients', {
  ...idColumn,
  clientId: text('client_id').notNull().unique(),
  /** HASH do secret, nunca o secret. Cliente público (PKCE) fica nulo. */
  clientSecretHash: text('client_secret_hash'),
  clientName: text('client_name'),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull().default([]),
  grantTypes: jsonb('grant_types').$type<string[]>().notNull().default(['authorization_code', 'refresh_token']),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  /** Desligar um cliente inteiro sem apagar o histórico dele. */
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  ...timestampColumns,
});

/**
 * Código de autorização e tokens, na mesma tabela porque têm o mesmo ciclo de
 * vida e a mesma regra de revogação.
 *
 * O TOKEN NUNCA É GUARDADO EM CLARO. Só o hash. Quem lê o banco não consegue se
 * passar por um funcionário — e é isso que separa um vazamento de dados de um
 * vazamento de identidade.
 */
export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    ...idColumn,
    /** 'authorization_code' | 'access' | 'refresh' */
    kind: text('kind').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    clientId: text('client_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /**
     * Os scopes CONCEDIDOS. Note que não são os efetivos: o efetivo é a
     * interseção com o papel, calculada a cada chamada (ver
     * `scopesEfetivos` em @desigual-os/mcp-domain). É isso que faz um
     * rebaixamento de papel valer sem esperar o token expirar.
     */
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    /** PKCE (RFC 7636): guardado no código, conferido na troca. */
    codeChallenge: text('code_challenge'),
    redirectUri: text('redirect_uri'),
    /** RFC 8707: para qual resource server este token vale. */
    resource: text('resource'),
    /** Encadeia o access ao refresh que o emitiu — revoga a família inteira. */
    parentTokenId: uuid('parent_token_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Código de autorização é de uso único: consumido não troca de novo. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('mcp_tokens_user_id_idx').on(table.userId),
    kindExpiresIdx: index('mcp_tokens_kind_expires_idx').on(table.kind, table.expiresAt),
    hashUnico: unique('mcp_tokens_token_hash_unique').on(table.tokenHash),
  }),
);

/**
 * Sessão MCP — a unidade de correlação entre as chamadas de um mesmo Claude.
 * É o `session_id` que a auditoria (§12) exige para responder "essa sequência
 * de alterações veio toda da mesma conversa?".
 */
export const mcpSessions = pgTable(
  'mcp_sessions',
  {
    ...idColumn,
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: text('client_id'),
    /** O id de sessão do transporte MCP, para casar log de rede com log de negócio. */
    transportSessionId: text('transport_session_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('mcp_sessions_user_id_idx').on(table.userId),
  }),
);
