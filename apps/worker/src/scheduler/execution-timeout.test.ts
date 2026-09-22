import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regressão do achado de 18/09/2026: consulta ao banco de produção encontrou
 * DOZE execuções de agente presas em `queued`/`running`, a mais antiga havia
 * 326 horas (13,6 dias). Nada no sistema expirava execução — o chat ficava com
 * o indicador de "pensando" aceso pra sempre e o resumo diário contava aquilo
 * como trabalho em andamento, todo dia.
 *
 * O que estes testes travam é o COMPORTAMENTO do vigia, não os números: que ele
 * expira órfã, que não mata execução nova, que respeita o timeout específico de
 * cada agente, que não reprova nada quando o Redis está fora, e — o mais
 * importante — que ele NÃO sobrescreve uma execução que terminou de verdade
 * entre o SELECT e o UPDATE.
 */

const linhas: Record<string, unknown[]> = { executions: [], steps: [] };
const updateAfeta = { linhas: 1 };
const registros = { wsEvents: [] as unknown[], notificacoes: [] as unknown[], steps: [] as unknown[], auditoria: [] as unknown[] };
const workersConectados: Record<string, number> = {};
let redisFora = false;

const tabela = (t: unknown): string => (t as { __nome?: string }).__nome ?? 'desconhecida';

vi.mock('@desigual-os/database', () => {
  const schema = {
    executions: { __nome: 'executions', id: 'id', status: 'status', startedAt: 's', createdAt: 'c', executionId: 'e', agent: 'a', userId: 'u' },
    executionSteps: { __nome: 'executionSteps', executionId: 'e', stepIndex: 'i' },
    notifications: { __nome: 'notifications' },
    auditLogs: { __nome: 'auditLogs' },
  };
  const db = {
    select: () => ({
      from: (t: unknown) => {
        const alvo = tabela(t);
        const resultado = alvo === 'executions' ? linhas.executions : linhas.steps;
        const encadeia = { where: () => encadeia, limit: () => Promise.resolve(resultado), then: undefined };
        return encadeia as unknown as { where: () => unknown; limit: () => Promise<unknown[]> };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve(updateAfeta.linhas > 0 ? [{ id: 'x' }] : []) }),
      }),
    }),
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        const alvo = tabela(t);
        if (alvo === 'notifications') registros.notificacoes.push(v);
        if (alvo === 'auditLogs') registros.auditoria.push(v);
        if (alvo === 'executionSteps') registros.steps.push(v);
        return { onConflictDoNothing: () => Promise.resolve(), then: (r: () => void) => Promise.resolve().then(r) };
      },
    }),
  };
  return { db, schema };
});

vi.mock('@desigual-os/orchestrator', () => ({
  AGENT_TIMEOUT_MS: { bento: 120_000, jarbas: 180_000, suzy: 180_000, studio: 1_500_000, otto: 360_000 },
  getAgentQueue: (agent: string) => ({
    getWorkers: () => (redisFora ? Promise.reject(new Error('redis fora')) : Promise.resolve(new Array(workersConectados[agent] ?? 0).fill({}))),
  }),
  publishWsEvent: (e: unknown) => {
    registros.wsEvents.push(e);
    return Promise.resolve();
  },
}));

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function execucao(over: Partial<{ agent: string; status: string; idadeMs: number }> = {}) {
  const idade = over.idadeMs ?? 0;
  return {
    id: `db-${Math.random()}`,
    executionId: 'EXE-2026-TESTE',
    agent: over.agent ?? 'bento',
    userId: 'user-1',
    status: over.status ?? 'running',
    desde: new Date(Date.now() - idade),
  };
}

beforeEach(() => {
  linhas.executions = [];
  linhas.steps = [];
  updateAfeta.linhas = 1;
  registros.wsEvents = [];
  registros.notificacoes = [];
  registros.steps = [];
  registros.auditoria = [];
  redisFora = false;
  for (const k of Object.keys(workersConectados)) delete workersConectados[k];
});

describe('execution-timeout', () => {
  it('expira a execução órfã — o caso das 326 horas', async () => {
    const { expireStaleExecutions } = await import('./execution-timeout.js');
    linhas.executions = [execucao({ agent: 'bento', idadeMs: 326 * 60 * 60_000 })];

    const r = await expireStaleExecutions(logger);

    expect(r.expiradas).toBe(1);
    expect(registros.wsEvents).toHaveLength(1);
    expect((registros.wsEvents[0] as { payload: { status: string } }).payload.status).toBe('timeout');
  });

  it('avisa a pessoa e deixa um step de falha, senão a bolha do chat fica vazia', async () => {
    const { expireStaleExecutions, MENSAGEM_SEM_WORKER } = await import('./execution-timeout.js');
    linhas.executions = [execucao({ idadeMs: 10 * 60 * 60_000 })];

    await expireStaleExecutions(logger);

    expect(registros.notificacoes).toHaveLength(1);
    expect(registros.steps).toHaveLength(1);
    const step = registros.steps[0] as { status: string; output: { answer: string } };
    expect(step.status).toBe('failed');
    expect(step.output.answer).toContain(MENSAGEM_SEM_WORKER.slice(0, 30));
  });

  it('NÃO mata execução que acabou de começar', async () => {
    const { expireStaleExecutions } = await import('./execution-timeout.js');
    linhas.executions = [execucao({ idadeMs: 5_000 })];

    const r = await expireStaleExecutions(logger);

    expect(r.expiradas).toBe(0);
    expect(registros.notificacoes).toHaveLength(0);
  });

  it('com worker conectado, respeita o timeout LONGO do agente em vez do curto', async () => {
    const { expireStaleExecutions, limiteComWorkerMs } = await import('./execution-timeout.js');
    workersConectados.studio = 1;
    // O Studio tem deadline de 25 min: 10 minutos de espera é normal, não órfã.
    linhas.executions = [execucao({ agent: 'studio', idadeMs: 10 * 60_000 })];

    const r = await expireStaleExecutions(logger);

    expect(r.expiradas).toBe(0);
    expect(limiteComWorkerMs('studio')).toBeGreaterThan(10 * 60_000);
  });

  it('sem worker conectado, um job do Studio parado há 10 min É órfão', async () => {
    const { expireStaleExecutions } = await import('./execution-timeout.js');
    linhas.executions = [execucao({ agent: 'studio', idadeMs: 10 * 60_000 })];

    expect((await expireStaleExecutions(logger)).expiradas).toBe(1);
  });

  it('Redis fora do ar: não reprova NADA (falso positivo mataria execução boa)', async () => {
    const { expireStaleExecutions } = await import('./execution-timeout.js');
    redisFora = true;
    linhas.executions = [execucao({ idadeMs: 326 * 60 * 60_000 })];

    const r = await expireStaleExecutions(logger);

    expect(r.expiradas).toBe(0);
    expect(registros.notificacoes).toHaveLength(0);
  });

  it('execução que terminou entre o SELECT e o UPDATE não é sobrescrita nem notificada', async () => {
    const { expireStaleExecutions } = await import('./execution-timeout.js');
    linhas.executions = [execucao({ idadeMs: 326 * 60 * 60_000 })];
    // UPDATE condicional não pega a linha: ela já saiu de 'running'.
    updateAfeta.linhas = 0;

    const r = await expireStaleExecutions(logger);

    expect(r.expiradas).toBe(0);
    expect(registros.wsEvents).toHaveLength(0);
    expect(registros.notificacoes).toHaveLength(0);
  });

  it('o limite sem worker é curto e o com worker é generoso', async () => {
    const { LIMITES_MS, limiteComWorkerMs } = await import('./execution-timeout.js');
    expect(LIMITES_MS.semWorker).toBeGreaterThanOrEqual(60_000);
    expect(limiteComWorkerMs('bento')).toBeGreaterThan(LIMITES_MS.semWorker);
    expect(limiteComWorkerMs('otto')).toBeGreaterThan(limiteComWorkerMs('bento'));
  });
});
