import { describe, expect, it } from 'vitest';
import { chipsDeStatus } from './page';

/**
 * O que estes testes protegem é o cliente que SOME.
 *
 * A lista de chips era fixa, com cinco entradas, e a carteira real tem sete
 * status. Medido em 09/10/2026: 49 clientes, sendo 22 ativos, 19 pontuais, 7
 * inativos e 1 prospect. Vinte deles — 40% da carteira — não tinham chip que
 * os alcançasse, e a soma dos chips não fechava com o total logo acima.
 *
 * Status é coluna de texto cadastrada por quem usa, então toda lista fixa aqui
 * envelhece na primeira vez que alguém inventa um valor novo. E envelhece em
 * silêncio: esconde cliente em vez de dar erro.
 */
describe('chipsDeStatus', () => {
  it('"Todos" vem primeiro, sempre', () => {
    expect(chipsDeStatus(['active'])[0]).toEqual({ key: 'todos', label: 'Todos' });
  });

  it('todo status presente na carteira ganha chip', () => {
    const chaves = chipsDeStatus(['active', 'pontual', 'prospect', 'inactive']).map((c) => c.key);
    expect(chaves).toEqual(['todos', 'active', 'pontual', 'inactive', 'prospect']);
  });

  /**
   * O caso que motiva o arquivo: `pontual` e `prospect` existiam no banco e
   * não existiam na lista escrita à mão.
   */
  it('pontual e prospect deixam de ficar inalcançáveis', () => {
    const chaves = chipsDeStatus(['pontual', 'prospect']).map((c) => c.key);
    expect(chaves).toContain('pontual');
    expect(chaves).toContain('prospect');
  });

  it('status repetido não gera chip repetido', () => {
    expect(chipsDeStatus(['active', 'active', 'active']).map((c) => c.key)).toEqual(['todos', 'active']);
  });

  it('status que ninguém previu aparece com o nome cru, em vez de sumir', () => {
    const chips = chipsDeStatus(['active', 'em_negociacao']);
    expect(chips.find((c) => c.key === 'em_negociacao')?.label).toBe('em_negociacao');
  });

  /**
   * Ordem: conhecidos na sequência do ciclo de vida, desconhecidos depois e
   * por quantidade. Assim o chip novo aparece sem desarrumar o que a equipe já
   * sabe de cor.
   */
  it('desconhecidos vêm depois dos conhecidos, e o mais numeroso primeiro', () => {
    const chaves = chipsDeStatus(['raro', 'comum', 'comum', 'comum', 'active']).map((c) => c.key);
    expect(chaves).toEqual(['todos', 'active', 'comum', 'raro']);
  });

  it('carteira vazia devolve só "Todos", sem inventar status', () => {
    expect(chipsDeStatus([])).toEqual([{ key: 'todos', label: 'Todos' }]);
  });

  /**
   * A propriedade que fecha a conta: somando os chips (fora "Todos"), o
   * resultado tem que ser a carteira inteira. É exatamente isso que falhava
   * antes, e falhava sem ninguém ver.
   */
  it('a soma dos chips cobre a carteira inteira', () => {
    const carteira = ['active', 'active', 'pontual', 'prospect', 'inactive', 'sei_la'];
    const chips = chipsDeStatus(carteira).filter((c) => c.key !== 'todos');
    const cobertos = carteira.filter((s) => chips.some((c) => c.key === s)).length;
    expect(cobertos).toBe(carteira.length);
  });
});
