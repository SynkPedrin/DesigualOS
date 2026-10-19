/**
 * evolution-client.ts — cliente cru da Evolution API (WhatsApp self-hosted).
 *
 * POR QUE EVOLUTION API E NÃO A API OFICIAL DA META: a agência já roda
 * Evolution API em produção hoje, fora deste repositório, no serviço
 * legado `agentes-desigual`/susy-service (Express + Evolution API,
 * confirmado em `DESIGUAL_OS_CONTEXT_RECOVERY.md` como "a fonte de verdade
 * do WhatsApp/Instagram de clientes" hoje). Reaproveitar essa decisão já
 * tomada, em vez de reabrir a escolha de fornecedor — exatamente o que o
 * plano de execução (§P1.2, "Decisão de adapter") e o prompt master (§7)
 * pedem: não re-decidir o que já está decidido e rodando.
 *
 * O QUE NÃO ESTÁ RESOLVIDO: credenciais utilizáveis DESTA instância Evolution
 * dentro DESTE repositório — nenhuma env var (`EVOLUTION_API_URL`/
 * `EVOLUTION_API_KEY` ou equivalente) existe aqui hoje, e a instância do
 * susy-service não foi desenhada pra ser compartilhada por múltiplos
 * tenants (ver `organization_connectors`, que é por EMPRESA). Por isso o
 * adapter concreto (`communication-provider-resolver.ts`) existe e
 * compila, mas a CONEXÃO real está marcada BLOCKED_EXTERNAL — sem
 * credencial pra testar contra uma instância de verdade nesta sessão.
 *
 * Contrato medido contra a documentação pública da Evolution API v2
 * (outubro/2026, ver progress doc — não "lembrado" de memória):
 *   POST {baseUrl}/message/sendText/{instance}, header `apikey: <key>`,
 *   corpo `{ number, text }` — resposta inclui o id da mensagem criada.
 *   Webhook (`messages.upsert`): `{ event, instance, data: { key: { id,
 *   remoteJid, fromMe }, message: { conversation }, messageTimestamp,
 *   pushName } }`.
 */

const EVOLUTION_FETCH_TIMEOUT_MS = 15_000;

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instance: string;
}

/**
 * Credencial de ADMINISTRAÇÃO do servidor Evolution (`AUTHENTICATION_API_KEY`,
 * a chave global) — diferente de `EvolutionConfig.apiKey`, que é o token da
 * instância de UMA empresa. Criar/conectar/apagar instância são operações de
 * infraestrutura nossa, nunca da empresa; ela nunca vê nem usa esta chave.
 */
export interface EvolutionAdminConfig {
  baseUrl: string;
  globalApiKey: string;
}

export interface EvolutionQrCode {
  /** `null` quando a instância já está conectada (não há QR pra mostrar). */
  base64: string | null;
}

/**
 * Cria a instância da empresa no servidor Evolution (self-hosted, 07/10/2026
 * — ver docker-compose.yml). `instanceName` é determinístico por empresa
 * (`org-<organizationId>`), então chamar de novo numa instância já criada
 * apenas reconecta (Evolution devolve 403/409 pra nome duplicado — tratado
 * pelo chamador como "já existe, usa /connect em vez de /create").
 *
 * Contrato medido contra a documentação pública (mintlify.wiki/EvolutionAPI/
 * evolution-api, consultada em 07/10/2026): `POST /instance/create`, corpo
 * `{instanceName, qrcode, integration, webhookUrl, webhookByEvents, webhookBase64}`,
 * resposta inclui `qrcode: {code, base64}` e `hash` (token da instância).
 */
export async function evolutionCreateInstance(
  admin: EvolutionAdminConfig,
  instanceName: string,
  webhookUrl: string,
): Promise<EvolutionQrCode> {
  const url = `${admin.baseUrl.replace(/\/$/, '')}/instance/create`;
  const response = await fetchEvolution(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: admin.globalApiKey },
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhookUrl,
      webhookByEvents: false,
      webhookBase64: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Evolution API recusou criar a instância (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const body = (await response.json().catch(() => null)) as { qrcode?: { base64?: string } } | null;
  return { base64: body?.qrcode?.base64 ?? null };
}

/**
 * Pede o QR code de uma instância JÁ CRIADA (reconexão: sessão expirou, ou a
 * pessoa fechou o modal antes de escanear). `GET /instance/connect/{instance}`
 * devolve `{code, base64}` direto na raiz quando há QR, ou `{instance:{state}}`
 * quando já está conectada — por isso `base64` sai `null` nesse segundo caso,
 * nunca um erro (reconectar uma instância já aberta não é falha).
 */
export async function evolutionConnectInstance(admin: EvolutionAdminConfig, instanceName: string): Promise<EvolutionQrCode> {
  const url = `${admin.baseUrl.replace(/\/$/, '')}/instance/connect/${encodeURIComponent(instanceName)}`;
  const response = await fetchEvolution(url, { headers: { apikey: admin.globalApiKey } });
  if (!response.ok) {
    throw new Error(`Evolution API recusou conectar a instância (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const body = (await response.json().catch(() => null)) as { base64?: string } | null;
  return { base64: body?.base64 ?? null };
}

export type EvolutionConnectionStateValue = 'open' | 'connecting' | 'close';

/** `GET /instance/connectionState/{instance}` — 'open' é o único estado em que mensagens fluem. */
export async function evolutionConnectionState(admin: EvolutionAdminConfig, instanceName: string): Promise<EvolutionConnectionStateValue> {
  const url = `${admin.baseUrl.replace(/\/$/, '')}/instance/connectionState/${encodeURIComponent(instanceName)}`;
  const response = await fetchEvolution(url, { headers: { apikey: admin.globalApiKey } });
  if (!response.ok) {
    throw new Error(`Evolution API recusou consultar o estado da instância (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const body = (await response.json().catch(() => null)) as { instance?: { state?: string } } | null;
  const estado = body?.instance?.state;
  return estado === 'open' || estado === 'connecting' ? estado : 'close';
}

/** Encerra a sessão (logout gracioso) — a instância continua existindo, pode reconectar com novo QR. */
export async function evolutionLogoutInstance(admin: EvolutionAdminConfig, instanceName: string): Promise<void> {
  const url = `${admin.baseUrl.replace(/\/$/, '')}/instance/logout/${encodeURIComponent(instanceName)}`;
  await fetchEvolution(url, { method: 'DELETE', headers: { apikey: admin.globalApiKey } });
}

/** Apaga a instância de vez — usado quando a empresa desconecta o WhatsApp pelo produto. */
export async function evolutionDeleteInstance(admin: EvolutionAdminConfig, instanceName: string): Promise<void> {
  const url = `${admin.baseUrl.replace(/\/$/, '')}/instance/delete/${encodeURIComponent(instanceName)}`;
  await fetchEvolution(url, { method: 'DELETE', headers: { apikey: admin.globalApiKey } });
}

export interface EvolutionChat {
  remoteJid: string;
  name: string | null;
  isGroup: boolean;
  updatedAt: string | null;
}

/** `POST /chat/findChats/{instance}` — usa a credencial DA EMPRESA (escopo da própria instância), não a global. */
export async function evolutionFindChats(config: EvolutionConfig): Promise<EvolutionChat[]> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/findChats/${encodeURIComponent(config.instance)}`;
  const response = await fetchEvolution(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`Evolution API recusou listar as conversas (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const body = (await response.json().catch(() => null)) as { chats?: Array<{ remoteJid: string; name?: string; isGroup?: boolean; updatedAt?: string }> } | null;
  return (body?.chats ?? []).map((c) => ({ remoteJid: c.remoteJid, name: c.name ?? null, isGroup: Boolean(c.isGroup), updatedAt: c.updatedAt ?? null }));
}

export interface EvolutionContact {
  remoteJid: string;
  pushName: string | null;
  profilePictureUrl: string | null;
}

/** `POST /chat/findContacts/{instance}` — mesma credencial de escopo da instância. */
export async function evolutionFindContacts(config: EvolutionConfig): Promise<EvolutionContact[]> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/findContacts/${encodeURIComponent(config.instance)}`;
  const response = await fetchEvolution(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`Evolution API recusou listar os contatos (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const body = (await response.json().catch(() => null)) as { contacts?: Array<{ remoteJid: string; pushName?: string; profilePictureUrl?: string }> } | null;
  return (body?.contacts ?? []).map((c) => ({ remoteJid: c.remoteJid, pushName: c.pushName ?? null, profilePictureUrl: c.profilePictureUrl ?? null }));
}

async function fetchEvolution(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(EVOLUTION_FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Evolution API não respondeu em ${EVOLUTION_FETCH_TIMEOUT_MS / 1000}s (timeout de rede)`);
    }
    throw error;
  }
}

export interface EvolutionSendResult {
  externalMessageId: string | null;
}

export async function evolutionSendText(config: EvolutionConfig, to: string, text: string): Promise<EvolutionSendResult> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(config.instance)}`;
  const response = await fetchEvolution(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({ number: to, text }),
  });
  if (!response.ok) {
    throw new Error(`Evolution API recusou o envio (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const body = (await response.json().catch(() => null)) as { key?: { id?: string } } | null;
  return { externalMessageId: body?.key?.id ?? null };
}

export async function evolutionHealth(config: EvolutionConfig): Promise<{ healthy: boolean; detail?: string }> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/instance/connectionState/${encodeURIComponent(config.instance)}`;
  try {
    const response = await fetchEvolution(url, { headers: { apikey: config.apiKey } });
    if (!response.ok) return { healthy: false, detail: `HTTP ${response.status}` };
    return { healthy: true };
  } catch (error) {
    return { healthy: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** O payload cru do webhook `messages.upsert`, só os campos que consumimos. */
export interface EvolutionWebhookEvent {
  event: string;
  instance: string;
  data: {
    key: { id: string; remoteJid: string; fromMe: boolean };
    message?: { conversation?: string } | undefined;
    messageTimestamp?: number | undefined;
    pushName?: string | undefined;
  };
}

/** `null` quando o payload não é um `messages.upsert` reconhecível — o
 *  chamador decide se ignora (outros eventos existem: connection.update
 *  etc., que não interessam ao Inbox). */
export function parseEvolutionWebhookEvent(raw: unknown): EvolutionWebhookEvent | null {
  if (raw === null || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (body.event !== 'messages.upsert') return null;
  const data = body.data as Record<string, unknown> | undefined;
  const key = data?.key as Record<string, unknown> | undefined;
  if (!data || !key || typeof key.id !== 'string' || typeof key.remoteJid !== 'string') return null;
  return {
    event: 'messages.upsert',
    instance: typeof body.instance === 'string' ? body.instance : '',
    data: {
      key: { id: key.id, remoteJid: key.remoteJid, fromMe: Boolean(key.fromMe) },
      message: data.message as { conversation?: string } | undefined,
      messageTimestamp: typeof data.messageTimestamp === 'number' ? data.messageTimestamp : undefined,
      pushName: typeof data.pushName === 'string' ? data.pushName : undefined,
    },
  };
}

/** Telefone normalizado a partir do `remoteJid` (`5511999998888@s.whatsapp.net` -> `5511999998888`). */
export function phoneFromRemoteJid(remoteJid: string): string {
  return remoteJid.split('@')[0] ?? remoteJid;
}
