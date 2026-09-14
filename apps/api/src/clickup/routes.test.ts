import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * Trava as checagens de autorização de escopo adicionadas na auditoria
 * pré-deploy (14/09/2026): antes delas, qualquer autenticado com
 * clickup:write criava/editava/deletava tarefas e lia comentários em
 * QUALQUER lista do workspace do ClickUp, bastava adivinhar o id. O padrão
 * de referência (POST /clickup/tasks/:id/comments e /attachments) já
 * resolvia a lista da task e cruzava com clients.clickup_list_id; estes
 * testes sobem as rotas num Fastify real com as dependências mockadas
 * (mesmo approach de vi.mock de auth/middleware.test.ts) e verificam o
 * 404/403 antes de qualquer escrita no ClickUp.
 */

const getTaskListId = vi.fn();
const createAttributedTask = vi.fn();
const getTaskComments = vi.fn();
const requestToolCall = vi.fn();
const resolveClickUpAccess = vi.fn();
const hasClientAccess = vi.fn();
const claimIdempotency = vi.fn();
const fulfillIdempotency = vi.fn();
const releaseIdempotency = vi.fn();
const dbSelectWhere = vi.fn();
const dbInsertValues = vi.fn();

vi.mock('@desigual-os/database', () => {
  const clientsTable = { clickupListId: 'clickup_list_id', id: 'id', name: 'name' };
  const usersTable = { id: 'id' };
  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          // clientsByClickUpListId faz await direto no .from() (sem .where);
          // as checagens de dono usam .where(). Os dois caminhos consultam o
          // mesmo mock pra manter o harness simples.
          const rows = Promise.resolve(dbSelectWhere(table));
          return Object.assign(rows, { where: () => Promise.resolve(dbSelectWhere(table)) });
        },
      }),
      insert: () => ({ values: (...args: unknown[]) => dbInsertValues(...args) }),
    },
    schema: { clients: clientsTable, users: usersTable, auditLogs: { id: 'id' } },
  };
});

vi.mock('@desigual-os/tool-gateway', () => ({
  createAttributedTask: (...args: unknown[]) => createAttributedTask(...args),
  createTaskComment: vi.fn(),
  deleteTask: vi.fn(),
  findMemberByEmail: vi.fn(),
  getTaskComments: (...args: unknown[]) => getTaskComments(...args),
  getTaskListId: (...args: unknown[]) => getTaskListId(...args),
  getTeamMembers: vi.fn(),
  parseTaskChangedEvent: vi.fn(),
  parseTaskCommentPostedEvent: vi.fn(),
  queryOperationTasks: vi.fn(),
  recordToolResult: vi.fn(),
  replyToComment: vi.fn(),
  requestToolCall: (...args: unknown[]) => requestToolCall(...args),
  updateTask: vi.fn(),
  uploadTaskAttachment: vi.fn(),
  verifyClickUpSignature: vi.fn(),
}));

vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@desigual-os/orchestrator', () => ({
  getRedisConnection: vi.fn(),
  publishWsEvent: vi.fn(),
  recordLearning: vi.fn(),
  recordOperationalEvent: vi.fn(),
}));

vi.mock('@desigual-os/types', () => ({
  stripBlockMarkers: (text: string) => text,
  stripEmDashes: (text: string) => text,
}));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'user-1', email: 'chefe@desigual.com', roles: ['master'] };
  },
  requirePermission: () => async () => {},
}));

vi.mock('../integrations/access', () => ({
  resolveClickUpAccess: (...args: unknown[]) => resolveClickUpAccess(...args),
}));

vi.mock('../lib/access', () => ({
  hasClientAccess: (...args: unknown[]) => hasClientAccess(...args),
}));

vi.mock('../lib/idempotency', () => ({
  claimIdempotency: (...args: unknown[]) => claimIdempotency(...args),
  fulfillIdempotency: (...args: unknown[]) => fulfillIdempotency(...args),
  idempotencyKey: () => 'idem-key',
  releaseIdempotency: (...args: unknown[]) => releaseIdempotency(...args),
}));

vi.mock('../lib/bento-mention', () => ({ respondAsBento: vi.fn() }));
vi.mock('../lib/agent-mention', () => ({
  detectMentionedAgent: vi.fn(),
  respondAsAgent: vi.fn(),
  respondAsOtto: vi.fn(),
}));

const { registerClickUpRoutes } = await import('./routes');

const OWNER_CLIENT = { id: 'client-1', name: 'Cliente Um', clickupListId: 'list-1' };

async function buildApp() {
  const app = Fastify();
  await registerClickUpRoutes(app);
  return app;
}

describe('autorização de escopo nas rotas ClickUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKUP_API_KEY = 'pk_teste';
    process.env.CLICKUP_TEAM_ID = 'team-1';
    resolveClickUpAccess.mockResolvedValue({ token: 'pk_teste', teamId: 'team-1', connectionId: null });
    hasClientAccess.mockResolvedValue(true);
    claimIdempotency.mockResolvedValue(null);
    dbInsertValues.mockResolvedValue(undefined);
  });

  it('POST /clickup/tasks com list_id que não é de nenhum cliente -> 404, sem criar nada no ClickUp', async () => {
    dbSelectWhere.mockResolvedValue([]); // nenhum cliente com essa lista
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/clickup/tasks',
      payload: { list_id: 'list-desconhecida', name: 'Tarefa' },
    });

    expect(response.statusCode).toBe(404);
    expect(createAttributedTask).not.toHaveBeenCalled();
    expect(claimIdempotency).not.toHaveBeenCalled();
  });

  it('POST /clickup/tasks em lista de cliente sem acesso do usuário -> 403', async () => {
    dbSelectWhere.mockResolvedValue([OWNER_CLIENT]);
    hasClientAccess.mockResolvedValue(false);
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/clickup/tasks',
      payload: { list_id: 'list-1', name: 'Tarefa' },
    });

    expect(response.statusCode).toBe(403);
    expect(createAttributedTask).not.toHaveBeenCalled();
  });

  it('POST /clickup/tasks em lista de cliente com acesso -> 201 e cria de verdade', async () => {
    dbSelectWhere
      .mockResolvedValueOnce([OWNER_CLIENT]) // dono da lista
      .mockResolvedValueOnce([{ id: 'user-1', name: 'Chefe', clickupEmail: null }]); // users
    createAttributedTask.mockResolvedValue({ id: 'task-1', url: 'https://app.clickup.com/t/task-1', assigned: false });
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/clickup/tasks',
      payload: { list_id: 'list-1', name: 'Tarefa' },
    });

    expect(response.statusCode).toBe(201);
    expect(createAttributedTask).toHaveBeenCalledTimes(1);
  });

  it('GET /clickup/tasks/:id/comments de task fora da carteira -> 404, sem ler comentários', async () => {
    getTaskListId.mockResolvedValue('list-desconhecida');
    dbSelectWhere.mockResolvedValue([]); // nenhum cliente com essa lista
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/clickup/tasks/task-x/comments' });

    expect(response.statusCode).toBe(404);
    expect(getTaskComments).not.toHaveBeenCalled();
  });

  it('GET /clickup/tasks/:id/comments de task de cliente sem acesso -> 403', async () => {
    getTaskListId.mockResolvedValue('list-1');
    dbSelectWhere.mockResolvedValue([OWNER_CLIENT]);
    hasClientAccess.mockResolvedValue(false);
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/clickup/tasks/task-1/comments' });

    expect(response.statusCode).toBe(403);
    expect(getTaskComments).not.toHaveBeenCalled();
  });

  it('GET /clickup/tasks/:id/comments de task da carteira com acesso -> 200', async () => {
    getTaskListId.mockResolvedValue('list-1');
    dbSelectWhere.mockResolvedValue([OWNER_CLIENT]);
    getTaskComments.mockResolvedValue([{ id: 'c1', text: 'oi', userId: 'u1', username: 'Ana', date: '2026-09-14' }]);
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/clickup/tasks/task-1/comments' });

    expect(response.statusCode).toBe(200);
    expect(response.json().comments).toHaveLength(1);
  });

  it('DELETE /clickup/tasks/:id de task fora da carteira -> 404, sem enfileirar aprovação', async () => {
    getTaskListId.mockResolvedValue('list-desconhecida');
    dbSelectWhere.mockResolvedValue([]);
    const app = await buildApp();

    const response = await app.inject({ method: 'DELETE', url: '/clickup/tasks/task-x' });

    expect(response.statusCode).toBe(404);
    expect(requestToolCall).not.toHaveBeenCalled();
  });

  it('PATCH /clickup/tasks/:id de task fora da carteira -> 404, sem enfileirar aprovação', async () => {
    getTaskListId.mockResolvedValue('list-desconhecida');
    dbSelectWhere.mockResolvedValue([]);
    const app = await buildApp();

    const response = await app.inject({
      method: 'PATCH',
      url: '/clickup/tasks/task-x',
      payload: { name: 'Novo nome' },
    });

    expect(response.statusCode).toBe(404);
    expect(requestToolCall).not.toHaveBeenCalled();
  });
});
