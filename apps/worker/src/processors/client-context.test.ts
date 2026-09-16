import { describe, expect, it } from 'vitest';
import { comporPerfil, fonteDoPerfil, formatClientBlock } from './client-context';

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

/**
 * As duas fontes de registro por cliente (brain criativo + dossiê operacional)
 * são complementares, não alternativas. A consulta antiga lia UMA com
 * `.limit(1)` e sem ordenação: com as duas no banco, o turno receberia uma ao
 * acaso e a ausente viraria a lacuna que o modelo preenche inventando.
 */
describe('comporPerfil', () => {
  it('entrega as duas fontes, criativo antes de operacional, cada uma rotulada', () => {
    const p = comporPerfil([
      { fonte: 'dossie', content: 'Lista no ClickUp 901411758614, retainer mensal.' },
      { fonte: 'brain', content: 'Concessionária John Deere, persona Seu Antônio decide.' },
    ]);

    expect(p).not.toBeNull();
    expect(p).toContain('Concessionária John Deere');
    expect(p).toContain('901411758614');
    expect(p!.indexOf('REGISTRO CRIATIVO')).toBeLessThan(p!.indexOf('REGISTRO OPERACIONAL'));
  });

  it('fonte longa não zera a outra: o piso por fonte é respeitado', () => {
    const p = comporPerfil(
      [
        { fonte: 'brain', content: 'B'.repeat(50_000) },
        { fonte: 'dossie', content: 'D'.repeat(50_000) },
      ],
      // Orçamento apertado de propósito: sem o piso, o brain comeria tudo.
      5_000,
    );

    expect(p).toContain('REGISTRO OPERACIONAL');
    expect((p!.match(/D/g) ?? []).length).toBeGreaterThanOrEqual(2_000);
    expect((p!.match(/B/g) ?? []).length).toBeGreaterThanOrEqual(2_000);
  });

  it('uma fonte só usa o orçamento inteiro, sem reservar para quem não existe', () => {
    const p = comporPerfil([{ fonte: 'brain', content: 'B'.repeat(50_000) }], 5_000);
    expect((p!.match(/B/g) ?? []).length).toBe(5_000);
  });

  it('sem conteúdo útil devolve null, e não um bloco vazio rotulado', () => {
    expect(comporPerfil([])).toBeNull();
    expect(comporPerfil([{ fonte: 'brain', content: '   ' }])).toBeNull();
  });

  it('subject desconhecido entra como registro adicional em vez de sumir', () => {
    const p = comporPerfil([{ fonte: fonteDoPerfil('cliente:x:algo-novo'), content: 'Fato relevante.' }]);
    expect(p).toContain('REGISTRO ADICIONAL');
    expect(p).toContain('Fato relevante.');
  });
});

describe('fonteDoPerfil', () => {
  it('classifica os subjects reais do sync', () => {
    expect(fonteDoPerfil('cliente:abc-123:brain')).toBe('brain');
    expect(fonteDoPerfil('cliente:abc-123:dossie')).toBe('dossie');
  });

  it('não quebra com subject ausente ou de outro tipo', () => {
    expect(fonteDoPerfil(undefined)).toBe('outra');
    expect(fonteDoPerfil(null)).toBe('outra');
    expect(fonteDoPerfil(42)).toBe('outra');
  });
});

/**
 * Terceira fonte: o que a equipe ensina no chat (client-fact.ts) entra como
 * registro APRENDIDO. Chega como vários registros — um por aspecto — e precisa
 * ser agrupado, senão cada fato ganharia cabeçalho próprio e o piso por fonte
 * seria cobrado N vezes, espremendo o dossiê.
 */
describe('comporPerfil com registro aprendido', () => {
  it('agrupa os fatos aprendidos sob um cabeçalho só', () => {
    const p = comporPerfil([
      { fonte: 'aprendizado', content: 'O decisor é a Marina.' },
      { fonte: 'aprendizado', content: 'A praça é Birigui.' },
      { fonte: 'dossie', content: 'Lista no ClickUp 901411764375.' },
    ]);

    expect((p!.match(/REGISTRO APRENDIDO/g) ?? []).length).toBe(1);
    expect(p).toContain('Marina');
    expect(p).toContain('Birigui');
    expect(p).toContain('901411764375');
  });

  it('o aprendido vem por último: é a informação mais recente', () => {
    const p = comporPerfil([
      { fonte: 'aprendizado', content: 'Na verdade o decisor mudou.' },
      { fonte: 'brain', content: 'Persona do funil.' },
      { fonte: 'dossie', content: 'Histórico de campanha.' },
    ]);
    expect(p!.indexOf('REGISTRO CRIATIVO')).toBeLessThan(p!.indexOf('REGISTRO OPERACIONAL'));
    expect(p!.indexOf('REGISTRO OPERACIONAL')).toBeLessThan(p!.indexOf('REGISTRO APRENDIDO'));
  });

  it('diz que o aprendido JÁ está gravado', () => {
    // Regressão medida ao vivo: com o rótulo antigo o agente usava o dado e
    // ainda pedia "registre formalmente no sistema", sendo que já estava em
    // memória permanente.
    const p = comporPerfil([{ fonte: 'aprendizado', content: 'O decisor é a Marina.' }]);
    expect(p).toMatch(/JA GRAVADO|JÁ GRAVADO/);
  });

  it('classifica o subject do fato, que termina no aspecto e não na fonte', () => {
    expect(fonteDoPerfil('cliente:c1:aprendizado:decisor')).toBe('aprendizado');
    expect(fonteDoPerfil('cliente:c1:aprendizado:geral:fabrica-fecha-em-janeiro')).toBe('aprendizado');
  });
});

describe('formatClientBlock mantém o registro vivo', () => {
  it('manda pedir o que falta e explica como o dado vira permanente', () => {
    const b = formatClientBlock(
      { clientId: 'c1', clientName: 'Yak Sushibar', profile: 'Restaurante japonês. Público: [FALTA]', unresolvedMentions: [], ambiguous: [] },
      57,
    );
    expect(b).toContain('REGISTRO É VIVO');
    expect(b).toMatch(/anota que|registra que/i);
    expect(b).toMatch(/Nunca preencha lacuna por dedução/i);
  });
});
