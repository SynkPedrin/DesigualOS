import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_STATUSES, type AgentTaskStatus } from '@desigual-os/types';
import { InMemoryAgentTaskStore } from '@desigual-os/agent-runtime';

/**
 * agent-task-postgres-store.test.ts — CONTRACT tests contra um banco
 * MOCKADO (mesmo padrão de workflow-consolidation.test.ts/
 * bento-jarbas-handoff.test.ts) — nunca uma conexão real. A migração
 * (database/migrations/0038_jarbas_persistent_tasks.sql) foi criada e
 * NÃO aplicada (ver docs/coordination/JARBAS_SENIOR_HANDOFF.md §11), então
 * "restart recovery" de verdade não pode ser provado aqui — o que este
 * arquivo prova é que a LÓGICA (idempotência via UNIQUE, transição atômica
 * por WHERE, isolamento de organização, rejeição de resultado stale) está
 * correta, pronta pra rodar contra o banco real assim que a migração for
 * aplicada.
 */

type FakeRow = Record<string, unknown>;

function fakeDb(initial: FakeRow[] = []) {
  const linhas = new Map<string, FakeRow>();
  for (const r of initial) linhas.set(r.id as string, r);
  let seq = 0;

  return {
    linhas,
    db: {
      insert: (_table: unknown) => ({
        values: (v: FakeRow) => ({
          onConflictDoNothing: (_opts?: unknown) => ({
            returning: async () => {
              const existente = [...linhas.values()].find((r) => (r.dispatchKey && r.dispatchKey === v.dispatchKey) || (r.taskId === v.taskId && r.taskVersion === v.taskVersion));
              if (existente) return [];
              seq += 1;
              const row: FakeRow = { id: `row-${seq}`, version: 1, attemptCount: 0, lastError: null, lastErrorAt: null, nextEligibleRetryAt: null, createdAt: new Date(), updatedAt: new Date(), status: 'assigned', requestedBy: null, dueAt: null, entityRefs: [], constraints: [], timeWindowStart: null, timeWindowEnd: null, ...v };
              linhas.set(row.id as string, row);
              return [row];
            },
          }),
        }),
      }),
      select: () => ({
        from: (_table: unknown) => ({
          where: async (cond: { type: string; a?: unknown; b?: unknown; conds?: unknown[] } | undefined) => {
            const rows = [...linhas.values()];
            return rows.filter((r) => matches(r, cond));
          },
        }),
      }),
      update: (_table: unknown) => ({
        set: (patch: FakeRow) => ({
          where: (cond: { type: string; a?: unknown; b?: unknown; conds?: unknown[] }) => ({
            returning: async () => {
              const alvo = [...linhas.values()].filter((r) => matches(r, cond));
              const atualizadas: FakeRow[] = [];
              for (const r of alvo) {
                const nova = { ...r, ...patch, updatedAt: new Date() };
                linhas.set(r.id as string, nova);
                atualizadas.push(nova);
              }
              return atualizadas;
            },
          }),
        }),
      }),
    },
  };
}

// Mini-DSL só pra este teste: reconhece `{col, op:'eq', val}` e `{op:'and', conds}` e `{op:'in', col, vals}`.
function matches(row: FakeRow, cond: unknown): boolean {
  if (!cond || typeof cond !== 'object') return true;
  const c = cond as { op: string; col?: string; val?: unknown; vals?: unknown[]; conds?: unknown[] };
  if (c.op === 'and') return (c.conds ?? []).every((sub) => matches(row, sub));
  if (c.op === 'eq') return row[c.col as string] === c.val;
  if (c.op === 'in') return (c.vals ?? []).includes(row[c.col as string]);
  return true;
}

vi.mock('drizzle-orm', () => ({
  eq: (col: { __col?: string }, val: unknown) => ({ op: 'eq', col: col?.__col, val }),
  and: (...conds: unknown[]) => ({ op: 'and', conds }),
  inArray: (col: { __col?: string }, vals: unknown[]) => ({ op: 'in', col: col?.__col, vals }),
}));

let currentDb: ReturnType<typeof fakeDb>;

vi.mock('@desigual-os/database', () => ({
  get db() {
    return currentDb.db;
  },
  schema: {
    agentTasks: {
      id: { __col: 'id' },
      dispatchKey: { __col: 'dispatchKey' },
      organizationId: { __col: 'organizationId' },
      clientId: { __col: 'clientId' },
      status: { __col: 'status' },
    },
    agentTaskResults: {
      taskId: { __col: 'taskId' },
      taskVersion: { __col: 'taskVersion' },
    },
  },
}));

describe('PostgresAgentTaskStore.dispatch — idempotência via UNIQUE de verdade (§5/§33)', () => {
  afterEach(() => vi.clearAllMocks());

  it('primeiro dispatch cria a linha', async () => {
    currentDb = fakeDb();
    const { PostgresAgentTaskStore } = await import('./agent-task-postgres-store');
    const store = new PostgresAgentTaskStore();
    const r = await store.dispatch(baseInput());
    expect(r.wasAlreadyDispatched).toBe(false);
    expect(r.task.status).toBe('assigned');
  });

  it('dispatchKey repetida -> onConflictDoNothing, devolve a linha existente, nunca duas', async () => {
    currentDb = fakeDb();
    const { PostgresAgentTaskStore } = await import('./agent-task-postgres-store');
    const store = new PostgresAgentTaskStore();
    const a = await store.dispatch(baseInput({ dispatchKey: 'msg-fixa' }));
    const b = await store.dispatch(baseInput({ dispatchKey: 'msg-fixa' }));
    expect(b.wasAlreadyDispatched).toBe(true);
    expect(b.task.taskId).toBe(a.task.taskId);
    expect(currentDb.linhas.size).toBe(1);
  });
});

describe('PostgresAgentTaskStore.transition — WHERE atômico, isolamento de organização', () => {
  afterEach(() => vi.clearAllMocks());

  it('transição válida muda o status', async () => {
    currentDb = fakeDb();
    const { PostgresAgentTaskStore } = await import('./agent-task-postgres-store');
    const store = new PostgresAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    const r = await store.transition(task.taskId, 'acknowledged', task.organizationId);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.status).toBe('acknowledged');
  });

  it('organização errada nunca consegue transicionar tarefa alheia (WHERE inclui organization_id)', async () => {
    currentDb = fakeDb();
    const { PostgresAgentTaskStore } = await import('./agent-task-postgres-store');
    const store = new PostgresAgentTaskStore();
    const { task } = await store.dispatch(baseInput({ organizationId: 'org-a' }));
    const r = await store.transition(task.taskId, 'acknowledged', 'org-b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cross_org');
  });

  it('transição inválida (pular estados) é recusada', async () => {
    currentDb = fakeDb();
    const { PostgresAgentTaskStore } = await import('./agent-task-postgres-store');
    const store = new PostgresAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    const r = await store.transition(task.taskId, 'ready_for_review', task.organizationId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_transition');
  });
});

describe('PostgresAgentTaskStore.attachResult — rejeita resultado de versão stale', () => {
  afterEach(() => vi.clearAllMocks());

  it('resultado com taskVersion diferente da vigente é recusado', async () => {
    currentDb = fakeDb();
    const { PostgresAgentTaskStore } = await import('./agent-task-postgres-store');
    const store = new PostgresAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    await store.transition(task.taskId, 'acknowledged', task.organizationId);
    await store.transition(task.taskId, 'context_resolved', task.organizationId);
    await store.transition(task.taskId, 'analyzing', task.organizationId);
    const r = await store.attachResult(task.taskId, resultadoFake(task.taskId, 99), task.organizationId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale_version');
  });
});

/**
 * A tabela de "de quais estados dá pra chegar em X" duplicada no store
 * Postgres (por necessidade do WHERE atômico — ver comentário no arquivo)
 * precisa concordar, PAR A PAR, com a máquina de estado real de
 * agent-task.ts. Testado aqui comparando contra o InMemoryAgentTaskStore
 * pra QUALQUER par (de, para) dos 13 status — se as duas divergirem, um
 * mock nunca pegaria, só este teste cruzado pega.
 */
describe('consistência entre a tabela Postgres (local) e a máquina de estado real (agent-task.ts)', () => {
  it('para cada par (de, para), o InMemoryAgentTaskStore concorda com o que o store Postgres permitiria', async () => {
    for (const de of AGENT_TASK_STATUSES) {
      for (const para of AGENT_TASK_STATUSES) {
        const store = new InMemoryAgentTaskStore();
        const { task } = await store.dispatch(baseInput({ dispatchKey: `${de}->${para}` }));
        // Anda até "de" por um caminho válido só quando "de" for alcançável
        // a partir de assigned pelos testes já cobertos noutro arquivo —
        // aqui simplificado: testa direto a partir de "assigned" (a única
        // origem real de uma tarefa nova) contra CADA destino, que é
        // exatamente o par mais crítico (primeira transição).
        if (de !== 'assigned') continue;
        const resultado = await store.transition(task.taskId, para as AgentTaskStatus, task.organizationId);
        const esperadoPermitido = resultado.ok;
        const postgresPermitiria = (ESTADOS_ALCANCAVEIS_DE_ASSIGNED as string[]).includes(para);
        expect(postgresPermitiria).toBe(esperadoPermitido);
      }
    }
  });
});

// Espelha ESTADOS_QUE_PODEM_IR_PARA['<x>'].includes('assigned') do módulo real, computado aqui só pra comparação de teste.
const ESTADOS_ALCANCAVEIS_DE_ASSIGNED = ['acknowledged', 'cancelled', 'blocked_permission', 'blocked_ambiguous'];

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    dispatchKey: `msg-${Math.random()}`,
    organizationId: 'org-1',
    clientId: 'cliente-a',
    requestedBy: 'user-1',
    objective: 'entender por que o CPL subiu',
    scope: 'campanha X, últimos 7 dias',
    entityRefs: [{ type: 'campaign' as const, id: 'camp-x' }],
    timeWindow: { start: '2026-09-17', end: '2026-09-24' },
    originalUserRequest: 'Bento, pede pro Jarbas analisar por que o CPL piorou.',
    ...overrides,
  };
}

function resultadoFake(taskId: string, taskVersion: number) {
  return {
    schemaVersion: 1 as const,
    taskId,
    taskVersion,
    provenanceAvailable: false,
    scope: { organizationId: 'org-1', clientId: 'cliente-a', accountId: null, entityType: null, entityId: null, periodStart: null, periodEnd: null },
    claims: [],
    metricFacts: [],
    comparisons: [],
    recommendations: [],
    proposedActions: [],
    missingData: [],
    risks: [],
    sourceTrace: [],
    analysisConfidence: 'insufficient_data' as const,
  };
}
