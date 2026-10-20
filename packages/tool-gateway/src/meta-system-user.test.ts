import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMetaAdSets,
  getMetaSystemUserConfig,
  inspectMetaToken,
  missingMetaSystemUserVars,
  type MetaSystemUserConfig,
} from './meta-system-user';

const CONFIG: MetaSystemUserConfig = { token: 'SYS-TOKEN', businessId: '999', appId: '111', appSecret: 'sec' };

function stubFetch(body: unknown, status = 200) {
  const mock = vi.fn(async (url: string | URL) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), url: String(url) }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('config do usuário do sistema', () => {
  it('só existe com token E business id', () => {
    expect(getMetaSystemUserConfig({ META_SYSTEM_USER_TOKEN: 't' } as NodeJS.ProcessEnv)).toBeNull();
    expect(getMetaSystemUserConfig({ META_BUSINESS_ID: '1' } as NodeJS.ProcessEnv)).toBeNull();
    expect(getMetaSystemUserConfig({ META_SYSTEM_USER_TOKEN: ' t ', META_BUSINESS_ID: '1' } as NodeJS.ProcessEnv)?.token).toBe('t');
  });

  it('nomeia o que falta', () => {
    expect(missingMetaSystemUserVars({} as NodeJS.ProcessEnv)).toEqual(['META_SYSTEM_USER_TOKEN', 'META_BUSINESS_ID']);
  });
});

describe('inspectMetaToken', () => {
  it('aprova token de usuário do sistema com as duas permissões', async () => {
    const mock = stubFetch({ data: { is_valid: true, type: 'SYSTEM_USER', app_id: '111', expires_at: 0, scopes: ['ads_read', 'business_management', 'ads_management'] } });
    const r = await inspectMetaToken(CONFIG);
    expect(r).toMatchObject({ valid: true, type: 'SYSTEM_USER', missingScopes: [], expiresAt: null });
    // o token do app inspeciona; o token do usuário vai como input_token
    const url = new URL(String(mock.mock.calls[0]![0]));
    expect(url.pathname).toMatch(/debug_token$/);
    expect(url.searchParams.get('input_token')).toBe('SYS-TOKEN');
    expect(url.searchParams.get('access_token')).toBe('111|sec');
  });

  it('aponta permissão faltando', async () => {
    stubFetch({ data: { is_valid: true, type: 'SYSTEM_USER', scopes: ['ads_read'] } });
    expect((await inspectMetaToken(CONFIG)).missingScopes).toEqual(['business_management']);
  });

  it('token revogado vem inválido com o motivo do Meta', async () => {
    stubFetch({ data: { is_valid: false, error: { message: 'Session has expired' } } });
    expect(await inspectMetaToken(CONFIG)).toMatchObject({ valid: false, reason: 'Session has expired' });
  });

  it('sem app configurado cai em /me/permissions', async () => {
    const mock = stubFetch({ data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'business_management', status: 'declined' }] });
    const r = await inspectMetaToken({ ...CONFIG, appId: null, appSecret: null });
    expect(new URL(String(mock.mock.calls[0]![0])).pathname).toMatch(/me\/permissions$/);
    expect(r.missingScopes).toEqual(['business_management']);
  });

  it('erro do Graph não vaza o token na mensagem', async () => {
    stubFetch({ error: { message: 'Invalid OAuth access token' } }, 400);
    const erro = await inspectMetaToken(CONFIG).catch((e: Error) => e);
    expect((erro as Error).message).toContain('Invalid OAuth access token');
    expect((erro as Error).message).not.toContain('SYS-TOKEN');
  });
});

describe('getMetaAdSets', () => {
  it('lê conjuntos com insights numa chamada e ausência vira null', async () => {
    const mock = stubFetch({
      data: [
        { id: 's1', name: 'Conjunto A', status: 'ACTIVE', campaign_id: 'c1', daily_budget: '5000', insights: { data: [{ spend: '12.5', clicks: '10' }] } },
        { id: 's2', name: 'Conjunto B', status: 'PAUSED' },
      ],
    });
    const r = await getMetaAdSets('tok', 'act_1');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(r[0]).toMatchObject({ id: 's1', campaignId: 'c1', dailyBudget: 5000, spend: 12.5, clicks: 10, impressions: null });
    expect(r[1]).toMatchObject({ spend: null, campaignId: null });
  });
});
