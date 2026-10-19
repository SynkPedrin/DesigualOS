import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as escopoModule from '../lib/escopo-de-organizacao';

/**
 * GUARDA DE REGRESSÃO de 05/10/2026: `/costs/economy` era a ÚNICA rota de
 * custo sem recorte nenhum — agregava `economy_records` do banco inteiro para
 * qualquer conta com `costs:read`. Com dois tenants, isso entrega o volume de
 * uso da outra empresa: vazamento por agregação.
 *
 * `economy_records` não tem `organization_id` própria; a fronteira sai do
 * vínculo que sempre existiu: execution_id -> executions.organization_id, com
 * a regra de NULL de sempre (legado só no contexto da provedora).
 */

const DESIGUAL = '11111111-1111-1111-1111-111111111111';
const EMPRESA_QA = '22222222-2222-2222-2222-222222222222';

const state = vi.hoisted(() => ({
  user: { id: 'user-1', roles: ['master'], permissions: [] } as { id: string; roles: string[]; permissions: never[] },
  deTrabalho: null as { id: string; name: string; slug: string } | null,
  condicoes: [] as unknown[],
}));

function dissecar(no: unknown, achados: { textos: string[]; valores: unknown[] } = { textos: [], valores: [] }) {
  if (typeof no === 'string') {
    achados.textos.push(no);
    return achados;
  }
  if (no === null || no === undefined || typeof no !== 'object') {
    if (typeof no === 'boolean') achados.valores.push(no);
    return achados;
  }
  if (Array.isArray(no)) {
    for (const item of no) dissecar(item, achados);
    return achados;
  }
  const registro = no as { value?: unknown; queryChunks?: unknown[] };
  if ('value' in registro) dissecar(registro.value, achados);
  if (Array.isArray(registro.queryChunks)) for (const c of registro.queryChunks) dissecar(c, achados);
  return achados;
}

vi.mock('@desigual-os/database', () => {
  const economyRecords = {
    estimatedCost: 'er.estimated_cost',
    actualCost: 'er.actual_cost',
    savedAmount: 'er.saved_amount',
    executionId: 'er.execution_id',
    createdAt: 'er.created_at',
  };
  const costRecords = { amount: 'cr.amount', createdAt: 'cr.created_at', clientId: 'cr.client_id', userId: 'cr.user_id', agent: 'cr.agent' };
  const tokenUsage = { inputTokens: 'tu.input_tokens', outputTokens: 'tu.output_tokens', createdAt: 'tu.created_at', executionId: 'tu.execution_id' };
  const clients = { id: 'clients.id', name: 'clients.name' };
  const users = { id: 'users.id', name: 'users.name' };

  const cadeia = () => {
    const resultado = Promise.resolve([{ estimatedCost: '0', actualCost: '0', savedAmount: '0', executionCount: 0 }]);
    const no: Record<string, unknown> = {
      then: resultado.then.bind(resultado),
      catch: resultado.catch.bind(resultado),
    };
    no.where = (cond: unknown) => {
      state.condicoes.push(cond);
      return no;
    };
    no.groupBy = () => Promise.resolve([]);
    no.leftJoin = () => no;
    return no;
  };

  return {
    db: { select: () => ({ from: () => cadeia() }) },
    schema: { economyRecords, costRecords, tokenUsage, clients, users },
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = state.user;
  },
  requirePermission: () => async () => {},
}));

vi.mock('../lib/escopo-de-organizacao', async (importOriginal) => {
  const actual = await importOriginal<typeof escopoModule>();
  return {
    ...actual,
    escopoDeOrganizacao: () => Promise.resolve({ organizationIds: [DESIGUAL, EMPRESA_QA], ehProvider: true }),
  };
});

vi.mock('../organizations/contexto', () => ({
  organizacaoDeTrabalhoDe: () => Promise.resolve(state.deTrabalho),
}));

const app = Fastify();
const { registerCostRoutes } = await import('./routes');
await app.register(registerCostRoutes);
await app.ready();

describe('/costs/economy, recorte pela empresa de trabalho', () => {
  beforeEach(() => {
    state.condicoes.length = 0;
    state.deTrabalho = null;
    process.env.PROVIDER_ORGANIZATION_ID = DESIGUAL;
  });

  it('dentro da Empresa QA, agrega SÓ execuções da QA, legado NULL fora', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA', slug: 'qa' };
    const res = await app.inject({ method: 'GET', url: '/costs/economy' });
    expect(res.statusCode).toBe(200);

    // Antes da correção o where era SÓ o range de datas — este teste falharia
    // no primeiro expect.
    expect(state.condicoes.length).toBeGreaterThan(0);
    const { textos, valores } = dissecar(state.condicoes[0]);
    // O recorte passa pela execution — o vínculo que sempre existiu.
    expect(textos.join(' ')).toContain('executions');
    expect(textos).toContain(EMPRESA_QA);
    expect(textos).not.toContain(DESIGUAL);
    expect(valores).toContain(false);
    expect(valores).not.toContain(true);
  });

  it('no contexto da provedora, execuções legado (org NULL) entram', async () => {
    state.deTrabalho = { id: DESIGUAL, name: 'Desigual', slug: 'desigual' };
    const res = await app.inject({ method: 'GET', url: '/costs/economy' });
    expect(res.statusCode).toBe(200);

    const { textos, valores } = dissecar(state.condicoes[0]);
    expect(textos).toContain(DESIGUAL);
    expect(valores).toContain(true);
  });

  it('sem empresa de trabalho resolvida, 403, nunca número sem escopo', async () => {
    const res = await app.inject({ method: 'GET', url: '/costs/economy' });
    expect(res.statusCode).toBe(403);
    expect(state.condicoes.length).toBe(0);
  });
});
