import { describe, expect, it } from 'vitest';
import { contarPorAba, eventoDaAba, pintarAgendas, TODAS } from './cores-das-agendas';

describe('cor de cada agenda do Outlook', () => {
  it('a principal é roxa e se chama Desigual, a da Manada Filmes laranja, outra pega a próxima cor', () => {
    const r = pintarAgendas(
      [{ external_calendar_id: 'ag' }, { external_calendar_id: 'mf' }, { external_calendar_id: 'ou' }],
      [{ id: 'ag', name: 'Calendário', is_default: true }, { id: 'mf', name: 'Manada Filmes', is_default: false }, { id: 'ou', name: 'Feriados', is_default: false }],
    );
    expect(r.map((a) => [a.nome, a.cor.ponto, a.principal])).toEqual([['Desigual', 'bg-roxo-eletrico', true], ['Manada Filmes', 'bg-aviso', false], ['Feriados', 'bg-sinal', false]]);
  });

  it('a principal com nome próprio no Outlook mantém o nome', () => {
    expect(pintarAgendas([{ external_calendar_id: 'ag' }], [{ id: 'ag', name: 'Agência Desigual', is_default: true }])[0]!.nome).toBe('Agência Desigual');
  });

  it('sem a lista da conta ainda (carregando), a primeira vinculada vale como principal', () => {
    expect(pintarAgendas([{ external_calendar_id: 'x' }], []).map((a) => [a.cor.ponto, a.principal])).toEqual([['bg-roxo-eletrico', true]]);
  });

  it('padrão da conta não vinculada: a primeira vinculada vira a principal, nunca fica sem nenhuma', () => {
    const r = pintarAgendas([{ external_calendar_id: 'mf' }, { external_calendar_id: 'ou' }], [{ id: 'ag', name: 'Calendário', is_default: true }, { id: 'mf', name: 'Manada Filmes' }, { id: 'ou', name: 'Clientes' }]);
    expect(r.filter((a) => a.principal).map((a) => a.id)).toEqual(['mf']);
  });
});

describe('aba de cada agenda', () => {
  const agendas = pintarAgendas([{ external_calendar_id: 'ag' }, { external_calendar_id: 'mf' }], [{ id: 'ag', name: 'Calendário', is_default: true }, { id: 'mf', name: 'Manada Filmes' }]);

  it('evento criado aqui (sem agenda de origem) é da Desigual, não da Manada', () => {
    expect(eventoDaAba(null, 'ag', agendas)).toBe(true);
    expect(eventoDaAba(null, 'mf', agendas)).toBe(false);
  });

  it('evento de agenda desvinculada só aparece em Todas', () => {
    expect(eventoDaAba('antiga', TODAS, agendas)).toBe(true);
    expect(agendas.some((a) => eventoDaAba('antiga', a.id, agendas))).toBe(false);
  });

  it('conta os eventos de cada aba', () => {
    const contagem = contarPorAba([{ calendar_id: 'ag' }, { calendar_id: null }, { calendar_id: 'mf' }, { calendar_id: 'antiga' }], agendas);
    expect(Object.fromEntries(contagem)).toEqual({ todas: 4, ag: 2, mf: 1 });
  });
});
