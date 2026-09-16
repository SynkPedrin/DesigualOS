import { describe, expect, it } from 'vitest';
import { casarEntidades, dobrar, resolverEntidade, variantesDeNumeral } from './entity-matching';

const campanhas = [
  { id: 'c-europa', canonicalName: 'Europa V', aliases: ['Jardim Europa V'], ownerId: 'cosentino' },
  { id: 'c-digitais', canonicalName: 'Digitais', ownerId: 'cosentino' },
  { id: 'c-corretor', canonicalName: 'Dia do Corretor', ownerId: 'cosentino' },
  { id: 'c-plantadeira', canonicalName: 'Campanha Plantadeira', ownerId: 'dcarvalho' },
];

const clientes = [
  { id: 'lago', canonicalName: 'Jardim do Lago' },
  { id: 'cosentino', canonicalName: 'Cosentino' },
  { id: 'areia', canonicalName: 'Areia Branca' },
  { id: 'ibiza', canonicalName: 'Ibiza II' },
];

describe('variantesDeNumeral', () => {
  it('trata romano e arábico como a mesma coisa', () => {
    expect(variantesDeNumeral('Europa V')).toEqual(expect.arrayContaining(['europa v', 'europa 5']));
    expect(variantesDeNumeral('Ibiza II')).toEqual(expect.arrayContaining(['ibiza ii', 'ibiza 2']));
    expect(variantesDeNumeral('Jardim Europa 5')).toEqual(expect.arrayContaining(['jardim europa 5', 'jardim europa v']));
  });

  it('não confunde letra dentro de palavra com numeral', () => {
    // "vila" começa com "vi", mas "vi" só é numeral como token inteiro.
    expect(variantesDeNumeral('Vila Nova')).toEqual(['vila nova']);
  });
});

describe('caso Tammy: Jardim Europa 5', () => {
  it('resolve para a campanha Europa V da Cosentino', () => {
    const r = resolverEntidade('crie uma legenda para a campanha de aniversário do Jardim Europa 5', campanhas);
    expect(r.resolvida?.id).toBe('c-europa');
    expect(r.ambiguas).toEqual([]);
  });

  it('NÃO resolve para o cliente Jardim do Lago', () => {
    // O bug original: a palavra "jardim" sequestrava o cliente e o Otto
    // escrevia a legenda de Penápolis para uma campanha de outro cliente.
    const r = resolverEntidade('campanha de aniversário do Jardim Europa 5', clientes);
    expect(r.resolvida).toBeNull();
    expect(r.todas).toEqual([]);
  });

  it('continua resolvendo Jardim do Lago quando é dele que se fala', () => {
    expect(resolverEntidade('as tarefas do Jardim do Lago', clientes).resolvida?.id).toBe('lago');
    expect(resolverEntidade('como está o Jardim do Lago?', clientes).resolvida?.id).toBe('lago');
  });
});

describe('palavra fraca não identifica entidade', () => {
  it('"digitais" sozinho não resolve campanha', () => {
    expect(resolverEntidade('preciso dos digitais de setembro', campanhas).resolvida).toBeNull();
  });

  it('nome específico de campanha resolve', () => {
    expect(resolverEntidade('como está o Dia do Corretor?', campanhas).resolvida?.id).toBe('c-corretor');
  });
});

describe('isolamento entre clientes', () => {
  it('não devolve campanha de outro cliente quando o dono é conhecido', () => {
    const r = resolverEntidade('campanha plantadeira', campanhas, { ownerId: 'cosentino' });
    expect(r.resolvida).toBeNull();
    // Não some em silêncio: o chamador precisa poder dizer de quem ela é.
    expect(r.foraDoEscopo.map((e) => e.id)).toEqual(['c-plantadeira']);
  });

  it('o dono conhecido desempata sem perguntar', () => {
    const dois = [
      { id: 'a1', canonicalName: 'Aniversário 47 anos', ownerId: 'cosentino' },
      { id: 'a2', canonicalName: 'Aniversário 47 anos', ownerId: 'dcarvalho' },
    ];
    expect(resolverEntidade('campanha aniversário 47 anos', dois, { ownerId: 'dcarvalho' }).resolvida?.id).toBe('a2');
  });

  it('empate real vira pergunta, não sorteio', () => {
    const dois = [
      { id: 'a1', canonicalName: 'Feirão de Usados', ownerId: 'x' },
      { id: 'a2', canonicalName: 'Feirão de Usados', ownerId: 'y' },
    ];
    const r = resolverEntidade('como está o feirão de usados?', dois);
    expect(r.resolvida).toBeNull();
    expect(r.ambiguas).toHaveLength(2);
  });
});

describe('especificidade vence', () => {
  it('a forma mais longa ganha da mais curta', () => {
    const ents = [
      { id: 'curto', canonicalName: 'Europa V' },
      { id: 'longo', canonicalName: 'Europa V Campanha de Aniversário' },
    ];
    const m = casarEntidades('preciso da Europa V Campanha de Aniversário', ents);
    expect(m[0]!.entidade.id).toBe('longo');
  });
});

describe('dobrar', () => {
  it('normaliza acento, emoji e pontuação', () => {
    expect(dobrar('🔥 Construtora e Imobiliária Cosentino Ltda. — Enterprise')).toContain('cosentino');
    expect(dobrar('D. Carvalho')).toBe('d carvalho');
  });
});
