import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveBalance, graphGetRetry, graphPaged, normalizeAccount, normalizeEntity, normalizeInsight, pickResult } from './meta-media-graph';

afterEach(() => vi.unstubAllGlobals());

function stubSequence(...responses: Array<{ status: number; body: unknown }>) {
  const mock = vi.fn();
  for (const r of responses) mock.mockResolvedValueOnce({ ok: r.status < 300, status: r.status, json: async () => r.body });
  vi.stubGlobal('fetch', mock);
  return mock;
}
const noSleep = async () => {};

describe('saldo', () => {
  it('sem limite de gastos o saldo é indisponível, nunca zero', () => {
    expect(deriveBalance(null, 5000)).toEqual({ kind: 'UNAVAILABLE', amount: null });
    expect(deriveBalance(0, 5000)).toEqual({ kind: 'UNAVAILABLE', amount: null });
  });
  it('com limite, vira estimativa do que falta e nunca negativa', () => {
    expect(deriveBalance(1000, 400)).toEqual({ kind: 'ESTIMATED_REMAINING', amount: 600 });
    expect(deriveBalance(1000, 1200).amount).toBe(0);
  });
  it('ACTUAL_BALANCE nunca sai da conta lida com este token', () => {
    const a = normalizeAccount({ id: 'act_1', spend_cap: '100000', amount_spent: '25000', balance: '999', account_status: 1 });
    expect(a.balanceKind).toBe('ESTIMATED_REMAINING');
    expect(a.balanceAmount).toBe(750); // centavos → reais; `balance` (dívida) é ignorado
    expect(a.status).toBe('ACTIVE');
  });
});

describe('resultado', () => {
  it('escolhe UM tipo por prioridade e diz qual', () => {
    expect(pickResult([{ action_type: 'link_click', value: '90' }, { action_type: 'lead', value: '7' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }])).toEqual({ value: 7, kind: 'lead' });
  });
  it('só clique não é resultado', () => {
    expect(pickResult([{ action_type: 'link_click', value: '90' }])).toEqual({ value: null, kind: null });
    expect(pickResult(undefined)).toEqual({ value: null, kind: null });
  });
  it('insight sem id ou dia é descartado', () => {
    expect(normalizeInsight('campaign', { spend: '1' })).toBeNull();
    expect(normalizeInsight('campaign', { campaign_id: 'c1', date_start: '2026-10-01', spend: '12.5', impressions: '100' })).toMatchObject({ entityId: 'c1', spend: 12.5, impressions: 100, results: null });
  });
});

describe('entidades', () => {
  it('orçamento do Meta vem em centavos', () => {
    expect(normalizeEntity('campaign', { id: 'c1', name: 'X', daily_budget: '5000' }).dailyBudget).toBe(50);
  });
  it('anúncio carrega criativo e link de destino', () => {
    const e = normalizeEntity('ad', { id: 'a1', name: 'A', adset_id: 's1', creative: { title: 'T', body: 'B', call_to_action_type: 'WHATSAPP_MESSAGE', thumbnail_url: 'https://x/t.jpg', object_story_spec: { link_data: { link: 'https://wa.me/1' } } } });
    expect(e.parentId).toBe('s1');
    expect(e.creative).toMatchObject({ title: 'T', callToAction: 'WHATSAPP_MESSAGE', linkUrl: 'https://wa.me/1', thumbnailUrl: 'https://x/t.jpg' });
  });
});

describe('retry e paginação adaptativa', () => {
  it('repete erro transitório e depois entrega', async () => {
    const mock = stubSequence({ status: 400, body: { error: { message: 'Service temporarily unavailable', code: 2 } } }, { status: 200, body: { ok: true } });
    expect(await graphGetRetry(new URL('https://g/x?access_token=SEGREDO'), { sleep: noSleep })).toEqual({ ok: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('erro permanente não repete e não vaza o token', async () => {
    const mock = stubSequence({ status: 400, body: { error: { message: 'Invalid parameter', code: 100 } } });
    const err = await graphGetRetry(new URL('https://g/x?access_token=SEGREDO'), { sleep: noSleep }).catch((e: Error) => e);
    expect((err as Error).message).toContain('Invalid parameter');
    expect((err as Error).message).not.toContain('SEGREDO');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('"reduza a quantidade de dados" diminui a página e continua do mesmo ponto', async () => {
    const mock = stubSequence(
      { status: 500, body: { error: { message: "Please reduce the amount of data you're asking for, then retry your request", code: 1 } } },
      { status: 500, body: { error: { message: "Please reduce the amount of data you're asking for, then retry your request", code: 1 } } },
      { status: 200, body: { data: [{ id: '1' }], paging: { next: 'x', cursors: { after: 'C1' } } } },
      { status: 200, body: { data: [{ id: '2' }] } },
    );
    const rows = await graphPaged('act_1/ads', { fields: 'id', limit: '100' }, 'tok', 10, { sleep: noSleep, retries: 0 });
    expect(rows.map((r) => r.id)).toEqual(['1', '2']);
    const limits = mock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('limit'));
    expect(limits).toEqual(['100', '50', '25', '25']);
    expect(new URL(String(mock.mock.calls[3]![0])).searchParams.get('after')).toBe('C1');
  });
});

describe('limite de requisições', () => {
  it('não repete em segundos: para e sinaliza rateLimited', async () => {
    const mock = stubSequence({ status: 400, body: { error: { message: 'User request limit reached', code: 17 } } });
    const err = await graphGetRetry(new URL('https://g/x'), { sleep: noSleep }).catch((e) => e);
    expect(err.rateLimited).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
