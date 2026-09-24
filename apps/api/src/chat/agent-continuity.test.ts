import { describe, expect, it } from 'vitest';
import { route, type RouterDecision } from '@desigual-os/router';
import { comContinuidadeDeAgente } from './agent-continuity.js';

/**
 * Os turnos reais do fluxo que quebrou, na ordem em que a Tammy os diria. As
 * decisões vêm do roteador DE VERDADE — a asserção não vale nada se o teste
 * inventar a confiança que quer.
 */
const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;

/**
 * O classifier local fala com o gateway da GPU. Aqui ele é desligado de
 * propósito: o que este arquivo testa é regra + continuidade, e uma chamada de
 * rede no meio disso só traz timeout e resultado que depende da máquina.
 */
const SEM_CLASSIFIER = { classificadorLocal: async () => null };

const CRIATIVOS = [
  'Me explica.',
  'Me dá 3 títulos.',
  'Agora faz uma legenda.',
  'Tá com cara de IA.',
  'Faz de outro jeito então.',
  'Uma versão pro cliente.',
  'Leva em conta o que falei ontem.',
  'E vê como tá operacionalmente.',
  'Agora fecha uma versão final.',
  'Coloca a data exata do evento no título.',
];

function decisao(over: Partial<RouterDecision> = {}): RouterDecision {
  return {
    intent: 'unclassified',
    primary_agent: 'bento',
    required_tools: [],
    context: [],
    estimated_complexity: 'low',
    workflow: null,
    confidence: 0,
    source: 'rule_engine',
    ...over,
  };
}

describe('otto_first_turn_with_vocative_routes_to_otto', () => {
  it('o vocativo abre a conversa no Otto, e continuidade não interfere', async () => {
    const d = await route('Otto, lembra daquela campanha de aniversário da Elite?', logger, SEM_CLASSIFIER);
    expect(d.primary_agent).toBe('otto');
    expect(comContinuidadeDeAgente(d, null).primary_agent).toBe('otto');
  });
});

describe('otto_followup_with_zero_confidence_stays_with_otto', () => {
  it('sem sinal novo, a conversa continua com quem estava', () => {
    const r = comContinuidadeDeAgente(decisao(), 'otto');
    expect(r.primary_agent).toBe('otto');
    expect(r.intent).toBe('continuidade_da_conversa');
  });

  it('e a confiança continua 0: o que mudou foi o destino, não a certeza', () => {
    expect(comContinuidadeDeAgente(decisao(), 'otto').confidence).toBe(0);
  });
});

describe('otto_three_titles_followup_routes_to_otto', () => {
  it('"Me dá 3 títulos." dentro da conversa do Otto vai pro Otto', async () => {
    const d = await route('Me dá 3 títulos.', logger, SEM_CLASSIFIER);
    // Desde 24/09/2026 "títulos" é palavra forte da regra criativa, então esta
    // frase decide sozinha (confiança 1) em vez de chegar no Otto pela
    // continuidade. O destino é o mesmo; o caminho é que ficou determinístico.
    expect(d.confidence).toBe(1);
    expect(d.primary_agent).toBe('otto');
    expect(comContinuidadeDeAgente(d, 'otto').primary_agent).toBe('otto');
  });
});

describe('otto_caption_followup_routes_to_otto', () => {
  it('"Agora faz uma legenda." também', async () => {
    const d = await route('Agora faz uma legenda.', logger, SEM_CLASSIFIER);
    expect(comContinuidadeDeAgente(d, 'otto').primary_agent).toBe('otto');
  });
});

describe('otto_revision_followup_routes_to_otto', () => {
  it('as três formas de reprovar continuam no Otto', async () => {
    for (const fala of ['Tá com cara de IA.', 'Faz de outro jeito então.', 'Uma versão pro cliente.']) {
      const d = await route(fala, logger, SEM_CLASSIFIER);
      expect(comContinuidadeDeAgente(d, 'otto').primary_agent, fala).toBe('otto');
    }
  });
});

describe('otto_operational_followup_stays_with_otto', () => {
  /**
   * Este é o que mais custa e o que mais importa. "E vê como tá
   * operacionalmente" PARECE pergunta de Bento, e num turno isolado seria. Aqui
   * é o Otto perguntando pela própria campanha — e ele já tem o caminho pra
   * isso (contexto operacional e A2A). Mandar pro Bento no meio da criação é
   * trocar de interlocutor no meio da frase.
   */
  it('a pergunta operacional dentro do fluxo criativo fica com o Otto', async () => {
    const d = await route('E vê como tá operacionalmente.', logger, SEM_CLASSIFIER);
    expect(comContinuidadeDeAgente(d, 'otto').primary_agent).toBe('otto');
  });

  it('o fluxo inteiro de 10 turnos curtos chega ao Otto', async () => {
    for (const fala of CRIATIVOS) {
      const d = await route(fala, logger, SEM_CLASSIFIER);
      expect(comContinuidadeDeAgente(d, 'otto').primary_agent, fala).toBe('otto');
    }
  });
});

describe('explicit_bento_switch_overrides_otto_continuity', () => {
  it('"Bento, me atualiza a operação." troca de agente mesmo vindo do Otto', async () => {
    const d = await route('Bento, me atualiza a operação.', logger, SEM_CLASSIFIER);
    expect(d.primary_agent).toBe('bento');
    expect(comContinuidadeDeAgente(d, 'otto').primary_agent).toBe('bento');
  });
});

describe('explicit_jarbas_switch_overrides_otto_continuity', () => {
  it('"Jarbas, olha essa campanha." também', async () => {
    const d = await route('Jarbas, olha essa campanha.', logger, SEM_CLASSIFIER);
    expect(d.primary_agent).toBe('jarbas');
    expect(comContinuidadeDeAgente(d, 'otto').primary_agent).toBe('jarbas');
  });

  it('e o agente escolhido na interface (manual) nunca é sobreposto', () => {
    const manual = decisao({ primary_agent: 'suzy', source: 'manual', confidence: 1 });
    expect(comContinuidadeDeAgente(manual, 'otto').primary_agent).toBe('suzy');
  });

  it('nem quando a escolha manual chega com confiança 0', () => {
    const manual = decisao({ primary_agent: 'bento', source: 'manual', confidence: 0 });
    expect(comContinuidadeDeAgente(manual, 'otto').primary_agent).toBe('bento');
  });
});

describe('new_conversation_does_not_inherit_otto', () => {
  it('conversa nova não tem agente anterior: vale a decisão do roteador', async () => {
    const d = await route('Me dá 3 títulos.', logger, SEM_CLASSIFIER);
    expect(comContinuidadeDeAgente(d, null).primary_agent).toBe(d.primary_agent);
  });
});

describe('nonzero_router_decision_overrides_continuity', () => {
  it('qualquer sinal detectado no turno vence a herança', () => {
    const comSinal = decisao({ primary_agent: 'bento', confidence: 0.8 });
    expect(comContinuidadeDeAgente(comSinal, 'otto').primary_agent).toBe('bento');
  });

  it('até um sinal fraco, mas existente', () => {
    const fraco = decisao({ primary_agent: 'bento', confidence: 0.1 });
    expect(comContinuidadeDeAgente(fraco, 'otto').primary_agent).toBe('bento');
  });
});

/**
 * O escopo é estreito de propósito: só o Otto herda. Uma pergunta solta sem
 * sinal segue indo pro Bento, que é o agente de conhecimento geral — e é isso
 * que impede uma dúvida operacional perdida de ficar presa no agente errado.
 */
describe('a continuidade não vale pros outros agentes', () => {
  it('bento_existing_routing_unchanged: conversa com o Bento não herda nada', () => {
    const d = decisao({ primary_agent: 'bento' });
    expect(comContinuidadeDeAgente(d, 'bento')).toBe(d);
  });

  it('jarbas_existing_routing_unchanged: turno sem sinal depois do Jarbas cai no fallback', () => {
    const d = decisao({ primary_agent: 'bento' });
    expect(comContinuidadeDeAgente(d, 'jarbas').primary_agent).toBe('bento');
  });

  it('suzy_existing_routing_unchanged: idem', () => {
    const d = decisao({ primary_agent: 'bento' });
    expect(comContinuidadeDeAgente(d, 'suzy').primary_agent).toBe('bento');
  });

  it('studio também não herda', () => {
    const d = decisao({ primary_agent: 'bento' });
    expect(comContinuidadeDeAgente(d, 'studio').primary_agent).toBe('bento');
  });
});
