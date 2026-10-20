import { describe, expect, it } from 'vitest';
import { dueKey, isDue, type ScheduleLike } from './media-report-schedules';

const base: ScheduleLike = { frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, hour: 9, timezone: 'America/Sao_Paulo', lastPeriodKey: null, lastRunAt: null };
// 2026-10-19 é segunda-feira. 12:30 UTC = 09:30 em Brasília.
const monday930 = new Date('2026-10-19T12:30:00Z');

describe('vencimento de agendamento', () => {
  it('semanal vence na segunda depois das 9h de Brasília', () => {
    expect(dueKey(base, monday930)).toBe('2026-10-19');
    expect(isDue(base, monday930)).toBe(true);
  });
  it('antes do horário não vence', () => {
    expect(isDue(base, new Date('2026-10-19T11:00:00Z'))).toBe(false); // 08h BRT
  });
  it('em outro dia da semana não vence', () => {
    expect(isDue(base, new Date('2026-10-20T12:30:00Z'))).toBe(false);
  });
  it('o mesmo período não é gerado duas vezes', () => {
    expect(isDue({ ...base, lastPeriodKey: '2026-10-19' }, monday930)).toBe(false);
    expect(isDue({ ...base, lastPeriodKey: '2026-10-12' }, monday930)).toBe(true);
  });
  it('quinzenal respeita o intervalo de 13 dias', () => {
    const q = { ...base, frequency: 'biweekly' };
    expect(isDue({ ...q, lastRunAt: new Date('2026-10-12T12:30:00Z'), lastPeriodKey: '2026-10-12' }, monday930)).toBe(false);
    expect(isDue({ ...q, lastRunAt: new Date('2026-10-05T12:30:00Z'), lastPeriodKey: '2026-10-05' }, monday930)).toBe(true);
  });
  it('mensal vence no dia do mês', () => {
    const m = { ...base, frequency: 'monthly', dayOfWeek: null, dayOfMonth: 19 };
    expect(isDue(m, monday930)).toBe(true);
    expect(isDue({ ...m, dayOfMonth: 20 }, monday930)).toBe(false);
  });
  it('diário vence todo dia, uma vez', () => {
    const d = { ...base, frequency: 'daily', dayOfWeek: null };
    expect(isDue(d, monday930)).toBe(true);
    expect(isDue({ ...d, lastPeriodKey: '2026-10-19' }, monday930)).toBe(false);
  });
  it('frequência desconhecida nunca vence', () => {
    expect(isDue({ ...base, frequency: 'minutely' }, monday930)).toBe(false);
  });
});
