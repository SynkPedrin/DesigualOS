import { describe, expect, it } from 'vitest';
import { montarDialogoRecente, ORCAMENTO_DIALOGO, type TurnoDeDialogo } from './recent-dialogue';
import { assembleContext } from './context-assembler';
import { classifyActionIntent } from './action-intent';

/**
 * Regressão do bloqueador de 18/09/2026: o Otto escreveu três títulos e, no
 * turno seguinte, disse "Sem contexto anterior no turno, não sei a qual
 * 'segundo' você se refere". E a regressão DO OUTRO LADO: a correção não pode
 * trazer de volta o despejo operacional que envenenava o pedido criativo.
 */

const TITULOS = `1 Sem agenda cheia mas com tempo pra ouvir você
2 A consulta começa antes da consulta
3 Médico que olha nos olhos em vez de no relógio`;

function turnos(...pares: Array<[TurnoDeDialogo['role'], string, string?]>): TurnoDeDialogo[] {
  return pares.map(([role, content, agent]) => ({ role, content, agent: agent ?? null }));
}

describe('otto_second_option_resolves_from_recent_dialogue', () => {
  const bloco = montarDialogoRecente(
    turnos(['user', 'Me dá 3 títulos.'], ['assistant', TITULOS, 'otto']),
    'otto',
  );

  it('os três títulos chegam ao turno seguinte', () => {
    expect(bloco).toContain('A consulta começa antes da consulta');
    expect(bloco).toContain('Sem agenda cheia');
  });

  it('a ordem cronológica é preservada — "o segundo" precisa ser o segundo', () => {
    expect(bloco.indexOf('Me dá 3 títulos')).toBeLessThan(bloco.indexOf('A consulta começa'));
    expect(bloco.indexOf('Sem agenda cheia')).toBeLessThan(bloco.indexOf('A consulta começa'));
    expect(bloco.indexOf('A consulta começa')).toBeLessThan(bloco.indexOf('Médico que olha'));
  });

  it('o bloco se declara como referência, não como fonte de fato', () => {
    expect(bloco.toLowerCase()).toContain('não é fonte de fato');
  });
});

describe('otto_feedback_resolves_previous_artifact', () => {
  it('a legenda anterior chega junto do feedback', () => {
    const bloco = montarDialogoRecente(
      turnos(
        ['user', 'Agora faz uma legenda.'],
        ['assistant', 'A consulta começa antes da consulta. Na nossa clínica o tempo é seu.', 'otto'],
        ['user', 'Tá com cara de IA.'],
      ),
      'otto',
    );
    expect(bloco).toContain('Na nossa clínica o tempo é seu');
    expect(bloco).toContain('Tá com cara de IA');
  });
});

describe('otto_recent_dialogue_does_not_restore_clickup_dump', () => {
  const OPERACIONAL = `DADOS AO VIVO DO CLICKUP (consultados agora)
- Criar placas — Clinica Teste Fase 7 | pendente | sem responsável
- EDIÇÃO VÍDEOS ADS, SETEMBRO | pendente`;

  it('bloco operacional injetado NÃO volta pro criativo', () => {
    const bloco = montarDialogoRecente(
      turnos(['user', 'como está a operação?'], ['assistant', OPERACIONAL, 'bento'], ['user', 'Me dá 3 títulos.']),
      'otto',
    );
    expect(bloco).not.toContain('DADOS AO VIVO DO CLICKUP');
    expect(bloco).not.toContain('EDIÇÃO VÍDEOS ADS');
  });

  it('otto_recent_dialogue_does_not_leak_task_names: link e id de task somem pro Otto', () => {
    const bloco = montarDialogoRecente(
      turnos(['assistant', 'Criei a task https://app.clickup.com/t/86bc30r87 com list_id: 901421119936', 'bento']),
      'otto',
    );
    expect(bloco).not.toContain('app.clickup.com');
    expect(bloco).not.toContain('901421119936');
  });

  it('mas o Bento MANTÉM o link — é o trabalho dele', () => {
    const bloco = montarDialogoRecente(
      turnos(['assistant', 'Criei a task https://app.clickup.com/t/86bc30r87', 'bento']),
      'bento',
    );
    expect(bloco).toContain('app.clickup.com/t/86bc30r87');
  });

  it('id de execução some para os dois', () => {
    for (const agente of ['otto', 'bento']) {
      const bloco = montarDialogoRecente(turnos(['assistant', 'pronto (EXE-2026-MU6XSLT3E017C8)', agente]), agente);
      expect(bloco).not.toContain('EXE-2026');
    }
  });
});

describe('bento_pronoun_resolves_previous_request / ordinal', () => {
  it('a solicitação anterior chega inteira para o Bento resolver "as duas primeiras"', () => {
    const bloco = montarDialogoRecente(
      turnos(['user', 'Tenho quatro demandas: cartaz, folder, banner e catálogo.'], ['user', 'separa as duas primeiras']),
      'bento',
    );
    expect(bloco).toContain('cartaz, folder, banner e catálogo');
  });
});

describe('bento_recent_dialogue_does_not_authorize_negated_write', () => {
  /**
   * O teste de segurança do hotfix: contexto explica o REFERENTE, nunca
   * autoriza a AÇÃO. Action Intent V2 continua soberano.
   */
  it('turno anterior sugerindo criação + "não cria ainda" continua NO WRITE', () => {
    const bloco = montarDialogoRecente(
      turnos(['user', 'poderíamos criar uma task pro Gui'], ['assistant', 'Posso criar quando você confirmar.', 'bento']),
      'bento',
    );
    expect(bloco).toContain('criar uma task pro Gui');
    // O bloco existe e menciona criação — e mesmo assim a ordem do turno manda.
    expect(classifyActionIntent('não cria ainda').writeAuthorized).toBe(false);
  });

  it('bento_recent_dialogue_preserves_action_intent_v2: a classificação não olha o bloco', () => {
    expect(classifyActionIntent('só analisa').writeAuthorized).toBe(false);
    expect(classifyActionIntent('agora pode criar').writeAuthorized).toBe(true);
    // e a liberação em forma de pergunta continua sem liberar
    expect(classifyActionIntent('pode criar?').writeAuthorized).toBe(false);
  });
});

describe('new_conversation_has_no_recent_dialogue', () => {
  it('sem turnos, bloco vazio', () => {
    expect(montarDialogoRecente([], 'otto')).toBe('');
  });

  it('bloco vazio não entra no pacote de contexto', () => {
    const pack = assembleContext([
      { fonte: 'dialogo', texto: '', evidenciavel: false },
      { fonte: 'cliente', texto: 'DOSSIÊ: Elite' },
    ]);
    expect(pack.fontes).not.toContain('dialogo');
    expect(pack.texto).toContain('Elite');
  });

  it('só turnos em branco também não produzem bloco', () => {
    expect(montarDialogoRecente(turnos(['user', '   '], ['assistant', '', 'otto']), 'otto')).toBe('');
  });
});

describe('orçamento', () => {
  it('respeita o teto de turnos, mantendo os MAIS RECENTES', () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ['user', `turno numero ${i}`] as [TurnoDeDialogo['role'], string]);
    const bloco = montarDialogoRecente(turnos(...muitos), 'otto');
    expect(bloco).toContain('turno numero 19');
    expect(bloco).not.toContain('turno numero 5');
  });

  it('respeita o teto de caracteres', () => {
    const gordo = Array.from({ length: 6 }, () => ['assistant', 'x'.repeat(2000), 'otto'] as [TurnoDeDialogo['role'], string, string]);
    const bloco = montarDialogoRecente(turnos(...gordo), 'otto');
    expect(bloco.length).toBeLessThanOrEqual(ORCAMENTO_DIALOGO.maxChars + 400);
  });

  it('quando falta espaço, cai o turno MAIS ANTIGO — nunca o imediatamente anterior', () => {
    const bloco = montarDialogoRecente(
      turnos(['user', 'a'.repeat(900)], ['user', 'b'.repeat(900)], ['user', 'ULTIMO TURNO IMPORTANTE']),
      'otto',
    );
    expect(bloco).toContain('ULTIMO TURNO IMPORTANTE');
  });

  it('o bloco é menor que o piso do dossiê: não vira o maior pedaço do prompt', () => {
    expect(ORCAMENTO_DIALOGO.maxChars).toBeLessThan(2_500);
  });
});

describe('different_conversation_does_not_leak / different_client', () => {
  /**
   * O isolamento é estrutural: o builder recebe SOMENTE os turnos que o
   * chamador buscou por `conversationId`. Não há caminho por onde outra
   * conversa entre — e é por isso que este teste checa a forma da função, não
   * um filtro interno que poderia ser esquecido.
   */
  it('o builder não busca nada: só formata o que recebeu', () => {
    const bloco = montarDialogoRecente(turnos(['user', 'só isto aqui']), 'otto');
    expect(bloco).toContain('só isto aqui');
    expect(bloco.split('\n')).toHaveLength(2);
  });
});
