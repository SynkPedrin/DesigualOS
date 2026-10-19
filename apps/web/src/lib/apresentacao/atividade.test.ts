import { describe, expect, it } from 'vitest';
import { apresentarAtividade, horaLocal, rotuloDoDia, tiposNaoMapeados } from './atividade';

/** Os quatro tipos que EXISTEM no banco, medidos em 02/10/2026. */
const TIPOS_REAIS = ['task.updated', 'task.created', 'CONNECTION_CREATED', 'CLIENT_DECISION'] as const;

describe('nenhum termo técnico chega à tela', () => {
  it.each(TIPOS_REAIS)('%s não aparece como texto', (type) => {
    const r = apresentarAtividade({ type, source: 'clickup' });
    expect(r.titulo).not.toContain('.');
    expect(r.titulo).not.toMatch(/task\.|CONNECTION|CLIENT_DECISION|operational_event|payload|event_type/i);
  });

  /** TESTE D do briefing: tipo desconhecido não vaza nem some. */
  it('tipo novo vira frase humana e fica marcado para o mapper evoluir', () => {
    const r = apresentarAtividade({ type: 'ALGUM_EVENTO_NOVO_XYZ', source: 'clickup' });
    expect(r.titulo).toBe('Registrou uma atualização operacional');
    expect(r.titulo).not.toContain('XYZ');
    expect(r.dadoInsuficiente).toBe(true);
    expect(tiposNaoMapeados([{ type: 'ALGUM_EVENTO_NOVO_XYZ' }])).toEqual(['ALGUM_EVENTO_NOVO_XYZ']);
  });
});

describe('TESTE B — conta compartilhada nunca vira pessoa', () => {
  it('mostra a equipe, não um membro', () => {
    const r = apresentarAtividade({
      type: 'CLIENT_DECISION',
      source: 'claude_mcp',
      actorIdentityName: 'Equipe Atendimento',
      actorType: 'shared_account',
      clientName: 'Cosentino',
      summary: 'Manter o posicionamento premium.',
    });
    expect(r.ator.rotulo).toBe('Equipe Atendimento');
    expect(r.ator.tipo).toBe('shared_account');
    expect(r.origem).toBe('Claude');
  });

  /**
   * O caso que parece inofensivo: a identidade compartilhada vence mesmo
   * quando o campo `actor` traz um nome. Um membro só não muda a regra.
   */
  it('a identidade compartilhada vence o campo actor', () => {
    const r = apresentarAtividade({
      type: 'CLIENT_DECISION',
      source: 'claude_mcp',
      actor: 'Tammy',
      actorIdentityName: 'Equipe Atendimento',
      actorType: 'shared_account',
    });
    expect(r.ator.rotulo).toBe('Equipe Atendimento');
    expect(r.ator.rotulo).not.toContain('Tammy');
  });
});

describe('TESTE C — pessoa identificada aparece pelo nome', () => {
  it('mostra a pessoa e a ferramenta', () => {
    const r = apresentarAtividade({ type: 'task.updated', source: 'clickup', actor: 'Tammy', clientName: 'Cosentino' });
    expect(r.ator.rotulo).toBe('Tammy');
    expect(r.ator.tipo).toBe('person');
    expect(r.origem).toBe('ClickUp');
    expect(r.cliente).toBe('Cosentino');
  });
});

describe('sem ator, a ferramenta é o ator — nunca um nome inventado', () => {
  /**
   * É o caso COMUM, não a exceção: 872 de 902 eventos não têm ator. Dizer
   * "ClickUp registrou" é verdade; dizer "Tammy fez" seria falsificação de
   * autoria — a mesma que o bloco de identidade existe para impedir.
   */
  it('evento de tarefa sem ator mostra ClickUp', () => {
    const r = apresentarAtividade({ type: 'task.updated', source: 'clickup', clientName: 'Cosentino' });
    expect(r.ator.rotulo).toBe('ClickUp');
    expect(r.ator.tipo).toBe('system');
    expect(r.ator.rotulo).not.toMatch(/null|undefined|unknown/i);
  });

  it('fonte desconhecida vira Sistema, nunca o identificador cru', () => {
    const r = apresentarAtividade({ type: 'task.updated', source: 'algum_conector_novo' });
    expect(r.ator.rotulo).toBe('Sistema');
  });
});

describe('o que é ruído de integração sai da timeline', () => {
  it('conexão do Claude não compete com o trabalho da equipe', () => {
    const r = apresentarAtividade({
      type: 'CONNECTION_CREATED',
      source: 'mcp',
      actor: 'pedro gabriel',
      summary: 'pedro gabriel conectou o Claude ao Desigual OS',
    });
    expect(r.visivelNaTimeline).toBe(false);
    expect(r.categoria).toBe('integracao');
    // E a frase já é humana, para quando a categoria Integrações for mostrada.
    expect(r.titulo).toBe('pedro gabriel conectou o Claude ao Desigual OS');
  });
});

describe('dadoInsuficiente aponta o conserto para o lugar certo', () => {
  /**
   * 872 eventos de tarefa guardam `{event, list_id, actor_resolution}` e mais
   * nada: sem nome, sem status, sem pessoa. A frase sai curta por falta de
   * DADO, e este campo existe para que ninguém passe meses melhorando o texto
   * aqui quando o conserto é no webhook.
   */
  it('evento de tarefa é marcado como dado pobre', () => {
    expect(apresentarAtividade({ type: 'task.updated', source: 'clickup' }).dadoInsuficiente).toBe(true);
    expect(apresentarAtividade({ type: 'task.created', source: 'clickup' }).dadoInsuficiente).toBe(true);
  });

  it('decisão com resumo NÃO é marcada: ali o dado existe', () => {
    const r = apresentarAtividade({ type: 'CLIENT_DECISION', source: 'chat', summary: 'Priorizar institucional.' });
    expect(r.dadoInsuficiente).toBe(false);
    expect(r.descricao).toBe('Priorizar institucional.');
  });
});

describe('data e hora em português, nunca ISO', () => {
  it('agrupa por Hoje, Ontem e data por extenso', () => {
    const agora = new Date('2026-10-02T15:00:00-03:00');
    expect(rotuloDoDia(new Date('2026-10-02T10:42:00-03:00'), agora)).toBe('Hoje');
    expect(rotuloDoDia(new Date('2026-10-01T10:42:00-03:00'), agora)).toBe('Ontem');
    expect(rotuloDoDia(new Date('2026-09-30T10:42:00-03:00'), agora)).toMatch(/30 de setembro/);
  });

  it('a hora sai no fuso da operação', () => {
    expect(horaLocal(new Date('2026-10-02T13:42:00Z'))).toBe('10:42');
  });

  it('nenhum rótulo contém ISO', () => {
    const agora = new Date('2026-10-02T15:00:00-03:00');
    for (const d of ['2026-10-02', '2026-10-01', '2026-09-28']) {
      expect(rotuloDoDia(new Date(`${d}T12:00:00-03:00`), agora)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    }
  });
});

/**
 * A TELA DIVIDIDA EM ANTES E DEPOIS DE 02/10/2026. O webhook passou a gravar
 * `task_name` e `changes`; os 872 eventos antigos não têm nenhum dos dois e
 * nunca terão — não há de onde tirá-los depois do fato. O mapper precisa
 * mostrar o dado novo e continuar honesto sobre o velho, nunca o contrário.
 */
describe('tarefa do ClickUp: evento rico x evento legado', () => {
  it('usa a frase e as mudanças que o webhook gravou', () => {
    const a = apresentarAtividade({
      source: 'clickup',
      type: 'task.updated',
      summary: 'Moveu "Campanha Outubro" de em produção para em aprovação',
      actor: 'Tammy',
      clientName: 'Colormaq',
      payload: {
        list_id: '901',
        task_name: 'Campanha Outubro',
        changes: [{ campo: 'status', rotulo: 'status', de: 'em produção', para: 'em aprovação' }],
      },
    });
    expect(a.titulo).toBe('Moveu "Campanha Outubro" de em produção para em aprovação');
    expect(a.descricao).toBe('status: em produção → em aprovação');
    expect(a.dadoInsuficiente).toBe(false);
  });

  it('o evento legado continua curto e MARCADO, em vez de ganhar frase bonita e vazia', () => {
    const a = apresentarAtividade({
      source: 'clickup',
      type: 'task.updated',
      summary: null,
      actor: null,
      clientName: 'Colormaq',
      payload: { list_id: '901', event: 'taskUpdated', actor_resolution: 'nao_resolvido' },
    });
    expect(a.titulo).toBe('Atualizou uma tarefa');
    expect(a.dadoInsuficiente).toBe(true);
  });

  it('nunca mostra id de lista nem nome técnico de campo cru na frase', () => {
    const a = apresentarAtividade({
      source: 'clickup',
      type: 'task.created',
      summary: 'Criou a tarefa "Brief Elite"',
      actor: 'Matheus Sain',
      clientName: null,
      payload: { list_id: '901234567', task_name: 'Brief Elite', changes: [] },
    });
    expect(a.titulo).not.toContain('901234567');
    expect(a.titulo).not.toContain('task.created');
    expect(a.descricao).toBeNull();
  });
});
