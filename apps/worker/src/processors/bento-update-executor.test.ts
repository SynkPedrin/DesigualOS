import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Executor de UPDATE de task existente (adendo 25/09/2026). Trava o contrato:
 * conteúdo/título/anexo/prazo/responsável mudam a MESMA task, campo a campo,
 * com read-back — e createTask sequer existe aqui.
 */
const estado = {
  description: 'BRIEFING ANTIGO que precisa sair',
  dueDate: Date.parse('2026-09-20T23:59:00-03:00') as number | null,
  assignees: [{ id: 123, username: 'Pedro Gabriel' }] as Array<{ id: number; username: string }>,
  attachments: [] as Array<{ id: string | null; title: string | null }>,
  name: 'Task de QA',
  /** Bento 3.0, Fase 4: o resto do ClickUp — tag, checklist, seguidor. */
  tags: [] as string[],
  checklists: [] as Array<{ name: string; items: string[] }>,
  watchers: [] as Array<{ id: number; username: string | null }>,
};
const chamadas = {
  put: [] as Array<Record<string, unknown>>,
  upload: 0,
  addTag: [] as string[],
  removeTag: [] as string[],
  setCustomField: [] as Array<{ taskId: string; fieldId: string; value: unknown }>,
  addToList: [] as string[],
  tempo: [] as Array<{ taskId: string; inicioMs: number; duracaoMs: number }>,
  dependency: [] as Array<{ dependsOn?: string; dependencyOf?: string }>,
};
/** Bento 3.0, Fase 2: captura toda tentativa de gravar audit_logs. */
const auditCalls: Record<string, unknown>[] = [];

vi.mock('@desigual-os/tool-gateway', () => ({
  auditarEscritaDoAgente: vi.fn(async (entrada: Record<string, unknown>) => { auditCalls.push(entrada); }),
  getTask: vi.fn(async (_c: unknown, taskId: string) => ({
    id: taskId,
    name: estado.name,
    status: 'aberto',
    priority: 3,
    dueDate: estado.dueDate,
    listId: 'lista-qa',
    assignees: estado.assignees,
    description: estado.description,
    attachments: estado.attachments,
    tags: estado.tags,
    checklists: estado.checklists,
    watchers: estado.watchers,
  })),
  updateTask: vi.fn(async (_c: unknown, _id: string, params: Record<string, unknown>) => {
    chamadas.put.push(params);
    if (params.description !== undefined) estado.description = params.description as string;
    if (params.dueDate !== undefined) estado.dueDate = params.dueDate as number | null;
    if (params.name !== undefined) estado.name = params.name as string;
    if (params.removeAssignees) estado.assignees = estado.assignees.filter((a) => !(params.removeAssignees as number[]).includes(a.id));
    if (params.addAssignees) estado.assignees.push(...(params.addAssignees as number[]).map((id) => ({ id, username: 'Novo' })));
  }),
  uploadTaskAttachment: vi.fn(async (_c: unknown, _id: string, _url: string, filename: string) => {
    chamadas.upload += 1;
    estado.attachments.push({ id: `att-${chamadas.upload}`, title: filename });
    return { id: `att-${chamadas.upload}` };
  }),
  listStatusesForTask: vi.fn(async () => ['aberto', 'em andamento', 'pronto']),
  resolveMemberByName: vi.fn(async (_c: unknown, name: string) =>
    /pedro/i.test(name)
      ? { status: 'resolved', member: { id: 123, username: 'Pedro Gabriel', email: 'p@x.com' }, matchedBy: 'first_name' }
      : { status: 'not_found', candidates: [] },
  ),
  addTaskTag: vi.fn(async (_c: unknown, _id: string, tag: string) => {
    chamadas.addTag.push(tag);
    estado.tags.push(tag.toLowerCase());
  }),
  removeTaskTag: vi.fn(async (_c: unknown, _id: string, tag: string) => {
    chamadas.removeTag.push(tag);
    estado.tags = estado.tags.filter((t) => t !== tag.toLowerCase());
  }),
  listCustomFields: vi.fn(async () => [
    { id: 'campo-etapa', name: 'Etapa', type: 'drop_down', options: [{ id: 'opt-aprovacao', name: 'Aprovação' }] },
  ]),
  setCustomFieldValue: vi.fn(async (_c: unknown, taskId: string, fieldId: string, value: unknown) => {
    chamadas.setCustomField.push({ taskId, fieldId, value });
  }),
  createChecklist: vi.fn(async (_c: unknown, _id: string, name: string) => {
    estado.checklists.push({ name, items: [] });
    return 'checklist-1';
  }),
  addChecklistItem: vi.fn(async (_c: unknown, _checklistId: string, item: string) => {
    estado.checklists[estado.checklists.length - 1]!.items.push(item);
  }),
  updateTaskWatchers: vi.fn(async (_c: unknown, _id: string, params: { add?: number[]; remove?: number[] }) => {
    for (const id of params.add ?? []) estado.watchers.push({ id, username: 'Convidado' });
    if (params.remove) estado.watchers = estado.watchers.filter((w) => !params.remove!.includes(w.id));
  }),
  addTaskToList: vi.fn(async (_c: unknown, _id: string, listId: string) => {
    chamadas.addToList.push(listId);
  }),
  registrarTempo: vi.fn(async (_c: unknown, _teamId: string, params: { taskId: string; inicioMs: number; duracaoMs: number }) => {
    chamadas.tempo.push(params);
  }),
  addTaskDependency: vi.fn(async (_c: unknown, _id: string, params: { dependsOn?: string; dependencyOf?: string }) => {
    chamadas.dependency.push(params);
  }),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
const config = { apiKey: 'k', teamId: 't' };

function base(fields: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    config,
    taskId: 'task-qa-1',
    knownTaskName: 'Task de QA',
    fields,
    mapStatus: (hint: string, statuses: string[]) => (/andamento/i.test(hint) ? statuses.find((s) => /andamento/i.test(s)) : undefined),
    logger,
    ...extra,
  } as never;
}

describe('executeTaskUpdate — conteúdo/título/anexo na MESMA task', () => {
  beforeEach(() => {
    estado.description = 'BRIEFING ANTIGO que precisa sair';
    estado.dueDate = Date.parse('2026-09-20T23:59:00-03:00');
    estado.assignees = [{ id: 123, username: 'Pedro Gabriel' }];
    estado.attachments = [];
    estado.name = 'Task de QA';
    estado.tags = [];
    estado.checklists = [];
    estado.watchers = [];
    chamadas.put.length = 0;
    chamadas.upload = 0;
    chamadas.addTag.length = 0;
    chamadas.removeTag.length = 0;
    chamadas.setCustomField.length = 0;
    chamadas.addToList.length = 0;
    chamadas.tempo.length = 0;
    chamadas.dependency.length = 0;
    auditCalls.length = 0;
  });

  /**
   * Bento 3.0, Fase 2 — achado da investigação forense: `executeTaskUpdate`
   * não gravava nada em `audit_logs`. Prova que, com `auditContext`, a
   * atualização verificada grava a linha certa — e sem ele, não quebra (os
   * chamadores antigos que não têm o contexto ainda não são obrigados a tê-lo).
   */
  it('grava audit_logs quando auditContext é passado, e não quebra quando não é', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const semContexto = await executeTaskUpdate(base({ clearDescription: true }));
    expect(semContexto.status).toBe('completed');
    expect(auditCalls).toHaveLength(0);

    // A primeira chamada já zerou a descrição — sem resetar, a segunda seria
    // "já estava assim" (zero escrita) em vez de uma mudança de verdade.
    estado.description = 'BRIEFING ANTIGO que precisa sair';
    const comContexto = await executeTaskUpdate(
      base({ clearDescription: true }, { auditContext: { agent: 'bento', userId: 'user-9', organizationId: 'org-9', executionId: 'exe-9' } }),
    );
    expect(comContexto.status).toBe('completed');
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ agent: 'bento', userId: 'user-9', organizationId: 'org-9', action: 'clickup.task_updated', resourceId: 'task-qa-1' });
  });

  it('clearDescription esvazia a descrição da MESMA task (PUT description vazio + read-back)', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ clearDescription: true }));
    expect(chamadas.put).toEqual([{ description: '' }]);
    expect(res.status).toBe('completed');
    expect(res.answer).toContain('✅ Task atualizada');
    expect(res.answer).toContain('📝 Briefing: removido');
  });

  it('replaceDescription gera o texto e substitui, conferido por releitura', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ replaceDescription: 'crie um texto de boas-vindas' }, { briefingWriter: async () => 'Bem-vindo, Pedro! Que bom ter você aqui.' }));
    expect(chamadas.put[0]!.description).toBe('Bem-vindo, Pedro! Que bom ter você aqui.');
    expect(res.answer).toContain('📝 Briefing: substituído');
  });

  it('falha de geração NÃO toca no conteúdo atual (e não cria nada)', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ replaceDescription: 'reescreve' }, { briefingWriter: async () => null }));
    expect(chamadas.put).toHaveLength(0);
    expect(res.answer).toContain('intacto');
    expect(estado.description).toBe('BRIEFING ANTIGO que precisa sair');
  });

  it('removePersonName remove o responsável da task', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ removePersonName: 'Pedro' }));
    expect(chamadas.put).toEqual([{ removeAssignees: [123] }]);
    expect(res.answer).toContain('👤');
  });

  it('attachImage sem imagem na conversa: falha de CAMPO, sem descartar o resto', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ attachImage: true, newTitle: 'Título Novo' }));
    expect(chamadas.upload).toBe(0);
    expect(chamadas.put).toEqual([{ name: 'Título Novo' }]);
    expect(res.answer).toContain('⚠️');
    expect(res.answer).toContain('✏️ Título');
    expect(res.answer).toContain('não encontrei nenhuma imagem');
  });

  it('attachImage com imagem: upload + read-back de anexo na mesma task', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(
      base({ attachImage: true }, { attachments: [{ url: 'https://supabase.x/storage/v1/object/public/b/print.png', filename: 'print.png', contentType: 'image/png' }] }),
    );
    expect(chamadas.upload).toBe(1);
    expect(res.status).toBe('completed');
    expect(res.answer).toContain('🖼️ Imagem');
  });

  it('idempotência: tudo já certo = zero escrita, resposta "já estava assim"', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ dueDate: estado.dueDate, personName: 'Pedro' }));
    expect(chamadas.put).toHaveLength(0);
    expect(res.answer).toContain('Já estava assim');
  });

  it('replacePersonName (assigneeOperation replace, F-17): adiciona a pessoa e remove os OUTROS num PUT só — nunca remove ela mesma', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    estado.assignees = [
      { id: 123, username: 'Pedro Gabriel' },
      { id: 456, username: 'Bruna' },
    ];
    const res = await executeTaskUpdate(base({ replacePersonName: 'Pedro' }));
    // O bug do desenho "personName + removePersonName:''" removeria TODOS,
    // inclusive o Pedro já atribuído. replacePersonName exclui ele da remoção.
    expect(chamadas.put).toEqual([{ addAssignees: [123], removeAssignees: [456] }]);
    expect(res.status).toBe('completed');
    expect(res.answer).toContain('somente Pedro Gabriel');
  });

  it('replacePersonName quando a pessoa JÁ é a única responsável: zero escrita (idempotente)', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    estado.assignees = [{ id: 123, username: 'Pedro Gabriel' }];
    const res = await executeTaskUpdate(base({ replacePersonName: 'Pedro' }));
    expect(chamadas.put).toHaveLength(0);
    expect(res.answer).toContain('Já estava assim');
  });
});

/**
 * Bento 3.0, Fase 4 (09-10/10/2026): "7 de ~12 capacidades da missão nunca
 * foram construídas" (achado da Fase 0) não resistiu à conferência — o código
 * de execução de tag/campo personalizado/checklist/seguidor/lista/tempo/
 * dependência já existe nesta função desde 28/09/2026 (ver TaskUpdateFields)
 * e já é preenchido pelo planner do core novo (packages/bento-core/src/planner.ts),
 * só nunca tinha teste PROVANDO que a execução funciona — só a chave de
 * idempotência (bento-campos-novos-idempotencia.test.ts) estava coberta.
 */
describe('executeTaskUpdate — o resto do ClickUp (tag, campo, checklist, seguidor, lista, tempo, dependência)', () => {
  beforeEach(() => {
    estado.tags = [];
    estado.checklists = [];
    estado.watchers = [];
    chamadas.addTag.length = 0;
    chamadas.removeTag.length = 0;
    chamadas.setCustomField.length = 0;
    chamadas.addToList.length = 0;
    chamadas.tempo.length = 0;
    chamadas.dependency.length = 0;
  });

  it('addTags aplica tag nova e é idempotente pra tag já aplicada', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    estado.tags = ['urgente-cliente'];
    const res = await executeTaskUpdate(base({ addTags: ['urgente-cliente', 'qa-teste'] }));
    expect(chamadas.addTag).toEqual(['qa-teste']);
    expect(res.status).toBe('completed');
    expect(res.answer).toContain('🏷️ Tag "qa-teste"');
  });

  it('removeTags tira a tag e confere pela releitura', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    estado.tags = ['rascunho'];
    const res = await executeTaskUpdate(base({ removeTags: ['rascunho'] }));
    expect(chamadas.removeTag).toEqual(['rascunho']);
    expect(estado.tags).toEqual([]);
    expect(res.answer).toContain('removida');
  });

  it('customFields resolve nome→id e valor→opção lendo a lista, sem o modelo chutar id', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ customFields: { Etapa: 'Aprovação' } }));
    expect(chamadas.setCustomField).toEqual([{ taskId: 'task-qa-1', fieldId: 'campo-etapa', value: 'opt-aprovacao' }]);
    expect(res.answer).toContain('🧩 Etapa');
  });

  it('customFields com campo que não existe na lista: erro de CAMPO, sem chamar o ClickUp', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ customFields: { Inexistente: 'x' } }));
    expect(chamadas.setCustomField).toHaveLength(0);
    expect(res.answer).toContain('não existe o campo "Inexistente"');
  });

  it('checklist cria o bloco e os itens, conferido pela releitura (checklistConfere)', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ checklistName: 'Aprovação', checklistItems: ['Logo', 'Copy'] }));
    expect(estado.checklists).toEqual([{ name: 'Aprovação', items: ['Logo', 'Copy'] }]);
    expect(res.status).toBe('completed');
    expect(res.answer).toContain('☑️ Checklist "Aprovação"');
  });

  it('addWatcherNames resolve o membro e segue a task, sem virar responsável', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ addWatcherNames: ['Pedro'] }));
    expect(estado.watchers).toEqual([{ id: 123, username: 'Convidado' }]);
    expect(estado.assignees).toEqual([{ id: 123, username: 'Pedro Gabriel' }]);
    expect(res.answer).toContain('👀 Seguidor');
  });

  it('addWatcherNames com nome que não resolve: erro de CAMPO explicando o motivo', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ addWatcherNames: ['Ninguém'] }));
    expect(estado.watchers).toHaveLength(0);
    expect(res.answer).toContain('não encontrei "Ninguém"');
  });

  it('addToListId adiciona a task a outra lista SEM tirar da origem ("também", nunca "moveu")', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ addToListId: 'lista-colormaq', addToListName: 'Colormaq' }));
    expect(chamadas.addToList).toEqual(['lista-colormaq']);
    expect(res.answer).toContain('Também na lista "Colormaq"');
  });

  it('tempo registra o apontamento de horas com início e duração', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ tempo: { inicioMs: 1000, duracaoMs: 7_200_000 } }));
    expect(chamadas.tempo).toEqual([{ taskId: 'task-qa-1', inicioMs: 1000, duracaoMs: 7_200_000 }]);
    expect(res.answer).toContain('⏲️ Horas apontadas');
  });

  it('dependsOnTaskId e dependencyOfTaskId viram chamadas separadas de dependência', async () => {
    const { executeTaskUpdate } = await import('./bento-update-executor.js');
    const res = await executeTaskUpdate(base({ dependsOnTaskId: 'task-x', dependencyOfTaskId: 'task-y' }));
    expect(chamadas.dependency).toEqual([{ dependsOn: 'task-x' }, { dependencyOf: 'task-y' }]);
    expect(res.answer).toContain('🔗 Depende de task-x');
    expect(res.answer).toContain('🔗 Bloqueia task-y');
  });
});
