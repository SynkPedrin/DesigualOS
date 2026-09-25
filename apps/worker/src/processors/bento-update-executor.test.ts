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
};
const chamadas = {
  put: [] as Array<Record<string, unknown>>,
  upload: 0,
};

vi.mock('@desigual-os/tool-gateway', () => ({
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
    chamadas.put.length = 0;
    chamadas.upload = 0;
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
});
