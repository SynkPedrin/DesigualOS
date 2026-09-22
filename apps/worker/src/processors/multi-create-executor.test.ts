import { describe, expect, it, vi } from 'vitest';
import type { CreateOneInput, CreateDeps } from './multi-create-executor';
import type { PlannedTask } from './operational-action-plan';
import type { SeniorToolContext, VerifiedTaskResult, ClickUpConfig } from '@desigual-os/tool-gateway';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));

const CONFIG = {} as ClickUpConfig;
const SENIOR_CONTEXT: SeniorToolContext = {
  executionId: 'exec-1',
  userId: 'user-1',
  organizationId: 'org-1',
  permissions: [{ resource: 'clickup', action: 'write' }],
  agent: 'bento',
};

const PLANNED: PlannedTask = { deliverable: 'briefing', assigneeName: null, excerpt: 'briefing de boas-vindas' };
const INPUT: CreateOneInput = {
  planned: PLANNED,
  title: 'Executar briefing — Cliente Teste 7',
  briefing: 'algum briefing',
  description: '',
  dueDate: null,
  attachments: [],
};

/**
 * BENTO_RETRY_SAYS_ALREADY_EXISTS — regressão do achado real (21/09/2026):
 * quando `createVerifiedSeniorTask` encontra a task já existente por dentro
 * (`wasExisting: true`), `createOneTask` PRECISA marcar `status: 'duplicate'`
 * — não 'created' — senão `reciboHumano` diz "criei a task" pra uma task que
 * já existia há horas, e o guard nunca sabe que não escreveu nada de novo.
 */
describe('createOneTask (senior context) — wasExisting vira duplicate, nunca created', () => {
  it('wasExisting: true -> status duplicate, sem tentar atribuir/comentar/read-back de novo', async () => {
    vi.resetModules();
    const existente: VerifiedTaskResult = {
      success: true,
      resourceId: 'task-existente',
      resourceUrl: 'https://app.clickup.com/t/task-existente',
      verified: true,
      wasExisting: true,
      assignedTo: null,
      data: {
        id: 'task-existente',
        name: INPUT.title,
        status: 'to do',
        priority: null,
        dueDate: null,
        listId: 'list-1',
        assignees: [],
        description: 'descrição já existente',
        attachments: [],
      },
    };
    vi.doMock('@desigual-os/tool-gateway', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@desigual-os/tool-gateway')>();
      return { ...actual, createVerifiedSeniorTask: vi.fn().mockResolvedValue(existente) };
    });
    const { createOneTask } = await import('./multi-create-executor.js');
    const deps = { listTasks: vi.fn().mockResolvedValue({ tasks: [] }) } as unknown as CreateDeps;
    const out = await createOneTask(CONFIG, 'list-1', { name: 'QA Bot', clickUpEmail: null }, INPUT, deps, SENIOR_CONTEXT);
    expect(out.status).toBe('duplicate');
    expect(out.taskId).toBe('task-existente');
    expect(out.url).toBe('https://app.clickup.com/t/task-existente');
    vi.doUnmock('@desigual-os/tool-gateway');
  });

  it('wasExisting: false -> status created, como antes', async () => {
    vi.resetModules();
    const criada: VerifiedTaskResult = {
      success: true,
      resourceId: 'task-nova',
      resourceUrl: 'https://app.clickup.com/t/task-nova',
      verified: true,
      wasExisting: false,
      assignedTo: null,
      data: {
        id: 'task-nova',
        name: INPUT.title,
        status: 'to do',
        priority: null,
        dueDate: null,
        listId: 'list-1',
        assignees: [],
        description: 'nova descrição',
        attachments: [],
      },
    };
    vi.doMock('@desigual-os/tool-gateway', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@desigual-os/tool-gateway')>();
      return { ...actual, createVerifiedSeniorTask: vi.fn().mockResolvedValue(criada) };
    });
    const { createOneTask } = await import('./multi-create-executor.js');
    const deps = {
      listTasks: vi.fn().mockResolvedValue({ tasks: [] }),
      uploadAttachment: vi.fn(),
    } as unknown as CreateDeps;
    const out = await createOneTask(CONFIG, 'list-1', { name: 'QA Bot', clickUpEmail: null }, INPUT, deps, SENIOR_CONTEXT);
    expect(out.status).toBe('created');
    expect(out.taskId).toBe('task-nova');
    vi.doUnmock('@desigual-os/tool-gateway');
  });
});
