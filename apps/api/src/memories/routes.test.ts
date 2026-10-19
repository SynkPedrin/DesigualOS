import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as escopoModule from '../lib/escopo-de-organizacao';

/**
 * GUARDA DE REGRESSÃO do vazamento cross-tenant confirmado em runtime em
 * 05/10/2026: logado como provider DENTRO da "Empresa QA White Label",
 * `GET /memories?limit=50` devolveu 50 memórias da operação da Desigual —
 * todas legado pré-migração 0045, com `organization_id NULL`.
 *
 * O defeito tinha duas camadas, e as duas são travadas aqui:
 *
 *   1. a rota recortava por `tenantSharingScope` — a UNIÃO de todas as
 *      empresas da pessoa — e não filtrava por `organization_id` nenhuma;
 *   2. master nem recorte tinha (`scope === null` virava "sem filtro").
 *
 * A regra que substitui: empresa DE TRABALHO (resolvida server-side, a mesma
 * de requireTenant e /activity), e NULL só entra no contexto da provedora.
 *
 * O banco é mockado no mesmo padrão de organizations/routes.test.ts: as
 * condições drizzle são capturadas e os parâmetros inspecionados — o que se
 * afirma é O QUE VAI PRO BANCO, não o retorno. `recorteDaOrganizacaoDeTrabalho`
 * roda de verdade (é ela que está sob teste); o que depende de banco
 * (escopoDeOrganizacao, organizacaoDeTrabalhoDe) é stubado.
 */

const DESIGUAL = '11111111-1111-1111-1111-111111111111';
const EMPRESA_QA = '22222222-2222-2222-2222-222222222222';

const state = vi.hoisted(() => ({
  user: { id: 'user-1', roles: ['master'], permissions: [] } as { id: string; roles: string[]; permissions: never[] },
  deTrabalho: null as { id: string; name: string; slug: string } | null,
  condicoes: [] as unknown[],
}));

/** Achata uma condição drizzle: textos = strings (colunas, SQL cru e params
 *  string — todos chegam como chunks), valores = primitivos não-string (o
 *  booleano que trava a perna do NULL). */
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
  const memories = {
    id: 'memories.id',
    organizationId: 'memories.organization_id',
    clientId: 'memories.client_id',
    userId: 'memories.user_id',
    kind: 'memories.kind',
    content: 'memories.content',
    metadata: 'memories.metadata',
    status: 'memories.status',
    environment: 'memories.environment',
    createdAt: 'memories.created_at',
  };
  const clients = { id: 'clients.id', name: 'clients.name' };
  const users = { id: 'users.id', name: 'users.name', email: 'users.email' };

  /** Cadeia thenable: where() pode ser o fim (kinds, contagem) ou vir antes
   *  de orderBy/limit (listagem). */
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
    db: {
      select: () => ({ from: () => cadeia() }),
    },
    schema: { memories, clients, users },
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
    escopoDeOrganizacao: () =>
      Promise.resolve({ organizationIds: [DESIGUAL, EMPRESA_QA], ehProvider: true }),
  };
});

vi.mock('../organizations/contexto', () => ({
  organizacaoDeTrabalhoDe: () => Promise.resolve(state.deTrabalho),
}));

const app = Fastify();
const { registerMemoryRoutes } = await import('./routes');
await app.register(registerMemoryRoutes);
await app.ready();

describe('/memories, fronteira de empresa de trabalho', () => {
  beforeEach(() => {
    state.condicoes.length = 0;
    state.user = { id: 'user-1', roles: ['master'], permissions: [] };
    state.deTrabalho = null;
    process.env.PROVIDER_ORGANIZATION_ID = DESIGUAL;
  });

  it('provider dentro da Empresa QA: NENHUMA memória da Desigual, legado NULL fora', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA White Label', slug: 'qa' };
    const res = await app.inject({ method: 'GET', url: '/memories?limit=50' });
    expect(res.statusCode).toBe(200);

    expect(state.condicoes.length).toBeGreaterThan(0);
    for (const cond of state.condicoes) {
      const { textos, valores } = dissecar(cond);
      // A empresa de trabalho entra como parâmetro, e a perna do NULL vem
      // travada em false. Antes da correção, master não tinha filtro NENHUM
      // (recorte undefined) — este teste falharia no primeiro expect.
      expect(textos).toContain(EMPRESA_QA);
      expect(textos).not.toContain(DESIGUAL);
      expect(valores).toContain(false);
      expect(valores).not.toContain(true);
    }
  });

  it('dentro da Desigual, o legado NULL (pré-0045) continua visível', async () => {
    state.deTrabalho = { id: DESIGUAL, name: 'Desigual', slug: 'desigual' };
    const res = await app.inject({ method: 'GET', url: '/memories' });
    expect(res.statusCode).toBe(200);

    const { textos, valores } = dissecar(state.condicoes[0]);
    expect(textos).toContain(DESIGUAL);
    expect(valores).toContain(true);
  });

  it('membro de tenant (não provider) vê só a própria empresa', async () => {
    state.user = { id: 'user-tenant', roles: ['colaborador'], permissions: [] };
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA White Label', slug: 'qa' };
    const res = await app.inject({ method: 'GET', url: '/memories' });
    expect(res.statusCode).toBe(200);

    const { textos, valores } = dissecar(state.condicoes[0]);
    expect(textos).toContain(EMPRESA_QA);
    expect(valores).toContain(false);
  });

  it('/memories/kinds aplica o MESMO recorte, um contador não pode ver o que a lista esconde', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA White Label', slug: 'qa' };
    const res = await app.inject({ method: 'GET', url: '/memories/kinds' });
    expect(res.statusCode).toBe(200);

    expect(state.condicoes.length).toBeGreaterThan(0);
    const { textos, valores } = dissecar(state.condicoes[0]);
    expect(textos).toContain(EMPRESA_QA);
    expect(valores).toContain(false);
  });

  it('o filtro de privacidade USER_PRIVATE continua na consulta', async () => {
    state.deTrabalho = { id: DESIGUAL, name: 'Desigual', slug: 'desigual' };
    await app.inject({ method: 'GET', url: '/memories' });

    const { textos } = dissecar(state.condicoes[0]);
    expect(textos.join(' ')).toContain('mcp_scope');
  });

  it('sem empresa de trabalho resolvida, 403, nunca lista sem recorte', async () => {
    state.deTrabalho = null;
    const res = await app.inject({ method: 'GET', url: '/memories' });
    expect(res.statusCode).toBe(403);
  });
});
