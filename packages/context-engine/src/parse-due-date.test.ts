import { describe, expect, it } from 'vitest';
import { parseDataNatural } from './parse-due-date';

// Quinta-feira, 24/09/2026 (local). Sexta é 25/09, próxima segunda é 28/09.
const NOW = new Date('2026-09-24T15:00:00-03:00');

function dia(ms: number | null): string | null {
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('parseDataNatural', () => {
  it('data extensa com e sem ano', () => {
    expect(dia(parseDataNatural('para o dia 28 de setembro de 2026', NOW))).toBe('2026-09-28');
    expect(dia(parseDataNatural('pra 28 de setembro', NOW))).toBe('2026-09-28');
    // já passou sem ano → ano seguinte
    expect(dia(parseDataNatural('pra 10 de janeiro', NOW))).toBe('2027-01-10');
  });

  it('data numérica', () => {
    expect(dia(parseDataNatural('para 28/09/2026', NOW))).toBe('2026-09-28');
    expect(dia(parseDataNatural('pra 28/09', NOW))).toBe('2026-09-28');
  });

  it('dia solto, hoje, amanhã, depois de amanhã', () => {
    expect(dia(parseDataNatural('dia 28', NOW))).toBe('2026-09-28');
    expect(dia(parseDataNatural('dia 05', NOW))).toBe('2026-10-05');
    expect(dia(parseDataNatural('hoje', NOW))).toBe('2026-09-24');
    expect(dia(parseDataNatural('amanhã', NOW))).toBe('2026-09-25');
    expect(dia(parseDataNatural('depois de amanhã', NOW))).toBe('2026-09-26');
  });

  it('dias de semana', () => {
    expect(dia(parseDataNatural('sexta', NOW))).toBe('2026-09-25');
    expect(dia(parseDataNatural('pra sexta-feira', NOW))).toBe('2026-09-25');
    expect(dia(parseDataNatural('próxima segunda', NOW))).toBe('2026-09-28');
    expect(dia(parseDataNatural('semana que vem', NOW))).toBe('2026-09-28');
  });

  it('fim do mês', () => {
    expect(dia(parseDataNatural('fim do mês', NOW))).toBe('2026-09-30');
  });

  it('sem data reconhecível = null (nunca inventa)', () => {
    expect(parseDataNatural('quando der', NOW)).toBeNull();
    expect(parseDataNatural('', NOW)).toBeNull();
  });
});
