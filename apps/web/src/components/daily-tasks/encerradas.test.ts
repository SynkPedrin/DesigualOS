import { describe, expect, it } from 'vitest';
import { rotuloDoDia } from './encerradas';

describe('rotuloDoDia (histórico de encerradas)', () => {
  const agora = new Date(2026, 9, 28, 15, 0);
  it('hoje e ontem pelo dia do calendário, não por 24 h', () => {
    expect(rotuloDoDia(new Date(2026, 9, 28, 0, 5).toISOString(), agora)).toBe('Hoje');
    expect(rotuloDoDia(new Date(2026, 9, 27, 23, 55).toISOString(), agora)).toBe('Ontem');
  });
  it('antes disso, dia da semana e data; o ano só quando não é o atual', () => {
    expect(rotuloDoDia(new Date(2026, 9, 21, 10).toISOString(), agora)).toBe('quarta-feira, 21 de outubro');
    expect(rotuloDoDia(new Date(2025, 11, 30, 10).toISOString(), agora)).toBe('terça-feira, 30 de dezembro de 2025');
  });
});
