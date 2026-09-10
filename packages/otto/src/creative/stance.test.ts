import { describe, expect, it } from 'vitest';
import { buildDirectionDirective } from './stance.js';

/**
 * A diretiva é texto de prompt, então o que se testa é o CONTRATO dela: manda
 * entregar em vez de perguntar, pede a estrutura certa pro nível, e não abre
 * brecha nas garantias de honestidade que já existiam.
 */

const FAST = buildDirectionDirective({ depth: 'fast', hasClientMaterial: true });
const STANDARD = buildDirectionDirective({ depth: 'standard', hasClientMaterial: true });
const DEEP = buildDirectionDirective({ depth: 'deep', hasClientMaterial: true });

describe('postura: assumir direcao', () => {
  it.each([
    ['fast', FAST],
    ['standard', STANDARD],
    ['deep', DEEP],
  ])('%s manda entregar na primeira resposta e nao devolver o pedido como pergunta', (_depth, directive) => {
    expect(directive).toContain('PRIMEIRA resposta');
    expect(directive).toContain('ASSUMA a hipótese mais provável');
    expect(directive).toContain('Devolver o pedido em forma de pergunta não é resposta');
  });

  it.each([
    ['fast', FAST],
    ['standard', STANDARD],
    ['deep', DEEP],
  ])('%s limita pergunta de esclarecimento a uma, no fim', (_depth, directive) => {
    expect(directive).toContain('UMA pergunta de esclarecimento');
    expect(directive).toContain('nunca no lugar dele');
  });

  it('resolve a regra de funil sem travar a entrega', () => {
    // A persona canônica diz "se o briefing não disser a etapa, pergunte antes
    // de dar direção". A diretiva substitui isso por assumir + declarar.
    expect(STANDARD).toContain('etapa de funil que você assumiu');
    expect(STANDARD).toContain('diga em uma linha qual assumiu');
  });
});

describe('forma da entrega por nivel', () => {
  it('fast pede so a peca, em poucas opcoes, sem relatorio', () => {
    expect(FAST).toContain('entrega curta');
    expect(FAST).toContain('3 opções numeradas');
    expect(FAST).not.toContain('Variação A');
    expect(FAST).not.toContain('Leitura estratégica');
  });

  it('standard pede a espinha completa que o dono especificou', () => {
    for (const label of ['Conceito:', 'Por que funciona:', 'Hook:', 'Roteiro:', 'Direção visual:', 'CTA:']) {
      expect(STANDARD).toContain(label);
    }
    // Duas variações de teste, cada uma mudando UMA variável.
    expect(STANDARD).toContain('Variação A:');
    expect(STANDARD).toContain('Variação B:');
    expect(STANDARD).toContain('muda UMA variável');
  });

  it('standard nao carrega a camada estrategica do deep', () => {
    expect(STANDARD).not.toContain('Leitura estratégica');
  });

  it('deep e o standard mais a leitura estrategica', () => {
    expect(DEEP).toContain('Leitura estratégica');
    for (const label of ['Conceito:', 'Hook:', 'Roteiro:', 'CTA:', 'Variação A:', 'Variação B:']) {
      expect(DEEP).toContain(label);
    }
  });

  it('todos os niveis proibem direcao vaga', () => {
    expect(STANDARD).toContain('foto bonita de produto não é direção');
  });
});

describe('garantias de honestidade preservadas', () => {
  it.each([
    ['fast', FAST],
    ['standard', STANDARD],
    ['deep', DEEP],
  ])('%s separa opiniao criativa de fato de cliente', (_depth, directive) => {
    expect(directive).toContain('nunca pra fato');
    expect(directive).toContain('que não chegou neste turno');
  });

  it.each([
    ['fast', FAST],
    ['standard', STANDARD],
    ['deep', DEEP],
  ])('%s mantem a proibicao de descrever anexo que o Otto nao viu', (_depth, directive) => {
    expect(directive).toContain('detalhe visual de anexo que você não recebeu de verdade');
  });

  it('sem material do cliente, reforca que nao pode inventar o DNA nem se autodescrever', () => {
    const withoutMaterial = buildDirectionDirective({ depth: 'standard', hasClientMaterial: false });
    expect(withoutMaterial).toContain('não recebeu material real deste cliente neste turno');
    expect(withoutMaterial).toContain('não invente o DNA dele');
    expect(withoutMaterial).toContain('nem descreva a si mesmo');
  });

  it('com material do cliente, o aviso extra nao aparece', () => {
    expect(STANDARD).not.toContain('não recebeu material real deste cliente neste turno');
  });
});

describe('formatacao', () => {
  it.each([
    ['fast', FAST],
    ['standard', STANDARD],
    ['deep', DEEP],
  ])('%s nao usa markdown nem travessao (as duas regras da casa do Otto)', (_depth, directive) => {
    expect(directive).not.toMatch(/^#{1,6}\s/m);
    expect(directive).not.toContain('**');
    expect(directive).not.toContain('—');
  });

  it.each([
    ['fast', FAST],
    ['standard', STANDARD],
    ['deep', DEEP],
  ])('%s proibe markdown na SAIDA, junto dos rotulos que a diretiva introduz', (_depth, directive) => {
    // Medido no bench de 10/09/2026: introduzir rótulos estruturados fez o
    // modelo local começar a devolver "**negrito**", que nenhum canal do Otto
    // renderiza. A proibição mora junto da estrutura que a provoca.
    expect(directive).toContain('TEXTO PLANO');
    expect(directive).toContain('Nada de asterisco');
  });
});
