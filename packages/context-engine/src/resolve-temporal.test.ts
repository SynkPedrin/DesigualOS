import { describe, expect, it } from 'vitest';
import { OPERATION_TIMEZONE, resolveTemporalRange, zonedDayRange } from './resolve-temporal';

/** Referência fixa: 2026-09-10T01:30:00-03:00 = 2026-09-10T04:30:00Z.
 * Escolhida de propósito DEPOIS da meia-noite local mas ANTES da meia-noite UTC —
 * é exatamente a janela em que usar UTC como se fosse o dia local erra o dia. */
const NOW = new Date('2026-09-10T04:30:00.000Z');

function localDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: OPERATION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function localTime(ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: OPERATION_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

describe('zonedDayRange', () => {
  it('hoje = o dia LOCAL da operação, não o dia UTC', () => {
    const { from, to } = zonedDayRange(NOW, 0);
    expect(localDay(from)).toBe('2026-09-10');
    expect(localDay(to)).toBe('2026-09-10');
    expect(localTime(from)).toBe('00:00');
    expect(localTime(to)).toBe('23:59');
  });

  it('amanhã anda exatamente um dia de calendário local', () => {
    const { from, to } = zonedDayRange(NOW, 1);
    expect(localDay(from)).toBe('2026-09-11');
    expect(localDay(to)).toBe('2026-09-11');
  });

  it('atravessa virada de mês corretamente', () => {
    const fimDoMes = new Date('2026-09-30T20:00:00.000Z'); // 17:00 local
    const { from } = zonedDayRange(fimDoMes, 1);
    expect(localDay(from)).toBe('2026-10-01');
  });

  it('a janela do dia tem ~24h', () => {
    const { from, to } = zonedDayRange(NOW, 1);
    const horas = (to - from) / 3_600_000;
    expect(horas).toBeGreaterThan(23.4);
    expect(horas).toBeLessThan(24.6);
  });
});

describe('resolveTemporalRange', () => {
  it('mensagem sem referência de tempo devolve null (não inventa "hoje")', () => {
    expect(resolveTemporalRange('quais as tasks da 3net?', NOW)).toBeNull();
  });

  it('reconhece amanhã com e sem acento', () => {
    expect(resolveTemporalRange('quantas tasks vencem amanhã?', NOW)?.label).toBe('amanha');
    expect(resolveTemporalRange('o que vence amanha', NOW)?.label).toBe('amanha');
  });

  it('amanhã resolve pelo relógio real, não por conhecimento do modelo', () => {
    const range = resolveTemporalRange('me da o briefing de amanhã', NOW)!;
    expect(localDay(range.from)).toBe('2026-09-11');
  });

  it('hoje, ontem', () => {
    expect(localDay(resolveTemporalRange('o que temos hoje?', NOW)!.from)).toBe('2026-09-10');
    expect(localDay(resolveTemporalRange('o que rolou ontem?', NOW)!.from)).toBe('2026-09-09');
  });

  it('"atrasadas" não é janela de calendário: é tudo que venceu antes de hoje', () => {
    const range = resolveTemporalRange('quantas tasks estão atrasadas?', NOW)!;
    expect(range.label).toBe('atrasadas');
    expect(range.overdue).toBe(true);
    expect(range.from).toBe(0);
    // termina 1ms antes do início de hoje
    expect(localDay(range.to)).toBe('2026-09-09');
  });

  it('"semana passada" tem precedência sobre "semana" solto', () => {
    const range = resolveTemporalRange('como foi a semana passada?', NOW)!;
    expect(range.label).toBe('semana-passada');
    expect(localDay(range.from)).toBe('2026-09-03');
    expect(localDay(range.to)).toBe('2026-09-09');
  });

  it('esta semana = segunda a domingo (padrão de agência BR)', () => {
    // 2026-09-10 local é uma quinta-feira
    const range = resolveTemporalRange('o que temos essa semana?', NOW)!;
    expect(range.label).toBe('esta-semana');
    expect(localDay(range.from)).toBe('2026-09-07'); // segunda
    expect(localDay(range.to)).toBe('2026-09-13'); // domingo
  });

  it('próximos 7 dias começa amanhã, últimos 7 dias termina hoje', () => {
    const prox = resolveTemporalRange('o que vence nos proximos 7 dias?', NOW)!;
    expect(localDay(prox.from)).toBe('2026-09-11');
    expect(localDay(prox.to)).toBe('2026-09-17');

    const ult = resolveTemporalRange('o que entregamos nos últimos 7 dias?', NOW)!;
    expect(localDay(ult.from)).toBe('2026-09-04');
    expect(localDay(ult.to)).toBe('2026-09-10');
  });
});
