import { describe, expect, it } from 'vitest';
import { normalizarSlug, slugEhValido } from './criar';

/**
 * O identificador legível da empresa.
 *
 * Tem UNIQUE no banco e aparece em endereço, então aceitar o que a pessoa
 * digitou cru geraria um slug com espaço, acento e ponto que ninguém consegue
 * usar depois — e que só seria descoberto quando alguém tentasse compartilhar
 * um link.
 */
describe('slug da empresa', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizarSlug('Construtora Cosentino Ltda.')).toBe('construtora-cosentino-ltda');
    expect(normalizarSlug('Ação & Cia')).toBe('acao-cia');
  });

  it('não deixa traço sobrando nas pontas', () => {
    expect(normalizarSlug('  Empresa!  ')).toBe('empresa');
    expect(normalizarSlug('--teste--')).toBe('teste');
  });

  /** Nome gigante viraria endereço gigante. 48 é o suficiente para ler. */
  it('corta nome muito longo', () => {
    expect(normalizarSlug('a'.repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it('emoji e símbolo não entram no endereço', () => {
    expect(normalizarSlug('🔥 Cosentino — Enterprise')).toBe('cosentino-enterprise');
  });

  /**
   * SLUGS RESERVADOS. Sem isto, uma empresa chamada "Admin" geraria o slug
   * `admin` e passaria a competir com caminhos do próprio produto.
   */
  it('recusa o que o sistema já usa', () => {
    for (const reservado of ['admin', 'api', 'login', 'settings']) {
      const r = slugEhValido(reservado);
      expect(r.ok, `"${reservado}" deveria ser recusado`).toBe(false);
    }
  });

  it('recusa identificador curto demais para ser reconhecível', () => {
    expect(slugEhValido('a').ok).toBe(false);
  });

  it('aceita um nome normal de empresa', () => {
    expect(slugEhValido(normalizarSlug('Cosentino')).ok).toBe(true);
  });

  /**
   * O caso que quebra em silêncio: um nome só de emoji vira slug vazio, e slug
   * vazio passaria pelo UNIQUE uma única vez e depois colidiria com qualquer
   * outro nome igualmente impronunciável.
   */
  it('nome que não sobra nada é recusado, não vira slug vazio', () => {
    expect(normalizarSlug('🔥🔥🔥')).toBe('');
    expect(slugEhValido('').ok).toBe(false);
  });
});
