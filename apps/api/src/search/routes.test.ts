import { describe, expect, it } from 'vitest';
import { ACCENTED_CHARS, PLAIN_CHARS } from './routes';

/**
 * A busca inteira depende de `translate(coluna, ACCENTED, PLAIN)` no Postgres.
 * `translate()` não reclama quando as duas listas têm tamanhos diferentes: ele
 * simplesmente APAGA os caracteres que sobram na primeira. Uma letra a mais
 * aqui viraria uma busca devolvendo resultado errado, em silêncio.
 */
describe('normalização de acento da busca', () => {
  it('mantém as duas listas do translate() com o mesmo número de caracteres', () => {
    expect([...PLAIN_CHARS]).toHaveLength([...ACCENTED_CHARS].length);
  });

  it('mapeia cada acentuado para a letra base correspondente', () => {
    const accented = [...ACCENTED_CHARS];
    const plain = [...PLAIN_CHARS];
    const map = new Map(accented.map((char, index) => [char, plain[index]]));

    expect(map.get('á')).toBe('a');
    expect(map.get('ã')).toBe('a');
    expect(map.get('ê')).toBe('e');
    expect(map.get('í')).toBe('i');
    expect(map.get('õ')).toBe('o');
    expect(map.get('ü')).toBe('u');
    expect(map.get('ç')).toBe('c');
    expect(map.get('ñ')).toBe('n');
    expect(map.get('Ê')).toBe('E');
    expect(map.get('Ç')).toBe('C');
  });

  it('cobre os acentos dos nomes reais da carteira (Agência, Painéis, Clínica)', () => {
    const fold = (value: string): string =>
      [...value].map((char) => {
        const index = [...ACCENTED_CHARS].indexOf(char);
        return index === -1 ? char : [...PLAIN_CHARS][index];
      }).join('');

    expect(fold('Agência Desigual')).toBe('Agencia Desigual');
    expect(fold('Sonhar Painéis')).toBe('Sonhar Paineis');
    expect(fold('Clínica Santa Maria')).toBe('Clinica Santa Maria');
  });

  it('não altera caractere sem acento nem curinga de LIKE', () => {
    const untouched = [...'abcxyz0129 -_%\\'];
    for (const char of untouched) {
      expect([...ACCENTED_CHARS]).not.toContain(char);
    }
  });
});
