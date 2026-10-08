import { z } from 'zod';
import type { CommunicationProvider } from './communication-provider';
import { evolutionHealth, evolutionSendText, type EvolutionConfig } from './evolution-client';
import { wapiHealth, wapiSendAudio, wapiSendDocument, wapiSendImage, wapiSendText, type WApiConfig } from './wapi-client';
import { ConnectorConfigError, loadConnectorRows } from './organization-connector-store';

/**
 * communication-provider-resolver.ts — mesmo papel de `task-provider-resolver.ts`,
 * pra comunicação externa em vez de task. Reusa a MESMA leitura de
 * `organization_connectors` (`loadConnectorRows`) — nunca uma segunda
 * implementação da pergunta "que credencial esta empresa tem pra este
 * provider?".
 *
 * DIFERENÇA DELIBERADA do resolver de task: não existe fallback de env
 * global. TaskProvider tem fallback porque historicamente só existia UMA
 * credencial de ClickUp (a da própria Desigual) antes do white label.
 * WhatsApp nunca teve isso — não existe "número de WhatsApp compartilhado
 * da agência" que faça sentido (misturaria conversas de clientes
 * diferentes no mesmo número). Sem conector próprio, a resposta é `null`:
 * a empresa ainda não conectou WhatsApp, ponto.
 */

/**
 * `vendor` é o que decide QUAL classe concreta nasce abaixo — a peça que
 * deixa trocar W-API por outro provider (Stevo, Meta Cloud API) sem mexer em
 * mais nada fora deste arquivo (pedido explícito do usuário, 07/10/2026).
 * `.default('evolution')` existe só pra não quebrar uma linha gravada ANTES
 * de `vendor` existir — nenhuma precisa disso hoje (o self-host Evolution
 * nunca chegou a ser usado em produção), mas não custa a segurança.
 */
const evolutionCredentialsSchema = z.object({
  vendor: z.literal('evolution').default('evolution'),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().trim().min(1),
  instance: z.string().trim().min(1),
});

const wapiCredentialsSchema = z.object({
  vendor: z.literal('wapi'),
  baseUrl: z.string().trim().url(),
  instanceId: z.string().trim().min(1),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).optional(),
});

const whatsappCredentialsSchema = z.union([evolutionCredentialsSchema, wapiCredentialsSchema]);

class EvolutionCommunicationProvider implements CommunicationProvider {
  readonly provider = 'whatsapp' as const;
  constructor(private readonly config: EvolutionConfig) {}

  async sendMessage(input: { to: string; text: string }): Promise<{ externalMessageId: string | null }> {
    return evolutionSendText(this.config, input.to, input.text);
  }

  async health(): Promise<{ healthy: boolean; detail?: string }> {
    return evolutionHealth(this.config);
  }
}

/**
 * WApiCommunicationProvider (07/10/2026) — mídia incluída (o usuário pediu
 * explicitamente imagem/áudio/documento). As chamadas de baixo nível em
 * `wapi-client.ts` lançam `WApiContractPendingError` até o formato oficial
 * da W-API ser confirmado; esta classe não esconde isso, só repassa.
 */
class WApiCommunicationProvider implements CommunicationProvider {
  readonly provider = 'whatsapp' as const;
  constructor(private readonly config: WApiConfig) {}

  async sendMessage(input: { to: string; text: string }): Promise<{ externalMessageId: string | null }> {
    return wapiSendText(this.config, input.to, input.text);
  }

  async sendImage(input: { to: string; url: string; caption?: string }): Promise<{ externalMessageId: string | null }> {
    return wapiSendImage(this.config, input.to, input.url, input.caption);
  }

  async sendAudio(input: { to: string; url: string }): Promise<{ externalMessageId: string | null }> {
    return wapiSendAudio(this.config, input.to, input.url);
  }

  async sendDocument(input: { to: string; url: string; filename: string }): Promise<{ externalMessageId: string | null }> {
    return wapiSendDocument(this.config, input.to, input.url, input.filename);
  }

  async health(): Promise<{ healthy: boolean; detail?: string }> {
    return wapiHealth(this.config);
  }
}

/**
 * O provider de WhatsApp da empresa, ou `null` se ela não tem um
 * configurado. Conector existente mas quebrado (inativo/credencial
 * incompleta) lança `ConnectorConfigError` — nunca `null` (que pareceria
 * "não configurou" e esconderia um problema real de configuração).
 */
export async function resolveCommunicationProvider(
  organizationId: string | null | undefined,
): Promise<CommunicationProvider | null> {
  if (!organizationId) return null;
  const rows = await loadConnectorRows(organizationId);
  const whatsapp = rows.find((r) => r.provider === 'whatsapp');
  if (!whatsapp) return null;
  if (whatsapp.status !== 'ativa') {
    throw new ConnectorConfigError(
      `O conector whatsapp desta empresa está ${whatsapp.status}. Reative-o nas configurações da empresa.`,
      organizationId,
      'whatsapp',
    );
  }
  const parsed = whatsappCredentialsSchema.safeParse(whatsapp.credentials);
  if (!parsed.success) {
    throw new ConnectorConfigError(
      'A configuração do WhatsApp desta empresa está incompleta. Refaça a conexão nas configurações da empresa.',
      organizationId,
      'whatsapp',
    );
  }
  // O discriminador que troca o vendor sem mexer em mais nada fora daqui.
  return parsed.data.vendor === 'wapi' ? new WApiCommunicationProvider(parsed.data) : new EvolutionCommunicationProvider(parsed.data);
}
