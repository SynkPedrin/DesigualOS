import { describe, expect, it } from 'vitest';
import { buildInternalAlertMessage, buildInternalReportMessage, saudacao, type InternalAlertInput } from './media-internal-messages';

const base: InternalAlertInput = {
  recipientName: 'Pessoa Teste',
  now: new Date('2026-10-22T17:00:00Z'), // 14:00 em Brasília
  type: 'low_balance',
  severity: 'warning',
  title: 'Saldo em R$ 85,00',
  clientName: 'Cliente Exemplo',
  platform: 'meta',
  accountName: 'Conta Principal',
  currency: 'BRL',
  spend: 1200,
  results: 34,
  detail: { balanceKind: 'ACTUAL_BALANCE', balance: 85, threshold: 100 },
  link: 'https://app.exemplo.com/midias/abc',
};

describe('saudação pelo horário de Brasília', () => {
  it.each([
    ['2026-10-22T08:00:00Z', 'Bom dia'], // 05:00
    ['2026-10-22T14:59:00Z', 'Bom dia'], // 11:59
    ['2026-10-22T15:00:00Z', 'Boa tarde'], // 12:00
    ['2026-10-22T20:59:00Z', 'Boa tarde'], // 17:59
    ['2026-10-22T21:00:00Z', 'Boa noite'], // 18:00
    ['2026-10-22T06:00:00Z', 'Boa noite'], // 03:00
  ])('%s => %s', (iso, esperado) => {
    expect(saudacao(new Date(iso))).toBe(esperado);
  });
});

describe('mensagem interna de alerta', () => {
  it('é pessoal: nome, saudação, gravidade, cliente, conta e próximo passo', () => {
    const m = buildInternalAlertMessage(base);
    expect(m).toContain('Boa tarde, Pessoa Teste!');
    expect(m).toContain('🟠 *Atenção*');
    expect(m).toContain('💸 *Saldo em R$ 85,00*');
    expect(m).toContain('📘 Cliente Exemplo · Meta Ads');
    expect(m).toContain('🧾 Conta: Conta Principal');
    expect(m).toContain('🎯 Alerta configurado para');
    expect(m).toContain('recarregar');
    expect(m).toContain('🔗 https://app.exemplo.com/midias/abc');
    expect(m).toContain('_Bento · Desigual OS_');
  });

  it('crítico muda o tom e o emoji', () => {
    const m = buildInternalAlertMessage({ ...base, severity: 'critical' });
    expect(m).toContain('🔴 *URGENTE*');
    expect(m).toContain('pede ação agora');
  });

  it('saldo ESTIMADO diz que é estimativa, nunca como saldo da conta', () => {
    const m = buildInternalAlertMessage({ ...base, title: 'Restante do limite de gastos (estimado) em R$ 85,00', detail: { balanceKind: 'ESTIMATED_REMAINING', threshold: 100 } });
    expect(m).toContain('estimado');
    expect(m).toContain('não é o saldo real da conta');
    const real = buildInternalAlertMessage(base);
    expect(real).not.toContain('não é o saldo real');
  });

  it('linha só existe quando o dado existe: nada de R$ 0,00 nem "undefined"', () => {
    const m = buildInternalAlertMessage({ ...base, type: 'cpl_above', title: 'Custo por resultado em R$ 40,00 (limite R$ 25,00)', spend: null, results: null, detail: {} });
    expect(m).not.toContain('Investido no período');
    expect(m).not.toContain('Resultados no período');
    expect(m).not.toMatch(/undefined|null|NaN|R\$ 0,00/);
  });

  it('campanhas pausadas ou reprovadas viram lista, com corte em cinco', () => {
    const m = buildInternalAlertMessage({ ...base, type: 'campaign_paused', title: '7 campanha(s) que gastavam pararam', campaigns: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
    expect(m).toContain('• A');
    expect(m).toContain('• E');
    expect(m).not.toContain('• F');
    expect(m).toContain('• e mais 2');
  });

  it('cada tipo tem emoji e próximo passo próprios', () => {
    const tipos = ['low_balance', 'budget_limit', 'cpl_above', 'cpa_above', 'leads_drop', 'campaign_paused', 'campaign_rejected', 'sync_failed', 'account_inactive'];
    const emojis = new Set<string>();
    for (const type of tipos) {
      const m = buildInternalAlertMessage({ ...base, type, detail: { error: 'timeout' } });
      expect(m).toContain('👉');
      emojis.add(m.split('\n\n')[1]!.slice(0, 2));
    }
    expect(emojis.size).toBeGreaterThanOrEqual(7);
  });

  it('plataforma Google tem o próprio emoji e nome', () => {
    expect(buildInternalAlertMessage({ ...base, platform: 'google' })).toContain('🔎 Cliente Exemplo · Google Ads');
  });

  it('sem link conhecido, não há linha de link', () => {
    expect(buildInternalAlertMessage({ ...base, link: null })).not.toContain('🔗');
  });

  it('nunca usa travessão (regra de texto de produto)', () => {
    for (const type of ['low_balance', 'budget_limit', 'cpl_above', 'campaign_paused', 'sync_failed']) {
      const m = buildInternalAlertMessage({ ...base, type, campaigns: ['Campanha X'], detail: { error: 'falha' } });
      expect(m).not.toMatch(/[—–]/);
    }
    expect(buildInternalReportMessage({ recipientName: 'Pessoa Teste', now: base.now, clientName: 'Cliente Exemplo', periodLabel: '15/10 a 21/10', url: 'https://x.exemplo/r.pdf' })).not.toMatch(/[—–]/);
  });

  it('aviso de relatório pronto traz cliente, período e o link', () => {
    const m = buildInternalReportMessage({ recipientName: 'Pessoa Teste', now: base.now, clientName: 'Cliente Exemplo', periodLabel: '15/10 a 21/10', url: 'https://x.exemplo/r.pdf' });
    expect(m).toContain('Relatório pronto');
    expect(m).toContain('Cliente Exemplo');
    expect(m).toContain('15/10 a 21/10');
    expect(m).toContain('https://x.exemplo/r.pdf');
  });
});
