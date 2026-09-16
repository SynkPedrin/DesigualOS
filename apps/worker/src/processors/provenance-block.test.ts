import { describe, expect, it } from 'vitest';
import { formatProvenanceBlock, pedeProveniencia } from './provenance-block';

/**
 * Regressão medida no navegador (16/09/2026): perguntado "quem trabalha na
 * conta da Cosentino e de onde você tirou essa informação?", o Bento nomeou a
 * equipe certa e não disse a origem. Resposta correta e mesmo assim inútil para
 * quem precisa decidir se confia nela.
 */
describe('pedeProveniencia', () => {
  it('reconhece as formas reais de perguntar a fonte', () => {
    for (const f of [
      'de onde você tirou essa informação?',
      'qual a fonte disso?',
      'como você sabe disso?',
      'em que você se baseou?',
      'quais as fontes?',
    ]) expect(pedeProveniencia(f), f).toBe(true);
  });

  it('não dispara em turno comum', () => {
    expect(pedeProveniencia('quem trabalha na conta da Cosentino?')).toBe(false);
    expect(pedeProveniencia('crie uma legenda')).toBe(false);
  });
});

describe('formatProvenanceBlock', () => {
  it('lista as fontes REAIS do turno em linguagem de gente', () => {
    const b = formatProvenanceBlock('e de onde você tirou isso?', ['cliente', 'pessoas']);
    expect(b).toContain('dossiê do cliente');
    expect(b).toContain('registro de pessoas');
    expect(b).toMatch(/N[ÃA]O invente fonte/i);
  });

  it('sem fonte no turno, manda declarar a ausência', () => {
    const b = formatProvenanceBlock('de onde veio isso?', []);
    expect(b).toMatch(/N[ÃA]O recebeu nenhuma fonte/i);
    expect(b).toMatch(/Diga isso com todas as letras/i);
  });

  it('proíbe a saída de escape mais comum', () => {
    // "meu conhecimento interno" não é resposta para quem precisa conferir.
    expect(formatProvenanceBlock('qual a fonte?', ['campanha'])).toMatch(/conhecimento interno/i);
  });

  it('turno que não pergunta não vira bibliografia', () => {
    expect(formatProvenanceBlock('me explica a campanha', ['cliente', 'campanha'])).toBe('');
  });
});
