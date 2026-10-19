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

/** Regressão 24/09/2026: pergunta operacional óbvia caía no esclarecimento. */
describe('AUTO: pedido operacional decide sem depender da classifier', () => {
  const LIMIAR = 0.7;
  const operacionais = [
    'quais as demandas da Alícia?',
    'qual o processo de onboarding de cliente?',
    'quem tá com a task do site?',
    'tem algo atrasado?',
    'qual o prazo disso?',
  ];
  for (const frase of operacionais) {
    it(`"${frase}" -> bento acima do limiar`, () => {
      const m = matchRule(frase);
      expect(m?.rule.primaryAgent).toBe('bento');
      expect(m!.confidence).toBeGreaterThanOrEqual(LIMIAR);
    });
  }

  it('pedido criativo continua no Otto mesmo citando cliente', () => {
    expect(matchRule('faz uma legenda pra 3Net')?.rule.primaryAgent).toBe('otto');
  });

  it('pergunta de mídia paga continua no Jarbas', () => {
    expect(matchRule('qual o cpa desse mês')?.rule.primaryAgent).toBe('jarbas');
  });
});

/** Regressão: casos que caíam em esclarecimento por falta de regra. */
describe('AUTO: frases coloquiais decidem por regra', () => {
  it('"o que tá pegando fogo na agência?" -> bento', () => {
    const m = matchRule('o que tá pegando fogo na agência?');
    expect(m?.rule.primaryAgent).toBe('bento');
    expect(m!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('"manda mensagem pro lead no whatsapp" -> suzy', () => {
    const m = matchRule('manda mensagem pro lead no whatsapp');
    expect(m?.rule.primaryAgent).toBe('suzy');
    expect(m!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('métrica de lead/whatsapp continua no Jarbas', () => {
    expect(matchRule('quantos leads tivemos esse mês? qual o cpl')?.rule.primaryAgent).toBe('jarbas');
  });
});

/**
 * Medido em 29/09/2026 com o classificador local decidindo (a pessoa não
 * escolheu agente nenhum, que é o caso normal):
 *
 *   "o que está em risco hoje"           -> jarbas, confiança 1.0
 *   "o que está em risco na Cosentino?"  -> jarbas, confiança 0.8
 *
 * A pergunta central da gestão da operação ia pro agente de mídia, e a análise
 * causal ficava inalcançável pela forma mais natural de perguntar. Apareceu nas
 * personas da Tammy no navegador, onde ninguém clica em chip antes de falar.
 */
describe('risco é pergunta de operação, não de mídia paga', () => {
  it.each([
    'o que está em risco hoje',
    'o que está em risco na Cosentino? me explica o porquê',
    'tem algum risco pra essa semana',
    'quais os riscos da operação',
  ])('%s -> bento', (m) => {
    const r = matchRule(m);
    expect(r?.rule.primaryAgent, `"${m}" precisa ir pro Bento`).toBe('bento');
  });

  /** Mídia continua com o Jarbas: o vocabulário dela é outro. */
  it.each(['qual o CPA da campanha', 'como está o ROAS esse mês', 'quanto investimos no Meta'])(
    '%s NÃO vira operação por causa desta regra',
    (m) => {
      expect(matchRule(m)?.rule.primaryAgent).not.toBe('bento');
    },
  );
});

/**
 * Achado da sessão de auditoria com o harness de roteamento sem hint
 * (scripts/intelligence-routing-check.mts), 29/09/2026. Mesma classe do
 * "em risco": o classificador 3B lê "estado" e "aconteceu" como vocabulário de
 * desempenho de mídia.
 *
 *   "Qual é o estado atual do Desigual OS?" -> jarbas, confiança 1.0
 *   "Qual é o estado do Citável?"           -> jarbas, confiança 0.8
 *   "O que aconteceu ontem?"                -> jarbas, confiança 0.8
 *
 * As duas primeiras são as perguntas sobre os projetos INTERNOS da agência.
 */
describe('estado e "o que aconteceu" são operação', () => {
  it.each([
    'Qual é o estado atual do Desigual OS?',
    'Qual é o estado do Citável?',
    'O que aconteceu ontem?',
    'qual o estado da operação',
  ])('%s -> bento', (m) => {
    expect(matchRule(m)?.rule.primaryAgent).toBe('bento');
  });

  /**
   * A cerca do outro lado. Consertar o roteamento empurrando tudo pro Bento
   * seria trocar um erro por outro, e o Jarbas é quem responde mídia.
   */
  it.each([
    'como está o CPA da campanha da D. Carvalho?',
    'o ROAS caiu essa semana?',
  ])('%s continua no Jarbas', (m) => {
    expect(matchRule(m)?.rule.primaryAgent).toBe('jarbas');
  });
});

/**
 * O classificador local é um 3B que divide a máquina com um modelo de 24 GB.
 * Medido em 29/09/2026: com o grande residente (/api/ps mostrando
 * qwen3.6:35b-a3b), classifyLocally devolve TimeoutError, a decisão cai num
 * casamento fraco de regra e a pergunta de MÍDIA vai parar no Bento — sem
 * nenhuma linha de código ter mudado.
 *
 * Vocabulário de mídia é determinístico. Depender de modelo pra ele foi a
 * escolha errada: estas frases decidem sem rede e sem GPU.
 */
describe('mídia decide por regra, não por modelo que pode estar fora', () => {
  it.each([
    'quanto gastamos em Meta Ads esse mês?',
    'qual criativo está performando melhor?',
    'quanto investimos em mídia no trimestre',
    'qual o custo por clique da campanha',
  ])('%s -> jarbas, sem depender do classificador', (m) => {
    expect(matchRule(m)?.rule.primaryAgent).toBe('jarbas');
  });

  /** E a cerca do outro lado continua: operação não virou mídia. */
  it.each(['o que está em risco hoje', 'me mostra o que ta atrasado', 'o que aconteceu ontem?'])(
    '%s continua no Bento',
    (m) => {
      expect(matchRule(m)?.rule.primaryAgent).toBe('bento');
    },
  );
});

/**
 * Bug reportado em produção (01/10/2026): "Quem é o decisor do Cliente Teste 7?"
 * recebeu PEDIDO DE ESCLARECIMENTO. Nenhuma regra cobria fato de cliente
 * (decisor, orçamento), o classifier local estava indisponível e a paga sem
 * chave — a decisão caía no fallback. A resposta é recuperável pela memória do
 * cliente (Bento); esclarecimento aqui é sempre errado.
 */
describe('fato sobre cliente nomeado é pergunta de conhecimento, nunca esclarecimento', () => {
  const LIMIAR = 0.7;

  it.each([
    'Quem é o decisor do Cliente Teste 7?',
    'quem é o decisor da Cosentino?',
    'quem decide o orçamento na 3Net?',
    'qual o orçamento do Cliente Teste 7?',
    'qual é o orcamento mensal da Elite?',
    'quando é a entrega do Cliente Teste 7?',
    'quem é o responsável pelo Cliente Teste 7?',
  ])('"%s" -> bento acima do limiar, sem depender de classifier', (m) => {
    const r = matchRule(m);
    expect(r?.rule.primaryAgent).toBe('bento');
    expect(r?.rule.intent).toBe('knowledge_query');
    expect(r!.confidence).toBeGreaterThanOrEqual(LIMIAR);
  });

  /** A cerca do outro lado: verba de MÍDIA continua com o Jarbas. */
  it.each(['quanto investimos em Meta Ads esse mês?', 'qual a verba de mídia do trimestre?'])(
    '%s continua no Jarbas',
    (m) => {
      expect(matchRule(m)?.rule.primaryAgent).toBe('jarbas');
    },
  );

  /**
   * A CARTEIRA, medida no chat de produção em 08/10/2026.
   *
   * "operação: me lista as minhas tarefas abertas" devolveu 414 tarefas reais;
   * "quantos clientes ativos existem na carteira hoje?", na mesma sessão,
   * devolveu pedido de esclarecimento. A diferença era a palavra "operação"
   * escrita na frente — que ninguém escreve no uso de verdade.
   */
  it.each([
    'quantos clientes ativos existem na carteira hoje?',
    'como está a carteira esse mês?',
    'quantos clientes a gente atende?',
  ])('"%s" -> bento acima do limiar (a carteira é operação)', (m) => {
    const r = matchRule(m);
    expect(r?.rule.primaryAgent).toBe('bento');
    expect(r!.confidence).toBeGreaterThanOrEqual(LIMIAR);
  });

  /**
   * A cerca do outro lado da carteira: pergunta de MÍDIA que cita cliente não
   * pode ser capturada por este vocabulário novo.
   */
  it.each([
    'qual o CPA das campanhas da Elite esse mês?',
    'como está o ROAS do Meta Ads da 3Net?',
  ])('%s continua no Jarbas depois da regra de carteira', (m) => {
    expect(matchRule(m)?.rule.primaryAgent).toBe('jarbas');
  });

  /** E o genuinamente ambíguo continua sem regra (vai pro esclarecimento legítimo). */
  it.each(['oi, tudo bem?', 'me ajuda com isso'])('%s não casa regra', (m) => {
    expect(matchRule(m)).toBeNull();
  });
});
