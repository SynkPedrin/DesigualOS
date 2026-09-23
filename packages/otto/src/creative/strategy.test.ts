import { describe, expect, it } from 'vitest';
import {
  bigIdeaPassesTest,
  deriveAngleTotal,
  deriveHookTotal,
  developBigIdeaAndHooks,
  developStrategy,
  formatStrategyBriefing,
  selectBestAngle,
  selectBestHook,
} from './strategy.js';
import type { CreativeAngle, CreativeStrategy, HookCandidate } from './schemas.js';

const strongAngleScores = {
  objective_fit: 8, audience_fit: 8, brand_fit: 8, originality: 8,
  hook_potential: 8, visual_potential: 8, executability: 8, factual_safety: 8,
};

function angle(overrides: Partial<CreativeAngle> = {}): CreativeAngle {
  return {
    name: 'Fricção removida',
    one_sentence_idea: 'Comprar a casa própria da Cosentino sem burocracia de cadastro',
    hook_direction: 'pergunta direta',
    emotional_mechanism: 'alívio',
    why_it_fits_audience: 'famílias cansadas de processos longos',
    why_it_fits_brand: 'a marca já promete agilidade',
    visual_potential: 'porta abrindo, entrega de chaves',
    execution_risk: 'parecer genérico se não ancorar no produto real',
    scores: strongAngleScores,
    ...overrides,
  };
}

function strategy(angles: CreativeAngle[]): CreativeStrategy {
  return {
    audience_insight: 'famílias que já pesquisaram e temem burocracia',
    tension: 'querem decidir rápido, mas o mercado empurra processo lento',
    opportunity: 'ser a incorporadora que remove a fricção',
    promise_or_message: 'abertura sem cadastro',
    communication_job: 'reduzir a objeção de burocracia antes da visita',
    emotional_direction: 'alívio e confiança',
    desired_reaction: 'agendar visita',
    reason_to_watch: 'a data está próxima e o processo é diferente do esperado',
    reason_to_believe: 'o atendimento já está pronto para o dia 24/09',
    angles,
  };
}

describe('deriveAngleTotal', () => {
  it('é a soma dos 8 scores, não um número que o modelo inventa', () => {
    expect(deriveAngleTotal(strongAngleScores)).toBe(64);
  });
});

describe('deriveHookTotal', () => {
  it('é a soma dos 7 scores do hook', () => {
    const scores = { stop_power: 7, specificity: 7, curiosity: 7, clarity: 7, believability: 7, brand_fit: 7, continuation_power: 7 };
    expect(deriveHookTotal(scores)).toBe(49);
  });
});

describe('selectBestAngle', () => {
  it('escolhe o ângulo de maior pontuação total entre os específicos', () => {
    const forte = angle({ name: 'A', scores: strongAngleScores });
    const fraco = angle({ name: 'B', scores: { ...strongAngleScores, originality: 2, hook_potential: 2 } });
    const result = selectBestAngle(strategy([fraco, forte]));
    expect(result.selected.name).toBe('A');
    expect(result.rejected.map((r) => r.angle.name)).toContain('B');
  });

  /**
   * MISSÃO 7 (teste de especificidade): reaproveita assessCreativeCopy sobre
   * a IDEIA do ângulo — um ângulo com clichê genérico não pode vencer só por
   * ter score alto, mesmo que o modelo (inflando a própria nota) diga que é
   * bom. A seleção é uma segunda porta determinística sobre o score.
   */
  it('rejeita ângulo genérico mesmo com score alto (teste de especificidade em código, não confia só no score do modelo)', () => {
    const generico = angle({
      name: 'Genérico',
      one_sentence_idea: 'Transforme seu negócio e leve sua empresa para o próximo nível com a solução ideal',
      scores: { ...strongAngleScores, originality: 10 }, // modelo "confiante" no próprio ângulo genérico
    });
    const especifico = angle({
      name: 'Específico',
      one_sentence_idea: 'A chave do Jardim Europa V entra na fechadura no mesmo dia da visita, sem fila de cadastro',
      scores: { ...strongAngleScores, originality: 6 }, // score total menor, mas específico
    });
    const result = selectBestAngle(strategy([generico, especifico]));
    expect(result.selected.name).toBe('Específico');
    expect(result.rejected.some((r) => r.angle.name === 'Genérico' && r.reason.includes('genérico'))).toBe(true);
  });

  it('se TODOS os ângulos forem genéricos, entrega o de maior pontuação mesmo assim (nunca trava o turno) e diz por quê', () => {
    const a = angle({ name: 'A', one_sentence_idea: 'A solução ideal pra transformar seu negócio', scores: { ...strongAngleScores, originality: 9 } });
    const b = angle({ name: 'B', one_sentence_idea: 'Leve sua empresa para o próximo nível com qualidade e excelência', scores: { ...strongAngleScores, originality: 3 } });
    const result = selectBestAngle(strategy([a, b]));
    expect(result.selected.name).toBe('A');
    expect(result.selectionReason).toMatch(/falharam no teste de especificidade/);
  });

  it('termos de marca no ângulo contam como âncora concreta (mesma regra de assessCreativeCopy)', () => {
    const comMarca = angle({
      name: 'Com marca',
      one_sentence_idea: 'A solução ideal: Jardim Europa V leva sua empresa para o próximo nível',
      scores: strongAngleScores,
    });
    const result = selectBestAngle(strategy([comMarca]), ['jardim europa v']);
    expect(result.selected.name).toBe('Com marca');
  });
});

describe('bigIdeaPassesTest', () => {
  it('reprova quando a big idea é só o objetivo reformulado', () => {
    expect(bigIdeaPassesTest('Vamos informar que as vendas abrirão dia 24 de setembro.')).toBe(false);
    expect(bigIdeaPassesTest('Informar que a abertura de vendas vai acontecer.')).toBe(false);
    expect(bigIdeaPassesTest('Comunicar que o atendimento está disponível.')).toBe(false);
  });

  it('reprova texto curto demais pra ser uma proposição real', () => {
    expect(bigIdeaPassesTest('Abertura dia 24.')).toBe(false);
  });

  it('aprova uma proposição criativa real', () => {
    expect(bigIdeaPassesTest('A chave que nunca esperou por burocracia.')).toBe(true);
  });
});

describe('selectBestHook', () => {
  it('escolhe o hook de maior pontuação total', () => {
    const fraco: HookCandidate = { text: 'fraco', scores: { stop_power: 2, specificity: 2, curiosity: 2, clarity: 2, believability: 2, brand_fit: 2, continuation_power: 2 } };
    const forte: HookCandidate = { text: 'forte', scores: { stop_power: 9, specificity: 9, curiosity: 9, clarity: 9, believability: 9, brand_fit: 9, continuation_power: 9 } };
    const selected = selectBestHook({ big_idea: 'x', hooks: [fraco, forte] });
    expect(selected.text).toBe('forte');
  });
});

describe('formatStrategyBriefing', () => {
  it('condensa estratégia + ângulo + big idea + hook num bloco compacto pro draft', () => {
    const s = strategy([angle()]);
    const a = angle();
    const hook: HookCandidate = { text: 'Sua chave já está pronta.', scores: { stop_power: 8, specificity: 8, curiosity: 8, clarity: 8, believability: 8, brand_fit: 8, continuation_power: 8 } };
    const briefing = formatStrategyBriefing(s, a, 'A chave que nunca esperou por burocracia.', hook);
    expect(briefing).toContain('A chave que nunca esperou por burocracia.');
    expect(briefing).toContain('Fricção removida');
    expect(briefing).toContain('Sua chave já está pronta.');
    expect(briefing).toContain(s.promise_or_message);
  });
});

describe('developStrategy / developBigIdeaAndHooks', () => {
  it('developStrategy manda o briefing e o contexto do cliente pro modelo', async () => {
    let capturedUser = '';
    const llm = {
      chat: () => Promise.reject(new Error('not expected')),
      chatJson: (messages: unknown) => {
        const list = messages as { role: string; content: string }[];
        capturedUser = list.find((m) => m.role === 'user')?.content ?? '';
        return Promise.resolve(strategy([angle()]));
      },
      healthCheck: () => Promise.reject(new Error('not expected')),
    };
    await developStrategy({ llm: llm as never }, { briefing: 'Crie um reels', clientContext: 'Cliente: Cosentino', mandatoryFacts: ['abertura dia 24/09'] });
    expect(capturedUser).toContain('Crie um reels');
    expect(capturedUser).toContain('Cliente: Cosentino');
    expect(capturedUser).toContain('abertura dia 24/09');
  });

  it('developBigIdeaAndHooks manda o ângulo escolhido e a estratégia pro modelo', async () => {
    let capturedUser = '';
    const llm = {
      chat: () => Promise.reject(new Error('not expected')),
      chatJson: (messages: unknown) => {
        const list = messages as { role: string; content: string }[];
        capturedUser = list.find((m) => m.role === 'user')?.content ?? '';
        return Promise.resolve({ big_idea: 'x', hooks: [] });
      },
      healthCheck: () => Promise.reject(new Error('not expected')),
    };
    const s = strategy([angle()]);
    await developBigIdeaAndHooks(
      { llm: llm as never },
      { briefing: 'Crie um reels', clientContext: 'Cliente: Cosentino', selectedAngle: angle(), strategy: s },
    );
    expect(capturedUser).toContain('Fricção removida');
    expect(capturedUser).toContain(s.promise_or_message);
  });
});
