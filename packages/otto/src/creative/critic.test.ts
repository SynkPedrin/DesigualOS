import { describe, expect, it } from 'vitest';
import {
  computeMissingDeliverables,
  critiqueDeliverable,
  deriveCriticOverall,
  formatCriticRevisionNote,
  passesCriticGate,
} from './critic.js';
import type { CriticEvaluation } from './schemas.js';

const baseScores = {
  strategy: 9,
  concept: 9,
  hook: 9,
  specificity: 9,
  originality: 9,
  brand_fit: 9,
  copy: 9,
  retention: 9,
  platform_fit: 9,
  executability: 9,
};

const baseFlags = {
  missing_deliverables: [],
  genericity: false,
  unsupported_claims: [],
  weak_hook: false,
  weak_concept: false,
  bad_cta: false,
  bad_platform_fit: false,
  ai_slop: false,
  over_explanation: false,
  missing_production_direction: false,
  brand_mismatch: false,
};

function evaluation(overrides: Partial<CriticEvaluation> = {}): CriticEvaluation {
  return { scores: baseScores, flags: baseFlags, reasoning: 'ok', ...overrides };
}

describe('deriveCriticOverall', () => {
  it('é a média dos dez scores, não um número que o modelo inventa (lição do bug de duration)', () => {
    expect(deriveCriticOverall(baseScores)).toBe(90);
  });

  it('desce quando qualquer dimensão desce', () => {
    expect(deriveCriticOverall({ ...baseScores, hook: 3 })).toBeLessThan(90);
  });
});

describe('computeMissingDeliverables', () => {
  it('detecta "roteiro" ausente quando a resposta não tem seção "Roteiro:"', () => {
    const missing = computeMissingDeliverables('Conceito: X\n\nLegenda: Y\n\nCTA: Z', ['roteiro']);
    expect(missing).toEqual(['roteiro']);
  });

  it('não marca "roteiro" quando a seção existe', () => {
    const missing = computeMissingDeliverables('Conceito: X\n\nRoteiro:\n\nCena 1...', ['roteiro']);
    expect(missing).toEqual([]);
  });

  it('detecta "legenda" ausente quando não há conteúdo depois de "Legenda:"', () => {
    const missing = computeMissingDeliverables('Conceito: X\n\nLegenda:   \n\nCTA: Z', ['legenda']);
    expect(missing).toEqual(['legenda']);
  });

  it('não verifica artefatos sem rótulo fixo no caminho de produção (título, headline etc)', () => {
    const missing = computeMissingDeliverables('Conceito: X', ['titulo']);
    expect(missing).toEqual([]);
  });

  it('sem entregáveis pedidos, nada é reportado como faltando', () => {
    expect(computeMissingDeliverables('qualquer coisa', [])).toEqual([]);
  });
});

describe('passesCriticGate', () => {
  it('usa codeMissingDeliverables (Missão 7) em vez de evaluation.flags.missing_deliverables quando fornecido', () => {
    // O modelo diz que está tudo ok...
    const evalOtimista = evaluation({ flags: { ...baseFlags, missing_deliverables: [] } });
    // ...mas o código sabe que "roteiro" está faltando de verdade.
    const result = passesCriticGate(evalOtimista, ['roteiro']);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('roteiro'))).toBe(true);
  });

  it('sem codeMissingDeliverables, cai de volta no autorreporte do modelo (compatibilidade)', () => {
    const semOverride = passesCriticGate(evaluation({ flags: { ...baseFlags, missing_deliverables: ['legenda'] } }));
    expect(semOverride.passed).toBe(false);
    expect(semOverride.reasons.some((r) => r.includes('legenda'))).toBe(true);
  });

  it('aprova quando overall >= 88 e nenhuma dimensão crítica < 8', () => {
    const result = passesCriticGate(evaluation());
    expect(result.passed).toBe(true);
    expect(result.overall).toBe(90);
    expect(result.reasons).toEqual([]);
  });

  it('reprova por overall baixo mesmo sem dimensão crítica isolada abaixo de 8', () => {
    const scores = { ...baseScores, strategy: 7, hook: 7, specificity: 7, originality: 7, brand_fit: 7, retention: 7, platform_fit: 7 };
    const result = passesCriticGate(evaluation({ scores }));
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('abaixo de 88'))).toBe(true);
  });

  it('reprova por concept < 8 mesmo com overall alto', () => {
    const result = passesCriticGate(evaluation({ scores: { ...baseScores, concept: 7 } }));
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('concept'))).toBe(true);
  });

  it('reprova por copy < 8', () => {
    const result = passesCriticGate(evaluation({ scores: { ...baseScores, copy: 6 } }));
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('copy'))).toBe(true);
  });

  it('reprova por executability < 8', () => {
    const result = passesCriticGate(evaluation({ scores: { ...baseScores, executability: 5 } }));
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('executability'))).toBe(true);
  });

  it('reprova sempre que falta entregável pedido, mesmo com scores altos', () => {
    const result = passesCriticGate(evaluation({ flags: { ...baseFlags, missing_deliverables: ['legenda'] } }));
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('legenda'))).toBe(true);
  });

  it('a nota real 59/100 da baseline ao vivo (Fase 1, ctx4) reprova o gate', () => {
    // Reconstituindo os scores honestos que o baseline ao vivo recebeu
    // (docs/coordination/OTTO_ELITE_HANDOFF.md, Phase 2, tabela de rubrica):
    // strategy 7, concept 6, hook 5, specificity 6, originality 4, brand_fit
    // 6, copy 6, retention 5, platform_fit 6, executability 6 -> soma 57/100
    // por essa média simples (a tabela do handoff usa pesos diferentes,
    // aqui é só média direta das dez dimensões do critic).
    const liveScores = {
      strategy: 7, concept: 6, hook: 5, specificity: 6, originality: 4,
      brand_fit: 6, copy: 6, retention: 5, platform_fit: 6, executability: 6,
    };
    const result = passesCriticGate(evaluation({ scores: liveScores }));
    expect(result.passed).toBe(false);
    expect(result.overall).toBeLessThan(88);
  });
});

describe('formatCriticRevisionNote', () => {
  it('lista os motivos do gate e instrui reescrita real, não patch de sinônimo', () => {
    const gate = passesCriticGate(evaluation({ scores: { ...baseScores, hook: 5 } }));
    const note = formatCriticRevisionNote(evaluation({ scores: { ...baseScores, hook: 5 } }), gate);
    expect(note).toMatch(/nota \d+\/100/);
    expect(note).toMatch(/não é troca de sinônimo/);
  });

  it('flag ai_slop vira instrução explícita de reescrever em português natural', () => {
    const evalWithSlop = evaluation({ flags: { ...baseFlags, ai_slop: true } });
    const gate = passesCriticGate(evalWithSlop);
    const note = formatCriticRevisionNote(evalWithSlop, gate);
    expect(note).toMatch(/clichê típico de texto de IA/);
  });

  it('missing_deliverables vira instrução de entregar TODOS os itens', () => {
    const evalMissing = evaluation({ flags: { ...baseFlags, missing_deliverables: ['legenda', 'shot list'] } });
    const gate = passesCriticGate(evalMissing);
    const note = formatCriticRevisionNote(evalMissing, gate);
    expect(note).toMatch(/ENTREGA INCOMPLETA/);
    expect(note).toMatch(/legenda, shot list/);
  });
});

describe('critiqueDeliverable', () => {
  it('manda o briefing, a resposta renderizada e os entregáveis pedidos pro modelo', async () => {
    let capturedUser = '';
    const llm = {
      chat: () => Promise.reject(new Error('not expected')),
      chatJson: (messages: unknown) => {
        const list = messages as { role: string; content: string }[];
        capturedUser = list.find((m) => m.role === 'user')?.content ?? '';
        return Promise.resolve(evaluation());
      },
      healthCheck: () => Promise.reject(new Error('not expected')),
    };

    const result = await critiqueDeliverable(
      { llm: llm as never },
      {
        briefing: 'Crie um reels sobre a abertura de vendas',
        renderedAnswer: 'Conceito: X\n\nRoteiro:\n...',
        requestedDeliverables: ['roteiro', 'legenda'],
      },
    );

    expect(capturedUser).toContain('Crie um reels sobre a abertura de vendas');
    expect(capturedUser).toContain('Conceito: X');
    expect(capturedUser).toContain('roteiro, legenda');
    expect(result.scores.strategy).toBe(9);
  });
});
