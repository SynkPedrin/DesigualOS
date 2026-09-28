import { describe, expect, it } from 'vitest';
import { corrigirResponsavel, pedeAutoAtribuicao } from './bento-self-assignment';

/**
 * 28/09/2026, ao vivo com a Tammy no frontend: "Agora me coloque também como
 * responsável nessa tarefa" virou assignee "D. Carvalho" — o nome do CLIENTE —
 * e a resposta foi "não encontrei 'D. Carvalho' entre os membros do ClickUp".
 * O erro não era de nome, era de ENTIDADE.
 */

const TAMMY = 'Tammy';
const CLIENTE = 'D. Carvalho';

function corrigir(message: string, assignee: string | null) {
  return corrigirResponsavel({ message, assignee, requesterName: TAMMY, clientName: CLIENTE });
}

describe('auto-atribuição: "me" é quem pediu, nunca o cliente', () => {
  it('o caso exato da Tammy', () => {
    expect(corrigir('Agora me coloque também como responsável nessa tarefa', CLIENTE)).toEqual({
      assignee: 'Tammy',
      motivo: 'auto_atribuicao',
    });
  });

  it.each([
    'me coloca como responsável',
    'me atribui essa task',
    'me põe nessa também',
    'me adiciona nessa tarefa',
    'atribui essa pra mim',
    'passa essa task para mim',
    'assume pra mim',
    'me bota como responsável nessa',
  ])('%s -> Tammy', (m) => {
    expect(corrigir(m, null).assignee).toBe('Tammy');
  });

  it('o planner não propondo ninguém também vira a pessoa que pediu', () => {
    expect(corrigir('me coloca como responsável', null)).toEqual({ assignee: 'Tammy', motivo: 'auto_atribuicao' });
  });
});

describe('cliente nunca é pessoa', () => {
  it('assignee igual ao cliente, sem auto-atribuição, vira "não sei quem"', () => {
    // Melhor perguntar que atribuir a task de alguém pra um nome que não existe.
    expect(corrigir('coloca o responsável nessa task', CLIENTE)).toEqual({
      assignee: null,
      motivo: 'cliente_nao_e_pessoa',
    });
  });

  it('compara sem acento e sem pontuação — "d carvalho" é o mesmo cliente', () => {
    expect(corrigir('poe alguem nessa', 'd. carvalho').motivo).toBe('cliente_nao_e_pessoa');
  });
});

describe('o que NÃO pode mudar', () => {
  it.each([
    ['coloca o Gui como responsável', 'Gui'],
    ['atribui pra Jamile Galdino', 'Jamile Galdino'],
    ['passa essa pro Matheus Sain', 'Matheus Sain'],
  ])('%s mantém a pessoa nomeada', (m, nome) => {
    expect(corrigir(m, nome)).toEqual({ assignee: nome, motivo: null });
  });

  it.each([
    'me diz quem é o responsável dessa task',
    'me manda o link da task',
    'me explica como funciona a atribuição',
    'quem é o responsável?',
  ])('%s não é auto-atribuição', (m) => {
    expect(pedeAutoAtribuicao(m)).toBe(false);
  });

  it('sem saber quem pediu, não inventa', () => {
    expect(
      corrigirResponsavel({ message: 'me coloca como responsável', assignee: null, requesterName: null, clientName: CLIENTE }),
    ).toEqual({ assignee: null, motivo: null });
  });
});
