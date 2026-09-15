import { describe, expect, it } from 'vitest';
import { formatClientBlock } from './client-context';

/**
 * Regressão do bug relatado pela operação (15/09/2026): pediram legenda para a
 * "D. Carvalho", o Otto disse que ela não era cliente e inventou que era "rede
 * de joias e relógios". Ela é concessionária John Deere, com dossiê completo
 * no banco — o turno é que chegava ao node sem a identidade do cliente.
 */
describe('formatClientBlock', () => {
  it('cliente resolvido com dossiê manda o dossiê como fonte', () => {
    const b = formatClientBlock(
      {
        clientId: 'c1',
        clientName: 'D. Carvalho',
        profile: 'Concessionária John Deere que atende Araçatuba, Andradina e Presidente Prudente.',
        unresolvedMentions: [],
        ambiguous: [],
      },
      57,
    );
    expect(b).toContain('D. Carvalho');
    expect(b).toContain('confirmado na carteira');
    expect(b).toContain('Concessionária John Deere');
  });

  it('cliente existe mas sem dossiê: proíbe inventar ramo/produto', () => {
    const b = formatClientBlock(
      { clientId: 'c1', clientName: 'Fulano', profile: null, unresolvedMentions: [], ambiguous: [] },
      57,
    );
    expect(b).toContain('EXISTE na carteira');
    expect(b).toMatch(/N[ÃA]O invente/i);
  });

  it('sem cliente resolvido: proíbe afirmar que cliente não existe', () => {
    const b = formatClientBlock(
      { clientId: null, clientName: null, profile: null, unresolvedMentions: [], ambiguous: [] },
      57,
    );
    // O erro exato do bug: afirmar que o cliente não existe e descrever o ramo.
    expect(b).toMatch(/NUNCA afirme que um cliente não existe/i);
    expect(b).toMatch(/NUNCA descreva o ramo/i);
    expect(b).toContain('57');
  });

  it('ambiguidade manda perguntar, não escolher', () => {
    const b = formatClientBlock(
      { clientId: null, clientName: null, profile: null, unresolvedMentions: [], ambiguous: ['Colpar', 'Colpar QA'] },
      57,
    );
    expect(b).toContain('AMBÍGUO');
    expect(b).toMatch(/NÃO escolha por conta própria/i);
  });
});
