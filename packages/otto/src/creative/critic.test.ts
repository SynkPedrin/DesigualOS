import { describe, expect, it } from 'vitest';
import {
  computeMissingDeliverables,
  critiqueDeliverable,
  deliverableRegression,
  deriveCriticOverall,
  detectPlaceholderContent,
  explainDeliverableGap,
  formatCriticRevisionNote,
  looksLikeScriptContent,
  looksLikeSequencedScript,
  looksLikeCreativeBrief,
  passesCriticGate,
  reconcileRootCause,
  rewriteRequiresStrategyLayer,
} from './critic.js';
import type { CriticEvaluation, CriticRootCause } from './schemas.js';

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
  return { scores: baseScores, flags: baseFlags, reasoning: 'ok', root_cause: 'NONE', ...overrides };
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

describe('validação semântica de entregável (Otto Elite, Blocker 1)', () => {
  const rotulos = 'Conceito: X\n\nLegenda: ';

  /**
   * REGRESSÃO REAL: a validação ao vivo Cosentino marcou missing_deliverables=[]
   * com uma "Legenda:" que na verdade era um roteiro duplicado com timestamps
   * ("[00:00-00:03]", "(Roteiro - Voz off masculina...)"). Presença do rótulo
   * não é suficiente — o CONTEÚDO precisa ter cara de legenda.
   */
  it('teste 1: "Legenda:" com timestamps/cenas repetidos NÃO é considerada legenda válida', () => {
    const resposta =
      `${rotulos}(Roteiro - Voz off)\n\n[00:00 - 00:03]\nImagem: mãos com papéis.\nFala: "Você já parou pra pensar?"\n\n[00:04 - 00:12]\nImagem: chave girando.\nFala: "Na Cosentino você não precisa se cadastrar."`;
    expect(computeMissingDeliverables(resposta, ['legenda'])).toEqual(['legenda']);
    expect(looksLikeScriptContent('(Roteiro - Voz off)\n\n[00:00 - 00:03]\nImagem: mãos com papéis.\nFala: "x"\n\n[00:04 - 00:12]\nImagem: chave.\nFala: "y"')).toBe(true);
  });

  it('teste 2: legenda em prosa natural, sem estrutura de cena, PASSA', () => {
    const resposta = `${rotulos}Cansou de formulário pra tudo? Na Cosentino você entra direto no seu novo lar, sem papelada, sem enrolação. Jardim Europa V abre hoje. 📲 Link na bio.`;
    expect(computeMissingDeliverables(resposta, ['legenda'])).toEqual([]);
    expect(looksLikeScriptContent('Cansou de formulário pra tudo? Na Cosentino você entra direto no seu novo lar, sem papelada.')).toBe(false);
  });

  it('teste 3: um roteiro completo não satisfaz o pedido de legenda (mesmo texto, entregável diferente)', () => {
    const roteiro = 'Cena 1 (3s):\nVisual: mãos com papéis.\nFala: "Você já parou pra pensar?"\n\nCena 2 (3s):\nVisual: chave girando.\nFala: "Sem burocracia."';
    expect(looksLikeScriptContent(roteiro)).toBe(true);
    expect(computeMissingDeliverables(`Conceito: X\n\nLegenda: ${roteiro}`, ['legenda'])).toEqual(['legenda']);
  });

  it('teste 4: uma legenda em prosa não satisfaz o pedido de roteiro (falta estrutura de cena/sequência)', () => {
    const legenda = 'Cansou de formulário pra tudo? Na Cosentino você entra direto no seu novo lar, sem papelada.';
    expect(looksLikeSequencedScript(legenda)).toBe(false);
    expect(computeMissingDeliverables(`Conceito: X\n\nRoteiro:\n\n${legenda}`, ['roteiro'])).toEqual(['roteiro']);
  });

  it('roteiro real com "Cena N"/"Visual:"/"Fala:" passa no teste de estrutura de sequência', () => {
    const roteiro = 'Cena 1 (3s):\nVisual: mãos com papéis.\nFala: "Você já parou pra pensar?"';
    expect(looksLikeSequencedScript(roteiro)).toBe(true);
    expect(computeMissingDeliverables(`Conceito: X\n\nRoteiro:\n\n${roteiro}`, ['roteiro'])).toEqual([]);
  });

  it('explainDeliverableGap explica que a legenda existe mas está no formato errado (pra reparo substituir, não regenerar tudo)', () => {
    const resposta = `${rotulos}[00:00-00:03]\nCena 1:\nImagem: x.\nFala: "a"\n\nCena 2:\nImagem: y.\nFala: "b"`;
    const explicacao = explainDeliverableGap('legenda', resposta);
    expect(explicacao).toMatch(/substitua SÓ essa seção/);
  });

  it('explainDeliverableGap devolve só o id quando o entregável nunca existiu (repare adicionando, não substituindo)', () => {
    expect(explainDeliverableGap('legenda', 'Conceito: X')).toBe('legenda');
  });
});

describe('deliverableRegression (Blocker 2)', () => {
  it('detecta entregável que existia antes e sumiu depois', () => {
    expect(deliverableRegression([], ['roteiro'])).toEqual(['roteiro']);
  });

  it('não conta entregável que já faltava antes (não é uma regressão nova)', () => {
    expect(deliverableRegression(['roteiro'], ['roteiro'])).toEqual([]);
  });

  it('sem mudança nenhuma, sem regressão', () => {
    expect(deliverableRegression([], [])).toEqual([]);
  });

  it('entregável CORRIGIDO (estava faltando, agora não está) não é regressão', () => {
    expect(deliverableRegression(['roteiro', 'legenda'], ['legenda'])).toEqual([]);
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

  /**
   * Blocker 4: "elite_passed can NEVER be true if unsupported_claims.length
   * > 0" — o gate do critic precisa reprovar por isso sozinho, senão nenhuma
   * reescrita é sequer disparada pra corrigir o fato (achado ao vivo real:
   * "sem burocracia" ficou sem correção porque REWRITE #1 quebrou em schema
   * antes de tocar em conteúdo, e nada tinha reprovado por causa do fato).
   */
  it('teste 7: reprova sempre que há unsupported_claims, mesmo com todos os scores altos', () => {
    const result = passesCriticGate(evaluation({ flags: { ...baseFlags, unsupported_claims: ['sem burocracia'] } }));
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('sem burocracia'))).toBe(true);
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

describe('rewriteRequiresStrategyLayer (Missão 16)', () => {
  it('STRATEGY, ANGLE, BIG_IDEA e HOOK exigem regenerar a camada estratégica', () => {
    const causes: CriticRootCause[] = ['STRATEGY', 'ANGLE', 'BIG_IDEA', 'HOOK'];
    for (const cause of causes) {
      expect(rewriteRequiresStrategyLayer(cause), cause).toBe(true);
    }
  });

  it('COPY, STRUCTURE, BRAND_FIT, EXECUTABILITY, FACTUAL, DELIVERABLE, NONE só exigem reescrever o texto', () => {
    const causes: CriticRootCause[] = ['COPY', 'STRUCTURE', 'BRAND_FIT', 'EXECUTABILITY', 'FACTUAL', 'DELIVERABLE', 'NONE'];
    for (const cause of causes) {
      expect(rewriteRequiresStrategyLayer(cause), cause).toBe(false);
    }
  });
});

describe('reconcileRootCause (Otto Elite, Blocker 3)', () => {
  /**
   * REGRESSÃO REAL: validação ao vivo Cosentino — overall=87 (abaixo do
   * corte de 88), gate reprovado, e root_cause="NONE" retornado pelo
   * modelo. Logicamente inconsistente: "Do NOT trust the critic's NONE
   * blindly" — o código precisa classificar algo sempre que o gate reprova.
   */
  it('teste 6: gate reprovado + root_cause=NONE nunca sobrevive — é reclassificado', () => {
    const scores = { ...baseScores, retention: 7, hook: 8, copy: 8 };
    const evalInconsistente = evaluation({ scores, root_cause: 'NONE' });
    const gate = passesCriticGate(evalInconsistente);
    expect(gate.passed).toBe(false); // overall < 88 por causa do retention baixo
    const corrigido = reconcileRootCause(evalInconsistente, gate);
    expect(corrigido).not.toBe('NONE');
  });

  it('entregável faltando tem prioridade sobre dimensão fraca (determinístico > julgamento)', () => {
    const evalComFaltante = evaluation({
      scores: { ...baseScores, hook: 6 },
      flags: { ...baseFlags, missing_deliverables: ['roteiro'] },
      root_cause: 'NONE',
    });
    const gate = passesCriticGate(evalComFaltante, ['roteiro']);
    expect(reconcileRootCause(evalComFaltante, gate, ['roteiro'])).toBe('DELIVERABLE');
  });

  it('alegação sem base tem prioridade sobre dimensão fraca quando não há entregável faltando', () => {
    const evalComAlegacao = evaluation({
      scores: { ...baseScores, hook: 6 },
      flags: { ...baseFlags, unsupported_claims: ['sem burocracia'] },
      root_cause: 'NONE',
    });
    const gate = passesCriticGate(evalComAlegacao);
    expect(reconcileRootCause(evalComAlegacao, gate)).toBe('FACTUAL');
  });

  it('sem entregável faltando nem alegação, cai na dimensão mais fraca (concept fraco -> BIG_IDEA)', () => {
    const evalFraco = evaluation({ scores: { ...baseScores, concept: 5 }, root_cause: 'NONE' });
    const gate = passesCriticGate(evalFraco);
    expect(reconcileRootCause(evalFraco, gate)).toBe('BIG_IDEA');
  });

  it('não mexe no root_cause quando o gate passou', () => {
    const evalAprovado = evaluation({ root_cause: 'NONE' });
    const gate = passesCriticGate(evalAprovado);
    expect(gate.passed).toBe(true);
    expect(reconcileRootCause(evalAprovado, gate)).toBe('NONE');
  });

  it('não mexe no root_cause quando o modelo já classificou algo diferente de NONE', () => {
    const evalClassificado = evaluation({ scores: { ...baseScores, hook: 5 }, root_cause: 'HOOK' });
    const gate = passesCriticGate(evalClassificado);
    expect(reconcileRootCause(evalClassificado, gate)).toBe('HOOK');
  });
});

describe('formatCriticRevisionNote com root_cause', () => {
  it('inclui a causa raiz classificada na nota, quando reprovado', () => {
    const evalComCausa = evaluation({ scores: { ...baseScores, hook: 5 }, root_cause: 'HOOK' });
    const gate = passesCriticGate(evalComCausa);
    const note = formatCriticRevisionNote(evalComCausa, gate);
    expect(note).toMatch(/Causa raiz \(camada que falhou\): HOOK/);
  });

  it('não menciona causa raiz quando root_cause é NONE', () => {
    const evalSemCausa = evaluation({ scores: { ...baseScores, hook: 5 }, root_cause: 'NONE' });
    const gate = passesCriticGate(evalSemCausa);
    const note = formatCriticRevisionNote(evalSemCausa, gate);
    expect(note).not.toMatch(/Causa raiz/);
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

  /**
   * Blocker 4 (Otto Elite, achado ao vivo real): o critic aprovou "sem
   * papelada", "as chaves já estão na sua mão" e "garanta sua vaga" quando
   * o briefing só dizia "sem cadastro", "abertura de vendas" e nada sobre
   * escassez. O prompt precisa instruir explicitamente que reformulação
   * criativa não pode FORTALECER o fato original.
   */
  it('system prompt instrui o critic a não deixar reformulação criativa fortalecer o fato original (Blocker 4)', async () => {
    let capturedSystem = '';
    const llm = {
      chat: () => Promise.reject(new Error('not expected')),
      chatJson: (messages: unknown) => {
        const list = messages as { role: string; content: string }[];
        capturedSystem = list.find((m) => m.role === 'system')?.content ?? '';
        return Promise.resolve(evaluation());
      },
      healthCheck: () => Promise.reject(new Error('not expected')),
    };

    await critiqueDeliverable({ llm: llm as never }, { briefing: 'x', renderedAnswer: 'y' });

    expect(capturedSystem).toMatch(/FORTALECE o fato original/);
    expect(capturedSystem).toMatch(/sem necessidade de cadastro.*sem papelada/s);
    expect(capturedSystem).toMatch(/abertura de vendas.*chaves já estão na sua mão/s);
    expect(capturedSystem).toMatch(/garanta sua vaga/);
  });

  /** Missão 14: o critic precisa ver a direção estratégica pra avaliar fidelidade, não só o texto final isolado. */
  it('manda o strategyContext quando fornecido, pro critic avaliar fidelidade à estratégia', async () => {
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

    await critiqueDeliverable(
      { llm: llm as never },
      {
        briefing: 'Crie um reels',
        renderedAnswer: 'Conceito: X',
        strategyContext: 'DIREÇÃO ESTRATÉGICA DESTA PEÇA:\nIdeia central (big idea): A chave que nunca esperou.',
      },
    );

    expect(capturedUser).toContain('DIREÇÃO ESTRATÉGICA DESTA PEÇA');
    expect(capturedUser).toContain('A chave que nunca esperou.');
  });
});

describe('looksLikeCreativeBrief (Otto Senior V1, "Universal Quality Floor")', () => {
  /**
   * REGRESSÃO REAL: pedido de "briefing criativo" degradava pro mesmo
   * formato de "Conceito: X / Legenda: Y" — um rótulo "Briefing:" na
   * frente não fazia (nem faz) de um texto um briefing de verdade.
   */
  it('teste: caption disfarçada de briefing ("Conceito: X / Legenda: Y") NÃO passa (achado ao vivo real)', () => {
    const falsoBriefing = 'Conceito: Transformar desconhecidos em clientes.\n\nLegenda: Descubra como a Mendes & Prado pode ajudar sua empresa.';
    expect(looksLikeCreativeBrief(falsoBriefing)).toBe(false);
  });

  it('briefing real, com seções suficientes rotuladas, passa', () => {
    const briefingReal = [
      'Objetivo: gerar leads qualificados via LinkedIn.',
      'Público: diretores financeiros de empresas de médio porte.',
      'Insight: decisores hesitam em reestruturar por medo de expor fragilidade.',
      'Mensagem Central: reestruturar cedo é proteger o que já foi construído.',
      'Tom: sério, técnico, confiável.',
      'CTA: agende uma conversa inicial sem compromisso.',
    ].join('\n\n');
    expect(looksLikeCreativeBrief(briefingReal)).toBe(true);
  });

  it('poucas seções (abaixo do mínimo) não passa', () => {
    const briefingIncompleto = 'Objetivo: gerar leads.\n\nTom: sério.';
    expect(looksLikeCreativeBrief(briefingIncompleto)).toBe(false);
  });

  it('texto vazio não passa', () => {
    expect(looksLikeCreativeBrief('')).toBe(false);
  });
});

describe('detectPlaceholderContent (Otto Senior V1, checagem leve de placeholder)', () => {
  it('detecta "texto aqui"', () => {
    expect(detectPlaceholderContent('Legenda: texto aqui')).toContain('texto aqui');
  });

  it('detecta "lorem ipsum"', () => {
    expect(detectPlaceholderContent('Legenda: Lorem ipsum dolor sit amet')).toEqual(expect.arrayContaining([expect.stringMatching(/lorem ipsum/i)]));
  });

  it('detecta colchete de variável não substituída ("[nome da marca]")', () => {
    expect(detectPlaceholderContent('CTA: compre já em [nome da marca]')).toEqual(expect.arrayContaining(['[nome da marca]']));
  });

  it('detecta chave de variável não substituída ("{cliente}")', () => {
    expect(detectPlaceholderContent('Legenda: bem-vindo à {cliente}')).toEqual(expect.arrayContaining(['{cliente}']));
  });

  it('NÃO confunde "[A CONFIRMAR: ...]" (lacuna declarada de propósito) com placeholder esquecido', () => {
    expect(detectPlaceholderContent('Legenda: o preço é [A CONFIRMAR: valor final com o time comercial]')).toEqual([]);
  });

  it('NÃO confunde "[DADO A CONFIRMAR: ...]" com placeholder esquecido', () => {
    expect(detectPlaceholderContent('Roteiro: entrega em [DADO A CONFIRMAR: prazo]')).toEqual([]);
  });

  it('texto real, sem placeholder nenhum, não dispara nada', () => {
    expect(detectPlaceholderContent('Conceito: A chave que nunca esperou.\n\nLegenda: Sua próxima decisão começa aqui, sem fila.')).toEqual([]);
  });
});
