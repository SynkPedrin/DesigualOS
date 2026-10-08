import type { EvolutionAdminConfig } from './evolution-client';

/**
 * evolution-admin-resolver.ts — a credencial de ADMINISTRAÇÃO do servidor
 * Evolution self-hosted (docker-compose.yml, 07/10/2026), e o nome
 * determinístico de instância por empresa.
 *
 * MESMO padrão de `google-ads-access-resolver.ts`: lê env direto, `null`
 * quando falta configuração — o chamador decide o que fazer (aqui, sempre
 * "conectar WhatsApp indisponível", nunca um fallback silencioso).
 */
export function resolveEvolutionAdminConfig(): EvolutionAdminConfig | null {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const globalApiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !globalApiKey) return null;
  return { baseUrl, globalApiKey };
}

/** A URL que o servidor Evolution (rodando em Docker) usa pra chamar de volta o nosso `/webhooks/whatsapp`. */
export function resolveEvolutionWebhookUrl(): string | null {
  const base = process.env.EVOLUTION_WEBHOOK_BASE_URL;
  return base ? `${base.replace(/\/$/, '')}/webhooks/whatsapp` : null;
}

/**
 * Nome de instância DETERMINÍSTICO por empresa: `org-<organizationId>`.
 * Nunca escolhido por quem conecta — é o que faz o webhook (`evento.instance`)
 * resolver a empresa dona sem ambiguidade, e o que faz chamar `/instance/create`
 * de novo numa empresa já conectada ser idempotente (mesmo nome, Evolution
 * decide se cria ou recusa por duplicata).
 */
export function evolutionInstanceNameFor(organizationId: string): string {
  return `org-${organizationId}`;
}
