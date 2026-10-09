import { describe, expect, it, vi } from 'vitest';
import { createVerifiedSeniorTask, MutationBudget } from './senior-operation';

/** Captura as linhas de audit_logs que `auditarEscritaDoAgente` tentou gravar
 *  (Bento 3.0, Fase 2) — sem isto, o teste batia na rede de verdade. */
const auditInserts: Record<string, unknown>[] = [];
vi.mock('@desigual-os/database', () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (valores: Record<string, unknown>) => {
        auditInserts.push(valores);
        return { catch: () => Promise.resolve(undefined) };
      },
    }),
  },
  schema: { auditLogs: {} },
}));

vi.mock('./clickup-client', () => ({
  findMemberByEmail: vi.fn(async () => ({ id: 11, username: 'Sofia Mendes', email: 'sofia@example.test' })),
  resolveMemberByName: vi.fn(async () => ({ status: 'resolved', matchedBy: 'full', member: { id: 11, username: 'Sofia Mendes', email: 'sofia@example.test' } })),
  createTask: vi.fn(async () => ({ id: 'task-1', url: 'https://clickup.test/t/task-1' })),
  getTask: vi.fn(async () => ({ id: 'task-1', name: 'Carrossel IA', status: 'to do', dueDate: 1_000, listId: 'list-1', assignees: [{ id: 11, username: 'Sofia Mendes' }], description: 'briefing', attachments: [] })),
}));

// P1-01 (release readiness audit, 22/09/2026): a checagem de duplicata
// (queryOperationTasks) agora é obrigatória ANTES de criar — falha dela vira
// erro retryable, não "nenhuma duplicata encontrada" em silêncio. Sem mockar
// aqui, os testes abaixo bateriam na rede de verdade e falhariam por isso,
// não pelo que cada um realmente testa.
vi.mock('./clickup-operation', () => ({
  queryOperationTasks: vi.fn(async () => ({ tasks: [] })),
}));

const context = { executionId: 'exe-1', userId: 'user-1', organizationId: 'org-1', agent: 'bento' as const, permissions: [{ resource: 'clickup', action: 'write' }] };
const config = { apiKey: 'test', teamId: 'team-1' };

describe('senior operation create → assign → verify', () => {
  it('returns structured verified success', async () => {
    const result = await createVerifiedSeniorTask(config, context, { listId: 'list-1', name: 'Carrossel IA', description: 'briefing', assigneeName: 'Sofia Mendes', expected: { dueDate: 1_000 } });
    expect(result).toMatchObject({ success: true, verified: true, resourceId: 'task-1', assignedTo: { id: 11 } });
  });

  /**
   * Bento 3.0, Fase 2 — achado da investigação forense: nenhuma escrita do
   * agente no ClickUp deixava rastro em `audit_logs` (só em `execution-record`,
   * que serve continuidade de conversa, não auditoria). Este teste prova que a
   * criação verificada agora grava a linha, com quem/organização/recurso reais.
   */
  it('grava audit_logs com actor/organização/recurso reais após criar', async () => {
    auditInserts.length = 0;
    await createVerifiedSeniorTask(config, context, { listId: 'list-1', name: 'Carrossel IA', description: 'briefing', assigneeName: 'Sofia Mendes' });
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      agent: 'bento',
      userId: 'user-1',
      organizationId: 'org-1',
      action: 'clickup.task_created',
      resourceId: 'task-1',
      source: 'agent',
    });
  });
  it('does not claim success without ClickUp permission', async () => {
    const result = await createVerifiedSeniorTask(config, { ...context, permissions: [] }, { listId: 'list-1', name: 'x', description: 'x' });
    expect(result).toMatchObject({ success: false, errorCode: 'permission_denied' });
  });
  it('stops a senior execution at its configured mutation budget', async () => {
    const budget = new MutationBudget(1);
    await createVerifiedSeniorTask(config, context, { listId: 'list-1', name: 'x', description: 'x' }, budget);
    const second = await createVerifiedSeniorTask(config, context, { listId: 'list-1', name: 'y', description: 'y' }, budget);
    expect(second).toMatchObject({ success: false, message: 'Mutation budget exceeded for this execution' });
  });

  /**
   * P1-01 (release readiness audit, 22/09/2026): a checagem de duplicata
   * falhando (timeout/rate-limit do ClickUp) virava `.catch(() => null)` —
   * lido como "nenhuma duplicata encontrada" — e criava uma SEGUNDA task de
   * verdade num retry. "RECONCILE FIRST": sem conseguir provar ausência de
   * duplicata, a operação para com erro retryable, nunca cria no escuro.
   */
  it('não cria task quando a checagem de duplicata falha — RECONCILE FIRST, nunca cria no escuro', async () => {
    const { queryOperationTasks } = await import('./clickup-operation');
    const { createTask } = await import('./clickup-client');
    vi.mocked(queryOperationTasks).mockRejectedValueOnce(new Error('ClickUp timeout'));
    vi.mocked(createTask).mockClear();

    const result = await createVerifiedSeniorTask(config, context, { listId: 'list-1', name: 'Carrossel IA', description: 'briefing' });

    expect(result).toMatchObject({ success: false, errorCode: 'write_failed', retryable: true });
    expect(createTask).not.toHaveBeenCalled();
  });
});
