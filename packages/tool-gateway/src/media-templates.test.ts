import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, formatMoney, renderTemplate, validateTemplate } from './media-templates';

describe('templates de mensagem', () => {
  it('todo template padrão usa só variáveis conhecidas', () => {
    for (const t of DEFAULT_TEMPLATES) expect(validateTemplate(t.body), t.code).toEqual({ ok: true, unknown: [] });
  });
  it('variável desconhecida é recusada, não enviada literal', () => {
    expect(validateTemplate('Saldo {saldoo}')).toEqual({ ok: false, unknown: ['saldoo'] });
    expect(renderTemplate('Saldo {saldoo}', { saldo: 'R$ 1' })).toMatchObject({ ok: false, reason: 'unknown_variables' });
  });
  it('valor ausente bloqueia o envio em vez de virar 0 ou "-"', () => {
    const r = renderTemplate('Saldo de {cliente}: {saldo}', { cliente: 'Rita', saldo: null });
    expect(r).toEqual({ ok: false, reason: 'missing_values', variables: ['saldo'] });
  });
  it('renderiza quando todos os valores existem', () => {
    expect(renderTemplate('{cliente} gastou {investimento}', { cliente: 'Rita', investimento: 'R$ 10,00' })).toEqual({ ok: true, text: 'Rita gastou R$ 10,00' });
  });
  it('template vazio é recusado', () => {
    expect(renderTemplate('   ', {})).toMatchObject({ ok: false, reason: 'empty' });
  });
  it('dinheiro nulo continua nulo e BRL formata em reais', () => {
    expect(formatMoney(null, 'BRL')).toBeNull();
    expect(formatMoney(1234.5, 'BRL')).toContain('1.234,50');
  });
});
