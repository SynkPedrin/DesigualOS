import { describe, expect, it } from 'vitest';
import { pintarAgendas } from './cores-das-agendas';

describe('cor de cada agenda do Outlook', () => {
  it('a principal é roxa (agência), a da Manada Filmes laranja, outra pega a próxima cor', () => {
    const r = pintarAgendas(
      [{ external_calendar_id: 'ag' }, { external_calendar_id: 'mf' }, { external_calendar_id: 'ou' }],
      [{ id: 'ag', name: 'Calendário', is_default: true }, { id: 'mf', name: 'Manada Filmes', is_default: false }, { id: 'ou', name: 'Feriados', is_default: false }],
    );
    expect(r.map((a) => [a.nome, a.cor.ponto])).toEqual([['Calendário', 'bg-roxo-eletrico'], ['Manada Filmes', 'bg-aviso'], ['Feriados', 'bg-sinal']]);
  });

  it('sem a lista da conta ainda (carregando), a primeira vinculada vale como principal', () => {
    expect(pintarAgendas([{ external_calendar_id: 'x' }], []).map((a) => a.cor.ponto)).toEqual(['bg-roxo-eletrico']);
  });
});
