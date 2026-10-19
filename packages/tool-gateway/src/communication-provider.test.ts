import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evolutionHealth,
  evolutionSendText,
  parseEvolutionWebhookEvent,
  phoneFromRemoteJid,
} from './evolution-client';
import { resolveCommunicationProvider } from './communication-provider-resolver';
import { ConnectorConfigError, __setConnectorConfigLoaderForTest } from './organization-connector-store';
import { WApiContractPendingError, wapiGetConnectionState, wapiSendText } from './wapi-client';
import { resolveWApiConfig } from './wapi-admin-resolver';

/**
 * COMMUNICATION PROVIDER (P1-A, 06/10/2026) — Evolution API é a decisão JÁ
 * TOMADA pelo legado (`agentes-desigual`/susy-service), reaproveitada aqui,
 * não re-decidida. Estes testes travam:
 *
 *   - o parser do webhook contra o shape real documentado da Evolution API
 *     (messages.upsert), não um shape inventado;
 *   - o resolver: mesma regra de `resolveTaskProvider` (conector quebrado
 *     nunca vira null), MAS sem fallback de env — WhatsApp nunca teve
 *     credencial global compartilhada fazendo sentido.
 */

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const page = handler(url, init);
    const status = page.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => page.body ?? {},
      text: async () => JSON.stringify(page.body ?? {}),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  __setConnectorConfigLoaderForTest(null);
});

describe('parseEvolutionWebhookEvent', () => {
  it('parseia um messages.upsert real (shape documentado da Evolution API v2)', () => {
    const raw = {
      event: 'messages.upsert',
      instance: 'desigual-cosentino',
      data: {
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: '3EB0XXXXX' },
        message: { conversation: 'Olá, preciso de um orçamento' },
        messageTimestamp: 1709550600,
        pushName: 'Maria Cliente',
      },
      date_time: '2026-10-06T10:30:00.000Z',
      sender: '5511999998888',
    };

    const parsed = parseEvolutionWebhookEvent(raw);

    expect(parsed).toEqual({
      event: 'messages.upsert',
      instance: 'desigual-cosentino',
      data: {
        key: { id: '3EB0XXXXX', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
        message: { conversation: 'Olá, preciso de um orçamento' },
        messageTimestamp: 1709550600,
        pushName: 'Maria Cliente',
      },
    });
  });

  it('evento que não é messages.upsert -> null (ex.: connection.update)', () => {
    expect(parseEvolutionWebhookEvent({ event: 'connection.update', instance: 'x', data: {} })).toBeNull();
  });

  it('payload sem key.id/remoteJid -> null, não lança', () => {
    expect(parseEvolutionWebhookEvent({ event: 'messages.upsert', data: {} })).toBeNull();
  });

  it('payload que não é objeto -> null', () => {
    expect(parseEvolutionWebhookEvent(null)).toBeNull();
    expect(parseEvolutionWebhookEvent('string')).toBeNull();
  });
});

describe('phoneFromRemoteJid', () => {
  it('extrai o telefone antes do @', () => {
    expect(phoneFromRemoteJid('5511999998888@s.whatsapp.net')).toBe('5511999998888');
  });

  it('sem @ no jid, devolve como veio', () => {
    expect(phoneFromRemoteJid('5511999998888')).toBe('5511999998888');
  });
});

describe('evolutionSendText', () => {
  const CONFIG = { baseUrl: 'https://evolution.exemplo.com', apiKey: 'chave-da-instancia', instance: 'desigual-cosentino' };

  it('monta a URL/headers/corpo conforme o contrato documentado', async () => {
    const calls = stubFetch(() => ({ body: { key: { id: 'msg-enviada-1' } } }));

    const resultado = await evolutionSendText(CONFIG, '5511988887777', 'Oi, tudo bem?');

    expect(calls[0]!.url).toBe('https://evolution.exemplo.com/message/sendText/desigual-cosentino');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>).apikey).toBe('chave-da-instancia');
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({ number: '5511988887777', text: 'Oi, tudo bem?' });
    expect(resultado).toEqual({ externalMessageId: 'msg-enviada-1' });
  });

  it('Evolution recusa o envio -> erro claro, não silencioso', async () => {
    stubFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    await expect(evolutionSendText(CONFIG, '5511988887777', 'oi')).rejects.toThrow(/401/);
  });
});

describe('evolutionHealth', () => {
  const CONFIG = { baseUrl: 'https://evolution.exemplo.com', apiKey: 'k', instance: 'inst' };

  it('instância respondendo -> healthy', async () => {
    stubFetch(() => ({ body: { state: 'open' } }));
    expect(await evolutionHealth(CONFIG)).toEqual({ healthy: true });
  });

  it('instância fora do ar -> healthy:false com detalhe, nunca lança', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const resultado = await evolutionHealth(CONFIG);
    expect(resultado.healthy).toBe(false);
    expect(resultado.detail).toContain('ECONNREFUSED');
  });
});

describe('resolveCommunicationProvider', () => {
  beforeEach(() => {
    __setConnectorConfigLoaderForTest(async () => []);
  });

  it('sem organizationId: null, não consulta banco', async () => {
    expect(await resolveCommunicationProvider(null)).toBeNull();
    expect(await resolveCommunicationProvider(undefined)).toBeNull();
  });

  it('empresa sem conector de whatsapp: null — NUNCA um fallback global (WhatsApp não tem um)', async () => {
    __setConnectorConfigLoaderForTest(async () => [{ provider: 'clickup', credentials: {}, status: 'ativa' }]);
    expect(await resolveCommunicationProvider('org-1')).toBeNull();
  });

  it('empresa COM conector de whatsapp ativo: devolve provider que envia com a credencial dela', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'whatsapp', credentials: { baseUrl: 'https://evo.cosentino.com', apiKey: 'pk_cosentino', instance: 'cosentino' }, status: 'ativa' },
    ]);
    const calls = stubFetch(() => ({ body: { key: { id: 'm1' } } }));

    const provider = await resolveCommunicationProvider('org-1');
    expect(provider).not.toBeNull();
    await provider!.sendMessage({ to: '5511999998888', text: 'oi' });

    expect(calls[0]!.url).toBe('https://evo.cosentino.com/message/sendText/cosentino');
    expect((calls[0]!.init?.headers as Record<string, string>).apikey).toBe('pk_cosentino');
  });

  it('conector de whatsapp DESATIVADO: ConnectorConfigError, nunca null', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'whatsapp', credentials: { baseUrl: 'https://evo.com', apiKey: 'k', instance: 'i' }, status: 'desativada' },
    ]);
    const erro = await resolveCommunicationProvider('org-1').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConnectorConfigError);
  });

  it('credencial incompleta (sem instance): ConnectorConfigError', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'whatsapp', credentials: { baseUrl: 'https://evo.com', apiKey: 'k' }, status: 'ativa' },
    ]);
    const erro = await resolveCommunicationProvider('org-1').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConnectorConfigError);
    expect((erro as Error).message).toContain('incompleta');
  });

  /**
   * VENDOR 'wapi' (07/10/2026, pedido explícito do usuário): o mesmo
   * `resolveCommunicationProvider`, sem o chamador saber ou se importar que
   * o vendor mudou — é exatamente o ponto de trocar provider sem tocar no
   * resto do produto. As chamadas de rede continuam pendentes
   * (`WApiContractPendingError`) até o formato oficial ser confirmado; o
   * resolver só prova que ele RECONHECE o vendor e delega certo.
   */
  it('empresa com conector whatsapp vendor "wapi": resolve pro provider certo (chamada de rede ainda pendente)', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'whatsapp', credentials: { vendor: 'wapi', baseUrl: 'https://api.w-api.app', instanceId: 'AQDBQK-DTYTRZ-DXEMU9', token: 'tok' }, status: 'ativa' },
    ]);

    const provider = await resolveCommunicationProvider('org-1');
    expect(provider).not.toBeNull();
    await expect(provider!.sendMessage({ to: '5511999998888', text: 'oi' })).rejects.toThrow(WApiContractPendingError);
  });

  it('empresa com conector whatsapp vendor "evolution" via linha ANTIGA (sem campo vendor gravado): continua resolvendo Evolution, nunca quebra', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'whatsapp', credentials: { baseUrl: 'https://evo.cosentino.com', apiKey: 'pk_cosentino', instance: 'cosentino' }, status: 'ativa' },
    ]);
    const calls = stubFetch(() => ({ body: { key: { id: 'm1' } } }));

    const provider = await resolveCommunicationProvider('org-1');
    await provider!.sendMessage({ to: '5511999998888', text: 'oi' });

    expect(calls[0]!.url).toBe('https://evo.cosentino.com/message/sendText/cosentino');
  });
});

describe('wapi-client — contrato pendente de confirmação', () => {
  const CONFIG = { baseUrl: 'https://api.w-api.app', instanceId: 'AQDBQK-DTYTRZ-DXEMU9', token: 'tok' };

  it('toda chamada de rede lança WApiContractPendingError — nenhum endpoint foi inventado', async () => {
    await expect(wapiSendText(CONFIG, '5511999998888', 'oi')).rejects.toThrow(WApiContractPendingError);
    await expect(wapiGetConnectionState(CONFIG)).rejects.toThrow(WApiContractPendingError);
  });
});

describe('resolveWApiConfig', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('sem as três variáveis obrigatórias: null, nunca um config pela metade', () => {
    delete process.env.WAPI_BASE_URL;
    delete process.env.WAPI_INSTANCE_ID;
    delete process.env.WAPI_TOKEN;
    expect(resolveWApiConfig()).toBeNull();
  });

  it('com as três presentes: monta o config, webhookSecret opcional', () => {
    process.env.WAPI_BASE_URL = 'https://api.w-api.app';
    process.env.WAPI_INSTANCE_ID = 'AQDBQK-DTYTRZ-DXEMU9';
    process.env.WAPI_TOKEN = 'tok';
    delete process.env.WAPI_WEBHOOK_SECRET;
    expect(resolveWApiConfig()).toEqual({ baseUrl: 'https://api.w-api.app', instanceId: 'AQDBQK-DTYTRZ-DXEMU9', token: 'tok', webhookSecret: undefined });
  });
});
