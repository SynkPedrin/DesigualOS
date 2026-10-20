import { describe, expect, it } from 'vitest';
import { dedupeKeyFor, evaluateRule, withinSendWindow, type AlertFacts } from './media-alerts';
import { deriveMetrics } from './media-metrics';

const t = (o: Partial<Parameters<typeof deriveMetrics>[0]>) => deriveMetrics({ spend: null, impressions: null, reach: null, clicks: null, results: null, conversionValue: null, ...o });

function facts(over: Partial<AlertFacts> = {}, account: Partial<AlertFacts['account']> = {}): AlertFacts {
  return {
    account: { accountId: 'act_1', name: 'Conta', currency: 'BRL', status: 'ACTIVE', balanceKind: 'UNAVAILABLE', balanceAmount: null, spendCap: null, lastSyncError: null, ...account },
    amountSpent: null,
    window: { current: t({}), previous: t({}), resultKinds: [] },
    stoppedCampaigns: [],
    rejectedCampaigns: [],
    ...over,
  };
}

describe('saldo baixo', () => {
  it('saldo indisponível NUNCA dispara: não se inventa valor financeiro', () => {
    expect(evaluateRule({ type: 'low_balance', threshold: 100 }, facts())).toEqual({ fire: false, reason: 'saldo_indisponivel' });
  });
  it('estimativa dispara e o título diz que é estimada', () => {
    const r = evaluateRule({ type: 'low_balance', threshold: 100 }, facts({}, { balanceKind: 'ESTIMATED_REMAINING', balanceAmount: 80 }));
    expect(r.fire).toBe(true);
    if (r.fire) expect(r.title).toMatch(/estimado/i);
  });
  it('saldo real não diz "estimado"', () => {
    const r = evaluateRule({ type: 'low_balance', threshold: 100 }, facts({}, { balanceKind: 'ACTUAL_BALANCE', balanceAmount: 30 }));
    expect(r.fire && r.title).not.toMatch(/estimado/i);
    expect(r.fire && r.severity).toBe('critical');
  });
  it('acima do limite não dispara', () => {
    expect(evaluateRule({ type: 'low_balance', threshold: 100 }, facts({}, { balanceKind: 'ESTIMATED_REMAINING', balanceAmount: 500 })).fire).toBe(false);
  });
});

describe('demais regras', () => {
  it('limite de gastos a 90% dispara com o percentual', () => {
    const r = evaluateRule({ type: 'budget_limit', threshold: 80 }, facts({ amountSpent: 900 }, { spendCap: 1000 }));
    expect(r.fire && r.detail.percent).toBe(90);
  });
  it('sem limite de gastos configurado, nada a avaliar', () => {
    expect(evaluateRule({ type: 'budget_limit', threshold: 80 }, facts({ amountSpent: 900 })).fire).toBe(false);
  });
  it('CPL acima do limite dispara; sem resultados não dispara', () => {
    const alto = facts({ window: { current: t({ spend: 300, results: 10 }), previous: t({}), resultKinds: ['lead'] } });
    expect(evaluateRule({ type: 'cpl_above', threshold: 20 }, alto).fire).toBe(true);
    const zero = facts({ window: { current: t({ spend: 300, results: 0 }), previous: t({}), resultKinds: [] } });
    expect(evaluateRule({ type: 'cpl_above', threshold: 20 }, zero)).toEqual({ fire: false, reason: 'sem_resultados_no_periodo' });
  });
  it('queda de resultados compara com o período anterior', () => {
    const f = facts({ window: { current: t({ results: 4 }), previous: t({ results: 10 }), resultKinds: ['lead'] } });
    expect(evaluateRule({ type: 'leads_drop', threshold: 30 }, f).fire).toBe(true);
    const sem = facts({ window: { current: t({ results: 4 }), previous: t({ results: 0 }), resultKinds: [] } });
    expect(evaluateRule({ type: 'leads_drop', threshold: 30 }, sem)).toEqual({ fire: false, reason: 'sem_base_de_comparacao' });
  });
  it('campanha reprovada, falha de sync e conta inativa', () => {
    expect(evaluateRule({ type: 'campaign_rejected', threshold: null }, facts({ rejectedCampaigns: ['X'] })).fire).toBe(true);
    expect(evaluateRule({ type: 'sync_failed', threshold: null }, facts({}, { lastSyncError: 'boom' })).fire).toBe(true);
    expect(evaluateRule({ type: 'account_inactive', threshold: null }, facts({}, { status: 'DISABLED' })).fire).toBe(true);
    expect(evaluateRule({ type: 'account_inactive', threshold: null }, facts()).fire).toBe(false);
  });
  it('tipo desconhecido não dispara', () => {
    expect(evaluateRule({ type: 'xpto', threshold: 1 }, facts())).toEqual({ fire: false, reason: 'tipo_desconhecido' });
  });
});

describe('deduplicação e horário', () => {
  it('duas execuções na mesma janela de cooldown geram a mesma chave', () => {
    const a = dedupeKeyFor('r1', 24, new Date('2026-10-20T10:00:00Z'));
    const b = dedupeKeyFor('r1', 24, new Date('2026-10-20T10:15:00Z'));
    expect(a).toBe(b);
  });
  it('janela seguinte gera chave nova; regra diferente também', () => {
    expect(dedupeKeyFor('r1', 24, new Date('2026-10-20T10:00:00Z'))).not.toBe(dedupeKeyFor('r1', 24, new Date('2026-10-22T10:00:00Z')));
    expect(dedupeKeyFor('r1', 24, new Date('2026-10-20T10:00:00Z'))).not.toBe(dedupeKeyFor('r2', 24, new Date('2026-10-20T10:00:00Z')));
  });
  it('horário permitido usa Brasília', () => {
    const w = { start: '08:00', end: '20:00' };
    expect(withinSendWindow(w, new Date('2026-10-20T15:00:00Z'))).toBe(true); // 12h BRT
    expect(withinSendWindow(w, new Date('2026-10-20T03:00:00Z'))).toBe(false); // 00h BRT
    expect(withinSendWindow(null, new Date())).toBe(true);
  });
});
