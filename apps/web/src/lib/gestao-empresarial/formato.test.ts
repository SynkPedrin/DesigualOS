import { describe, expect, it } from 'vitest';
import { centavosDeTexto, centavosParaCampo, formatarCentavos, formatarDia, hojeIso, ValorInvalido } from './formato';

describe('dinheiro em centavos', () => {
  it('lê o que a pessoa digita', () => {
    expect(centavosDeTexto('1.234,56')).toBe(123456);
    expect(centavosDeTexto('R$ 1.234,56')).toBe(123456);
    expect(centavosDeTexto('1234.56')).toBe(123456);
    expect(centavosDeTexto('12,5')).toBe(1250);
    expect(centavosDeTexto('12')).toBe(1200);
    expect(centavosDeTexto('0,05')).toBe(5);
    expect(centavosDeTexto('-10,00')).toBe(-1000);
  });
  it('a multiplicação por 100 que erra não é usada: 19,90 e 1,15 dão centavos exatos', () => {
    expect(19.9 * 100).not.toBe(1990);
    expect(centavosDeTexto('19,90')).toBe(1990);
    expect(centavosDeTexto('1,15')).toBe(115);
    expect(centavosDeTexto('0,29')).toBe(29);
  });
  it('recusa o que não é dinheiro', () => {
    for (const ruim of ['', '  ', 'abc', '12,3x', '1,2,3x', 'R$']) expect(() => centavosDeTexto(ruim)).toThrow(ValorInvalido);
  });
  it('formata igual em qualquer máquina', () => {
    expect(formatarCentavos(123456)).toBe('R$ 1.234,56');
    expect(formatarCentavos(5)).toBe('R$ 0,05');
    expect(formatarCentavos(-100000)).toBe('-R$ 1.000,00');
    expect(formatarCentavos(0)).toBe('R$ 0,00');
    expect(formatarCentavos(100000000)).toBe('R$ 1.000.000,00');
  });
  it('ida e volta pelo campo de edição não perde centavo', () => {
    for (const c of [0, 5, 99, 100, 123456, 100000001, -2550]) expect(centavosDeTexto(centavosParaCampo(c))).toBe(c);
  });
});

describe('datas como dia', () => {
  it('reordena sem passar por Date (nenhum dia a menos no fuso do Brasil)', () => {
    expect(formatarDia('2026-10-22')).toBe('22/10/2026');
    expect(formatarDia('2026-01-01')).toBe('01/01/2026');
    expect(formatarDia('2026-10-22T03:00:00.000Z')).toBe('22/10/2026');
    expect(formatarDia(null)).toBe('');
    expect(formatarDia(undefined)).toBe('');
  });
  it('"hoje" é o dia de São Paulo, não o do UTC', () => {
    expect(hojeIso(new Date('2026-10-23T01:30:00Z'))).toBe('2026-10-22');
    expect(hojeIso(new Date('2026-10-22T12:00:00Z'))).toBe('2026-10-22');
  });
});
