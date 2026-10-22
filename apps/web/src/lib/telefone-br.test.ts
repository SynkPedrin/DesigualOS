import { describe, expect, it } from 'vitest';
import { normalizarTelefoneBr, telefoneBrLegivel } from './telefone-br';

describe('telefone brasileiro', () => {
  it.each([
    ['(11) 90000-0001', '5511900000001'],
    ['11 90000-0001', '5511900000001'],
    ['+55 11 90000-0001', '5511900000001'],
    ['5511900000001', '5511900000001'],
    ['11 3000-0001', '551130000001'],
    ['(18) 99999-9999', '5518999999999'],
  ])('%s => %s', (entrada, esperado) => {
    expect(normalizarTelefoneBr(entrada)).toBe(esperado);
  });

  it.each(['', 'abc', '900000001', '5511', '+1 415 555 2671', '55119000000011', '0011900000001', '(10) 90000-0001', '(11) 80000-0001', '+44 20 7946 0958'])('recusa o que não dá para ter certeza: %j', (entrada) => {
    expect(normalizarTelefoneBr(entrada)).toBeNull();
  });

  it('exibe de forma legível', () => {
    expect(telefoneBrLegivel('5511900000001')).toBe('+55 11 90000-0001');
    expect(telefoneBrLegivel('551130000001')).toBe('+55 11 3000-0001');
    expect(telefoneBrLegivel('14155552671')).toBe('+14155552671');
  });
});
