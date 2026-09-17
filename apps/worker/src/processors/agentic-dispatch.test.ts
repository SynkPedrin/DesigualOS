import { describe, expect, it } from 'vitest';
import type { AgentJobData } from '@desigual-os/orchestrator';
import { aceitaContextoNaMensagem, comContextoOperacionalDoTurno } from './agentic-dispatch.js';

describe('contexto_vai_no_canal_que_o_node_entende', () => {
  it('Otto lê contexto dentro da mensagem', () => {
    expect(aceitaContextoNaMensagem('otto')).toBe(true);
  });

  it('Bento NÃO: a mensagem inteira é sinal de intenção e consulta vetorial dele', () => {
    expect(aceitaContextoNaMensagem('bento')).toBe(false);
  });

  it('node desconhecido recebe contexto apartado — o padrão seguro', () => {
    expect(aceitaContextoNaMensagem('node-novo')).toBe(false);
  });
});

/**
 * O dado operacional do Otto passou a chegar por CAMPO APARTADO (17/09/2026),
 * em vez de colado na mensagem pela API. O campo chega em todo turno, porque a
 * API resolve o escopo operacional sempre — e "chegou" não é "vale pra este
 * pedido". Quem decide é a intenção do turno, com a mesma régra do projetor do
 * dossiê.
 */
const DADO_AO_VIVO = 'DADOS AO VIVO DO CLICKUP (consultados agora)\n12 tarefa(s) aberta(s)\n- Elite Ads | em andamento';

function turno(message: string, agent: AgentJobData['agent'] = 'otto'): AgentJobData {
  return {
    executionDbId: 'exec-db',
    executionId: 'exec',
    agent,
    message,
    contextRefs: [],
    conversationId: 'conv',
    operationalContext: DADO_AO_VIVO,
  };
}

describe('otto_operational_query_still_gets_operational_context', () => {
  it('pergunta sobre o estado da conta recebe o dado ao vivo', () => {
    expect(comContextoOperacionalDoTurno(turno('E vê como tá operacionalmente.')).operationalContext).toBe(DADO_AO_VIVO);
  });

  it('pedido misto (criação que depende do agora) também recebe', () => {
    expect(
      comContextoOperacionalDoTurno(turno('Considerando o status atual, crie uma legenda.')).operationalContext,
    ).toBe(DADO_AO_VIVO);
  });
});

describe('creative_turn_after_operational_turn_does_not_inherit_clickup_framing', () => {
  it('"Me dá 3 títulos" não recebe a lista de tarefas, mesmo com o campo preenchido', () => {
    expect(comContextoOperacionalDoTurno(turno('Me dá 3 títulos.')).operationalContext).toBeUndefined();
  });

  it('nem um pedido de legenda logo depois de um turno operacional', () => {
    expect(comContextoOperacionalDoTurno(turno('Agora faz uma legenda.')).operationalContext).toBeUndefined();
  });
});

describe('revision_turn_after_operational_turn_remains_creative', () => {
  it('"Tá com cara de IA" é revisão da peça, não consulta de conta', () => {
    expect(comContextoOperacionalDoTurno(turno('Tá com cara de IA.')).operationalContext).toBeUndefined();
  });

  it('"Faz de outro jeito então" idem', () => {
    expect(comContextoOperacionalDoTurno(turno('Faz de outro jeito então.')).operationalContext).toBeUndefined();
  });

  it('e conversa solta sobre a marca também não vira relatório', () => {
    expect(comContextoOperacionalDoTurno(turno('Me explica.')).operationalContext).toBeUndefined();
  });
});

describe('bento_message_assembly_unchanged', () => {
  it('o Bento é operacional por natureza: o campo dele nunca é filtrado por intenção', () => {
    for (const m of ['Me dá 3 títulos.', 'Tá com cara de IA.', 'Me atualiza aí.']) {
      expect(comContextoOperacionalDoTurno(turno(m, 'bento')).operationalContext, m).toBe(DADO_AO_VIVO);
    }
  });

  it('turno sem dado operacional nenhum atravessa sem mudança', () => {
    const { operationalContext: _sem, ...cru } = turno('Me dá 3 títulos.');
    expect(comContextoOperacionalDoTurno(cru as AgentJobData)).toBe(cru);
  });
});
