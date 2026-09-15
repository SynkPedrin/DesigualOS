import { describe, expect, it } from 'vitest';
import type { OperationTask } from '@desigual-os/tool-gateway';
import { MARCADOR_ATRASO, authorizeAction, proposeActions, resumoDeAcoes, type AgentAction } from './agent-actions';
import { executeAction, type ExecutionDeps } from './action-executor';

const HOJE = new Date('2026-09-15T00:00:00').getTime();
const ONTEM = new Date('2026-09-13T12:00:00').getTime();
const QA = 'lista-qa';
const CLIENTE = 'lista-cliente';

function task(over: Partial<OperationTask> = {}): OperationTask {
  return {
    id: 't1', name: 'Task', description: null, status: 'aberto', statusType: 'open', priority: null,
    url: null, dueDate: null, startDate: null, createdAt: null, updatedAt: null,
    assignees: ['Ana'], tags: [], listId: QA, listName: 'QA', folderName: null, spaceId: null,
    ...over,
  };
}

describe('proposeActions', () => {
  it('task aberta e vencida vira comentário de atraso (risco baixo, automática)', () => {
    const a = proposeActions([task({ dueDate: ONTEM })], { startOfToday: HOJE });
    expect(a).toHaveLength(1);
    expect(a[0]?.type).toBe('add_comment');
    expect(a[0]?.requiresApproval).toBe(false);
    expect(a[0]?.risk).toBe('low');
    expect(String(a[0]?.arguments.text)).toContain(MARCADOR_ATRASO);
    expect(a[0]?.reason).toContain('venceu há');
  });

  it('task sem responsável vira DECISÃO HUMANA, nunca palpite de dono', () => {
    const a = proposeActions([task({ assignees: [] })], { startOfToday: HOJE });
    expect(a[0]?.type).toBe('request_approval');
    expect(a[0]?.requiresApproval).toBe(true);
  });

  it('não comenta de novo o atraso que já foi comentado', () => {
    const a = proposeActions([task({ dueDate: ONTEM })], { startOfToday: HOJE, jaComentadas: new Set(['t1']) });
    expect(a.every((x) => x.type !== 'add_comment')).toBe(true);
  });

  it('task concluída não gera ação nenhuma, mesmo vencida', () => {
    const a = proposeActions([task({ dueDate: ONTEM, statusType: 'done', assignees: [] })], { startOfToday: HOJE });
    expect(a[0]?.type).toBe('no_action');
  });

  it('operação saudável devolve no_action (silêncio é resposta)', () => {
    expect(proposeActions([task()], { startOfToday: HOJE })[0]?.type).toBe('no_action');
  });

  it('uma task pode gerar duas ações independentes (atraso + sem dono)', () => {
    const a = proposeActions([task({ dueDate: ONTEM, assignees: [] })], { startOfToday: HOJE });
    expect(a.map((x) => x.type).sort()).toEqual(['add_comment', 'request_approval']);
  });
});

describe('authorizeAction — CÓDIGO AUTORIZA', () => {
  const policy = { writeScopeListId: QA, listIdPorTask: new Map([['t1', QA], ['t2', CLIENTE]]) };

  it('autoriza ação de risco baixo dentro do escopo', () => {
    const [acao] = proposeActions([task({ dueDate: ONTEM })], { startOfToday: HOJE });
    expect(authorizeAction(acao!, policy).authorized).toBe(true);
  });

  it('BLOQUEIA ação em task de lista de cliente', () => {
    const [acao] = proposeActions([task({ id: 't2', dueDate: ONTEM })], { startOfToday: HOJE });
    const r = authorizeAction(acao!, policy);
    expect(r.authorized).toBe(false);
    expect(r.reason).toContain('fora do escopo');
  });

  it('BLOQUEIA quando não sabe a lista da task (falha fechada)', () => {
    const [acao] = proposeActions([task({ id: 'desconhecida', dueDate: ONTEM })], { startOfToday: HOJE });
    expect(authorizeAction(acao!, policy).authorized).toBe(false);
  });

  it('nunca executa o que depende de humano', () => {
    const [acao] = proposeActions([task({ assignees: [] })], { startOfToday: HOJE });
    expect(authorizeAction(acao!, policy).authorized).toBe(false);
  });

  it('risco acima do teto não é automático', () => {
    const acao: AgentAction = {
      id: 'a', type: 'update_status', objective: 'o', reason: 'r', tool: 'clickup.update',
      arguments: { taskId: 't1' }, risk: 'high', requiresApproval: false, status: 'proposed',
      taskId: 't1', taskName: 'Task',
    };
    expect(authorizeAction(acao, policy).authorized).toBe(false);
  });
});

describe('executeAction — EXECUTA + VERIFICA', () => {
  const config = { apiKey: 'k', teamId: 't' } as ClickUpConfigLike;
  type ClickUpConfigLike = Parameters<typeof executeAction>[0];

  function deps(over: Partial<ExecutionDeps> = {}): ExecutionDeps {
    return {
      addComment: async () => ({ id: 'c1' }),
      readComments: async () => [{ id: 'c1', text: `${MARCADOR_ATRASO} atrasada` }],
      readTask: (async () => ({ id: 't1', name: 'Task', status: 'aberto', assignees: [], dueDate: null })) as never,
      editTask: (async () => undefined) as never,
      ...over,
    };
  }

  const comentario = () => proposeActions([task({ dueDate: ONTEM })], { startOfToday: HOJE })[0]!;

  it('comentário é escrito E confirmado por read-back', async () => {
    const r = await executeAction(config, comentario(), deps());
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.action.status).toBe('executed');
    expect(r.toolCall).toEqual({ tool: 'clickup.create_comment', ok: true });
  });

  it('escrita aceita mas AUSENTE na releitura = FALHA (não é "feito")', async () => {
    const r = await executeAction(config, comentario(), deps({ readComments: async () => [] }));
    expect(r.ok).toBe(false);
    expect(r.verified).toBe(false);
    expect(r.action.status).toBe('failed');
    expect(r.observation).toContain('NÃO encontrado na releitura');
  });

  it('erro da ferramenta vira falha observável, não exceção solta', async () => {
    const r = await executeAction(config, comentario(), deps({
      addComment: async () => { throw new Error('ClickUp 500'); },
    }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('ClickUp 500');
  });

  it('cerca de escopo marca BLOQUEADA, não "falhou"', async () => {
    const { WriteScopeError } = await import('@desigual-os/tool-gateway');
    const r = await executeAction(config, comentario(), deps({
      addComment: async () => { throw new WriteScopeError('fora do escopo', 'x', QA); },
    }));
    expect(r.action.status).toBe('blocked');
    expect(r.observation).toContain('BLOQUEADA pela cerca');
  });
});

describe('resumoDeAcoes', () => {
  it('separa o que foi resolvido do que depende de humano', () => {
    const acoes = proposeActions([task({ dueDate: ONTEM, assignees: [] })], { startOfToday: HOJE });
    acoes[0]!.status = 'executed';
    const r = resumoDeAcoes(acoes);
    expect(r.executadas).toHaveLength(1);
    expect(r.humanas).toHaveLength(1);
  });
});
