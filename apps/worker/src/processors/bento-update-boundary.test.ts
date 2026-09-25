import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectionSnapshot } from '@desigual-os/context-engine';

/**
 * INVARIANTE (25/09/2026, incidente D. Carvalho): referência a task EXISTENTE
 * + verbo de edição NUNCA vira createTask. Três níveis de prova:
 *
 *   1. ESTRUTURAL: o executor de update não importa createTask (não existe
 *      caminho de código entre update e create).
 *   2. CLASSIFICAÇÃO: as frases de edição nunca produzem intent 'create'.
 *   3. PONTA A PONTA: a frase EXATA do incidente, com a lista anterior de 13
 *      tasks na conversa, chama updateTask no id do item 11 com 28/09/2026 e
 *      zero createTask.
 */

const chamadas = {
  createTask: 0,
  updateTask: [] as Array<{ taskId: string; params: Record<string, unknown> }>,
  getTask: 0,
};

const ITEM11_ID = 'task-item-11';

vi.mock('@desigual-os/tool-gateway', () => ({
  createTask: vi.fn(async () => {
    chamadas.createTask += 1;
    throw new Error('createTask NÃO PODE ser chamado num fluxo de update');
  }),
  updateTask: vi.fn(async (_c: unknown, taskId: string, params: Record<string, unknown>) => {
    chamadas.updateTask.push({ taskId, params });
  }),
  getTask: vi.fn(async (_c: unknown, taskId: string) => {
    chamadas.getTask += 1;
    const mudou = chamadas.updateTask.find((u) => u.taskId === taskId);
    return {
      id: taskId,
      name: 'DC_DC Academy_Base Apresentações',
      status: 'aberto',
      priority: 3,
      dueDate: (mudou?.params.dueDate as number | undefined) ?? Date.parse('2026-07-16T23:59:00-03:00'),
      listId: 'lista-dc',
      assignees: [],
      description: '',
      attachments: [],
    };
  }),
  getTaskListId: vi.fn(async () => 'lista-dc'),
  listStatusesForTask: vi.fn(async () => ['aberto', 'em andamento', 'pronto']),
  resolveMemberByName: vi.fn(async (_c: unknown, name: string) =>
    /pedro/i.test(name)
      ? { status: 'resolved', member: { id: 123, username: 'Pedro Gabriel', email: 'p@x.com' }, matchedBy: 'first_name' }
      : { status: 'not_found', candidates: [] },
  ),
  findMemberByName: vi.fn(async () => ({ id: 123, username: 'Pedro Gabriel' })),
  getTaskComments: vi.fn(async () => []),
  createTaskComment: vi.fn(async () => ({ id: 'c1', text: '', date: null })),
  deleteTask: vi.fn(async () => {}),
  // Stubs de módulo: importados por outros processors no grafo de imports.
  queryOperationTasks: vi.fn(async () => ({ tasks: [], truncated: false, pagesFetched: 0 })),
  uploadTaskAttachment: vi.fn(async () => ({ id: null })),
  verifyTaskState: vi.fn(() => ({ ok: true, mismatches: [] })),
  createVerifiedSeniorTask: vi.fn(async () => ({ id: 'nova', url: 'https://app.clickup.com/t/nova' })),
  createAttributedTask: vi.fn(async () => ({ id: 'nova', url: 'https://app.clickup.com/t/nova' })),
  WriteScopeError: class WriteScopeError extends Error {},
}));

const SELECAO: SelectionSnapshot = {
  version: 1,
  reason: 'tasks_overdue',
  reasonLabel: 'tasks atrasadas de D. Carvalho',
  source: 'clickup_operational_tasks',
  capturedAt: new Date().toISOString(),
  focusTaskId: null,
  tasks: Array.from({ length: 13 }, (_, i) => ({
    id: i === 10 ? ITEM11_ID : `task-item-${i + 1}`,
    title: i === 10 ? 'DC_DC Academy_Base Apresentações' : `Demanda ${i + 1} da lista`,
    clientName: 'D. Carvalho',
    listId: 'lista-dc',
    assignees: [],
    dueDate: Date.parse('2026-07-16T23:59:00-03:00'),
    status: 'aberto',
    priority: null,
    url: `https://app.clickup.com/t/task-item-${i + 1}`,
  })),
};

vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  desc: (c: unknown) => c,
  inArray: () => ({}),
}));

vi.mock('@desigual-os/database', () => {
  const messages = [{ __t: 'messages' }];
  const clients = [{ __t: 'clients' }];
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {};
    c.from = (t: unknown) => chain(t === messages ? [{ role: 'user', agent: null, content: 'liste as demandas atrasadas', attachmentUrl: null, attachmentType: null, attachmentFilename: null, metadata: { selecao: SELECAO } }] : rows);
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => Promise.resolve(c._rows ?? rows);
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(c._rows ?? rows).then(res, rej);
    c.catch = () => Promise.resolve(c._rows ?? rows);
    return c;
  }
  return {
    db: { select: () => chain([{ id: 'client-1', organizationId: 'org-1' }]) },
    schema: { messages, clients, memories: {} },
  };
});

vi.mock('./jarbas-handoff.js', () => ({ tryJarbasHandoff: async () => null }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

describe('INVARIANTE: existing task + edit verb nunca vira create', () => {
  beforeEach(() => {
    chamadas.createTask = 0;
    chamadas.updateTask.length = 0;
    chamadas.getTask = 0;
    process.env.CLICKUP_API_KEY = 'teste';
    process.env.CLICKUP_TEAM_ID = 'team';
  });

  it('1. ESTRUTURAL: o executor de update não importa nem chama createTask', () => {
    const fonte = readFileSync(join(__dirname, 'bento-update-executor.ts'), 'utf8');
    expect(fonte).not.toMatch(/import\s[^;]*\bcreateTask\b/);
    expect(fonte).not.toMatch(/[^a-zA-Z]createTask\s*\(/);
  });

  it.each([
    'altere a data do item 11 pra 28 de setembro de 2026',
    'mude o prazo da segunda',
    'troque o responsável dessa pro Pedro',
    'atualiza o briefing dela',
    'coloca essa como urgente',
    'muda o status da última pra em andamento',
    'troca o prazo e o responsável da primeira pro Pedro, pra sexta',
  ])('2. CLASSIFICAÇÃO: "%s" nunca é create', async (msg) => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest(msg);
    expect(intent.kind).not.toBe('create');
    expect(intent.kind).toMatch(/^update/);
  });

  it('2c. edição subespecificada ("edite essa task") pergunta, NUNCA cria', async () => {
    const { classifyIntentForTest, decideFallbackIntent } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('edite essa task');
    expect(intent.kind).not.toBe('create');
    // sem campo reconhecível: esclarecimento honesto, mesmo com alvo resolvido
    expect(decideFallbackIntent('edite essa task', 'task-qualquer').kind).toBe('ask_clarification');
    expect(decideFallbackIntent('edite essa task', null).kind).toBe('ask_clarification');
  });

  it('2b. fallback com verbo de edição pergunta, nunca cria', async () => {
    const { decideFallbackIntent } = await import('./bento-action-guard.js');
    expect(decideFallbackIntent('altere isso aí', null).kind).toBe('ask_clarification');
    expect(decideFallbackIntent('atualize pra mim', null).kind).toBe('ask_clarification');
  });

  it('3. PONTA A PONTA: a frase EXATA do incidente atualiza o item 11 com 28/09/2026, zero create', async () => {
    const { tryBentoActionGuard } = await import('./bento-action-guard.js');
    const res = await tryBentoActionGuard({
      message: 'no clickup, altere a data do item 11 (DC_DC Academy_Base Apresentações) para o dia 28 de setembro de 2026',
      conversationId: 'conv-incidente',
      userName: 'Tammy',
      userClickUpEmail: null,
      userEmail: 'tammy@exemplo.com',
      seniorToolContext: { permissions: [{ resource: 'clickup', action: 'write' }], organizationId: 'org-1' } as never,
      agencyListId: null,
      clientId: 'client-1',
      clientName: 'D. Carvalho',
      briefingWriter: async () => null,
      logger,
    });
    expect(chamadas.createTask).toBe(0);
    expect(chamadas.updateTask).toHaveLength(1);
    expect(chamadas.updateTask[0]!.taskId).toBe(ITEM11_ID);
    const due = chamadas.updateTask[0]!.params.dueDate as number;
    const d = new Date(due);
    expect(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).toBe('2026-09-28');
    expect(res?.answer).toContain('✅ Task atualizada');
    expect(res?.answer).toContain('28/09/2026');
  });

  it('2d. "faz um briefing detalhado dessa task e deixa ela com o Pedro" é update_multi com briefing E pessoa', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('faz um briefing detalhado dessa task e deixa ela com o Pedro');
    expect(intent.kind).toBe('update_multi');
    if (intent.kind === 'update_multi') {
      expect(intent.fields.briefAddition).toBeTruthy();
      expect(intent.fields.personName).toBe('Pedro');
    }
  });

  /**
   * OBJETO SEMÂNTICO (adendo 25/09/2026, incidente Tammy): "delete todo o
   * briefing" virou confirmação pra apagar A TASK. Verbo destrutivo + objeto
   * de conteúdo é edição de campo; só objeto de entidade pode deletar task.
   */
  it.each([
    ['apaga essa task', true],
    ['deleta essa demanda', true],
    ['exclui esse item do ClickUp', true],
    ['apaga o briefing dessa', false],
    ['delete o texto', false],
    ['remove a descrição', false],
    ['limpa o conteúdo', false],
    ['tira o responsável', false],
    ['remove o prazo', false],
    ['apaga esse comentário', false],
  ])('5. OBJETO: "%s" -> deleteTask permitido = %s', async (msg, esperado) => {
    const { isTaskDeleteRequestForTest } = await import('./bento-action-guard.js');
    expect(isTaskDeleteRequestForTest(msg)).toBe(esperado);
  });

  it.each([
    ['apaga o briefing dessa', 'clearDescription'],
    ['remove o prazo dela', 'clearDueDate'],
    ['remove o Pedro dela', 'removePersonName'],
    ['apaga a descrição e escreve outra', 'replaceDescription'],
    ['limpa tudo dentro dela e coloca esse briefing', 'replaceDescription'],
    ['delete o conteúdo', 'clearDescription'],
  ])('6. CAMPO: "%s" vira update_multi.%s na MESMA task', async (msg, campo) => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest(msg);
    expect(intent.kind).toBe('update_multi');
    if (intent.kind === 'update_multi') {
      expect(intent.fields[campo as keyof typeof intent.fields]).not.toBeUndefined();
    }
  });

  it('7. a frase EXATA do incidente vira update_multi (texto + título + imagem), nunca delete de task', async () => {
    const { classifyIntentForTest, isTaskDeleteRequestForTest } = await import('./bento-action-guard.js');
    const msg = 'altere ela, delete todo o briefing crie um texto de boas vindas bem humanizado de boas vindas para o pedro e crie um titulo da task coloque a imagem';
    expect(isTaskDeleteRequestForTest(msg)).toBe(false);
    const intent = classifyIntentForTest(msg);
    expect(intent.kind).toBe('update_multi');
    if (intent.kind === 'update_multi') {
      expect(intent.fields.replaceDescription).toBeTruthy();
      expect(intent.fields.generateTitle).toBe(true);
      expect(intent.fields.attachImage).toBe(true);
    }
  });

  it('8. CORREÇÃO de escopo: "nn e pra apagar..." é reparo, não negação', async () => {
    const { detectDeleteScopeCorrectionForTest } = await import('./bento-action-guard.js');
    expect(detectDeleteScopeCorrectionForTest('nn e pra apagar e pra deletar o conteudo dela e atualizar com oq eu pedi')).toBe(true);
    expect(detectDeleteScopeCorrectionForTest('não era pra apagar a task, era só o conteúdo dela')).toBe(true);
    expect(detectDeleteScopeCorrectionForTest('não cria nada ainda')).toBe(false);
    expect(detectDeleteScopeCorrectionForTest('apaga essa task')).toBe(false);
  });

  it('4. create legítimo continua classificando como create', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    expect(classifyIntentForTest('crie uma task nova pro Pedro chamada "QA Teste Bento"').kind).toBe('create');
    expect(classifyIntentForTest('abre uma nova task pra revisar o site amanhã').kind).toBe('create');
  });
});
