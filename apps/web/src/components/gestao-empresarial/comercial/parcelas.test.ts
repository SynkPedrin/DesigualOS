import { describe, expect, it } from 'vitest';
import { previaDasParcelas } from './parcelas';

describe('prévia das parcelas', () => {
  it('soma exatamente o total, com a sobra nas primeiras', () => {
    const p = previaDasParcelas(10000, 3, '2099-01-31');
    expect(p.map((x) => x.valor)).toEqual([3334, 3333, 3333]);
    expect(p.reduce((s, x) => s + x.valor, 0)).toBe(10000);
  });
  it('mês curto cai no último dia e mantém o dia depois', () => {
    expect(previaDasParcelas(9000, 3, '2099-01-31').map((x) => x.vencimento)).toEqual(['2099-01-31', '2099-02-28', '2099-03-31']);
    expect(previaDasParcelas(9000, 2, '2024-01-31').map((x) => x.vencimento)).toEqual(['2024-01-31', '2024-02-29']);
  });
  it('entrada impossível não gera prévia', () => {
    expect(previaDasParcelas(10, 0, '2099-01-31')).toEqual([]);
    expect(previaDasParcelas(2, 5, '2099-01-31')).toEqual([]);
    expect(previaDasParcelas(100, 2, 'amanhã')).toEqual([]);
  });
});
