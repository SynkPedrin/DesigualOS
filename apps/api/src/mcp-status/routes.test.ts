import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as escopoModule from '../lib/escopo-de-organizacao';

/**
 * GUARDA DE REGRESSÃO de 05/10/2026: `/mcp/status` recortava tokens por
 * "pessoas visíveis" (vínculo de membership) e não recortava NADA nas
 * chamadas de ferramenta nem nas conexões recentes — dentro de um tenant, a
 * tela mostrava as conexões, as tools e os eventos da operação inteira da
 * Desigual.
 *
 * A regra: filtrar pela empresa de trabalho PELA COLUNA `organization_id`
 * (mcp_tokens, audit_logs, operational_events), com NULL = legado visível só
 * no contexto da provedora.
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
  const mcpTokens = {
    kind: 'mcp_tokens.kind',
    revokedAt: 'mcp_tokens.revoked_at',
    expiresAt: 'mcp_tokens.expires_at',
    userId: 'mcp_tokens.user_id',
    organizationId: 'mcp_tokens.organization_id',
    scopes: 'mcp_tokens.scopes',
    createdAt: 'mcp_tokens.created_at',
  };
  const users = { id: 'users.id', name: 'users.name', email: 'users.email' };
  const auditLogs = {
    tool: 'audit_logs.tool',
    result: 'audit_logs.result',
    timestamp: 'audit_logs.timestamp',
    userId: 'audit_logs.user_id',
    clientId: 'audit_logs.client_id',
    requestId: 'audit_logs.request_id',
    organizationId: 'audit_logs.organization_id',
  };
  const operationalEvents = {
    id: 'oe.id',
    type: 'oe.type',
    actor: 'oe.actor',
    summary: 'oe.summary',
    userId: 'oe.user_id',
    occurredAt: 'oe.occurred_at',
    entityId: 'oe.entity_id',
    organizationId: 'oe.organization_id',
  };

  const cadeia = () => {
    const resultado = Promise.resolve([] as unknown[]);
    const no: Record<string, unknown> = {
      then: resultado.then.bind(resultado),
      catch: resultado.catch.bind(resultado),
    };
    no.leftJoin = () => no;
    no.where = (cond: unknown) => {
      state.condicoes.push(cond);
      return no;
    };
    no.orderBy = () => no;
    no.limit = () => Promise.resolve([]);
    no.groupBy = () => Promise.resolve([]);
    return no;
  };

  return {
    db: { select: () => ({ from: () => cadeia() }) },
    schema: { mcpTokens, users, auditLogs, operationalEvents },
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = state.user;
  },
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
const { registerMcpStatusRoutes } = await import('./routes');
await app.register(registerMcpStatusRoutes);
await app.ready();

describe('/mcp/status, recorte pela empresa de trabalho, pela coluna', () => {
  beforeEach(() => {
    state.condicoes.length = 0;
    state.deTrabalho = null;
    process.env.PROVIDER_ORGANIZATION_ID = DESIGUAL;
  });

  it('dentro da Empresa QA, TODAS as consultas saem recortadas pela QA, NULL fora', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA', slug: 'qa' };
    const res = await app.inject({ method: 'GET', url: '/mcp/status' });
    expect(res.statusCode).toBe(200);

    // tokens, chamadas, chamadasPorPessoa, conexoesRecentes — as QUATRO
    // consultas recortadas. Antes da correção, três delas não tinham recorte
    // nenhum — este teste falharia no primeiro expect.
    expect(state.condicoes.length).toBe(4);
    for (const cond of state.condicoes) {
      const { textos, valores } = dissecar(cond);
      expect(textos).toContain(EMPRESA_QA);
      expect(textos).not.toContain(DESIGUAL);
      expect(valores).toContain(false);
      expect(valores).not.toContain(true);
    }
  });

  it('no contexto da provedora, tokens/chamadas legado (org NULL) entram', async () => {
    state.deTrabalho = { id: DESIGUAL, name: 'Desigual', slug: 'desigual' };
    const res = await app.inject({ method: 'GET', url: '/mcp/status' });
    expect(res.statusCode).toBe(200);

    expect(state.condicoes.length).toBe(4);
    for (const cond of state.condicoes) {
      const { textos, valores } = dissecar(cond);
      expect(textos).toContain(DESIGUAL);
      expect(valores).toContain(true);
    }
  });

  it('sem empresa de trabalho resolvida, 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/mcp/status' });
    expect(res.statusCode).toBe(403);
    expect(state.condicoes.length).toBe(0);
  });
});
