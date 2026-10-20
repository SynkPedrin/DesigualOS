import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decryptToken } from './token-crypto';
import { isMetaTokenValid } from './meta-oauth';
import { META_SYSTEM_PROVIDER, getMetaSystemUserConfig } from './meta-system-user';

export const META_PROVIDER = 'meta';

export interface MetaAccess {
  token: string;
  connectionId: string;
  /**
   * 'system' = a conexão central da agência (usuário do sistema da BM, sem
   * OAuth). 'user' = o Facebook pessoal de um colaborador.
   */
  kind: 'user' | 'system';
  /** BM da conexão central. O token de usuário do sistema não lista BMs em /me/businesses, então a sync parte desta. */
  businessId?: string;
}

/**
 * meta-access-resolver.ts — movido de apps/api/src/integrations/meta-access.ts
 * (06/10/2026, Relatórios PDF) pelo MESMO motivo de token-crypto.ts: o worker
 * também precisa resolver a conexão Meta de um `connectionId` pra gerar um
 * relatório, e apps não importam uns aos outros, só pacotes compartilhados.
 * `apps/api/src/integrations/meta-access.ts` virou um re-export; nenhum
 * import existente em apps/api precisou mudar.
 */
export async function getMetaConnection(userId: string) {
  const [connection] = await db
    .select()
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, META_PROVIDER)));
  return connection ?? null;
}

/**
 * Acesso ao Meta Graph API deste colaborador. Ao contrário do ClickUp, não
 * existe chave compartilhada de fallback aqui — mídia é sempre a conexão
 * pessoal de quem conectou (§34-38 do prompt de refinamento): não há uma
 * "chave da agência" que já estivesse em uso antes para servir de ponte.
 */
export async function resolveMetaAccess(userId: string): Promise<MetaAccess | null> {
  const connection = await getMetaConnection(userId);
  if (connection && connection.status === 'connected') {
    const token = decryptToken(connection.accessTokenEncrypted);
    if (await isMetaTokenValid(token)) return { token, connectionId: connection.id, kind: 'user' };
  }
  // Sem Facebook pessoal válido, vale a conexão central da agência: ninguém
  // precisa fazer OAuth para ler contas que a própria BM já autorizou.
  return resolveMetaSystemAccess();
}

/** Linha da conexão central (uma por organização da agência), se existir e estiver ativa. */
export async function getMetaSystemConnection() {
  const [connection] = await db
    .select()
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.provider, META_SYSTEM_PROVIDER), eq(schema.integrationConnections.status, 'connected')));
  return connection ?? null;
}

/**
 * Token da conexão central. O ambiente manda: trocar META_SYSTEM_USER_TOKEN e
 * reiniciar vale na hora, sem reconectar. A cópia cifrada no banco é só
 * reserva para processos sem a variável.
 */
export async function resolveMetaSystemAccess(): Promise<MetaAccess | null> {
  const connection = await getMetaSystemConnection();
  if (!connection) return null;
  return systemAccessFromConnection(connection);
}

async function systemAccessFromConnection(connection: {
  id: string;
  accessTokenEncrypted: string;
  externalWorkspaceId: string | null;
}): Promise<MetaAccess | null> {
  const env = getMetaSystemUserConfig();
  const token = env?.token ?? decryptToken(connection.accessTokenEncrypted);
  if (!token || !(await isMetaTokenValid(token))) return null;
  const businessId = env?.businessId ?? connection.externalWorkspaceId ?? undefined;
  return { token, connectionId: connection.id, kind: 'system', ...(businessId ? { businessId } : {}) };
}

/**
 * Acesso pelo `connectionId` gravado em `client_meta_accounts` — não pelo
 * usuário que está olhando a tela agora (ou, no caso do worker gerando um
 * relatório, que não é "olhando" coisa nenhuma). Quem conectou o Meta e quem
 * lê a performance do cliente depois não precisam ser a mesma pessoa; a
 * CONTA usada pra ler é sempre a que ficou gravada no vínculo.
 */
export async function resolveMetaAccessByConnectionId(connectionId: string): Promise<MetaAccess | null> {
  const [connection] = await db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.id, connectionId));
  if (!connection || connection.status !== 'connected') return null;

  if (connection.provider === META_SYSTEM_PROVIDER) return systemAccessFromConnection(connection);

  const token = decryptToken(connection.accessTokenEncrypted);
  if (!(await isMetaTokenValid(token))) return null;

  return { token, connectionId: connection.id, kind: 'user' };
}
