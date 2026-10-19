import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  OpenwaGatewayClient,
  OpenwaGatewayError,
  decryptToken,
  encryptToken,
  openwaAdminClient,
  openwaBaseUrl,
} from '@desigual-os/tool-gateway';
import { bentoWhatsappConfig, type BentoWhatsappConfig } from './config';

/**
 * O NÚMERO DO BENTO SE CONFIGURA PELO PAINEL (19/10/2026).
 *
 * O desenho de 16/10 exigia cinco variáveis preenchidas à mão no servidor
 * (sessão, chave, segredo, URL...). Em produção ninguém preencheu, e o canal
 * ficou ligado respondendo "sem configuração completa": aparecia na tela e
 * não funcionava.
 *
 * Agora é o mesmo caminho que a frente do Inbox já usa para o número de cada
 * colaborador: com a chave ADMIN do OpenWA (que o servidor já tem), o painel
 * cria a sessão do número do Bento, gera uma chave escopada SÓ a ela,
 * registra o webhook com segredo próprio e guarda tudo criptografado. A
 * pessoa com o celular do Bento só escaneia o QR.
 *
 * Onde fica: uma linha de `organization_connectors` com provider
 * 'bento_whatsapp' — sem migração nova. Uma por instalação: há UM número do
 * Bento. `status` 'ativa'/'desativada' é o liga/desliga do canal no painel.
 *
 * As variáveis de ambiente continuam valendo e têm precedência quando
 * preenchidas (BENTO_WHATSAPP_SESSION_ID etc.), e BENTO_WHATSAPP_ENABLED=false
 * continua sendo a chave geral que desliga tudo.
 */

export const PROVIDER_DO_BENTO = 'bento_whatsapp';

export interface CredenciaisDoBento {
  sessionId: string;
  sessionName: string;
  apiKeyId: string | null;
  apiKeyEncrypted: string;
  webhookSecretEncrypted: string;
  webhookId: string | null;
  webhookUrl: string | null;
  botPhone: string | null;
}

export interface LinhaDoBento {
  id: string;
  organizationId: string;
  status: string;
  credenciais: CredenciaisDoBento;
}

export type OrigemDaConfiguracao = 'env' | 'painel' | 'nenhuma';

export interface ConfiguracaoResolvida {
  config: BentoWhatsappConfig;
  origem: OrigemDaConfiguracao;
  linha: LinhaDoBento | null;
}

function credenciaisValidas(valor: unknown): valor is CredenciaisDoBento {
  const c = valor as Partial<CredenciaisDoBento> | null;
  return Boolean(c && typeof c.sessionId === 'string' && typeof c.apiKeyEncrypted === 'string' && typeof c.webhookSecretEncrypted === 'string');
}

export async function linhaDoBento(): Promise<LinhaDoBento | null> {
  const [linha] = await db
    .select()
    .from(schema.organizationConnectors)
    .where(eq(schema.organizationConnectors.provider, PROVIDER_DO_BENTO))
    .limit(1);
  if (!linha || !credenciaisValidas(linha.credentials)) return null;
  return { id: linha.id, organizationId: linha.organizationId, status: linha.status, credenciais: linha.credentials };
}

function baseDoOpenwa(): string | null {
  try {
    return openwaBaseUrl();
  } catch {
    return null;
  }
}

/**
 * Para onde o OpenWA manda as mensagens do Bento. Segue a URL que o Inbox já
 * usa com sucesso (OPENWA_WEBHOOK_URL), trocando só o caminho — assim vale a
 * mesma regra de rede/SSRF que já foi acertada para ela.
 */
export function urlDoWebhookDoBento(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicita = env.BENTO_WHATSAPP_WEBHOOK_URL?.trim();
  if (explicita) return explicita;
  const doInbox = env.OPENWA_WEBHOOK_URL?.trim();
  if (doInbox) {
    try {
      const url = new URL(doInbox);
      url.pathname = '/bento-whatsapp/webhook';
      url.search = '';
      return url.toString();
    } catch {
      // cai para API_PUBLIC_URL
    }
  }
  const publica = env.API_PUBLIC_URL?.trim().replace(/\/$/, '');
  return publica ? `${publica}/bento-whatsapp/webhook` : null;
}

let cache: { valor: ConfiguracaoResolvida; ate: number } | null = null;
const VALIDADE_DO_CACHE_MS = 10_000;

export function esquecerConfiguracaoEmCache(): void {
  cache = null;
}

/**
 * A configuração que vale AGORA: env completa > painel > nada. Lida a cada
 * webhook (com cache curto), para que conectar ou desligar pelo painel valha
 * sem reiniciar a API.
 */
export async function resolverConfiguracao(env: NodeJS.ProcessEnv = process.env): Promise<ConfiguracaoResolvida> {
  if (cache && cache.ate > Date.now()) return cache.valor;
  const base = bentoWhatsappConfig(env);
  const chaveGeralDesligada = env.BENTO_WHATSAPP_ENABLED === 'false';

  let valor: ConfiguracaoResolvida;
  if (base.sessionId && base.openwaApiKey && base.webhookSecret) {
    valor = {
      config: { ...base, openwaBaseUrl: base.openwaBaseUrl ?? baseDoOpenwa() },
      origem: 'env',
      linha: null,
    };
  } else {
    const linha = await linhaDoBento().catch(() => null);
    if (linha) {
      let apiKey: string | null = null;
      let segredo: string | null = null;
      try {
        apiKey = decryptToken(linha.credenciais.apiKeyEncrypted);
        segredo = decryptToken(linha.credenciais.webhookSecretEncrypted);
      } catch {
        // Chave de criptografia trocada: a linha não serve mais; o painel
        // mostra "não configurado" e o provisionamento refaz.
      }
      valor = {
        config: {
          ...base,
          enabled: !chaveGeralDesligada && linha.status === 'ativa' && Boolean(apiKey && segredo),
          openwaBaseUrl: base.openwaBaseUrl ?? baseDoOpenwa(),
          openwaApiKey: apiKey,
          sessionId: linha.credenciais.sessionId,
          webhookSecret: segredo,
          botPhone: linha.credenciais.botPhone ?? base.botPhone,
        },
        origem: 'painel',
        linha,
      };
    } else {
      valor = { config: { ...base, enabled: false }, origem: 'nenhuma', linha: null };
    }
  }
  if (chaveGeralDesligada) valor = { ...valor, config: { ...valor.config, enabled: false } };
  cache = { valor, ate: Date.now() + VALIDADE_DO_CACHE_MS };
  return valor;
}

async function salvarCredenciais(id: string, credenciais: CredenciaisDoBento, status?: string): Promise<void> {
  await db
    .update(schema.organizationConnectors)
    .set({ credentials: credenciais, ...(status ? { status } : {}) })
    .where(eq(schema.organizationConnectors.id, id));
  esquecerConfiguracaoEmCache();
}

function clienteDaSessao(credenciais: CredenciaisDoBento): OpenwaGatewayClient {
  return new OpenwaGatewayClient({
    baseUrl: openwaBaseUrl(),
    apiKey: decryptToken(credenciais.apiKeyEncrypted),
    sessionId: credenciais.sessionId,
  });
}

export interface ResultadoDoProvisionamento {
  criada: boolean;
  status: string;
  sessionId: string;
}

/**
 * Cria (ou retoma) a sessão do número do Bento no OpenWA e deixa o webhook
 * apontando para cá. Idempotente: rodar de novo não cria segunda sessão —
 * reaproveita a linha guardada, re-registra o webhook e inicia a sessão.
 */
export async function provisionarSessaoDoBento(input: { organizationId: string }): Promise<ResultadoDoProvisionamento> {
  const urlDoWebhook = urlDoWebhookDoBento();
  if (!urlDoWebhook) throw new Error('Defina OPENWA_WEBHOOK_URL ou API_PUBLIC_URL no servidor para o OpenWA saber onde entregar as mensagens.');

  let existente = await linhaDoBento();
  let sessaoExistente = null;
  if (existente) {
    try {
      sessaoExistente = await clienteDaSessao(existente.credenciais).getSession();
    } catch (error) {
      // Sessão apagada no OpenWA (ou chave revogada): a linha guardada não
      // serve mais. Recria do zero em vez de ficar preso num 404.
      const perdida = error instanceof OpenwaGatewayError && (error.status === 404 || error.status === 401 || error.status === 403);
      if (!perdida) throw error;
      existente = null;
    }
  }
  if (existente && sessaoExistente) {
    const credenciais = { ...existente.credenciais };
    const cliente = clienteDaSessao(credenciais);
    let sessao = sessaoExistente;
    const segredo = decryptToken(credenciais.webhookSecretEncrypted);
    if (credenciais.webhookId) {
      try {
        await cliente.updateWebhook(credenciais.webhookId, { url: urlDoWebhook, secret: segredo });
      } catch (error) {
        if (!(error instanceof OpenwaGatewayError) || error.status !== 404) throw error;
        credenciais.webhookId = (await cliente.createWebhook({ url: urlDoWebhook, secret: segredo })).id;
      }
    } else {
      credenciais.webhookId = (await cliente.createWebhook({ url: urlDoWebhook, secret: segredo })).id;
    }
    credenciais.webhookUrl = urlDoWebhook;
    if (!sessao.engineLoaded || ['created', 'failed', 'disconnected'].includes(sessao.status)) {
      sessao = await cliente.startSession();
    }
    await salvarCredenciais(existente.id, credenciais, 'ativa');
    return { criada: false, status: sessao.status, sessionId: credenciais.sessionId };
  }

  const admin = openwaAdminClient();
  const nome = `bento-${randomBytes(4).toString('hex')}`;
  const criada = await admin.createSession(nome);
  const chave = await admin.createScopedOperatorKey(nome, criada.id);
  const segredo = randomBytes(32).toString('hex');
  const credenciais: CredenciaisDoBento = {
    sessionId: criada.id,
    sessionName: nome,
    apiKeyId: chave.id,
    apiKeyEncrypted: encryptToken(chave.apiKey),
    webhookSecretEncrypted: encryptToken(segredo),
    webhookId: null,
    webhookUrl: urlDoWebhook,
    botPhone: null,
  };
  const cliente = clienteDaSessao(credenciais);
  credenciais.webhookId = (await cliente.createWebhook({ url: urlDoWebhook, secret: segredo })).id;

  await db
    .insert(schema.organizationConnectors)
    .values({ organizationId: input.organizationId, provider: PROVIDER_DO_BENTO, credentials: credenciais, status: 'ativa' })
    .onConflictDoUpdate({
      target: [schema.organizationConnectors.organizationId, schema.organizationConnectors.provider],
      set: { credentials: credenciais, status: 'ativa' },
    });
  esquecerConfiguracaoEmCache();
  const sessao = await cliente.startSession();
  return { criada: true, status: sessao.status, sessionId: criada.id };
}

/** Liga/desliga o canal pelo painel, sem tocar na sessão do WhatsApp. */
export async function definirCanalAtivo(ativo: boolean): Promise<boolean> {
  const linha = await linhaDoBento();
  if (!linha) return false;
  await db
    .update(schema.organizationConnectors)
    .set({ status: ativo ? 'ativa' : 'desativada' })
    .where(eq(schema.organizationConnectors.id, linha.id));
  esquecerConfiguracaoEmCache();
  return true;
}

/**
 * Quando a sessão fica pronta, o número que o WhatsApp informa passa a ser o
 * número do Bento (anti-loop, link wa.me). Grava só se mudou.
 */
export async function lembrarNumeroDoBento(telefone: string | null | undefined): Promise<void> {
  const digitos = telefone?.replace(/\D/g, '');
  if (!digitos) return;
  const linha = await linhaDoBento().catch(() => null);
  if (!linha || linha.credenciais.botPhone === digitos) return;
  await salvarCredenciais(linha.id, { ...linha.credenciais, botPhone: digitos });
}
