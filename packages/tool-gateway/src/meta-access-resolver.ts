import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decryptToken } from './token-crypto';
import { isMetaTokenValid } from './meta-oauth';

export const META_PROVIDER = 'meta';

export interface MetaAccess {
  token: string;
  connectionId: string;
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
  if (!connection || connection.status !== 'connected') return null;

  const token = decryptToken(connection.accessTokenEncrypted);
  if (!(await isMetaTokenValid(token))) return null;

  return { token, connectionId: connection.id };
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

  const token = decryptToken(connection.accessTokenEncrypted);
  if (!(await isMetaTokenValid(token))) return null;

  return { token, connectionId: connection.id };
}
