import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decryptToken } from '../lib/token-crypto';

export const CLICKUP_PROVIDER = 'clickup';

export interface ClickUpAccess {
  token: string;
  teamId: string;
  /** null quando o acesso veio da API key compartilhada, não de um OAuth pessoal. */
  connectionId: string | null;
}

export async function getClickUpConnection(userId: string) {
  const [connection] = await db
    .select()
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, CLICKUP_PROVIDER)));
  return connection ?? null;
}

/**
 * De onde sai o acesso ao ClickUp deste usuário, nesta ordem:
 *  1. conexão OAuth pessoal dele (o alvo final, cada um com o próprio acesso);
 *  2. a API key compartilhada que o sistema já usa hoje (CLICKUP_API_KEY),
 *     como ponte enquanto o OAuth não está conectado.
 *
 * O fallback não afrouxa nada: essa mesma chave já é o que createTask,
 * getTeamMembers e o resto do Tool Gateway usam hoje. Quando todo mundo
 * estiver conectado por OAuth, é só remover o passo 2.
 */
export async function resolveClickUpAccess(userId: string): Promise<ClickUpAccess | null> {
  const connection = await getClickUpConnection(userId);
  if (connection && connection.status === 'connected' && connection.externalWorkspaceId) {
    return {
      token: decryptToken(connection.accessTokenEncrypted),
      teamId: connection.externalWorkspaceId,
      connectionId: connection.id,
    };
  }

  const sharedKey = process.env.CLICKUP_API_KEY;
  const sharedTeam = process.env.CLICKUP_TEAM_ID;
  if (sharedKey && sharedTeam) {
    return { token: sharedKey, teamId: sharedTeam, connectionId: null };
  }

  return null;
}

/** Acesso pra rodar fora de uma request (script CLI): só a chave compartilhada. */
export function resolveSharedClickUpAccess(): ClickUpAccess | null {
  const sharedKey = process.env.CLICKUP_API_KEY;
  const sharedTeam = process.env.CLICKUP_TEAM_ID;
  if (!sharedKey || !sharedTeam) return null;
  return { token: sharedKey, teamId: sharedTeam, connectionId: null };
}
