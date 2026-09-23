import { describe, expect, it } from 'vitest';
import {
  blocoDeContinuacaoCriativa,
  contratoDeSaida,
  diretivaDoContrato,
  ehRevisaoEliptica,
  exigeFrescorOperacional,
  parseRequestedSlideCount,
} from './output-contract.js';

describe('three_titles_returns_three_titles', () => {
  it('lê o artefato e a quantidade do pedido', () => {
    expect(contratoDeSaida('Me dá 3 títulos para um carrossel dos 70 anos da Elite.')).toEqual({
      artefato: 'titulo',
      quantidade: 3,
    });
  });

  it('entende número por extenso, que é como a equipe fala', () => {
    expect(contratoDeSaida('me manda três títulos')).toEqual({ artefato: 'titulo', quantidade: 3 });
  });

  it('a diretiva exige a quantidade exata', () => {
    const d = diretivaDoContrato({ artefato: 'titulo', quantidade: 3 });
    expect(d).toMatch(/exatamente 3/);
  });
});

describe('three_headlines_does_not_return_captions', () => {
  it('headline é artefato próprio, não legenda', () => {
    expect(contratoDeSaida('escreve 3 headlines pro anúncio').artefato).toBe('headline');
  });

  it('a diretiva proíbe explicitamente devolver legenda ou post', () => {
    const d = diretivaDoContrato({ artefato: 'headline', quantidade: 3 });
    expect(d).toMatch(/NÃO devolva legenda/);
    expect(d).toMatch(/uma linha/i);
  });

  it('e diz que título não tem CTA nem hashtag — é o que o separa de legenda', () => {
    expect(diretivaDoContrato({ artefato: 'titulo', quantidade: 3 })).toMatch(/não tem CTA e não tem hashtag/i);
  });
});

describe('caption_request_returns_caption', () => {
  it('pedido de legenda continua sendo legenda', () => {
    expect(contratoDeSaida('escreve uma legenda de Instagram sobre seguro residencial').artefato).toBe('legenda');
  });

  it('e a forma final mantém a regra de colar', () => {
    const d = diretivaDoContrato({ artefato: 'legenda', quantidade: null });
    expect(d).toMatch(/hashtags na última linha/i);
    expect(d).toMatch(/CTA em bloco próprio/i);
  });
});

describe('script_request_returns_script', () => {
  it('roteiro é roteiro', () => {
    expect(contratoDeSaida('faz um roteiro de Reels de 20 segundos').artefato).toBe('roteiro');
  });

  it('roteiro ganha marcação de tempo, senão quem grava não executa', () => {
    expect(diretivaDoContrato({ artefato: 'roteiro', quantidade: null })).toMatch(/marcação de tempo/i);
  });

  it('roteiro vence "post" na mesma frase: o mais específico manda', () => {
    expect(contratoDeSaida('roteiro pro post de Reels').artefato).toBe('roteiro');
  });
});

/**
 * REGRESSÃO REAL: Jardim Europa V (Cosentino), 22/09/2026.
 *
 * "roteiro ... sugestão de imagem para as telas e uma legenda complementar
 * bem escrita" pede DOIS entregáveis nomeados (roteiro e legenda) no mesmo
 * turno. A versão anterior de contratoDeSaida via só 'roteiro' (primeiro
 * match) e diretivaDoContrato mandava "entregue roteiro, e só isso" —
 * contradizendo a REGRA 2 do CHAT_SYSTEM_PROMPT (entregar todos os
 * entregáveis pedidos) e vencendo ela, porque o contrato "vale sobre
 * qualquer regra de formato acima". Isso apagava a legenda pedida.
 */
describe('multi_deliverable_request_returns_all_named_deliverables', () => {
  const PEDIDO =
    'Quero um roteiro com uma sequência de frases bem elaboradas para o vídeo explicando o que irá acontecer, ' +
    'sugestão de imagem para as telas e uma legenda complementar bem escrita.';

  it('reconhece roteiro como principal e legenda como adicional, conectada por "e"', () => {
    // quantidade:1 vem de "uma sequência de frases" — quantidadeDe não é
    // ancorada ao artefato, quirk pré-existente e fora do escopo deste fix.
    expect(contratoDeSaida(PEDIDO)).toEqual({
      artefato: 'roteiro',
      quantidade: 1,
      adicionais: ['legenda'],
    });
  });

  it('a diretiva manda entregar os DOIS, não travar num só', () => {
    const d = diretivaDoContrato(contratoDeSaida(PEDIDO));
    expect(d).toMatch(/MAIS DE UM entregável/);
    expect(d).toMatch(/roteiro, legenda/);
    expect(d).toMatch(/Entregue TODOS/);
    expect(d).not.toMatch(/e só isso/);
  });

  it('cada adicional ganha a própria forma final, não a do principal', () => {
    const d = diretivaDoContrato(contratoDeSaida(PEDIDO));
    expect(d).toMatch(/Forma final de roteiro: marcação de tempo/);
    expect(d).toMatch(/Forma final de legenda:.*hashtags na última linha/);
  });

  it('sinônimo solto do MESMO entregável continua sem adicional (regressão do fix anterior)', () => {
    expect(contratoDeSaida('roteiro pro post de Reels')).toEqual({ artefato: 'roteiro', quantidade: null });
  });
});

describe('prompt_request_returns_prompt', () => {
  it('prompt de imagem é prompt', () => {
    expect(contratoDeSaida('me dá um prompt de imagem pra capa').artefato).toBe('prompt');
  });

  it('e sai pronto pra colar, sem explicação no meio', () => {
    expect(diretivaDoContrato({ artefato: 'prompt', quantidade: null })).toMatch(/pronto pra colar/i);
  });
});

describe('contrato ausente', () => {
  it('pergunta sem artefato não ganha diretiva: constranger formato que ninguém pediu troca um erro por outro', () => {
    expect(contratoDeSaida('qual é o tom de voz da Fácil Seguros?')).toEqual({
      artefato: 'indefinido',
      quantidade: null,
    });
    expect(diretivaDoContrato({ artefato: 'indefinido', quantidade: null })).toBe('');
  });

  it('pedido sem quantidade não inventa uma', () => {
    expect(contratoDeSaida('escreve um título').quantidade).toBe(1);
    expect(contratoDeSaida('escreve título pra peça').quantidade).toBeNull();
  });

  it('ignora acento: quem digita rápido não acentua', () => {
    expect(contratoDeSaida('me da 3 titulos').artefato).toBe('titulo');
  });
});

/**
 * REVISÃO ELÍPTICA. "Faz de outro jeito" não nomeia artefato, ficava sem
 * contrato, e o modelo respondia com a coisa mais concreta do contexto — a
 * lista de tarefas do ClickUp. Contexto não é intenção.
 */
describe('do_it_another_way_revises_previous_artifact', () => {
  it('reconhece as formas que a equipe usa pra reprovar', () => {
    for (const q of [
      'Tá com cara de IA.',
      'Faz de outro jeito então.',
      'Não gostei.',
      'Uma versão pro cliente.',
      'Agora fecha uma versão final.',
      'ficou genérico',
    ]) {
      expect(ehRevisaoEliptica(q), q).toBe(true);
    }
  });

  it('briefing novo e longo não é continuação da peça anterior', () => {
    expect(
      ehRevisaoEliptica(
        'Faz de outro jeito considerando que agora o público é outro, o objetivo mudou para captação e a campanha vai ao ar em dezembro',
      ),
    ).toBe(false);
  });

  it('pedido comum não vira revisão', () => {
    expect(ehRevisaoEliptica('Me dá 3 títulos.')).toBe(false);
  });
});

describe('operational_context_does_not_override_creative_intent', () => {
  it('o bloco manda entregar a PEÇA, não status da conta', () => {
    const b = blocoDeContinuacaoCriativa('legenda');
    expect(b).toMatch(/Entregue legenda de novo, reescrita/);
    expect(b).toMatch(/não um status da conta, não uma lista de tarefas/);
  });

  it('this_feels_like_ai_triggers_creative_self_critique: manda mudar o ângulo, não sinônimo', () => {
    expect(blocoDeContinuacaoCriativa('legenda')).toMatch(/mude o ÂNGULO, não as palavras/);
    expect(blocoDeContinuacaoCriativa('legenda')).toMatch(/Trocar sinônimo não é refazer/);
  });

  it('sem artefato anterior conhecido, não inventa contrato', () => {
    expect(blocoDeContinuacaoCriativa('indefinido')).toBe('');
  });
});

/**
 * CONTINUIDADE SEM O BLOCO DA API (17/09/2026).
 *
 * Até aqui a peça anterior só chegava ao Otto porque a API concatenava o
 * histórico da conversa na mensagem — junto com o dossiê cru e a lista do
 * ClickUp, por fora do projetor. Fechado aquele caminho, a peça precisa vir
 * pela estrutura: o dispatch lê a última resposta do assistente e passa ela
 * aqui. Sem isso, "tá com cara de IA" sabe que houve uma legenda e não sabe
 * QUAL — não há o que reescrever.
 */
describe('otto_previous_artifact_survives_without_api_context_concat', () => {
  const PECA = 'Setenta anos não se comemora com bolo. Se comemora com quem ainda está aqui.';

  it('a peça anterior viaja literal no bloco de continuação', () => {
    const b = blocoDeContinuacaoCriativa('legenda', PECA);
    expect(b).toContain(PECA);
    expect(b).toMatch(/O QUE VOCÊ ENTREGOU NO TURNO ANTERIOR/);
  });

  it('e o contrato de reescrita continua junto: é a peça que está sendo criticada', () => {
    const b = blocoDeContinuacaoCriativa('legenda', PECA);
    expect(b).toMatch(/Entregue legenda de novo, reescrita/);
    expect(b).toMatch(/mude o ÂNGULO, não as palavras/);
  });

  it('peça longa é cortada, não despejada: continuidade não pode virar o novo contexto dominante', () => {
    const b = blocoDeContinuacaoCriativa('legenda', 'a'.repeat(5_000));
    expect(b.length).toBeLessThan(2_000);
  });

  it('sem peça anterior o bloco segue válido — só perde o texto de referência', () => {
    const b = blocoDeContinuacaoCriativa('legenda');
    expect(b).toMatch(/Entregue legenda de novo, reescrita/);
    expect(b).not.toMatch(/O QUE VOCÊ ENTREGOU NO TURNO ANTERIOR/);
  });

  it('resposta anterior vazia não abre seção vazia', () => {
    expect(blocoDeContinuacaoCriativa('legenda', '   ')).not.toMatch(/O QUE VOCÊ ENTREGOU/);
  });
});

/**
 * FRESCOR. O aviso de sincronização atrasada é o primeiro bloco do contexto e
 * vem em caixa alta. Protege turno operacional; num pedido criativo virou a
 * resposta inteira — "me dá 3 títulos" voltou com "o dado está atrasado" e sem
 * os títulos.
 */
describe('freshness_is_prioritized_for_operational_request', () => {
  it('pergunta sobre estado atual EXIGE frescor', () => {
    for (const q of [
      'E vê como tá operacionalmente.',
      'Qual o prazo disso?',
      'O que está pendente?',
      'Quem é o responsável?',
      'O que mudou hoje?',
    ]) {
      expect(exigeFrescorOperacional(q), q).toBe(true);
    }
  });

  it('pedido criativo puro NÃO exige', () => {
    for (const q of ['Me dá 3 títulos.', 'Tá com cara de IA.', 'Faz de outro jeito então.', 'Cria uma direção visual.']) {
      expect(exigeFrescorOperacional(q), q).toBe(false);
    }
  });

  it('freshness_degraded_does_not_block_creative_request: pedido misto mantém o aviso', () => {
    // "considerando o status atual, crie uma legenda" depende do agora.
    expect(exigeFrescorOperacional('Considerando o status atual, crie uma legenda.')).toBe(true);
  });

  it('na dúvida fica o aviso: "uma versão pro cliente" não fala de operação', () => {
    expect(exigeFrescorOperacional('Uma versão pro cliente.')).toBe(false);
  });
});

/**
 * REGRESSÃO REAL (Otto Senior V1, "Universal Quality Floor", Section 9):
 * pedido explícito de "8 slides" devolveu 10 — planCarousel era chamado com
 * a contagem hardcoded em execute.ts, nunca lendo o que o usuário pediu.
 */
describe('parseRequestedSlideCount (Otto Senior V1)', () => {
  it('teste 9a: "carrossel de 8 slides" -> 8, não o default de 10', () => {
    expect(parseRequestedSlideCount('Crie um carrossel de 8 slides para o cliente')).toBe(8);
  });

  it('teste 9b: "5 slides" -> 5', () => {
    expect(parseRequestedSlideCount('Quero um carrossel com 5 slides sobre o lançamento')).toBe(5);
  });

  it('"carrossel de 6" (sem a palavra slides) também é reconhecido', () => {
    expect(parseRequestedSlideCount('Faz um carrossel de 6 para o Instagram')).toBe(6);
  });

  it('"N cards" também conta como pedido de quantidade', () => {
    expect(parseRequestedSlideCount('Crie 7 cards para o carrossel')).toBe(7);
  });

  it('sem quantidade pedida, devolve null (quem chama decide o default do produto)', () => {
    expect(parseRequestedSlideCount('Crie um carrossel pro cliente')).toBeNull();
  });

  it('número fora da faixa razoável (0 ou > 20) devolve null', () => {
    expect(parseRequestedSlideCount('Crie um carrossel de 0 slides')).toBeNull();
    expect(parseRequestedSlideCount('Crie um carrossel de 45 slides')).toBeNull();
  });
});
