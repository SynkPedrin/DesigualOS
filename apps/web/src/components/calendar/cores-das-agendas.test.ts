import { describe, expect, it } from 'vitest';
import { agruparAgendasDaEquipe, contarPorAba, eventoDaAba, juntarEventos, pintarAgendas, TODAS } from './cores-das-agendas';

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

describe('agenda geral: as agendas da equipe num calendário só', () => {
  const equipe = [
    { calendar_id: 'ag-pedro', user_id: 'pedro', nome: 'Calendário', padrao: true },
    { calendar_id: 'mf-pedro', user_id: 'pedro', nome: 'Manada Filmes', padrao: false },
    { calendar_id: 'ag-ana', user_id: 'ana', nome: null, padrao: true },
    { calendar_id: 'mf-ana', user_id: 'ana', nome: 'Manada Filmes ', padrao: false },
    { calendar_id: 'sem-nome', user_id: 'ana', nome: null, padrao: false },
  ];
  const ev = (id: string, calendar_id: string | null, title = 'Reunião', visible = true) => ({ id, calendar_id, title, visible, start_at: '2026-11-03T13:00:00Z', end_at: '2026-11-03T14:00:00Z' });

  it('agrupa pelo nome: a padrão de cada pessoa é a Desigual, a Manada de qualquer pessoa é uma aba laranja só', () => {
    const { agendas, grupoDe } = agruparAgendasDaEquipe(equipe);
    expect(agendas.map((a) => [a.nome, a.cor.ponto, a.principal])).toEqual([['Desigual', 'bg-roxo-eletrico', true], ['Manada Filmes', 'bg-aviso', false]]);
    expect(grupoDe.get('ag-ana')).toBe(grupoDe.get('ag-pedro'));
    expect(grupoDe.get('mf-ana')).toBe(grupoDe.get('mf-pedro'));
    expect(grupoDe.has('sem-nome')).toBe(false);
  });

  it('a mesma reunião, vinda de cada convidado, aparece uma vez, e na agenda mais específica', () => {
    const { agendas, grupoDe } = agruparAgendasDaEquipe(equipe);
    const juntos = juntarEventos([ev('1', 'ag-pedro'), ev('2', 'mf-ana'), ev('3', 'ag-ana')], grupoDe, agendas);
    expect(juntos.map((e) => [e.id, e.calendar_id])).toEqual([['2', grupoDe.get('mf-ana')]]);
  });

  it('evento "Ocupado" (privado de outra pessoa) não se funde com outro no mesmo horário', () => {
    const { agendas, grupoDe } = agruparAgendasDaEquipe(equipe);
    expect(juntarEventos([ev('1', 'ag-pedro', null as never, false), ev('2', 'ag-ana', null as never, false)], grupoDe, agendas)).toHaveLength(2);
  });
});
