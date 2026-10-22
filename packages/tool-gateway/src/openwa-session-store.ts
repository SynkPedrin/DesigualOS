import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decryptToken } from './token-crypto';
import { OpenwaGatewayClient } from './openwa-gateway';
import { OpenwaClient } from './openwa-client';

export type WhatsappSessionRow = typeof schema.whatsappSessions.$inferSelect;

export function openwaBaseUrl(): string {
  const value = process.env.OPENWA_BASE_URL?.trim().replace(/\/$/, '');
  if (!value) throw new Error('OPENWA_BASE_URL não configurada');
  return value;
}

export function openwaAdminClient(): OpenwaGatewayClient {
  const apiKey = process.env.OPENWA_ADMIN_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENWA_ADMIN_API_KEY não configurada');
  return new OpenwaGatewayClient({ baseUrl: openwaBaseUrl(), apiKey });
}

/**
 * Reinicia o motor (Chromium) de uma sessão com a chave administrativa: para e
 * sobe de novo, o que faz o WhatsApp Web emitir um QR novo. O "start" sozinho
 * não basta, porque num motor já carregado o OpenWA responde "já iniciado" e
 * nada acontece — foi assim que o QR da Jamile ficou parado por 25 minutos.
 * Não apaga credenciais: sessão já vinculada volta pelo que está guardado.
 */
export async function restartOpenwaEngine(externalSessionId: string): Promise<void> {
  const apiKey = process.env.OPENWA_ADMIN_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENWA_ADMIN_API_KEY não configurada');
  const session = new OpenwaGatewayClient({ baseUrl: openwaBaseUrl(), apiKey, sessionId: externalSessionId });
  await session.stopSession();
  await session.requestStart();
}

export async function whatsappSessionById(id: string): Promise<WhatsappSessionRow | null> {
  const [row] = await db.select().from(schema.whatsappSessions).where(eq(schema.whatsappSessions.id, id)).limit(1);
  return row ?? null;
}

export async function whatsappSessionByExternalId(externalSessionId: string): Promise<WhatsappSessionRow | null> {
  const [row] = await db.select().from(schema.whatsappSessions).where(eq(schema.whatsappSessions.externalSessionId, externalSessionId)).limit(1);
  return row ?? null;
}

/**
 * Mesma consulta com 30 s de memória, para o caminho quente das mensagens
 * (cada evento do webhook buscava a sessão de novo, ~130 ms até o banco nos
 * EUA). Evento de status de sessão continua lendo do banco.
 */
const sessionCache = new Map<string, { row: WhatsappSessionRow; at: number }>();
const SESSION_CACHE_TTL_MS = 30_000;

export async function cachedWhatsappSession(by: 'id' | 'external', key: string): Promise<WhatsappSessionRow | null> {
  const cacheKey = `${by}:${key}`;
  const hit = sessionCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SESSION_CACHE_TTL_MS) return hit.row;
  const row = by === 'id' ? await whatsappSessionById(key) : await whatsappSessionByExternalId(key);
  if (row) sessionCache.set(cacheKey, { row, at: Date.now() });
  return row;
}

export async function whatsappSessionForOwner(input: { id: string; organizationId: string; ownerUserId: string; canManageOthers?: boolean }): Promise<WhatsappSessionRow | null> {
  const conditions = [
    eq(schema.whatsappSessions.id, input.id),
    eq(schema.whatsappSessions.organizationId, input.organizationId),
  ];
  if (!input.canManageOthers) conditions.push(eq(schema.whatsappSessions.ownerUserId, input.ownerUserId));
  const [row] = await db.select().from(schema.whatsappSessions).where(and(...conditions)).limit(1);
  return row ?? null;
}

export function whatsappSessionCredentials(row: WhatsappSessionRow): { baseUrl: string; apiKey: string; sessionId: string } {
  return { baseUrl: openwaBaseUrl(), apiKey: decryptToken(row.apiKeyEncrypted), sessionId: row.externalSessionId };
}

export function whatsappWebhookSecret(row: WhatsappSessionRow): string {
  return decryptToken(row.webhookSecretEncrypted);
}

export function gatewayForWhatsappSession(row: WhatsappSessionRow): OpenwaGatewayClient {
  return new OpenwaGatewayClient(whatsappSessionCredentials(row));
}

export function senderForWhatsappSession(row: WhatsappSessionRow): OpenwaClient {
  return new OpenwaClient(whatsappSessionCredentials(row));
}
