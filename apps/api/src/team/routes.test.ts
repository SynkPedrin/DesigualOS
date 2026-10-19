import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * GET /team/members/:id/assignments — a metade "member → assigned clients"
 * do Client Assignment (P0-C, 06/10/2026). A outra metade
 * (GET/PUT/DELETE /clients/:id/assignments) tem suíte própria em
 * clients/assignments.test.ts.
 *
 * Fronteira: `recorteDePessoasVisiveis` (mesma de GET /team/members) —
 * alvo que não compartilha empresa com o chamador devolve lista VAZIA,
 * nunca 404 (não confirma existência de pessoa de outro tenant) e nunca os
 * clientes de uma empresa que o chamador não enxerga.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const JAMILLE = '44444444-4444-4444-8444-444444444444';
const ALICIA = '55555555-5555-4555-8555-555555555555';
const FORA_DA_ORG = '66666666-6666-4666-8666-666666666666';
const CLIENTE_A = '33333333-3333-4333-8333-333333333333';
const CLIENTE_B = '77777777-7777-4777-8777-777777777777';

let currentUser: { id: string; roles: string[] };

interface ClientUserRow {
  clientId: string;
  userId: string;
  responsibility: string | null;
}
interface ClienteRow {
  id: string;
  name: string;
  organizationId: string;
  deletedAt: Date | null;
}

let clientUsersRows: ClientUserRow[];
let clientes: ClienteRow[];
/** Controla diretamente o resultado de `recorteDePessoasVisiveis` (mockada
 *  abaixo) — não tenta reinterpretar o SQL real da função, só o GATE que
 *  ela decide. A função em si já tem suíte própria em
 *  lib/escopo-de-organizacao.test.ts. */
let mockRecortePermiteAlvo: boolean;

function coletarParams(no: unknown, achados: string[] = []): string[] {
  if (typeof no === 'string') {
    achados.push(no);
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
}

vi.mock('@desigual-os/database', () => {
  const users = { id: 'users.id', name: 'users.name', email: 'users.email', avatarUrl: 'users.avatar_url', deletedAt: 'users.deleted_at' };
  const userRoles = { userId: 'ur.user_id', roleId: 'ur.role_id' };
  const roles = { id: 'roles.id', name: 'roles.name' };
  const clientUsers = { userId: 'cu.user_id', clientId: 'cu.client_id', responsibility: 'cu.responsibility' };
  const clients = { id: 'clients.id', name: 'clients.name', deletedAt: 'clients.deleted_at' };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: (joinTable: unknown) => ({
            innerJoin: (joinTable2: unknown) => ({
              where: (cond: unknown) => {
                if (table === users && joinTable === clientUsers && joinTable2 === clients) {
                  const params = coletarParams(cond);
                  const targetId = params.find((p) => p.includes('-') && p !== 'RECORTE_PERMITE' && p !== 'RECORTE_NEGA');
                  return Object.assign(Promise.resolve([]), {
                    orderBy: () => {
                      if (!targetId || !params.includes('RECORTE_PERMITE')) return Promise.resolve([]);
                      return Promise.resolve(
                        clientUsersRows
                          .filter((r) => r.userId === targetId && r.responsibility !== null)
                          .map((r) => ({
                            clientId: r.clientId,
                            clientName: clientes.find((c) => c.id === r.clientId)?.name,
                            responsibility: r.responsibility,
                          })),
                      );
                    },
                  });
                }
                return Object.assign(Promise.resolve([]), { orderBy: () => Promise.resolve([]) });
              },
            }),
          }),
        }),
      }),
    },
    schema: { users, userRoles, roles, clientUsers, clients },
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = currentUser;
  },
}));

vi.mock('../lib/escopo-de-organizacao', () => ({
  recorteDePessoasVisiveis: () => (mockRecortePermiteAlvo ? 'RECORTE_PERMITE' : 'RECORTE_NEGA'),
}));

const { registerTeamRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  await registerTeamRoutes(app);
  return app;
}

beforeEach(() => {
  currentUser = { id: JAMILLE, roles: ['colaborador'] };
  mockRecortePermiteAlvo = true;
  clientes = [
    { id: CLIENTE_A, name: 'Cosentino', organizationId: ORG_A, deletedAt: null },
    { id: CLIENTE_B, name: 'Cliente B', organizationId: ORG_B, deletedAt: null },
  ];
  clientUsersRows = [{ clientId: CLIENTE_A, userId: ALICIA, responsibility: 'traffic' }];
});

describe('GET /team/members/:id/assignments', () => {
  it('lista os clientes e responsabilidades de um colega da MESMA empresa', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/team/members/${ALICIA}/assignments` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ assignments: [{ client_id: CLIENTE_A, client_name: 'Cosentino', responsibility: 'traffic' }] });
  });

  it('CROSS-TENANT: pessoa de outra empresa (recorte nega) -> lista vazia, nunca 404 nem os clientes dela', async () => {
    mockRecortePermiteAlvo = false;
    clientUsersRows.push({ clientId: CLIENTE_B, userId: FORA_DA_ORG, responsibility: 'design' });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/team/members/${FORA_DA_ORG}/assignments` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ assignments: [] });
  });
});
