import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * token-store.ts — emissão, verificação e revogação dos tokens do MCP.
 *
 * Três regras que este arquivo existe para garantir, e que a §4 da missão pede
 * por nome:
 *
 *  1. **Nunca uma chave global.** Todo token pertence a UM usuário e UMA
 *     organização. Sem isso não há auditoria por pessoa e revogar o acesso de
 *     alguém significaria trocar a chave de todo mundo.
 *  2. **Nunca o token em claro no banco.** Guardamos SHA-256. Um vazamento de
 *     banco vira vazamento de dados, não vazamento de identidade.
 *  3. **Curto e revogável.** Access de 1 hora, refresh de 30 dias, e
 *     `revoked_at` cortando a família inteira de uma vez.
 */

/** Uma hora. Curto o bastante para que um token perdido não valha muito. */
const ACCESS_TTL_S = 60 * 60;
/** Trinta dias. Quem trabalha todo dia não reautoriza toda semana. */
const REFRESH_TTL_S = 60 * 60 * 24 * 30;
/** Código de autorização: vida de um clique. */
const CODE_TTL_S = 60;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function gerarToken(prefixo: string): string {
  // 32 bytes = 256 bits de entropia. O prefixo é só para diagnóstico em log
  // (nunca logamos o token inteiro), e para o humano reconhecer o que achou.
  return `${prefixo}_${randomBytes(32).toString('base64url')}`;
}

export interface ConcessaoInput {
  clientId: string;
  userId: string;
  organizationId: string;
  scopes: string[];
  redirectUri?: string | null;
  codeChallenge?: string | null;
  resource?: string | null;
}

/** Cria o código de autorização (uso único, vida de 60s). */
export async function emitirCodigoDeAutorizacao(input: ConcessaoInput): Promise<string> {
  const codigo = gerarToken('dsgc');
  await db.insert(schema.mcpTokens).values({
    kind: 'authorization_code',
    tokenHash: hashToken(codigo),
    clientId: input.clientId,
    userId: input.userId,
    organizationId: input.organizationId,
    scopes: input.scopes,
    codeChallenge: input.codeChallenge ?? null,
    redirectUri: input.redirectUri ?? null,
    resource: input.resource ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
  });
  return codigo;
}

export interface CodigoResolvido {
  id: string;
  clientId: string;
  userId: string;
  organizationId: string;
  scopes: string[];
  codeChallenge: string | null;
  redirectUri: string | null;
  resource: string | null;
}

/** Lê o código sem consumir. Usado pelo `challengeForAuthorizationCode` do SDK. */
export async function lerCodigo(codigo: string): Promise<CodigoResolvido | null> {
  const [row] = await db
    .select()
    .from(schema.mcpTokens)
    .where(
      and(
        eq(schema.mcpTokens.tokenHash, hashToken(codigo)),
        eq(schema.mcpTokens.kind, 'authorization_code'),
        isNull(schema.mcpTokens.consumedAt),
        isNull(schema.mcpTokens.revokedAt),
        sql`${schema.mcpTokens.expiresAt} > now()`,
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    userId: row.userId,
    organizationId: row.organizationId,
    scopes: row.scopes,
    codeChallenge: row.codeChallenge,
    redirectUri: row.redirectUri,
    resource: row.resource,
  };
}

/**
 * Consome o código. O UPDATE condicional é a defesa contra corrida: duas trocas
 * simultâneas do mesmo código, e só uma escreve `consumed_at`. A segunda recebe
 * zero linhas e é recusada — não dá para duplicar concessão por retry.
 */
export async function consumirCodigo(codigo: string): Promise<CodigoResolvido | null> {
  const atualizadas = await db
    .update(schema.mcpTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(schema.mcpTokens.tokenHash, hashToken(codigo)),
        eq(schema.mcpTokens.kind, 'authorization_code'),
        isNull(schema.mcpTokens.consumedAt),
        isNull(schema.mcpTokens.revokedAt),
        sql`${schema.mcpTokens.expiresAt} > now()`,
      ),
    )
    .returning();
  const row = atualizadas[0];
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    userId: row.userId,
    organizationId: row.organizationId,
    scopes: row.scopes,
    codeChallenge: row.codeChallenge,
    redirectUri: row.redirectUri,
    resource: row.resource,
  };
}

export interface ParDeTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}

/** Emite access + refresh para uma concessão já autorizada. */
export async function emitirTokens(input: ConcessaoInput): Promise<ParDeTokens> {
  const refresh = gerarToken('dsgr');
  const [linhaRefresh] = await db
    .insert(schema.mcpTokens)
    .values({
      kind: 'refresh',
      tokenHash: hashToken(refresh),
      clientId: input.clientId,
      userId: input.userId,
      organizationId: input.organizationId,
      scopes: input.scopes,
      resource: input.resource ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
    })
    .returning({ id: schema.mcpTokens.id });

  const access = gerarToken('dsga');
  await db.insert(schema.mcpTokens).values({
    kind: 'access',
    tokenHash: hashToken(access),
    clientId: input.clientId,
    userId: input.userId,
    organizationId: input.organizationId,
    scopes: input.scopes,
    resource: input.resource ?? null,
    // Encadear ao refresh é o que permite revogar a família inteira: cortar o
    // refresh sem cortar os access que ele gerou deixaria janela de até 1h.
    parentTokenId: linhaRefresh?.id ?? null,
    expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
  });

  return { accessToken: access, refreshToken: refresh, expiresIn: ACCESS_TTL_S, scopes: input.scopes };
}

export interface TokenVerificado {
  tokenId: string;
  clientId: string;
  userId: string;
  organizationId: string;
  scopes: string[];
  expiresAt: Date;
  resource: string | null;
}

/**
 * Verifica um access token. Devolve `null` para qualquer motivo de recusa —
 * expirado, revogado, inexistente, cliente desligado — sem distinguir entre
 * eles para quem chama: dizer QUAL é o motivo ajuda quem está tentando
 * adivinhar token.
 */
export async function verificarAccessToken(token: string): Promise<TokenVerificado | null> {
  const [row] = await db
    .select({
      id: schema.mcpTokens.id,
      clientId: schema.mcpTokens.clientId,
      userId: schema.mcpTokens.userId,
      organizationId: schema.mcpTokens.organizationId,
      scopes: schema.mcpTokens.scopes,
      expiresAt: schema.mcpTokens.expiresAt,
      resource: schema.mcpTokens.resource,
      clienteDesligadoEm: schema.mcpClients.disabledAt,
    })
    .from(schema.mcpTokens)
    .leftJoin(schema.mcpClients, eq(schema.mcpClients.clientId, schema.mcpTokens.clientId))
    .where(
      and(
        eq(schema.mcpTokens.tokenHash, hashToken(token)),
        eq(schema.mcpTokens.kind, 'access'),
        isNull(schema.mcpTokens.revokedAt),
        sql`${schema.mcpTokens.expiresAt} > now()`,
      ),
    );
  if (!row || row.clienteDesligadoEm) return null;
  return {
    tokenId: row.id,
    clientId: row.clientId,
    userId: row.userId,
    organizationId: row.organizationId,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    resource: row.resource,
  };
}

/** Troca um refresh válido por um par novo, revogando o antigo (rotação). */
export async function rotacionarRefresh(
  refreshToken: string,
  clientId: string,
  scopesPedidos?: string[],
): Promise<ParDeTokens | null> {
  const [row] = await db
    .select()
    .from(schema.mcpTokens)
    .where(
      and(
        eq(schema.mcpTokens.tokenHash, hashToken(refreshToken)),
        eq(schema.mcpTokens.kind, 'refresh'),
        eq(schema.mcpTokens.clientId, clientId),
        isNull(schema.mcpTokens.revokedAt),
        sql`${schema.mcpTokens.expiresAt} > now()`,
      ),
    );
  if (!row) return null;

  /**
   * ROTAÇÃO: o refresh usado morre junto com os access que ele gerou. Se um
   * refresh vazado for usado depois do legítimo, a família já foi revogada e a
   * tentativa falha — detecção de reuso, de graça.
   */
  await revogarFamilia(row.id);

  // Reduzir escopo é permitido; ampliar, não. Pedir mais do que a concessão
  // original tinha devolve a concessão original, nunca mais que ela.
  const scopes = scopesPedidos?.length
    ? scopesPedidos.filter((s) => row.scopes.includes(s))
    : row.scopes;

  return emitirTokens({
    clientId: row.clientId,
    userId: row.userId,
    organizationId: row.organizationId,
    scopes,
    resource: row.resource,
  });
}

/** Revoga um token e tudo que desce dele. */
export async function revogarFamilia(tokenId: string): Promise<void> {
  const agora = new Date();
  await db
    .update(schema.mcpTokens)
    .set({ revokedAt: agora })
    .where(and(or(eq(schema.mcpTokens.id, tokenId), eq(schema.mcpTokens.parentTokenId, tokenId)), isNull(schema.mcpTokens.revokedAt)));
}

/** Revoga pelo valor do token (o que o endpoint /revoke do OAuth recebe). */
export async function revogarPorValor(token: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.mcpTokens.id })
    .from(schema.mcpTokens)
    .where(eq(schema.mcpTokens.tokenHash, hashToken(token)));
  if (row) await revogarFamilia(row.id);
}

/** Corta TODO acesso MCP de uma pessoa. É o botão de desligar do §28. */
export async function revogarTudoDoUsuario(userId: string): Promise<number> {
  const linhas = await db
    .update(schema.mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.mcpTokens.userId, userId), isNull(schema.mcpTokens.revokedAt)))
    .returning({ id: schema.mcpTokens.id });
  return linhas.length;
}

/** Limpeza: token vencido há mais de um dia não serve nem para auditoria. */
export async function limparTokensVencidos(): Promise<number> {
  const linhas = await db
    .delete(schema.mcpTokens)
    .where(lt(schema.mcpTokens.expiresAt, new Date(Date.now() - 86_400_000)))
    .returning({ id: schema.mcpTokens.id });
  return linhas.length;
}
