import { describe, expect, it } from 'vitest';
import { matchRule } from './rules';

describe('matchRule — intenção vs assunto', () => {
  it('pergunta comparativa de performance vai pro Jarbas, não pro Otto', () => {
    // Bug real: 'campanha' era keyword de creative_direction e valia 0.85, então esta
    // pergunta era cravada no Otto sem nem consultar o classifier.
    const m = matchRule('qual cliente tem a melhor campanha hoje?')!;
    expect(m.rule.primaryAgent).toBe('jarbas');
    expect(m.rule.intent).toBe('campaign_analysis');
    expect(m.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('palavra de ASSUNTO sozinha fica abaixo do limiar (escala pro classifier)', () => {
    const m = matchRule('me fala sobre copy')!;
    expect(m.rule.intent).toBe('creative_direction');
    expect(m.confidence).toBeLessThan(0.7);
  });

  it('frase de INTENÇÃO criativa continua cravando o Otto sem LLM', () => {
    const m = matchRule('preciso de uma direção de arte pra isso')!;
    expect(m.rule.primaryAgent).toBe('otto');
    expect(m.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('métrica de uma palavra continua sendo intenção forte (cpa/roas)', () => {
    expect(matchRule('como ta o cpa?')!.rule.primaryAgent).toBe('jarbas');
    expect(matchRule('qual o roas?')!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('geração de mídia continua indo pro Studio', () => {
    expect(matchRule('gere um carrossel novo')!.rule.primaryAgent).toBe('studio');
  });

  it('mensagem sem nenhuma palavra conhecida não casa regra', () => {
    expect(matchRule('oi, tudo bem?')).toBeNull();
  });
});

/**
 * Regressão do AUTO no front publicado (24/09/2026). Com a classifier
 * indisponível (ANTHROPIC_API_KEY vazia), tudo que não passa de 0,70 cai no
 * fallback do Router, que é o Bento — e "faz 2 legendas pro aniversário da
 * Cosentino" voltou como data de fundação tirada do vault, zero legendas.
 */
describe('AUTO: pedido de peça criativa decide sem depender da classifier', () => {
  const LIMIAR = 0.7;

  const criativos = [
    'faz 2 legendas pro aniversário da Cosentino',
    'me dá 3 títulos',
    'preciso de um roteiro pra reels',
    'me manda 3 hooks',
    'escreve uma headline pra esse anúncio',
    'monta um carrossel de 8 cards',
  ];

  for (const frase of criativos) {
    it(`"${frase}" -> otto acima do limiar`, () => {
      const m = matchRule(frase);
      expect(m?.rule.primaryAgent).toBe('otto');
      expect(m!.confidence).toBeGreaterThanOrEqual(LIMIAR);
    });
  }

  it('leitura de mídia paga continua com o Jarbas, não vira direção criativa', () => {
    expect(matchRule('como está a campanha da 3net')?.rule.primaryAgent).toBe('jarbas');
    expect(matchRule('qual o cpa desse mês')?.rule.primaryAgent).toBe('jarbas');
  });

  it('pergunta de processo continua no Bento', () => {
    expect(matchRule('qual é o processo de onboarding do cliente')?.rule.primaryAgent).toBe('bento');
  });
});
