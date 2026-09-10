import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeCost } from '@desigual-os/token-engine';

interface DbCall {
  op: 'insert' | 'update' | 'delete';
  table: unknown;
  payload?: unknown;
}

const mockCalls: DbCall[] = [];
let mockCostRecordRows: { amount: string }[] = [];
let mockExecutionReturningRow: { estimatedCost: string | null } | undefined;

vi.mock('@desigual-os/database', () => ({
  db: {
    insert: (table: unknown) => ({
      values: (data: unknown) => {
        mockCalls.push({ op: 'insert', table, payload: data });
        return Promise.resolve();
      },
    }),
    select: (_columns?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => Promise.resolve(mockCostRecordRows),
      }),
    }),
    update: (table: unknown) => ({
      set: (data: unknown) => {
        mockCalls.push({ op: 'update', table, payload: data });
        return {
          where: (_condition: unknown) => ({
            returning: (_columns: unknown) =>
              Promise.resolve(mockExecutionReturningRow ? [mockExecutionReturningRow] : []),
          }),
        };
      },
    }),
    delete: (table: unknown) => {
      mockCalls.push({ op: 'delete', table });
      return { where: (_condition: unknown) => Promise.resolve() };
    },
  },
  schema: {
    costRecords: { executionId: 'costRecords.executionId', amount: 'costRecords.amount' },
    executions: { id: 'executions.id', estimatedCost: 'executions.estimatedCost' },
    economyRecords: { executionId: 'economyRecords.executionId' },
  },
}));

describe('recordCostEvent', () => {
  afterEach(() => {
    mockCalls.length = 0;
  });

  it('não grava nada quando inputTokens e outputTokens são os dois 0', async () => {
    const { recordCostEvent } = await import('./cost-service.js');

    await recordCostEvent({
      executionDbId: 'exec-1',
      clientId: null,
      userId: 'user-1',
      agent: 'bento',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(mockCalls).toHaveLength(0);
  });

  it('grava uma linha em cost_records com o custo calculado quando há tokens', async () => {
    const { recordCostEvent } = await import('./cost-service.js');
    const expected = computeCost('unknown', 1000, 500);

    await recordCostEvent({
      executionDbId: 'exec-1',
      clientId: 'client-1',
      userId: 'user-1',
      agent: 'jarbas',
      model: 'unknown',
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]).toMatchObject({
      op: 'insert',
      payload: {
        executionId: 'exec-1',
        clientId: 'client-1',
        userId: 'user-1',
        agent: 'jarbas',
        kind: 'model',
        amount: expected.amountUsd.toString(),
        currency: 'USD',
      },
    });
  });

  it('marca kind como model_estimated quando estimated: true (Bento/Jarbas/Suzy não reportam usage real)', async () => {
    const { recordCostEvent } = await import('./cost-service.js');

    await recordCostEvent({
      executionDbId: 'exec-1',
      clientId: null,
      userId: 'user-1',
      agent: 'suzy',
      model: 'unknown',
      inputTokens: 100,
      outputTokens: 50,
      estimated: true,
    });

    expect(mockCalls[0]).toMatchObject({ payload: { kind: 'model_estimated' } });
  });
});

describe('finalizeExecutionCost', () => {
  afterEach(() => {
    mockCalls.length = 0;
    mockCostRecordRows = [];
    mockExecutionReturningRow = undefined;
  });

  it('soma corretamente múltiplas linhas de cost_records pra uma execution', async () => {
    mockCostRecordRows = [{ amount: '1.50' }, { amount: '2.25' }, { amount: '0.10' }];
    mockExecutionReturningRow = { estimatedCost: null };
    const { finalizeExecutionCost } = await import('./cost-service.js');

    await finalizeExecutionCost('exec-1');

    const updateCall = mockCalls.find((c) => c.op === 'update');
    expect(updateCall?.payload).toMatchObject({ actualCost: '3.85' });
  });

  it('sem estimatedCost na execution, não grava nada em economy_records', async () => {
    mockCostRecordRows = [{ amount: '3.85' }];
    mockExecutionReturningRow = { estimatedCost: null };
    const { finalizeExecutionCost } = await import('./cost-service.js');

    await finalizeExecutionCost('exec-1');

    expect(mockCalls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(mockCalls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('com estimatedCost preenchido, grava economy_records com savedAmount = estimated - actual', async () => {
    mockCostRecordRows = [{ amount: '3.75' }];
    mockExecutionReturningRow = { estimatedCost: '10.00' };
    const { finalizeExecutionCost } = await import('./cost-service.js');

    await finalizeExecutionCost('exec-1');

    const deleteCall = mockCalls.find((c) => c.op === 'delete');
    const insertCall = mockCalls.find((c) => c.op === 'insert');
    expect(deleteCall).toBeDefined();
    expect(insertCall?.payload).toMatchObject({
      executionId: 'exec-1',
      estimatedCost: '10',
      actualCost: '3.75',
      savedAmount: '6.25',
      savedPercentage: '62.50',
    });
  });

  it('com estimatedCost <= 0, não grava economy_records (não faz sentido "economia" negativa/zero de base)', async () => {
    mockCostRecordRows = [{ amount: '1' }];
    mockExecutionReturningRow = { estimatedCost: '0' };
    const { finalizeExecutionCost } = await import('./cost-service.js');

    await finalizeExecutionCost('exec-1');

    expect(mockCalls.filter((c) => c.op === 'delete' || c.op === 'insert')).toHaveLength(0);
  });
});
