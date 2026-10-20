import { count, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { encryptToken } from './token-crypto';
import {
  META_REQUIRED_SCOPES,
  META_SYSTEM_PROVIDER,
  countMetaBusinessAccounts,
  getMetaBusinessName,
  getMetaSystemUserConfig,
  inspectMetaToken,
  missingMetaSystemUserVars,
  type MetaCentralContaCount,
  type MetaTokenInspection,
} from './meta-system-user';

/**
 * meta-system-connection.ts — estabelece e descreve a conexão CENTRAL da
 * agência (ver meta-system-user.ts). Uma única linha `meta_system` em
 * `integration_connections`; o vínculo cliente↔conta aponta para ela via
 * `client_meta_accounts.connection_id`, e por isso Mídia, relatórios e a
 * Alicia leem o Meta sem saber que existe uma conexão central.
 */

export type MetaCentralStatus =
  | { state: 'not_configured'; missing: string[] }
  | { state: 'not_connected'; businessId: string }
  | { state: 'error'; businessId: string; message: string }
  | {
      state: 'connected' | 'invalid' | 'missing_scopes';
      businessId: string;
      businessName: string | null;
      tokenType: string | null;
      scopes: string[];
      missingScopes: string[];
      expiresAt: string | null;
      reason: string | null;
      linkedAccounts: number;
      connectedAt: string | null;
      lastSyncedAt: string | null;
    };

async function findCentralRow() {
  const [row] = await db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.provider, META_SYSTEM_PROVIDER));
  return row ?? null;
}

async function linkedAccounts(connectionId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.clientMetaAccounts).where(eq(schema.clientMetaAccounts.connectionId, connectionId));
  return row?.n ?? 0;
}

/**
 * Estado REAL: confere o token no Meta a cada chamada, em vez de mostrar
 * "conectado" porque existe uma linha no banco.
 */
export async function getMetaCentralStatus(): Promise<MetaCentralStatus> {
  const config = getMetaSystemUserConfig();
  if (!config) return { state: 'not_configured', missing: missingMetaSystemUserVars() };

  const row = await findCentralRow();
  if (!row || row.status !== 'connected') return { state: 'not_connected', businessId: config.businessId };

  let inspection: MetaTokenInspection;
  try {
    inspection = await inspectMetaToken(config);
  } catch (error) {
    return { state: 'error', businessId: config.businessId, message: error instanceof Error ? error.message : 'Falha ao consultar o Meta' };
  }

  return {
    state: !inspection.valid ? 'invalid' : inspection.missingScopes.length > 0 ? 'missing_scopes' : 'connected',
    businessId: config.businessId,
    businessName: row.externalWorkspaceName,
    tokenType: inspection.type,
    scopes: inspection.scopes,
    missingScopes: inspection.missingScopes,
    expiresAt: inspection.expiresAt,
    reason: inspection.reason,
    linkedAccounts: await linkedAccounts(row.id),
    connectedAt: row.createdAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };
}

export type MetaCentralConnectResult =
  | { ok: true; connectionId: string; businessId: string; businessName: string; inspection: MetaTokenInspection; accounts: MetaCentralContaCount }
  | { ok: false; code: 'not_configured' | 'token_invalid' | 'missing_scopes' | 'business_unreachable' | 'meta_error'; message: string };

/**
 * Valida token, permissões e acesso à BM; só então grava. Qualquer falha
 * devolve o motivo e NÃO grava nada — conexão "conectada" que não funciona é
 * pior que conexão ausente.
 */
export async function connectMetaSystemUser(userId: string): Promise<MetaCentralConnectResult> {
  const config = getMetaSystemUserConfig();
  if (!config) {
    return { ok: false, code: 'not_configured', message: `Faltam no servidor: ${missingMetaSystemUserVars().join(', ')}.` };
  }

  let inspection: MetaTokenInspection;
  try {
    inspection = await inspectMetaToken(config);
  } catch (error) {
    return { ok: false, code: 'meta_error', message: error instanceof Error ? error.message : 'Falha ao validar o token no Meta' };
  }
  if (!inspection.valid) {
    return { ok: false, code: 'token_invalid', message: inspection.reason ?? 'O Meta recusou o token do usuário do sistema.' };
  }
  if (inspection.missingScopes.length > 0) {
    return {
      ok: false,
      code: 'missing_scopes',
      message: `O token não tem: ${inspection.missingScopes.join(', ')}. Exigidos: ${META_REQUIRED_SCOPES.join(', ')}. Gere o token de novo marcando essas permissões.`,
    };
  }

  let businessName: string;
  let accounts: MetaCentralContaCount;
  try {
    businessName = await getMetaBusinessName(config.token, config.businessId);
    accounts = await countMetaBusinessAccounts(config.token, config.businessId);
  } catch (error) {
    return {
      ok: false,
      code: 'business_unreachable',
      message: `O token não alcança a Business Manager ${config.businessId}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    };
  }

  const existing = await findCentralRow();
  const values = {
    accessTokenEncrypted: encryptToken(config.token),
    externalWorkspaceId: config.businessId,
    externalWorkspaceName: businessName,
    status: 'connected',
    updatedAt: new Date(),
  };
  let connectionId: string;
  if (existing) {
    await db.update(schema.integrationConnections).set(values).where(eq(schema.integrationConnections.id, existing.id));
    connectionId = existing.id;
  } else {
    const [created] = await db
      .insert(schema.integrationConnections)
      .values({ userId, provider: META_SYSTEM_PROVIDER, ...values })
      .returning({ id: schema.integrationConnections.id });
    connectionId = created!.id;
  }

  await db.insert(schema.auditLogs).values({
    userId,
    action: 'integration.meta.central_connected',
    result: 'completed',
    metadata: { businessId: config.businessId, scopes: inspection.scopes, contas: accounts },
  });

  return { ok: true, connectionId, businessId: config.businessId, businessName, inspection, accounts };
}

export async function markMetaCentralSynced(): Promise<void> {
  const row = await findCentralRow();
  if (row) await db.update(schema.integrationConnections).set({ lastSyncedAt: new Date() }).where(eq(schema.integrationConnections.id, row.id));
}
