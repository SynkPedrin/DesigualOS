import type { WApiConfig } from './wapi-client';

/**
 * wapi-admin-resolver.ts — lê a config da W-API do ambiente (07/10/2026).
 *
 * MESMO padrão de `evolution-admin-resolver.ts`/`google-ads-access-resolver.ts`:
 * `null` quando falta variável, o chamador decide (aqui, sempre "WhatsApp via
 * W-API indisponível neste ambiente", nunca um fallback silencioso).
 *
 * `WAPI_BASE_URL` fica vazio de propósito até o usuário confirmar o host
 * correto com um exemplo oficial de request — ver wapi-client.ts.
 */
export function resolveWApiConfig(): WApiConfig | null {
  const baseUrl = process.env.WAPI_BASE_URL;
  const instanceId = process.env.WAPI_INSTANCE_ID;
  const token = process.env.WAPI_TOKEN;
  if (!baseUrl || !instanceId || !token) return null;
  return { baseUrl, instanceId, token, webhookSecret: process.env.WAPI_WEBHOOK_SECRET || undefined };
}
