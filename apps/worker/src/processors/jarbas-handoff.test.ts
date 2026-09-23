import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAgentTaskStore } from '@desigual-os/agent-runtime';

/**
 * jarbas-handoff.test.ts — missão de fechamento de operabilidade em chat
 * (23/09/2026). `resolveMetaAccountId` agora lê client_meta_accounts de
 * verdade (mockado aqui, nunca banco real) e o rastreamento de tarefa por
 * conversa usa um AgentTaskStore real (InMemoryAgentTaskStore, injetado no
 * lugar do PostgresAgentTaskStore — este arquivo testa a LÓGICA do
 * handoff, não a camada Postgres, que já tem seu próprio contrato de
 * testes em agent-task-postgres-store.test.ts).
 */

process.env.JARBAS_V2_URL = 'http://fake-jarbas-v2';
process.env.AGENTES_ASK_TOKEN = 'fake-token';

let contasPorCliente: Record<string, Array<{ accountId: string; isPrimary: boolean }>> = {};

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: { col?: string; val?: unknown }) => {
          if (cond?.col === 'email') {
            // resolveUserIdByEmail — sem usuário conhecido pro e-mail de teste, nunca inventa (null é o esperado).
            return Promise.resolve([]);
          }
          const clientId = cond?.val as string;
          const rows = (contasPorCliente[clientId] ?? []).map((c) => ({ accountId: c.accountId, isPrimary: c.isPrimary }));
          return Promise.resolve(rows);
        },
      }),
    }),
  },
  schema: {
    clientMetaAccounts: { clientId: { __col: 'clientId' } },
    users: { id: { __col: 'id' }, email: { __col: 'email' } },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: { __col?: string }, val: unknown) => ({ col: col?.__col, val }),
}));

const storeUnico = new InMemoryAgentTaskStore();
vi.mock('./agent-task-postgres-store', () => ({
  PostgresAgentTaskStore: class {
    dispatch(input: unknown) {
      return storeUnico.dispatch(input as never);
    }
    get(taskId: string) {
      return storeUnico.get(taskId);
    }
    getResult(taskId: string) {
      return storeUnico.getResult(taskId);
    }
    transition(taskId: string, next: never, org: string) {
      return storeUnico.transition(taskId, next, org);
    }
    attachResult(taskId: string, result: never, org: string) {
      return storeUnico.attachResult(taskId, result, org);
    }
    updateScope(taskId: string, next: never, org: string) {
      return storeUnico.updateScope(taskId, next, org);
    }
    recordFailure(taskId: string, error: string, org: string) {
      return storeUnico.recordFailure(taskId, error, org);
    }
    getLatestTaskForClientConversation(org: string, clientId: string, conversationId: string) {
      return storeUnico.getLatestTaskForClientConversation(org, clientId, conversationId);
    }
  },
}));

vi.mock('./jarbas-v2-orchestrator', () => ({
  runJarbasV2Task: vi.fn(),
  formatExecutiveAnswer: (task: { scope: string }, result: { metricFacts: unknown[] }) =>
    `[executivo] ${task.scope} — ${result.metricFacts.length} fato(s)`,
}));

/** Simula o que runJarbasV2Task faria de verdade contra o store: leva a tarefa até ready_for_review e anexa o resultado. */
async function completarComoPronta(taskId: string, organizationId: string, metricFacts: unknown[]) {
  await storeUnico.transition(taskId, 'acknowledged', organizationId);
  await storeUnico.transition(taskId, 'context_resolved', organizationId);
  await storeUnico.transition(taskId, 'analyzing', organizationId);
  await storeUnico.transition(taskId, 'verifying', organizationId);
  const task = await storeUnico.get(taskId);
  await storeUnico.attachResult(
    taskId,
    {
      schemaVersion: 1,
      taskId,
      taskVersion: task?.version ?? 1,
      provenanceAvailable: true,
      scope: { organizationId, clientId: task?.clientId ?? '', accountId: null, entityType: null, entityId: null, periodStart: null, periodEnd: null },
      claims: [],
      metricFacts: metricFacts as never,
      comparisons: [],
      recommendations: [],
      proposedActions: [],
      missingData: [],
      risks: [],
      sourceTrace: [],
      analysisConfidence: 'medium',
    },
    organizationId,
  );
  return storeUnico.transition(taskId, 'ready_for_review', organizationId);
}

const SENIOR_CONTEXT_ASSIGN = {
  executionId: 'exe-1',
  userId: 'user-1',
  organizationId: 'org-1',
  agent: 'bento' as const,
  permissions: [{ resource: 'jarbas', action: 'assign' }],
};

const SENIOR_CONTEXT_NO_PERMISSION = {
  ...SENIOR_CONTEXT_ASSIGN,
  permissions: [{ resource: 'clickup', action: 'write' }],
};

describe('tryJarbasHandoff — RBAC e resolução de contexto', () => {
  afterEach(() => {
    contasPorCliente = {};
  });

  it('mensagem sem menção ao Jarbas -> null (guard segue normal, sem interferir em nada)', async () => {
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const r = await tryJarbasHandoff({
      message: 'cria uma task pro Pedro', conversationId: null, userEmail: 'x@x.com',
      clientId: 'cliente-a', clientName: 'Cliente A', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).toBeNull();
  });

  it('pedido de handoff sem permissão jarbas:assign -> negado explicitamente, nunca silencioso', async () => {
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const r = await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar a Cosentino', conversationId: null, userEmail: 'x@x.com',
      clientId: 'cliente-a', clientName: 'Cosentino', seniorToolContext: SENIOR_CONTEXT_NO_PERMISSION,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('denied_permission');
  });

  it('pedido de handoff sem cliente resolvido -> pede o cliente, nunca adivinha', async () => {
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const r = await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar isso', conversationId: null, userEmail: 'x@x.com',
      clientId: null, clientName: null, seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('blocked_ambiguous_client');
  });
});

describe('resolveMetaAccountId (§1/§2/§3) — via client_meta_accounts real, nunca inventado', () => {
  afterEach(() => {
    contasPorCliente = {};
  });

  it('cliente sem nenhuma conta mapeada -> mensagem fail-closed EXATA (§2), nunca adivinha', async () => {
    contasPorCliente = {};
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const r = await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar a Cosentino', conversationId: null, userEmail: 'x@x.com',
      clientId: 'cliente-cosentino', clientName: 'Cosentino', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('blocked_no_account_mapping');
    expect(r?.answer).toBe('Esse cliente ainda não tem uma conta Meta vinculada ao Jarbas.');
  });

  it('cliente com múltiplas contas e nenhuma marcada primary -> BLOCKED_NEEDS_DATA, nunca escolhe uma sozinho', async () => {
    contasPorCliente = { 'cliente-multi': [{ accountId: 'act_1', isPrimary: false }, { accountId: 'act_2', isPrimary: false }] };
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const r = await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar a Multi', conversationId: 'conv-multi', userEmail: 'x@x.com',
      clientId: 'cliente-multi', clientName: 'Multi', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('blocked_ambiguous_account');

    const taskId = r?.metadata.task_id as string;
    const task = await storeUnico.get(taskId);
    expect(task?.status).toBe('blocked_needs_data');
  });

  it('cliente com múltiplas contas e uma marcada primary -> resolve pra essa sem ambiguidade', async () => {
    contasPorCliente = { 'cliente-com-primary': [{ accountId: 'act_secundaria', isPrimary: false }, { accountId: 'act_principal', isPrimary: true }] };
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const { runJarbasV2Task } = await import('./jarbas-v2-orchestrator');
    vi.mocked(runJarbasV2Task).mockResolvedValueOnce({ ok: true, task: {} as never, result: { metricFacts: [] } as never, answer: 'ok' });

    await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar a ComPrimary', conversationId: 'conv-primary', userEmail: 'x@x.com',
      clientId: 'cliente-com-primary', clientName: 'ComPrimary', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });

    const chamada = vi.mocked(runJarbasV2Task).mock.calls[0];
    const taskIdArg = chamada?.[1];
    const task = await storeUnico.get(taskIdArg as string);
    expect(task?.entityRefs).toEqual([{ type: 'account', id: 'act_principal' }]);
  });
});

describe('status/resultado por conversa (§4-§8) — lê o que está persistido, nunca rerroda o Jarbas', () => {
  afterEach(() => {
    contasPorCliente = {};
  });

  it('pergunta de status sem nenhuma tarefa nesta conversa -> resposta honesta, nunca inventa', async () => {
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const r = await tryJarbasHandoff({
      message: 'Bento, o Jarbas terminou?', conversationId: 'conv-sem-tarefa', userEmail: 'x@x.com',
      clientId: 'cliente-sem-tarefa', clientName: 'X', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('no_task_for_conversation');
  });

  it('pergunta de status com tarefa ready_for_review -> "análise pronta", sem chamar Jarbas de novo', async () => {
    contasPorCliente = { 'cliente-pronto': [{ accountId: 'act_pronto', isPrimary: false }] };
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const { runJarbasV2Task } = await import('./jarbas-v2-orchestrator');
    vi.mocked(runJarbasV2Task).mockClear();
    vi.mocked(runJarbasV2Task).mockImplementationOnce(async (_store, taskId, org) => {
      const done = await completarComoPronta(taskId, org, [{ metric: 'spend' }]);
      return { ok: true, task: done.ok ? done.task : ({} as never), result: (await storeUnico.getResult(taskId))!, answer: '[executivo] resposta original' };
    });

    await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar a ClientePronto', conversationId: 'conv-pronto', userEmail: 'x@x.com',
      clientId: 'cliente-pronto', clientName: 'ClientePronto', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });

    const r = await tryJarbasHandoff({
      message: 'Bento, o Jarbas terminou?', conversationId: 'conv-pronto', userEmail: 'x@x.com',
      clientId: 'cliente-pronto', clientName: 'ClientePronto', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r?.metadata.action).toBe('status_query_answered');
    expect(r?.answer).toMatch(/pronta/);
    expect(vi.mocked(runJarbasV2Task)).toHaveBeenCalledTimes(1); // só na criação, nunca de novo no follow-up
  });

  it('pergunta "o que ele encontrou?" com tarefa pronta -> lê o resultado persistido, sem rerodar', async () => {
    contasPorCliente = { 'cliente-resultado': [{ accountId: 'act_resultado', isPrimary: false }] };
    const { tryJarbasHandoff } = await import('./jarbas-handoff');
    const { runJarbasV2Task } = await import('./jarbas-v2-orchestrator');
    vi.mocked(runJarbasV2Task).mockClear();
    vi.mocked(runJarbasV2Task).mockImplementationOnce(async (_store, taskId, org) => {
      const done = await completarComoPronta(taskId, org, [{ metric: 'spend' }]);
      return { ok: true, task: done.ok ? done.task : ({} as never), result: (await storeUnico.getResult(taskId))!, answer: '[executivo] resposta original' };
    });

    await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar a ClienteResultado', conversationId: 'conv-resultado', userEmail: 'x@x.com',
      clientId: 'cliente-resultado', clientName: 'ClienteResultado', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });

    const r = await tryJarbasHandoff({
      message: 'Bento, o que ele encontrou?', conversationId: 'conv-resultado', userEmail: 'x@x.com',
      clientId: 'cliente-resultado', clientName: 'ClienteResultado', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r?.metadata.action).toBe('result_query_answered');
    expect(r?.answer).toMatch(/executivo/);
    expect(vi.mocked(runJarbasV2Task)).toHaveBeenCalledTimes(1);
  });
});
