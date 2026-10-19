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

export async function whatsappSessionById(id: string): Promise<WhatsappSessionRow | null> {
  const [row] = await db.select().from(schema.whatsappSessions).where(eq(schema.whatsappSessions.id, id)).limit(1);
  return row ?? null;
}

export async function whatsappSessionByExternalId(externalSessionId: string): Promise<WhatsappSessionRow | null> {
  const [row] = await db.select().from(schema.whatsappSessions).where(eq(schema.whatsappSessions.externalSessionId, externalSessionId)).limit(1);
  return row ?? null;
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
