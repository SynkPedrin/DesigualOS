import { describe, expect, it } from 'vitest';
import { checkConflict, findCommonAvailability, freeSlotsFor, mergeIntervals } from './availability';

/**
 * §72 do prompt "CALENDAR + AUTOMATIONS + BENTO V2": unit tests de
 * availability/conflito/timezone, puros — sem banco, sem Google, sem LLM.
 * É a prova de que "9h está livre" sempre vem de um cálculo, nunca de um
 * palpite (§34).
 */
function d(diaISO: string, hora: number, minuto = 0): Date {
  const data = new Date(`${diaISO}T00:00:00-03:00`);
  data.setHours(data.getHours() + hora, minuto);
  return data;
}

describe('mergeIntervals', () => {
  it('funde dois blocos sobrepostos da mesma pessoa num só', () => {
    const fundido = mergeIntervals([
      { start: d('2026-10-06', 9), end: d('2026-10-06', 10), hard: true },
      { start: d('2026-10-06', 9, 30), end: d('2026-10-06', 10, 30), hard: true },
    ]);
    expect(fundido).toHaveLength(1);
    expect(fundido[0]).toMatchObject({ start: d('2026-10-06', 9), end: d('2026-10-06', 10, 30) });
  });

  it('mantém blocos separados quando não se tocam', () => {
    const fundido = mergeIntervals([
      { start: d('2026-10-06', 9), end: d('2026-10-06', 10), hard: true },
      { start: d('2026-10-06', 14), end: d('2026-10-06', 15), hard: true },
    ]);
    expect(fundido).toHaveLength(2);
  });
});

describe('checkConflict — hard vs soft (§20)', () => {
  const ocupadoObrigatorio = [{ start: d('2026-10-06', 9), end: d('2026-10-06', 10), hard: true }];
  const ocupadoOpcional = [{ start: d('2026-10-06', 9), end: d('2026-10-06', 10), hard: false }];

  it('detecta conflito quando os intervalos se sobrepõem', () => {
    const resultado = checkConflict(ocupadoObrigatorio, d('2026-10-06', 9, 30), d('2026-10-06', 10, 30));
    expect(resultado.conflict).toBe(true);
    expect(resultado.hard).toBe(true);
    expect(resultado.busySlot).toEqual({ start: d('2026-10-06', 9), end: d('2026-10-06', 10) });
  });

  it('participante opcional é conflito SOFT, não bloqueia por padrão', () => {
    const resultado = checkConflict(ocupadoOpcional, d('2026-10-06', 9, 30), d('2026-10-06', 10, 30));
    expect(resultado.conflict).toBe(true);
    expect(resultado.hard).toBe(false);
  });

  it('sem overlap nenhum, sem conflito', () => {
    const resultado = checkConflict(ocupadoObrigatorio, d('2026-10-06', 10), d('2026-10-06', 11));
    expect(resultado.conflict).toBe(false);
    expect(resultado.busySlot).toBeNull();
  });

  it('encosta exatamente na borda (10h-11h vs ocupado até 10h) não é conflito — semiaberto', () => {
    const resultado = checkConflict(ocupadoObrigatorio, d('2026-10-06', 10), d('2026-10-06', 11));
    expect(resultado.conflict).toBe(false);
  });
});

describe('freeSlotsFor — só HARD define livre/ocupado (§20), deadline nunca entra aqui (§17)', () => {
  it('recorta o expediente ao redor de um compromisso obrigatório', () => {
    const livres = freeSlotsFor(
      [{ start: d('2026-10-06', 9), end: d('2026-10-06', 10), hard: true }],
      d('2026-10-06', 9),
      d('2026-10-06', 18),
      { startHour: 9, endHour: 18 },
      30,
    );
    expect(livres[0]).toMatchObject({ start: d('2026-10-06', 10), end: d('2026-10-06', 18) });
  });

  it('compromisso OPCIONAL não reduz o horário livre', () => {
    const livres = freeSlotsFor(
      [{ start: d('2026-10-06', 9), end: d('2026-10-06', 18), hard: false }],
      d('2026-10-06', 9),
      d('2026-10-06', 18),
      { startHour: 9, endHour: 18 },
      30,
    );
    expect(livres).toEqual([{ start: d('2026-10-06', 9), end: d('2026-10-06', 18) }]);
  });

  it('buraco menor que o grão mínimo não vira sugestão de slot', () => {
    const livres = freeSlotsFor(
      [
        { start: d('2026-10-06', 9), end: d('2026-10-06', 10), hard: true },
        { start: d('2026-10-06', 10, 10), end: d('2026-10-06', 18), hard: true },
      ],
      d('2026-10-06', 9),
      d('2026-10-06', 18),
      { startHour: 9, endHour: 18 },
      30,
    );
    expect(livres).toHaveLength(0); // os 10 minutos entre 10h e 10h10 não cabem num slot de 30min
  });
});

describe('findCommonAvailability — "Bento, marca 30min comigo, Jamille e Alicia" (§21/§33)', () => {
  it('encontra o horário comum quando as agendas se cruzam parcialmente', () => {
    const comuns = findCommonAvailability(
      {
        jamille: [{ start: d('2026-10-06', 9), end: d('2026-10-06', 11), hard: true }],
        alicia: [{ start: d('2026-10-06', 9), end: d('2026-10-06', 11, 30), hard: true }],
      },
      d('2026-10-06', 9),
      d('2026-10-06', 18),
      30,
      { startHour: 9, endHour: 18 },
    );
    // as duas só ficam livres ao mesmo tempo a partir das 11h30 (a mais ocupada das duas)
    expect(comuns[0]?.start).toEqual(d('2026-10-06', 11, 30));
  });

  it('ninguém livre em comum devolve lista vazia, nunca um palpite (§34)', () => {
    const comuns = findCommonAvailability(
      {
        jamille: [{ start: d('2026-10-06', 9), end: d('2026-10-06', 18), hard: true }],
        alicia: [{ start: d('2026-10-06', 9), end: d('2026-10-06', 18), hard: true }],
      },
      d('2026-10-06', 9),
      d('2026-10-06', 18),
      30,
    );
    expect(comuns).toEqual([]);
  });

  it('uma pessoa sem evento nenhum está livre o expediente inteiro', () => {
    const comuns = findCommonAvailability({ gui: [] }, d('2026-10-06', 9), d('2026-10-06', 10), 30);
    expect(comuns).toEqual([{ start: d('2026-10-06', 9), end: d('2026-10-06', 9, 30) }]);
  });
});
