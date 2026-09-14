import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeForSearch } from './search-match';

describe('normalizeForSearch', () => {
  it('remove acento e caixa', () => {
    expect(normalizeForSearch('Automações')).toBe('automacoes');
    expect(normalizeForSearch('  Histórico  ')).toBe('historico');
  });
});

describe('matchesQuery (filtro da navegação na paleta)', () => {
  it('acha o item digitando sem acento', () => {
    expect(matchesQuery('Histórico', 'historico')).toBe(true);
    expect(matchesQuery('Tokens & Custos', 'custos')).toBe(true);
  });

  it('casa por trecho no meio do rótulo', () => {
    expect(matchesQuery('Tokens & Custos', 'tokens')).toBe(true);
  });

  it('termo vazio mostra a navegação inteira', () => {
    expect(matchesQuery('Dashboard', '')).toBe(true);
    expect(matchesQuery('Dashboard', '   ')).toBe(true);
  });

  it('não casa o que não tem nada a ver — é isto que esvazia a navegação quando se busca um cliente', () => {
    expect(matchesQuery('Dashboard', 'consentino')).toBe(false);
    expect(matchesQuery('Clientes', 'cosentino')).toBe(false);
  });
});
