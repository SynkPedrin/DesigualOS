/**
 * wapi-client.ts — cliente cru da W-API (vendor 'wapi' do WhatsApp, pedido
 * explícito do usuário em 07/10/2026, substituindo o self-host Evolution
 * como caminho ATIVO pra este primeiro conector real).
 *
 * NENHUMA CHAMADA HTTP REAL AINDA. O usuário foi explícito: "não quero que
 * você invente endpoints nem formato de autenticação" — a documentação
 * pública da W-API (docs.w-api.app) é um app Bubble que não expõe o
 * conteúdo a leitura automática, e o painel do usuário não mostra um
 * snippet de exemplo. Toda função aqui embaixo monta a INTENÇÃO da chamada
 * (operação, dados) e repassa pra `wapiRequest`, que é o único lugar que
 * efetivamente faria o fetch — e que por ora só lança `WApiContractPendingError`.
 *
 * QUANDO O USUÁRIO MANDAR UM cURL DE VERDADE: implementar `wapiRequest`
 * (como montar a URL a partir de `config.baseUrl`/`config.instanceId`, qual
 * header carrega `config.token`) é o que destrava TODAS as operações de uma
 * vez. Cada função individual (sendText, getQrCode, etc.) pode então
 * precisar de um ajuste de path/body próprio se o exemplo dado for de uma
 * operação específica — mas a mecânica de auth fica resolvida uma vez só.
 */

export interface WApiConfig {
  baseUrl: string;
  instanceId: string;
  token: string;
  webhookSecret?: string | undefined;
}

export class WApiContractPendingError extends Error {
  constructor(operacao: string) {
    super(
      `A integração com a W-API ainda não tem o formato oficial de request confirmado (operação: ${operacao}). ` +
        'Aguardando um cURL de exemplo do usuário — ver o cabeçalho de wapi-client.ts antes de preencher isto.',
    );
    this.name = 'WApiContractPendingError';
  }
}

/**
 * O ÚNICO lugar que faria a chamada HTTP de verdade. Recebe a operação (só
 * pra mensagem de erro/log) e os dados que ELA precisaria — path, método,
 * corpo — mas não os usa ainda, porque nenhum dos três é confirmado.
 */
function wapiRequest(_config: WApiConfig, operacao: string, _params: { method: string; body?: unknown }): never {
  throw new WApiContractPendingError(operacao);
}

export interface WApiSendResult {
  externalMessageId: string | null;
}

export async function wapiSendText(config: WApiConfig, to: string, text: string): Promise<WApiSendResult> {
  return wapiRequest(config, 'sendText', { method: 'POST', body: { to, text } });
}

export async function wapiSendImage(config: WApiConfig, to: string, imageUrl: string, caption?: string): Promise<WApiSendResult> {
  return wapiRequest(config, 'sendImage', { method: 'POST', body: { to, imageUrl, caption } });
}

export async function wapiSendAudio(config: WApiConfig, to: string, audioUrl: string): Promise<WApiSendResult> {
  return wapiRequest(config, 'sendAudio', { method: 'POST', body: { to, audioUrl } });
}

export async function wapiSendDocument(config: WApiConfig, to: string, documentUrl: string, filename: string): Promise<WApiSendResult> {
  return wapiRequest(config, 'sendDocument', { method: 'POST', body: { to, documentUrl, filename } });
}

export interface WApiQrCode {
  /** `null` quando a instância já está conectada. */
  base64: string | null;
}

export async function wapiGetQrCode(config: WApiConfig): Promise<WApiQrCode> {
  return wapiRequest(config, 'getQrCode', { method: 'GET' });
}

export type WApiConnectionStateValue = 'open' | 'connecting' | 'close';

export async function wapiGetConnectionState(config: WApiConfig): Promise<WApiConnectionStateValue> {
  return wapiRequest(config, 'getConnectionState', { method: 'GET' });
}

export async function wapiDisconnect(config: WApiConfig): Promise<void> {
  return wapiRequest(config, 'disconnect', { method: 'POST' });
}

/** Saúde da conexão com o provedor (não o estado do WhatsApp em si — ver CommunicationProvider.health). */
export async function wapiHealth(config: WApiConfig): Promise<{ healthy: boolean; detail?: string }> {
  try {
    const estado = await wapiGetConnectionState(config);
    return { healthy: estado === 'open' };
  } catch (error) {
    return { healthy: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * O payload cru do webhook de mensagem recebida — formato DESCONHECIDO até
 * o usuário confirmar. `null` sempre, por ora: o webhook endpoint aceita a
 * chamada (200, pra W-API nunca reentregar em loop) mas não processa nada
 * até esta função ser escrita de verdade contra um payload real.
 */
export function parseWApiWebhookEvent(_raw: unknown): null {
  return null;
}
