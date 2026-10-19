import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as escopoDeOrganizacaoModule from '../lib/escopo-de-organizacao';

/**
 * AS REGRAS DO WHITE LABEL, travadas nas rotas:
 *
 *   - subconta nasce pelo provedor OU por quem administra a empresa mãe —
 *     membro comum não abre tenant;
 *   - a lista de empresas desce a árvore para quem administra (agência vê a
 *     carteira DELA) e continua proibida para colaborador;
 *   - o custo por empresa agrega a subárvore para quem tem direito, e para
 *     quem não tem responde 404 — nunca 403, porque "existe mas não é sua"
 *     confirma a existência da empresa.
 *
 * Sobem as rotas num Fastify real com banco e escopo mockados (mesmo padrão
 * de clickup/routes.test.ts). O que é regra pura (podeCriarSubconta,
 * descendentesTransitivos) roda de verdade — é ela que está sendo testada
 * aqui integrada à rota.
 */

let currentUser: { id: string; roles: string[] };
let mockEscopo: { organizationIds: string[]; ehProvider: boolean };
let mockPapeis: Map<string, string>;
let mockArvore: { id: string; parentId: string | null }[];
let mockOrgsPorId: Record<string, { id: string } | undefined>;
let mockExecuteRows: unknown[];
const insertedValues: unknown[] = [];

vi.mock('@desigual-os/database', () => {
  const organizations = { id: 'organizations.id', parentId: 'organizations.parent_id' };
  const organizationMembers = { userId: 'om.user_id', organizationId: 'om.organization_id', role: 'om.role' };
  const users = { id: 'users.id', email: 'users.email' };
  const costRecords = { amount: 'cr.amount', createdAt: 'cr.created_at', organizationId: 'cr.organization_id' };
  const tokenUsage = {
    inputTokens: 'tu.input_tokens',
    outputTokens: 'tu.output_tokens',
    createdAt: 'tu.created_at',
    organizationId: 'tu.organization_id',
  };
  const auditLogs = { id: 'audit.id' };

  /** Os ids parametrizados de uma condição drizzle (eq/inArray/and...) — com
   *  coluna mockada como string, o drizzle embute o valor cru nos chunks. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const coletarParams = (no: unknown, achados: unknown[] = []): unknown[] => {
    if (typeof no === 'string') {
      if (UUID.test(no)) achados.push(no);
      return achados;
    }
    if (Array.isArray(no)) {
      for (const item of no) coletarParams(item, achados);
      return achados;
    }
    if (no === null || typeof no !== 'object') return achados;
    if ('value' in no && !Array.isArray((no as { value: unknown }).value)) {
      coletarParams((no as { value: unknown }).value, achados);
    }
    const chunks = (no as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) for (const c of chunks) coletarParams(c, achados);
    return achados;
  };

  const txInsert = (table: unknown) => ({
    values: (v: unknown) => {
      insertedValues.push({ table, payload: v });
      const promise = Promise.resolve();
      return Object.assign(promise, {
        returning: () => Promise.resolve([{ id: 'org-nova', name: (v as { name?: string }).name, slug: (v as { slug?: string }).slug }]),
        onConflictDoNothing: () => Promise.resolve(),
      });
    },
  });

  return {
    db: {
      transaction: (cb: (tx: unknown) => Promise<unknown>) => cb({ insert: txInsert }),
      insert: txInsert,
      execute: () => Promise.resolve({ rows: mockExecuteRows }),
      select: (_cols?: unknown) => ({
        from: (table: unknown) => ({
          where: (cond: unknown) => {
            const linhas = (() => {
              if (table === organizations) {
                // criarEmpresa valida o pai; a rota de custo valida o alvo.
                const achado = coletarParams(cond).find(
                  (p): p is string => typeof p === 'string' && mockOrgsPorId[p] !== undefined,
                );
                return achado ? [mockOrgsPorId[achado]] : [];
              }
              return [];
            })();
            // groupBy existe na cadeia do "por empresa" da rota de custo.
            return Object.assign(Promise.resolve(linhas), { groupBy: () => Promise.resolve([]) });
          },
        }),
      }),
    },
    schema: { organizations, organizationMembers, users, costRecords, tokenUsage, auditLogs },
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = currentUser;
  },
  requirePermission: () => async () => {},
}));

const mockSubarvore = vi.fn<(id: string) => Promise<string[]>>();

vi.mock('../lib/escopo-de-organizacao', async (importOriginal) => {
  const actual = await importOriginal<typeof escopoDeOrganizacaoModule>();
  return {
    ...actual,
    escopoDeOrganizacao: () => Promise.resolve(mockEscopo),
    papeisPorOrganizacao: () => Promise.resolve(mockPapeis),
    subarvoreDe: (id: string) => mockSubarvore(id),
    arvoreDeOrganizacoes: () => Promise.resolve(mockArvore),
  };
});

const { registerOrganizationRoutes } = await import('./routes');

const AGENCIA = '11111111-1111-4111-8111-111111111111';
const FILHO = '22222222-2222-4222-8222-222222222222';
const NETO = '33333333-3333-4333-8333-333333333333';
const VIZINHA = '44444444-4444-4444-8444-444444444444';

async function buildApp() {
  const app = Fastify();
  await registerOrganizationRoutes(app);
  return app;
}

beforeEach(() => {
  insertedValues.length = 0;
  mockExecuteRows = [];
  mockOrgsPorId = {};
  mockSubarvore.mockReset();
  currentUser = { id: 'user-1', roles: ['colaborador'] };
  mockEscopo = { organizationIds: [], ehProvider: false };
  mockPapeis = new Map();
  mockArvore = [
    { id: AGENCIA, parentId: null },
    { id: FILHO, parentId: AGENCIA },
    { id: NETO, parentId: FILHO },
    { id: VIZINHA, parentId: null },
  ];
});

describe('POST /organizations, quem cria subconta', () => {
  const corpo = { nome: 'Cliente da Agência', parent_id: AGENCIA };

  it('provedor cria subconta, e o parent_id é gravado', async () => {
    mockEscopo = { organizationIds: [AGENCIA], ehProvider: true };
    mockOrgsPorId = { [AGENCIA]: { id: AGENCIA } };
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/organizations', payload: corpo });

    expect(res.statusCode).toBe(201);
    const daOrg = insertedValues.find((v) => (v as { payload: { parentId?: string } }).payload.parentId !== undefined);
    expect(daOrg).toMatchObject({ payload: { parentId: AGENCIA } });
  });

  it('dono da empresa mãe cria subconta dela (a agência abre a conta do cliente)', async () => {
    mockEscopo = { organizationIds: [AGENCIA], ehProvider: false };
    mockPapeis = new Map([[AGENCIA, 'owner']]);
    mockOrgsPorId = { [AGENCIA]: { id: AGENCIA } };
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/organizations', payload: corpo });

    expect(res.statusCode).toBe(201);
  });

  it('membro comum NÃO cria subconta, abrir tenant não é decisão de quem só trabalha na agência', async () => {
    mockEscopo = { organizationIds: [AGENCIA], ehProvider: false };
    mockPapeis = new Map([[AGENCIA, 'collaborator']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/organizations', payload: corpo });

    expect(res.statusCode).toBe(403);
  });

  it('dono de OUTRA árvore não cria subconta nesta', async () => {
    mockEscopo = { organizationIds: [VIZINHA], ehProvider: false };
    mockPapeis = new Map([[VIZINHA, 'owner']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/organizations', payload: corpo });

    expect(res.statusCode).toBe(403);
  });

  it('empresa raiz (sem parent_id) continua sendo só do provedor', async () => {
    mockEscopo = { organizationIds: [AGENCIA], ehProvider: false };
    mockPapeis = new Map([[AGENCIA, 'owner']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/organizations', payload: { nome: 'Empresa Solta' } });

    expect(res.statusCode).toBe(403);
  });

  it('pai inexistente é erro claro, não violação de FK ilegível', async () => {
    mockEscopo = { organizationIds: [], ehProvider: true };
    mockOrgsPorId = {};
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/organizations', payload: corpo });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('empresa mãe');
  });
});

describe('GET /organizations, a lista desce a árvore', () => {
  const linha = (id: string, parentId: string | null) => ({
    id,
    name: `Empresa ${id.slice(0, 4)}`,
    parent_id: parentId,
    pessoas: 1,
    clientes: 0,
    ultima_atividade: null,
    memorias: 0,
    eh_provedora: false,
  });

  beforeEach(() => {
    mockExecuteRows = [
      linha(AGENCIA, null),
      linha(FILHO, AGENCIA),
      linha(NETO, FILHO),
      linha(VIZINHA, null),
    ];
  });

  it('provedor vê a árvore inteira, com parent_id para desenhá-la', async () => {
    mockEscopo = { organizationIds: [AGENCIA], ehProvider: true };
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/organizations' });

    expect(res.statusCode).toBe(200);
    const orgs = res.json().organizations;
    expect(orgs).toHaveLength(4);
    expect(orgs.find((o: { id: string }) => o.id === FILHO).parent_id).toBe(AGENCIA);
  });

  it('dono da agência vê a carteira DELA: agência, filho e neto, nunca a vizinha', async () => {
    mockEscopo = { organizationIds: [AGENCIA], ehProvider: false };
    mockPapeis = new Map([[AGENCIA, 'owner']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/organizations' });

    expect(res.statusCode).toBe(200);
    const ids = res.json().organizations.map((o: { id: string }) => o.id).sort();
    expect(ids).toEqual([AGENCIA, FILHO, NETO].sort());
    expect(ids).not.toContain(VIZINHA);
  });

  it('dono da subconta NÃO vê a mãe nem a irmã', async () => {
    mockEscopo = { organizationIds: [FILHO], ehProvider: false };
    mockPapeis = new Map([[FILHO, 'owner']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/organizations' });

    const ids = res.json().organizations.map((o: { id: string }) => o.id).sort();
    expect(ids).toEqual([FILHO, NETO].sort());
  });

  it('colaborador continua fora da lista, como sempre esteve', async () => {
    mockEscopo = { organizationIds: [AGENCIA], ehProvider: false };
    mockPapeis = new Map([[AGENCIA, 'collaborator']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/organizations' });

    expect(res.statusCode).toBe(403);
  });
});

describe('GET /organizations/:id/costs, custo por tenant com subárvore', () => {
  beforeEach(() => {
    mockOrgsPorId = { [AGENCIA]: { id: AGENCIA }, [FILHO]: { id: FILHO } };
    mockSubarvore.mockImplementation((id: string) => {
      const descendentes: Record<string, string[]> = {
        [AGENCIA]: [AGENCIA, FILHO, NETO],
        [FILHO]: [FILHO, NETO],
      };
      return Promise.resolve(descendentes[id] ?? [id]);
    });
  });

  it('dono da agência agrega filho e neto na soma', async () => {
    mockEscopo = { organizationIds: [AGENCIA], ehProvider: false };
    mockPapeis = new Map([[AGENCIA, 'owner']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${AGENCIA}/costs` });

    expect(res.statusCode).toBe(200);
    expect(mockSubarvore).toHaveBeenCalledWith(AGENCIA);
    expect(res.json().empresas_na_soma).toBe(3);
  });

  it('a subconta consultando o custo da MÃE recebe 404, não 403, que vazaria a existência', async () => {
    mockEscopo = { organizationIds: [FILHO], ehProvider: false };
    mockPapeis = new Map([[FILHO, 'owner']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${AGENCIA}/costs` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Empresa não encontrada.');
  });

  it('a subconta consultando o PRÓPRIO custo agrega só a própria subárvore', async () => {
    mockEscopo = { organizationIds: [FILHO], ehProvider: false };
    mockPapeis = new Map([[FILHO, 'owner']]);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${FILHO}/costs` });

    expect(res.statusCode).toBe(200);
    expect(res.json().empresas_na_soma).toBe(2);
  });

  it('provedor consulta o custo de qualquer empresa', async () => {
    mockEscopo = { organizationIds: [], ehProvider: true };
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${AGENCIA}/costs` });

    expect(res.statusCode).toBe(200);
  });

  it('empresa inexistente: o mesmo 404 de empresa alheia (não vaza existência)', async () => {
    mockEscopo = { organizationIds: [], ehProvider: true };
    mockOrgsPorId = {};
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${AGENCIA}/costs` });

    expect(res.statusCode).toBe(404);
  });
});
