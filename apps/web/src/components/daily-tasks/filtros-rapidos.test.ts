import { describe, expect, it } from 'vitest';
import { janelaDoPrazo, rotuloDoPeriodo } from './filtros-rapidos';

// 29/10/2026 às 22h de São Paulo = já 30/10 em UTC: o dia que vale é o de São Paulo.
const agora = new Date('2026-10-30T01:00:00Z');

describe('filtro de prazo do Daily', () => {
  it('hoje e amanhã são dias inteiros de São Paulo', () => {
    expect(janelaDoPrazo('hoje', null, null, agora)).toEqual({ dueFrom: '2026-10-29T03:00:00.000Z', dueTo: '2026-10-30T02:59:59.999Z' });
    expect(janelaDoPrazo('amanha', null, null, agora)).toEqual({ dueFrom: '2026-10-30T03:00:00.000Z', dueTo: '2026-10-31T02:59:59.999Z' });
  });

  it('atrasadas: tudo que venceu antes de hoje, só as abertas', () => {
    expect(janelaDoPrazo('atrasadas', null, null, agora)).toEqual({ dueTo: '2026-10-29T02:59:59.999Z', soAbertas: true });
  });

  it('próximos 7 dias contam hoje; este mês vai do dia 1 ao último', () => {
    expect(janelaDoPrazo('semana', null, null, agora)).toEqual({ dueFrom: '2026-10-29T03:00:00.000Z', dueTo: '2026-11-05T02:59:59.999Z' });
    expect(janelaDoPrazo('mes', null, null, agora)).toEqual({ dueFrom: '2026-10-01T03:00:00.000Z', dueTo: '2026-11-01T02:59:59.999Z' });
  });

  it('período: de e até inclusivos, ou só um lado', () => {
    expect(janelaDoPrazo('periodo', '2026-11-01', '2026-11-15', agora)).toEqual({ dueFrom: '2026-11-01T03:00:00.000Z', dueTo: '2026-11-16T02:59:59.999Z' });
    expect(janelaDoPrazo('periodo', '2026-11-01', null, agora)).toEqual({ dueFrom: '2026-11-01T03:00:00.000Z' });
    expect(janelaDoPrazo('periodo', null, null, agora)).toEqual({});
    expect(janelaDoPrazo('', null, null, agora)).toEqual({});
  });

  it('rótulo do botão', () => {
    expect(rotuloDoPeriodo('', null, null)).toBe('Prazo');
    expect(rotuloDoPeriodo('atrasadas', null, null)).toBe('Atrasadas');
    expect(rotuloDoPeriodo('periodo', '2026-11-01', '2026-11-15')).toMatch(/^1 nov.* – 15 nov/);
    expect(rotuloDoPeriodo('periodo', null, '2026-11-15')).toMatch(/^até 15 nov/);
  });
});
