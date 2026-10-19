import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Operacao } from './db-falso';

const estado = vi.hoisted(() => ({
  conectores: [] as Array<Record<string, unknown>>,
  inseridos: [] as Array<Record<string, unknown>>,
  atualizados: [] as Array<Record<string, unknown>>,
}));

const gw = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({ id: 'sess-uuid', status: 'created', engineLoaded: false })),
  createScopedOperatorKey: vi.fn(async () => ({ id: 'key-1', apiKey: 'owa_k1_escopada' })),
  createWebhook: vi.fn(async () => ({ id: 'wh-1' })),
  updateWebhook: vi.fn(async () => undefined),
  getSession: vi.fn(async () => ({ id: 'sess-uuid', status: 'created', engineLoaded: false })),
  startSession: vi.fn(async () => ({ id: 'sess-uuid', status: 'initializing', engineLoaded: true })),
}));

vi.mock('@desigual-os/database', async () => {
  process.env.DATABASE_URL ??= 'postgres://t:t@127.0.0.1:1/t';
  const real = await vi.importActual<typeof import('@desigual-os/database')>('@desigual-os/database');
  const { dbFalso } = await import('./db-falso');
  return {
    ...real,
    db: dbFalso((op: Operacao) => {
      if (op === 'select') return estado.conectores;
      return [];
    }),
  };
});

vi.mock('@desigual-os/tool-gateway', async () => {
  const real = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  class OpenwaGatewayClient {
    constructor(public cfg: unknown) {}
    getSession = gw.getSession;
    startSession = gw.startSession;
    createWebhook = gw.createWebhook;
    updateWebhook = gw.updateWebhook;
  }
  return {
    ...real,
    OpenwaGatewayClient,
    openwaAdminClient: () => ({
      createSession: gw.createSession,
      createScopedOperatorKey: gw.createScopedOperatorKey,
    }),
    openwaBaseUrl: () => 'http://127.0.0.1:2785',
    encryptToken: (v: string) => `enc(${v})`,
    decryptToken: (v: string) => v.replace(/^enc\((.*)\)$/, '$1'),
  };
});

const prov = await import('./provisioning');

const ENV_BASE = { OPENWA_WEBHOOK_URL: 'https://api.citavel.ai/openwa/webhook' } as NodeJS.ProcessEnv;

function linhaDoPainel(extra: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    organizationId: 'org-1',
    provider: 'bento_whatsapp',
    status: 'ativa',
    credentials: {
      sessionId: 'sess-uuid',
      sessionName: 'bento-ab12',
      apiKeyId: 'key-1',
      apiKeyEncrypted: 'enc(owa_k1_escopada)',
      webhookSecretEncrypted: 'enc(segredo)',
      webhookId: 'wh-1',
      webhookUrl: 'https://api.citavel.ai/bento-whatsapp/webhook',
      botPhone: null,
    },
    ...extra,
  };
}

beforeEach(() => {
  prov.esquecerConfiguracaoEmCache();
  estado.conectores = [];
});
afterEach(() => vi.clearAllMocks());

describe('URL do webhook do Bento', () => {
  it('segue a URL do Inbox trocando só o caminho', () => {
    expect(prov.urlDoWebhookDoBento(ENV_BASE)).toBe('https://api.citavel.ai/bento-whatsapp/webhook');
  });
  it('cai para API_PUBLIC_URL, e a explícita vence', () => {
    expect(prov.urlDoWebhookDoBento({ API_PUBLIC_URL: 'https://api.x.com/' } as NodeJS.ProcessEnv)).toBe('https://api.x.com/bento-whatsapp/webhook');
    expect(
      prov.urlDoWebhookDoBento({ ...ENV_BASE, BENTO_WHATSAPP_WEBHOOK_URL: 'https://outra/hook' } as NodeJS.ProcessEnv),
    ).toBe('https://outra/hook');
    expect(prov.urlDoWebhookDoBento({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('configuração que vale agora', () => {
  it('sem env e sem linha: desligado, origem "nenhuma", número do Bento já conhecido', async () => {
    const r = await prov.resolverConfiguracao({} as NodeJS.ProcessEnv);
    expect(r.origem).toBe('nenhuma');
    expect(r.config.enabled).toBe(false);
    expect(r.config.botPhone).toBe('5518997987295');
  });

  it('linha do painel ativa liga o canal com a sessão e as credenciais dela (decifradas)', async () => {
    estado.conectores = [linhaDoPainel()];
    const r = await prov.resolverConfiguracao({ OPENWA_BASE_URL: 'http://127.0.0.1:2785' } as NodeJS.ProcessEnv);
    expect(r.origem).toBe('painel');
    expect(r.config).toMatchObject({
      enabled: true,
      sessionId: 'sess-uuid',
      openwaApiKey: 'owa_k1_escopada',
      webhookSecret: 'segredo',
      openwaBaseUrl: 'http://127.0.0.1:2785',
    });
  });

  it('linha desativada no painel: canal desligado', async () => {
    estado.conectores = [linhaDoPainel({ status: 'desativada' })];
    const r = await prov.resolverConfiguracao({} as NodeJS.ProcessEnv);
    expect(r.config.enabled).toBe(false);
  });

  it('BENTO_WHATSAPP_ENABLED=false é a chave geral: vence o painel', async () => {
    estado.conectores = [linhaDoPainel()];
    const r = await prov.resolverConfiguracao({ BENTO_WHATSAPP_ENABLED: 'false' } as NodeJS.ProcessEnv);
    expect(r.config.enabled).toBe(false);
  });

  it('variáveis de ambiente completas têm precedência sobre o painel', async () => {
    estado.conectores = [linhaDoPainel()];
    const r = await prov.resolverConfiguracao({
      BENTO_WHATSAPP_ENABLED: 'true',
      BENTO_WHATSAPP_SESSION_ID: 'sess-env',
      BENTO_WHATSAPP_OPENWA_API_KEY: 'k',
      BENTO_WHATSAPP_WEBHOOK_SECRET: 's'.repeat(20),
      BENTO_WHATSAPP_OPENWA_URL: 'http://openwa:2785',
    } as NodeJS.ProcessEnv);
    expect(r.origem).toBe('env');
    expect(r.config.sessionId).toBe('sess-env');
  });

  it('capacidade total por padrão: roteamento AUTO e documentos ligados; transcrição liga com a credencial OpenAI', async () => {
    const sem = await prov.resolverConfiguracao({} as NodeJS.ProcessEnv);
    expect(sem.config).toMatchObject({ agentHint: 'AUTO', documentsEnabled: true, transcriptionProvider: 'none' });
    prov.esquecerConfiguracaoEmCache();
    const com = await prov.resolverConfiguracao({ OPENAI_API_KEY: 'sk-x' } as NodeJS.ProcessEnv);
    expect(com.config.transcriptionProvider).toBe('openai');
    prov.esquecerConfiguracaoEmCache();
    const desligada = await prov.resolverConfiguracao({ OPENAI_API_KEY: 'sk-x', BENTO_WHATSAPP_TRANSCRIPTION: 'none' } as NodeJS.ProcessEnv);
    expect(desligada.config.transcriptionProvider).toBe('none');
  });
});

describe('provisionamento', () => {
  const salvo = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, ENV_BASE);
  });
  afterEach(() => {
    process.env = { ...salvo };
  });

  it('primeira vez: cria sessão, chave escopada à sessão, webhook com segredo próprio e inicia', async () => {
    const r = await prov.provisionarSessaoDoBento({ organizationId: 'org-1' });
    expect(r).toEqual({ criada: true, status: 'initializing', sessionId: 'sess-uuid' });
    expect(gw.createSession).toHaveBeenCalledTimes(1);
    expect(gw.createScopedOperatorKey).toHaveBeenCalledWith(expect.stringMatching(/^bento-/), 'sess-uuid');
    expect(gw.createWebhook).toHaveBeenCalledWith({
      url: 'https://api.citavel.ai/bento-whatsapp/webhook',
      secret: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(gw.startSession).toHaveBeenCalledTimes(1);
  });

  it('repetir NÃO cria segunda sessão: re-registra o webhook e reinicia se estiver parada', async () => {
    estado.conectores = [linhaDoPainel()];
    const r = await prov.provisionarSessaoDoBento({ organizationId: 'org-1' });
    expect(r.criada).toBe(false);
    expect(gw.createSession).not.toHaveBeenCalled();
    expect(gw.createScopedOperatorKey).not.toHaveBeenCalled();
    expect(gw.updateWebhook).toHaveBeenCalledWith('wh-1', { url: 'https://api.citavel.ai/bento-whatsapp/webhook', secret: 'segredo' });
    expect(gw.startSession).toHaveBeenCalledTimes(1);
  });

  it('sessão já pronta não é reiniciada (não derruba o número conectado)', async () => {
    estado.conectores = [linhaDoPainel()];
    gw.getSession.mockResolvedValueOnce({ id: 'sess-uuid', status: 'ready', engineLoaded: true });
    await prov.provisionarSessaoDoBento({ organizationId: 'org-1' });
    expect(gw.startSession).not.toHaveBeenCalled();
  });

  it('sessão apagada no OpenWA (404): recria do zero em vez de ficar presa', async () => {
    estado.conectores = [linhaDoPainel()];
    const { OpenwaGatewayError } = await import('@desigual-os/tool-gateway');
    gw.getSession.mockRejectedValueOnce(new OpenwaGatewayError('not found', 404));
    const r = await prov.provisionarSessaoDoBento({ organizationId: 'org-1' });
    expect(r.criada).toBe(true);
    expect(gw.createSession).toHaveBeenCalledTimes(1);
  });

  it('OpenWA fora do ar (rede): propaga o erro, não recria sessão', async () => {
    estado.conectores = [linhaDoPainel()];
    const { OpenwaGatewayError } = await import('@desigual-os/tool-gateway');
    gw.getSession.mockRejectedValueOnce(new OpenwaGatewayError('down', null, 'NETWORK', true));
    await expect(prov.provisionarSessaoDoBento({ organizationId: 'org-1' })).rejects.toThrow('down');
    expect(gw.createSession).not.toHaveBeenCalled();
  });

  it('sem URL pública para o webhook: recusa com explicação', async () => {
    delete process.env.OPENWA_WEBHOOK_URL;
    delete process.env.API_PUBLIC_URL;
    delete process.env.BENTO_WHATSAPP_WEBHOOK_URL;
    await expect(prov.provisionarSessaoDoBento({ organizationId: 'org-1' })).rejects.toThrow(/OPENWA_WEBHOOK_URL/);
    expect(gw.createSession).not.toHaveBeenCalled();
  });
});

describe('modo teste aberto: prazo', () => {
  const comModoAberto = (ate: Date) =>
    linhaDoPainel({ credentials: { ...linhaDoPainel().credentials, modoAberto: { userId: 'u-pedro', ate: ate.toISOString() } } });

  it('vigente aparece na configuração; vencido some sozinho', async () => {
    estado.conectores = [comModoAberto(new Date(Date.now() + 10 * 60_000))];
    const vigente = await prov.resolverConfiguracao({} as NodeJS.ProcessEnv);
    expect(vigente.config.modoAberto?.userId).toBe('u-pedro');
    prov.esquecerConfiguracaoEmCache();
    estado.conectores = [comModoAberto(new Date(Date.now() - 1_000))];
    const vencido = await prov.resolverConfiguracao({} as NodeJS.ProcessEnv);
    expect(vencido.config.modoAberto).toBeNull();
  });

  it('nunca passa de 240 min, nunca de 1 min para baixo, e desligar devolve null', async () => {
    estado.conectores = [linhaDoPainel()];
    const longo = (await prov.definirModoAberto({ userId: 'u-pedro', minutos: 99_999 })) as Date;
    expect(longo.getTime() - Date.now()).toBeLessThanOrEqual(240 * 60_000 + 1_000);
    const curto = (await prov.definirModoAberto({ userId: 'u-pedro', minutos: -5 })) as Date;
    expect(curto.getTime() - Date.now()).toBeGreaterThan(0);
    expect(await prov.definirModoAberto({ userId: 'u-pedro', minutos: null })).toBeNull();
  });

  it('sem canal conectado não liga', async () => {
    estado.conectores = [];
    expect(await prov.definirModoAberto({ userId: 'u-pedro', minutos: 30 })).toBe('sem_canal');
  });
});
