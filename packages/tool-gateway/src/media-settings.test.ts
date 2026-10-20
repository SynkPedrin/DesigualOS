import { describe, expect, it } from 'vitest';
import { resolveMediaSettings, MEDIA_SETTING_DEFS } from './media-settings';

const row = (key: string, value: unknown, clientId: string | null = null, accountKey: string | null = null) => ({ clientId, accountKey, key, value });

describe('resolveMediaSettings — precedência', () => {
  it('sem linhas devolve os padrões e diz que são padrão', () => {
    const r = resolveMediaSettings([]);
    expect(r.values['dashboard.defaultPeriod']).toBe(MEDIA_SETTING_DEFS['dashboard.defaultPeriod'].default);
    expect(r.source['dashboard.defaultPeriod']).toBe('default');
    expect(r.values['whatsapp.sendEnabled']).toBe(false);
  });

  it('conta vence cliente vence organização', () => {
    const r = resolveMediaSettings([
      row('alerts.defaultCooldownHours', 24),
      row('alerts.defaultCooldownHours', 12, 'c1'),
      row('alerts.defaultCooldownHours', 6, 'c1', 'meta:act_1'),
    ]);
    expect(r.values['alerts.defaultCooldownHours']).toBe(6);
    expect(r.source['alerts.defaultCooldownHours']).toBe('account');
  });

  it('a ordem das linhas não muda o resultado', () => {
    const a = [row('dashboard.defaultPeriod', 'last_7d'), row('dashboard.defaultPeriod', 'this_month', 'c1')];
    expect(resolveMediaSettings(a).values['dashboard.defaultPeriod']).toBe('this_month');
    expect(resolveMediaSettings([...a].reverse()).values['dashboard.defaultPeriod']).toBe('this_month');
  });

  it('a chave inteira vem de um escopo só, sem mesclar campos', () => {
    const r = resolveMediaSettings([
      row('agent.permissions', { analyze: true, generateReports: true, prepareMessages: true, proposeActions: true }),
      row('agent.permissions', { analyze: true, generateReports: false, prepareMessages: false, proposeActions: false }, 'c1'),
    ]);
    expect(r.values['agent.permissions']).toEqual({ analyze: true, generateReports: false, prepareMessages: false, proposeActions: false });
  });

  it('valor corrompido no banco é ignorado e cai no escopo de baixo', () => {
    const r = resolveMediaSettings([row('dashboard.defaultPeriod', 'last_7d'), row('dashboard.defaultPeriod', 'ontem-de-manha', 'c1')]);
    expect(r.values['dashboard.defaultPeriod']).toBe('last_7d');
    expect(r.source['dashboard.defaultPeriod']).toBe('organization');
  });

  it('agente não propõe ação por padrão', () => {
    expect(resolveMediaSettings([]).values['agent.permissions'].proposeActions).toBe(false);
  });
});
