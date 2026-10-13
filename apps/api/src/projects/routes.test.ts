import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as escopoModule from '../lib/escopo-de-organizacao';

/**
 * GUARDA DE REGRESSÃO do mesmo vazamento de 05/10/2026, na tabela que nem
 * coluna de empresa tinha: `projects` recortava por `tenantSharingScope` (a
 * união de TODAS as empresas da pessoa) com bypass de master. Um provedor
 * dentro da conta de um cliente via — e editava — os projetos da Desigual.
 *
 * A migração 0054 deu `organization_id` à tabela, e a fronteira passou a ser a
 * empresa DE TRABALHO (server-side) com a regra de NULL de sempre: legado
 * pré-migração só entra no contexto da provedora.
 *
 * Banco mockado no padrão de organizations/routes.test.ts: o que se afirma é
 * o que VAI pro banco (condição, insert), não o retorno.
 */

const DESIGUAL = '11111111-1111-1111-1111-111111111111';
const EMPRESA_QA = '22222222-2222-2222-2222-222222222222';
const PROJETO_DA_DESIGUAL = '33333333-3333-3333-3333-333333333333';

const state = vi.hoisted(() => ({
  user: { id: 'user-1', roles: ['master'], permissions: [] } as { id: string; roles: string[]; permissions: never[] },
  deTrabalho: null as { id: string; name: string; slug: string } | null,
  condicoes: [] as unknown[],
  inserts: [] as unknown[],
  /** O que o select de projeto existente devolve (PATCH/DELETE). */
  projetoExistente: null as unknown,
  /** O que o select de cliente devolve (validação de client_id). */
  clienteExistente: [] as unknown[],
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
  const projects = {
    id: 'projects.id',
    organizationId: 'projects.organization_id',
    clientId: 'projects.client_id',
    createdBy: 'projects.created_by',
    name: 'projects.name',
  };
  const clients = { id: 'clients.id', organizationId: 'clients.organization_id' };
  const conversations = { projectId: 'conversations.project_id' };
  const projectFiles = { id: 'pf.id', projectId: 'pf.project_id' };

  const cadeiaSelect = (table: unknown) => {
    const linhas = table === clients ? state.clienteExistente : state.projetoExistente ? [state.projetoExistente] : [];
    const resultado = Promise.resolve(linhas as unknown[]);
    const no: Record<string, unknown> = {
      then: resultado.then.bind(resultado),
      catch: resultado.catch.bind(resultado),
    };
    no.where = (cond: unknown) => {
      state.condicoes.push(cond);
      return no;
    };
    no.orderBy = () => Promise.resolve([]);
    return no;
  };

  return {
    db: {
      select: () => ({ from: (table: unknown) => cadeiaSelect(table) }),
      insert: () => ({
        values: (v: unknown) => {
          state.inserts.push(v);
          return {
            returning: () =>
              Promise.resolve([
                {
                  id: PROJETO_DA_DESIGUAL,
                  name: (v as { name?: string }).name,
                  clientId: null,
                  organizationId: (v as { organizationId?: string }).organizationId,
                  createdBy: 'user-1',
                  createdAt: new Date('2026-10-05'),
                  updatedAt: new Date('2026-10-05'),
                },
              ]),
          };
        },
      }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
      delete: () => ({ where: () => Promise.resolve() }),
    },
    schema: { projects, clients, conversations, projectFiles },
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = state.user;
  },
  requirePermission: () => async () => {},
}));

vi.mock('../lib/storage', () => ({
  uploadUserFile: vi.fn(),
  deleteUserFile: vi.fn(),
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
const { registerProjectRoutes } = await import('./routes');
await app.register(registerProjectRoutes);
await app.ready();

describe('/projects, fronteira de empresa de trabalho', () => {
  beforeEach(() => {
    state.condicoes.length = 0;
    state.inserts.length = 0;
    state.projetoExistente = null;
    state.clienteExistente = [];
    state.deTrabalho = null;
    process.env.PROVIDER_ORGANIZATION_ID = DESIGUAL;
  });

  it('GET dentro da Empresa QA lista SÓ a QA, projeto da Desigual e legado NULL fora', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA', slug: 'qa' };
    const res = await app.inject({ method: 'GET', url: '/projects' });
    expect(res.statusCode).toBe(200);

    // Antes da correção, master não tinha filtro NENHUM na listagem — este
    // teste falharia aqui.
    expect(state.condicoes.length).toBeGreaterThan(0);
    const { textos, valores } = dissecar(state.condicoes[0]);
    expect(textos).toContain(EMPRESA_QA);
    expect(textos).not.toContain(DESIGUAL);
    expect(valores).toContain(false);
  });

  it('GET dentro da Desigual inclui o legado NULL', async () => {
    state.deTrabalho = { id: DESIGUAL, name: 'Desigual', slug: 'desigual' };
    const res = await app.inject({ method: 'GET', url: '/projects' });
    expect(res.statusCode).toBe(200);

    const { textos, valores } = dissecar(state.condicoes[0]);
    expect(textos).toContain(DESIGUAL);
    expect(valores).toContain(true);
  });

  it('POST grava a empresa de trabalho como dona do projeto', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA', slug: 'qa' };
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'Deck comercial' } });
    expect(res.statusCode).toBe(201);

    expect(state.inserts.length).toBe(1);
    expect((state.inserts[0] as { organizationId?: string }).organizationId).toBe(EMPRESA_QA);
  });

  it('POST com cliente de OUTRA empresa responde 404, nunca anexa cruzado', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA', slug: 'qa' };
    state.clienteExistente = []; // cliente existe no banco, mas não NA QA
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'X', client_id: '44444444-4444-4444-4444-444444444444' },
    });
    expect(res.statusCode).toBe(404);
    expect(state.inserts.length).toBe(0);
  });

  it('PATCH em projeto da Desigual, estando dentro da QA, é 404, master inclusive', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA', slug: 'qa' };
    state.projetoExistente = { organizationId: DESIGUAL };
    const res = await app.inject({
      method: 'PATCH',
      url: `/projects/${PROJETO_DA_DESIGUAL}`,
      payload: { name: 'adulterado' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE em projeto da Desigual, estando dentro da QA, é 404', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA', slug: 'qa' };
    state.projetoExistente = { id: PROJETO_DA_DESIGUAL, organizationId: DESIGUAL };
    const res = await app.inject({ method: 'DELETE', url: `/projects/${PROJETO_DA_DESIGUAL}` });
    expect(res.statusCode).toBe(404);
  });

  it('projeto legado (organization_id NULL) só é alcançável no contexto da provedora', async () => {
    state.projetoExistente = { id: PROJETO_DA_DESIGUAL, organizationId: null };

    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA', slug: 'qa' };
    const dentroDeTenant = await app.inject({ method: 'DELETE', url: `/projects/${PROJETO_DA_DESIGUAL}` });
    expect(dentroDeTenant.statusCode).toBe(404);

    state.deTrabalho = { id: DESIGUAL, name: 'Desigual', slug: 'desigual' };
    const naProvedora = await app.inject({ method: 'DELETE', url: `/projects/${PROJETO_DA_DESIGUAL}` });
    expect(naProvedora.statusCode).toBe(204);
  });
});
