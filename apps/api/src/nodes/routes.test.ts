import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * Auditoria P0-A (06/10/2026): `POST /nodes/:node_id/command` checava
 * `nodes:write` mas não `exigirProvedor()` — ao contrário do `GET /nodes`
 * irmão, que já tinha os dois. Um colaborador comum (não provedor) com o
 * papel certo conseguia colocar nós de infraestrutura em manutenção.
 */

const dbSelectWhere = vi.fn();
const dbUpdateSet = vi.fn();
let currentUser: { id: string; roles: string[] };
let ehProvider: boolean;

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(dbSelectWhere()) }) }),
    update: () => ({ set: (patch: unknown) => ({ where: () => dbUpdateSet(patch) }) }),
  },
  schema: { nodes: { id: 'id', nodeId: 'node_id' }, agents: { id: 'id', name: 'name' } },
}));

vi.mock('@desigual-os/node-protocol', () => ({
  heartbeatRequestSchema: { parse: (v: unknown) => v },
  heartbeatResponseSchema: { parse: (v: unknown) => v },
  registerNodeRequestSchema: { parse: (v: unknown) => v },
  registerNodeResponseSchema: { parse: (v: unknown) => v },
}));

vi.mock('@desigual-os/orchestrator', () => ({ publishWsEvent: vi.fn() }));

vi.mock('./auth', () => ({ requireNodeSecret: async () => {} }));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = currentUser;
  },
  requirePermission: () => async () => {},
}));

// Mesmo padrão de connectors/routes.test.ts: mocka o PORTEIRO de autorização
// (exigirProvedor), não a leitura de banco que ele faz por dentro —
// `escopoDeOrganizacao` já tem suíte própria em lib/escopo-de-organizacao.test.ts.
vi.mock('../lib/escopo-de-organizacao', () => ({
  exigirProvedor: () => async (request: { authUser?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    if (!ehProvider) reply.code(403).send({ error: 'Infraestrutura da plataforma é visível só para quem a opera.' });
  },
}));

const { registerNodeRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  await registerNodeRoutes(app);
  return app;
}

describe('POST /nodes/:node_id/command, exige provedor, não só nodes:write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: 'user-1', roles: ['master'] };
    dbSelectWhere.mockResolvedValue([{ id: 'node-db-1', nodeId: 'node-1', lastHeartbeatAt: null }]);
  });

  it('colaborador com nodes:write mas SEM ser provedor: 403, nenhum comando executado', async () => {
    ehProvider = false;
    const app = await buildApp();

    const response = await app.inject({ method: 'POST', url: '/nodes/node-1/command', payload: { command: 'maintenance' } });

    expect(response.statusCode).toBe(403);
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });

  it('provedor com nodes:write: comando executado normalmente', async () => {
    ehProvider = true;
    const app = await buildApp();

    const response = await app.inject({ method: 'POST', url: '/nodes/node-1/command', payload: { command: 'maintenance' } });

    expect(response.statusCode).toBe(200);
    expect(dbUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'maintenance' }));
  });
});
