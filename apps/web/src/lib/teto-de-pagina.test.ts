import { describe, expect, it } from 'vitest';
import { TETO_DE_PAGINA, comoPiso, veioCheia } from './teto-de-pagina';

describe('teto de página', () => {
  it('mostra o número cru quando a página NÃO veio cheia, porque aí é total mesmo', () => {
    expect(comoPiso(0)).toBe('0');
    expect(comoPiso(12)).toBe('12');
    expect(comoPiso(TETO_DE_PAGINA - 1)).toBe('29');
  });

  /**
   * O caso que motiva o arquivo: com 30 linhas voltando, não dá pra saber se
   * são 30 ou 300. Estampar "30" afirma um total que ninguém contou, e num
   * painel de pendências o número baixo demais tranquiliza.
   */
  it('vira piso quando a página veio cheia', () => {
    expect(comoPiso(TETO_DE_PAGINA)).toBe('30+');
  });

  /** Defesa contra o servidor devolver mais que o pedido: ainda é piso. */
  it('continua piso se vier acima do teto', () => {
    expect(comoPiso(45)).toBe('30+');
  });

  it('veioCheia distingue página cheia de página parcial', () => {
    expect(veioCheia(TETO_DE_PAGINA)).toBe(true);
    expect(veioCheia(TETO_DE_PAGINA - 1)).toBe(false);
  });

  /** `undefined` é "ainda não sei", e não sei NÃO é piso: sem isto, a tela
   *  anunciaria "30+" durante o carregamento. */
  it('não trata ausência de dado como página cheia', () => {
    expect(veioCheia(undefined)).toBe(false);
  });
});
