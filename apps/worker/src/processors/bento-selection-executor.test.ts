import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectionSnapshot } from '@desigual-os/context-engine';

/**
 * Mocks no estilo da casa (ver bento-action-guard.test.ts): ClickUp e banco
 * nunca são tocados de verdade. Cada chamada de escrita/leitura é registrada
 * pra provar QUANTAS vezes cada task foi mutada — duplicata é falha dura.
 */
const chamadas = {
  updateTask: [] as Array<{ taskId: string; params: unknown }>,
  createTaskComment: [] as Array<{ taskId: string; text: string }>,
  getTask: [] as string[],
  getTaskComments: [] as string[],
};

vi.mock('@desigual-os/tool-gateway', () => ({
  createTaskComment: vi.fn(async (_c: unknown, taskId: string, text: string) => {
    chamadas.createTaskComment.push({ taskId, text });
    return { id: `comment-${taskId}`, text, date: '2026-09-24' };
  }),
  getTask: vi.fn(async (_c: unknown, taskId: string) => {
    chamadas.getTask.push(taskId);
    return {
      id: taskId,
      name: `Task ${taskId}`,
      status: 'aberto',
      priority: 3,
      dueDate: null,
      listId: 'list-1',
      assignees: [{ id: 123, username: 'Pedro Gabriel' }],
      description: '',
      attachments: [],
    };
  }),
  getTaskComments: vi.fn(async (_c: unknown, taskId: string) => {
    chamadas.getTaskComments.push(taskId);
    return [{ id: `comment-${taskId}`, text: 'briefing', userId: 1, username: 'Bento', date: '2026-09-24' }];
  }),
  resolveMemberByName: vi.fn(async (_c: unknown, name: string) =>
    name.toLowerCase().startsWith('pedro')
      ? { status: 'resolved', member: { id: 123, username: 'Pedro Gabriel', email: 'pedro@x.com' }, matchedBy: 'first_name' }
      : { status: 'not_found', candidates: [] },
  ),
  updateTask: vi.fn(async (_c: unknown, taskId: string, params: unknown) => {
    chamadas.updateTask.push({ taskId, params });
  }),
}));

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
          catch: () => Promise.resolve([]),
          orderBy: () => ({ limit: () => ({ catch: () => Promise.resolve([]) }) }),
        }),
      }),
    }),
  },
  schema: {
    clients: { id: 'id', name: 'name', clickupListId: 'clickupListId' },
    messages: { metadata: 'metadata', conversationId: 'conversationId', createdAt: 'createdAt' },
  },
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

function selecao(n: number): SelectionSnapshot {
  return {
    version: 1,
    reason: 'tasks_due_today',
    reasonLabel: 'tasks que vencem hoje, 24/09/2026',
    source: 'clickup_operational_tasks',
    capturedAt: '2026-09-24T14:00:00.000Z',
    focusTaskId: null,
    tasks: Array.from({ length: n }, (_, i) => ({
      id: `t${i + 1}`,
      title: `Task ${i + 1}`,
      clientName: 'Cliente Teste 7',
      listId: 'list-1',
      assignees: [],
      dueDate: Date.parse('2026-09-24T23:59:00-03:00'),
      status: 'aberto',
      priority: null,
      url: `https://app.clickup.com/t/t${i + 1}`,
    })),
  };
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    message: 'crie um briefing detalhado de cada uma delas e lança pro pedro',
    config: { apiKey: 'k', teamId: 'team' },
    selection: selecao(3),
    reference: { kind: 'all' } as const,
    withBriefing: true,
    wantsAssign: true,
    personName: 'Pedro',
    userName: 'Pedro',
    userEmail: 'pedro@institutoalmada.org',
    conversationId: null,
    authorizeTask: async () => 'match' as const,
    mayWriteForClient: () => true,
    briefingWriter: async () => null,
    logger,
    ...overrides,
  };
}

describe('executeSelectionMutation', () => {
  beforeEach(() => {
    chamadas.updateTask.length = 0;
    chamadas.createTaskComment.length = 0;
    chamadas.getTask.length = 0;
    chamadas.getTaskComments.length = 0;
  });

  it('briefing+assign em CADA task da seleção, com read-back e registro estruturado', async () => {
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    const res = await executeSelectionMutation(params());

    // Uma mutação por task — nem a mais (duplicata), nem a menos (conjunto perdido)
    expect(chamadas.createTaskComment.map((c) => c.taskId)).toEqual(['t1', 't2', 't3']);
    expect(chamadas.updateTask.map((c) => c.taskId)).toEqual(['t1', 't2', 't3']);
    // Read-back das DUAS escritas por task (comentários são lidos também pelo
    // retrieval do briefing — o que importa é cada task ter sido relida)
    expect(new Set(chamadas.getTask)).toEqual(new Set(['t1', 't2', 't3']));
    expect(new Set(chamadas.getTaskComments)).toEqual(new Set(['t1', 't2', 't3']));

    expect(res.status).toBe('completed');
    expect(res.answer).toContain('📝 Briefings criados: 3/3');
    expect(res.answer).toContain('👤 Atribuídas a Pedro Gabriel: 3/3');
    const exec = (res.metadata as { execucao: { operation: string; successIds: string[]; failedIds: unknown[]; targetPerson: { memberId: number } } }).execucao;
    expect(exec.operation).toBe('briefing_assign');
    expect(exec.successIds).toEqual(['t1', 't2', 't3']);
    expect(exec.failedIds).toEqual([]);
    expect(exec.targetPerson.memberId).toBe(123);
  });

  it('o briefing carrega o título REAL da task, não texto genérico', async () => {
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    await executeSelectionMutation(params());
    expect(chamadas.createTaskComment[0]!.text).toContain('Task 1');
    expect(chamadas.createTaskComment[0]!.text).toContain('Cliente Teste 7');
  });

  it('pessoa inexistente no ClickUp: resposta honesta, ZERO escrita', async () => {
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    const res = await executeSelectionMutation(params({ personName: 'Xerxes' }));
    expect(res.answer).toContain('Xerxes');
    expect(chamadas.updateTask).toHaveLength(0);
    expect(chamadas.createTaskComment).toHaveLength(0);
  });

  it('despacho sem pessoa pergunta pra quem, sem escrever', async () => {
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    const res = await executeSelectionMutation(params({ withBriefing: false, personName: null, message: 'atribui essas' }));
    expect(res.answer).toContain('pra quem');
    expect(chamadas.updateTask).toHaveLength(0);
  });

  it('subconjunto por ordinal: só a task referenciada é mutada', async () => {
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    await executeSelectionMutation(params({ reference: { kind: 'ordinal', position: 1 }, message: 'atribui a segunda pro Pedro', withBriefing: false }));
    expect(chamadas.updateTask.map((c) => c.taskId)).toEqual(['t2']);
    expect(chamadas.createTaskComment).toHaveLength(0);
  });

  it('cliente fora da autorização de produção falha fechado POR TASK', async () => {
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    const res = await executeSelectionMutation(params({ mayWriteForClient: () => false }));
    const exec = (res.metadata as { execucao: { successIds: string[]; failedIds: Array<{ reason: string }> } }).execucao;
    expect(exec.successIds).toEqual([]);
    expect(exec.failedIds).toHaveLength(3);
    expect(exec.failedIds[0]!.reason).toContain('não autorizada');
    expect(chamadas.updateTask).toHaveLength(0);
  });

  it('task não autorizada pro contexto (cross-client) não é tocada', async () => {
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    const res = await executeSelectionMutation(params({ authorizeTask: async (id: string) => (id === 't2' ? 'mismatch' : 'match') }));
    const exec = (res.metadata as { execucao: { successIds: string[]; failedIds: Array<{ id: string }> } }).execucao;
    expect(exec.successIds).toEqual(['t1', 't3']);
    expect(exec.failedIds.map((f) => f.id)).toEqual(['t2']);
    expect(chamadas.updateTask.map((c) => c.taskId)).toEqual(['t1', 't3']);
  });

  it('repeat "faz o mesmo nas outras": repete a operação do registro só nas que faltam', async () => {
    const execucaoAnterior = {
      executionId: 'exec-prev',
      operation: 'assign',
      taskIds: ['t1', 't2', 't3'],
      targetPerson: { name: 'Pedro Gabriel', memberId: 123, username: 'Pedro Gabriel' },
      successIds: ['t1'],
      failedIds: [{ id: 't2', title: 'Task 2', reason: 'x' }, { id: 't3', title: 'Task 3', reason: 'y' }],
      timestamp: '2026-09-24T14:00:00.000Z',
      verification: [],
    };
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    const execMod = await import('./execution-record.js');
    const spy = vi.spyOn(execMod, 'loadLatestExecutionState').mockResolvedValue({ kind: 'executed', record: execucaoAnterior });
    try {
      const res = await executeSelectionMutation(
        params({
          message: 'faz o mesmo nas outras',
          reference: { kind: 'repeat', scope: 'rest' },
          withBriefing: false,
          wantsAssign: false,
          personName: null,
          conversationId: 'conv-1',
        }),
      );
      // Só as que faltavam — nunca repete a que já saiu (mutação duplicada)
      expect(chamadas.updateTask.map((c) => c.taskId)).toEqual(['t2', 't3']);
      expect((res.metadata as { execucao: { targetPerson: { memberId: number } } }).execucao.targetPerson.memberId).toBe(123);
    } finally {
      spy.mockRestore();
    }
  });

  it('repeat sem operação anterior: resposta honesta, zero escrita', async () => {
    const { executeSelectionMutation } = await import('./bento-selection-executor.js');
    const res = await executeSelectionMutation(
      params({
        message: 'faz igual nas outras',
        reference: { kind: 'repeat', scope: 'rest' },
        withBriefing: false,
        wantsAssign: false,
        personName: null,
        conversationId: 'conv-1',
      }),
    );
    expect(res.answer).toContain('Não encontrei uma operação executada');
    expect(chamadas.updateTask).toHaveLength(0);
  });

  it('extractPersonNameLoose resolve "pro pedro" minúsculo e ignora "pra mim"', async () => {
    const { extractPersonNameLoose } = await import('./bento-selection-executor.js');
    expect(extractPersonNameLoose('lança elas pro pedro no clickup')).toBe('pedro');
    expect(extractPersonNameLoose('manda pro Pedro Gabriel')).toBe('Pedro Gabriel');
    expect(extractPersonNameLoose('me manda o briefing')).toBeNull();
    expect(extractPersonNameLoose('lança no clickup')).toBeNull();
    // Regressão do aceite ao vivo (24/09/2026): extraía "delas e" como pessoa
    expect(extractPersonNameLoose('crie um briefing detalhado de cada uma delas e lança pro pedro')).toBe('pedro');
    expect(extractPersonNameLoose('atribui a segunda pro Gui')).toBe('Gui');
  });
});
