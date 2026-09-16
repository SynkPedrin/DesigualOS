import { describe, expect, it } from 'vitest';
import {
  CONTEXT_BLOCK_MARKER,
  classifyRetrievalDepth,
  depthPolicy,
  planTurnDepth,
  stripOrchestratorContext,
} from './depth.js';

/**
 * Classificador puro: nada de IO, nada de rede. Os casos são pedidos reais em
 * pt-BR do jeito que chegam pelo chat, incluindo sem acento (é como muita
 * gente digita no celular) e com o bloco de contexto do Orchestrator grudado.
 */

describe('classifyRetrievalDepth: FAST', () => {
  it.each([
    'Me da uma headline pra esse post da pizzaria.',
    'Me dá uma headline pra esse post da pizzaria.',
    'Troca o CTA desse anuncio por um mais direto.',
    'Escreve uma legenda pra essa foto',
    'Encurta esse texto, ficou grande demais',
    'Me da so uma ideia de gancho',
    'Reescreve essa chamada com mais urgencia',
    'Preciso de um slogan',
  ])('trata entrega curta como fast: %s', (message) => {
    expect(classifyRetrievalDepth(message).depth).toBe('fast');
  });

  it('mensagem curta sem nenhum cue cai em fast por tamanho', () => {
    const decision = classifyRetrievalDepth('e agora, o que você acha?');
    expect(decision.depth).toBe('fast');
    expect(decision.reason).toBe('short_message');
    expect(decision.signals).toEqual([]);
  });

  it('entrega pequena ganha de assunto grande citado em volta', () => {
    // O pedido menciona a campanha, mas a ENTREGA é uma headline.
    const decision = classifyRetrievalDepth('Me da uma headline pra campanha de natal');
    expect(decision.depth).toBe('fast');
    expect(decision.reason).toBe('fast_cue');
    expect(decision.signals).toContain('headline');
  });
});

describe('classifyRetrievalDepth: STANDARD', () => {
  it.each([
    'Preciso de uma campanha para o lancamento do novo rodizio da pizzaria',
    'Monta o briefing dessa peca',
    'Crie um carrossel sobre o funil de demanda pro cliente',
    'Me ajuda com o roteiro do reels',
    'Qual conceito criativo pra promocao de aniversario da loja',
  ])('trata trabalho de uma peca/campanha como standard: %s', (message) => {
    expect(classifyRetrievalDepth(message).depth).toBe('standard');
  });

  it('mensagem longa sem cue nenhum cai em standard, nao em fast', () => {
    const longMessage =
      'Estamos conversando sobre o cliente novo que entrou esse mes e queria sua leitura sobre o que a gente pode fazer com o material que eles mandaram, tem bastante coisa e o time comercial quer uma resposta ainda essa semana pra fechar o escopo.';
    expect(longMessage.length).toBeGreaterThan(180);
    const decision = classifyRetrievalDepth(longMessage);
    expect(decision.depth).toBe('standard');
    expect(decision.reason).toBe('default');
  });
});

describe('classifyRetrievalDepth: DEEP', () => {
  it.each([
    'Quero repensar o posicionamento e a arquitetura de marca da Bravvo',
    'Vamos fazer um rebranding completo',
    'Preciso do go to market do produto novo',
    'Monta a identidade visual da marca',
    'Qual o planejamento anual de conteudo',
  ])('trata trabalho de marca inteira como deep: %s', (message) => {
    expect(classifyRetrievalDepth(message).depth).toBe('deep');
  });

  it('deep ganha de fast quando os dois vocabularios aparecem', () => {
    const decision = classifyRetrievalDepth('Ajusta o posicionamento da marca pro ano que vem');
    expect(decision.depth).toBe('deep');
    expect(decision.reason).toBe('deep_cue');
    expect(decision.signals).toContain('posicionamento');
  });
});

describe('classifyRetrievalDepth: robustez', () => {
  it('ignora o bloco de contexto do Orchestrator', () => {
    // Um aprendizado antigo sobre reposicionamento não pode transformar um
    // pedido novo de headline num turno DEEP (é o mesmo bug que já tinha sido
    // corrigido na detecção de intenção de produção).
    const message = `Me da uma headline pra esse post${CONTEXT_BLOCK_MARKER}Aprendizado recente: Otto trabalhou no reposicionamento e na arquitetura de marca do cliente X.`;
    expect(classifyRetrievalDepth(message).depth).toBe('fast');
  });

  it('nao casa cue dentro de outra palavra', () => {
    // "bio" em "Biofit" e "cta" em "espectador" não são pedidos de bio/CTA.
    const decision = classifyRetrievalDepth('O que o espectador da Biofit espera ver nessa peca de midia');
    expect(decision.signals).not.toContain('bio');
    expect(decision.signals).not.toContain('cta');
  });

  it('mensagem vazia nao explode e vira fast', () => {
    expect(classifyRetrievalDepth('').depth).toBe('fast');
  });

  it('e deterministico: mesma entrada, mesma saida', () => {
    const message = 'Preciso de uma campanha para o lancamento';
    expect(classifyRetrievalDepth(message)).toEqual(classifyRetrievalDepth(message));
  });

  it('custa muito menos que qualquer chamada de modelo', () => {
    // O ponto do classificador é ser mais barato que o que ele evita. 1000
    // classificações têm que caber com folga em 50 ms.
    const startedAt = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      classifyRetrievalDepth('Preciso de uma campanha para o lancamento do novo rodizio da pizzaria Bravvo');
    }
    expect(performance.now() - startedAt).toBeLessThan(50);
  });
});

describe('stripOrchestratorContext', () => {
  it('devolve so o turno do usuario', () => {
    expect(stripOrchestratorContext(`pergunta${CONTEXT_BLOCK_MARKER}contexto anexado`)).toBe('pergunta');
  });

  it('devolve a mensagem intacta quando nao ha bloco de contexto', () => {
    expect(stripOrchestratorContext('pergunta solta')).toBe('pergunta solta');
  });
});

describe('depthPolicy', () => {
  it('fast e o turno mais barato: menos docs, snippet menor, sem STUDIO-BRAIN, sem raciocinio', () => {
    const policy = depthPolicy('fast');
    expect(policy.includeStudioBrain).toBe(false);
    expect(policy.suppressThinking).toBe(true);
    expect(policy.maxDocs).toBeLessThan(depthPolicy('standard').maxDocs);
    expect(policy.snippetLength).toBeLessThan(depthPolicy('standard').snippetLength);
  });

  it('nenhum nivel deixa o modelo raciocinar sozinho, nem o deep', () => {
    // Medido: turno DEEP com raciocínio passou de 600s, e o timeout de
    // produção é 120s. Profundidade vem de contexto, não de monólogo.
    for (const depth of ['fast', 'standard', 'deep'] as const) {
      expect(depthPolicy(depth).suppressThinking).toBe(true);
    }
  });

  it('o custo de contexto cresce monotonicamente com a profundidade', () => {
    const [fast, standard, deep] = [depthPolicy('fast'), depthPolicy('standard'), depthPolicy('deep')];
    expect(fast.maxDocs).toBeLessThan(standard.maxDocs);
    expect(standard.maxDocs).toBeLessThan(deep.maxDocs);
    expect(fast.snippetLength).toBeLessThan(standard.snippetLength);
    expect(standard.snippetLength).toBeLessThan(deep.snippetLength);
  });
});

describe('planTurnDepth', () => {
  it('junta decisao e parametros num objeto so', () => {
    const plan = planTurnDepth('Me da uma headline pra esse post');
    expect(plan.depth).toBe('fast');
    expect(plan.reason).toBe('fast_cue');
    expect(plan.policy).toEqual(depthPolicy('fast'));
  });
});
