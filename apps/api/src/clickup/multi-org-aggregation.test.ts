import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * REDESENHO MULTI-ORG das rotas agregadas de ClickUp (06/10/2026) — item de
 * pré-release não-negociável: `GET /clickup/tasks/agency` e
 * `GET /clickup/tasks/me` agregam clientes que podem pertencer a
 * organizações DIFERENTES, e usavam UMA credencial (pessoal/compartilhada de
 * quem perguntou) pra consultar todas. Prova aqui, com dois tenants reais no
 * mock:
 *
 *   - Tenant A -> ClickUp A (credencial própria, workspace próprio);
 *   - Tenant B -> ClickUp B (credencial própria, workspace próprio);
 *   - consulta agregada de alguém que vê os dois devolve A+B, cada tarefa
 *     consultada com a credencial CERTA pro cliente dela;
 *   - organização com conector quebrado não derruba a consulta das outras —
 *     aparece em `unavailable_clients` (nunca um id de organização no fio).
 */

const ORG_A = 'org-a-11111111-1111-4111-8111-111111111111';
const ORG_B = 'org-b-22222222-2222-4222-8222-222222222222';
const ORG_C_QUEBRADA = 'org-c-33333333-3333-4333-8333-333333333333';

const CLIENT_A = { id: 'client-a', name: 'Cliente A', clickupListId: 'list-a', organizationId: ORG_A };
const CLIENT_B = { id: 'client-b', name: 'Cliente B', clickupListId: 'list-b', organizationId: ORG_B };
const CLIENT_C = { id: 'client-c', name: 'Cliente C (conector quebrado)', clickupListId: 'list-c', organizationId: ORG_C_QUEBRADA };

const CONFIG_A = { apiKey: 'key-a', teamId: 'team-a' };
const CONFIG_B = { apiKey: 'key-b', teamId: 'team-b' };

const queryOperationTasks = vi.fn();
const findMemberByEmail = vi.fn();
const resolveClickUpCredentialsForOrganizations = vi.fn();
const resolveClickUpCredentials = vi.fn();
const escopoDeOrganizacao = vi.fn();
const resolveSharedClickUpAccess = vi.fn();
const resolveClickUpAccess = vi.fn();

class FakeConnectorConfigError extends Error {}

let clientsRows: Array<{ id: string; name: string; clickupListId: string | null; organizationId: string | null }>;
let usersRows: Array<{ id: string; clickupEmail: string | null }>;

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        const rows = (table as { __name?: string }).__name === 'users' ? usersRows : clientsRows;
        return Object.assign(Promise.resolve(rows), { where: () => Promise.resolve(rows) });
      },
    }),
    insert: () => ({ values: () => Promise.resolve([]) }),
  },
  schema: {
    clients: { __name: 'clients', clickupListId: 'clickup_list_id', id: 'id', name: 'name', organizationId: 'organization_id' },
    users: { __name: 'users', id: 'id' },
    auditLogs: { id: 'id' },
  },
  resolverPessoaPorClickupUserId: vi.fn(),
  resolverPessoaPorEmail: vi.fn(),
}));

vi.mock('@desigual-os/tool-gateway', () => ({
  createAttributedTask: vi.fn(),
  createTaskComment: vi.fn(),
  deleteTask: vi.fn(),
  findMemberByEmail: (...args: unknown[]) => findMemberByEmail(...args),
  getTaskComments: vi.fn(),
  getTaskListId: vi.fn(),
  getTaskResumo: vi.fn(),
  getTeamMembers: vi.fn(),
  parseTaskChangedEvent: vi.fn(),
  parseTaskCommentPostedEvent: vi.fn(),
  queryOperationTasks: (...args: unknown[]) => queryOperationTasks(...args),
  recordToolResult: vi.fn(),
  replyToComment: vi.fn(),
  requestToolCall: vi.fn(),
  updateTask: vi.fn(),
  uploadTaskAttachment: vi.fn(),
  verifyClickUpSignature: vi.fn(),
  resolveClickUpCredentials: (...args: unknown[]) => resolveClickUpCredentials(...args),
  resolveClickUpCredentialsForOrganizations: (...args: unknown[]) => resolveClickUpCredentialsForOrganizations(...args),
  ConnectorConfigError: FakeConnectorConfigError,
}));

vi.mock('../organizations/contexto', () => ({ organizacaoDeTrabalhoDe: vi.fn() }));
vi.mock('@desigual-os/context-engine', () => ({ precisaResincronizar: vi.fn(), sincronizarCampanhasDoCliente: vi.fn() }));
vi.mock('@desigual-os/logging', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('@desigual-os/orchestrator', () => ({
  getRedisConnection: vi.fn(),
  publishWsEvent: vi.fn(),
  recordLearning: vi.fn(),
  recordOperationalEvent: vi.fn(),
}));
vi.mock('@desigual-os/types', () => ({ stripBlockMarkers: (t: string) => t, stripEmDashes: (t: string) => t }));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'user-1', email: 'chefe@desigual.com', roles: ['master'] };
  },
  requirePermission: () => async () => {},
}));

vi.mock('../lib/escopo-de-organizacao', () => ({
  escopoDeOrganizacao: (...args: unknown[]) => escopoDeOrganizacao(...args),
}));

vi.mock('../integrations/access', () => ({
  resolveClickUpAccess: (...args: unknown[]) => resolveClickUpAccess(...args),
  resolveSharedClickUpAccess: (...args: unknown[]) => resolveSharedClickUpAccess(...args),
}));

vi.mock('../lib/access', () => ({ hasClientAccess: vi.fn() }));
vi.mock('../lib/idempotency', () => ({
  claimIdempotency: vi.fn(),
  fulfillIdempotency: vi.fn(),
  idempotencyKey: () => 'idem-key',
  releaseIdempotency: vi.fn(),
}));
vi.mock('../lib/bento-mention', () => ({ respondAsBento: vi.fn() }));
vi.mock('../lib/agent-mention', () => ({ detectMentionedAgent: vi.fn(), respondAsAgent: vi.fn(), respondAsOtto: vi.fn() }));

const { registerClickUpRoutes, esquecerTarefasEmCache } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  await registerClickUpRoutes(app);
  return app;
}

function fakeTask(id: string, listId: string, assignees: string[] = []): unknown {
  return {
    id, name: `Tarefa ${id}`, description: null, status: 'aberto', statusType: 'open', priority: null,
    url: null, dueDate: null, startDate: null, createdAt: null, updatedAt: null,
    assignees, tags: [], parentId: null, topLevelParentId: null, listId, listName: null, folderName: null, spaceId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  /**
   * CACHE FRIO A CADA TESTE.
   *
   * `/clickup/tasks/agency` guarda a resposta do ClickUp num mapa de módulo
   * (ver `consultarComCache` em routes.ts), e módulo não se reinicia entre
   * testes. Sem isto, o segundo teste a pedir a mesma consulta era servido do
   * cache do primeiro e `queryOperationTasks` não era chamada — o que fez dois
   * testes desta suíte falharem com "expected spy to be called 1 times, but got
   * 0 times" quando o cache entrou, em 08/10/2026.
   *
   * Os testes estavam certos: o que eles medem é QUANTAS consultas o plano
   * gera, e isso tem que ser medido a partir do zero. Cache compartilhado entre
   * testes é estado escondido, e estado escondido faz um teste depender da
   * ordem em que os outros rodaram.
   */
  esquecerTarefasEmCache();
  clientsRows = [CLIENT_A, CLIENT_B];
  usersRows = [{ id: 'user-1', clickupEmail: 'chefe@desigual.com' }];
  escopoDeOrganizacao.mockResolvedValue({ organizationIds: [ORG_A, ORG_B], ehProvider: false });
});

describe('GET /clickup/tasks/agency — credencial POR organização, nunca uma só pra todas', () => {
  it('Tenant A -> ClickUp A, Tenant B -> ClickUp B: agregado devolve A+B, cada um com a credencial certa', async () => {
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([
        [ORG_A, { organizationId: ORG_A, credentials: CONFIG_A, error: null }],
        [ORG_B, { organizationId: ORG_B, credentials: CONFIG_B, error: null }],
      ]),
    );
    /**
     * 07/10/2026: estas asserções pediam `listIds` por organização. O que elas
     * guardam de fato — e segue guardado — é que cada workspace é consultado
     * com a credencial DELE e nunca com a de outro. O recorte por lista deixou
     * de valer aqui porque o chamador é MEMBRO das duas organizações, e
     * "todas as tarefas da agência" passou a significar o workspace inteiro
     * (ver planejarConsultas em routes.ts). O caso do recorte por lista está
     * logo abaixo, no teste do provedor que apenas supervisiona.
     */
    queryOperationTasks.mockImplementation(async (config: { apiKey: string }, query: { listIds?: string[] }) => {
      if (config.apiKey === 'key-a') {
        expect(query.listIds).toBeUndefined();
        return { tasks: [fakeTask('task-a1', 'list-a')], truncated: false, pagesFetched: 1 };
      }
      if (config.apiKey === 'key-b') {
        expect(query.listIds).toBeUndefined();
        return { tasks: [fakeTask('task-b1', 'list-b')], truncated: false, pagesFetched: 1 };
      }
      throw new Error(`credencial inesperada: ${config.apiKey}`);
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/agency' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tasks.map((t: { id: string }) => t.id).sort()).toEqual(['task-a1', 'task-b1']);
    // Proveniência por CLIENTE, nunca id de organização no fio.
    const porId = Object.fromEntries(body.tasks.map((t: { id: string; client: { name: string } }) => [t.id, t.client.name]));
    expect(porId['task-a1']).toBe('Cliente A');
    expect(porId['task-b1']).toBe('Cliente B');
    expect(JSON.stringify(body)).not.toContain(ORG_A);
    expect(JSON.stringify(body)).not.toContain(ORG_B);
    expect(queryOperationTasks).toHaveBeenCalledTimes(2);
  });

  it('organização com conector quebrado não derruba as outras — some do resultado, aparece em unavailable_clients', async () => {
    clientsRows = [CLIENT_A, CLIENT_C];
    escopoDeOrganizacao.mockResolvedValue({ organizationIds: [ORG_A, ORG_C_QUEBRADA], ehProvider: false });
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([
        [ORG_A, { organizationId: ORG_A, credentials: CONFIG_A, error: null }],
        [ORG_C_QUEBRADA, { organizationId: ORG_C_QUEBRADA, credentials: null, error: 'O conector clickup desta empresa está inativa.' }],
      ]),
    );
    queryOperationTasks.mockResolvedValue({ tasks: [fakeTask('task-a1', 'list-a')], truncated: false, pagesFetched: 1 });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/agency' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(['task-a1']);
    expect(body.unavailable_clients).toEqual(['Cliente C (conector quebrado)']);
    expect(JSON.stringify(body)).not.toContain(ORG_C_QUEBRADA);
    // só 1 chamada: a organização quebrada nunca foi consultada com a
    // credencial de outra organização no lugar.
    expect(queryOperationTasks).toHaveBeenCalledTimes(1);
  });

  it('nenhuma organização visível tem credencial utilizável -> 400, nunca usa a chave de qualquer outra', async () => {
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([
        [ORG_A, { organizationId: ORG_A, credentials: null, error: 'quebrado' }],
        [ORG_B, { organizationId: ORG_B, credentials: null, error: 'quebrado' }],
      ]),
    );

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/agency' });
    expect(res.statusCode).toBe(400);
    expect(queryOperationTasks).not.toHaveBeenCalled();
  });

  it('organização sem conector próprio cai na chave compartilhada (comportamento de sempre, não regressão)', async () => {
    clientsRows = [CLIENT_A];
    escopoDeOrganizacao.mockResolvedValue({ organizationIds: [ORG_A], ehProvider: false });
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([[ORG_A, { organizationId: ORG_A, credentials: null, error: null }]]),
    );
    resolveSharedClickUpAccess.mockReturnValue({ token: 'shared-key', teamId: 'shared-team', connectionId: null });
    queryOperationTasks.mockResolvedValue({ tasks: [fakeTask('task-a1', 'list-a')], truncated: false, pagesFetched: 1 });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/agency' });
    expect(res.statusCode).toBe(200);
    // Chave compartilhada continua sendo o fallback de quem não tem conector
    // próprio; o que mudou é o RECORTE, que some para a organização da casa.
    expect(queryOperationTasks).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'shared-key' }), {});
  });

  /**
   * A FRONTEIRA NOVA (07/10/2026). "Todas as tarefas" virou o workspace
   * inteiro só para a organização de que a pessoa é MEMBRO. Para a empresa que
   * o provedor apenas ENXERGA, o recorte por lista de cliente continua —
   * supervisionar a conta de um cliente não é varrer o ClickUp dele.
   */
  it('provedor que apenas enxerga a empresa segue limitado às listas dos clientes dela', async () => {
    clientsRows = [CLIENT_A, CLIENT_B];
    escopoDeOrganizacao.mockResolvedValue({ organizationIds: [], ehProvider: true });
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([
        [ORG_A, { organizationId: ORG_A, credentials: CONFIG_A, error: null }],
        [ORG_B, { organizationId: ORG_B, credentials: CONFIG_B, error: null }],
      ]),
    );
    queryOperationTasks.mockResolvedValue({ tasks: [], truncated: false, pagesFetched: 1 });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/agency' });

    expect(res.statusCode).toBe(200);
    expect(queryOperationTasks).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key-a' }), { listIds: ['list-a'] });
    expect(queryOperationTasks).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key-b' }), { listIds: ['list-b'] });
  });

  /**
   * Duas organizações caindo na MESMA chave compartilhada: sem agrupar por
   * workspace, o mesmo ClickUp seria consultado duas vezes e cada tarefa
   * apareceria em duplicata na tela.
   */
  it('duas organizações na mesma credencial: uma consulta só, sem tarefa repetida', async () => {
    clientsRows = [CLIENT_A, CLIENT_B];
    escopoDeOrganizacao.mockResolvedValue({ organizationIds: [ORG_A, ORG_B], ehProvider: false });
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([
        [ORG_A, { organizationId: ORG_A, credentials: null, error: null }],
        [ORG_B, { organizationId: ORG_B, credentials: null, error: null }],
      ]),
    );
    resolveSharedClickUpAccess.mockReturnValue({ token: 'shared-key', teamId: 'shared-team', connectionId: null });
    queryOperationTasks.mockResolvedValue({
      tasks: [fakeTask('task-a1', 'list-a'), fakeTask('task-b1', 'list-b')],
      truncated: false,
      pagesFetched: 1,
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/agency' });

    expect(res.statusCode).toBe(200);
    expect(queryOperationTasks).toHaveBeenCalledTimes(1);
    expect(res.json().tasks.map((t: { id: string }) => t.id)).toEqual(['task-a1', 'task-b1']);
  });
});

describe('GET /clickup/tasks/me — id de membro é POR WORKSPACE, resolvido por organização', () => {
  it('a mesma pessoa tem ids de membro diferentes em workspaces diferentes — cada organização usa o id certo', async () => {
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([
        [ORG_A, { organizationId: ORG_A, credentials: CONFIG_A, error: null }],
        [ORG_B, { organizationId: ORG_B, credentials: CONFIG_B, error: null }],
      ]),
    );
    findMemberByEmail.mockImplementation(async (config: { apiKey: string }) => {
      if (config.apiKey === 'key-a') return { id: 111, email: 'chefe@desigual.com', username: 'chefe', profilePicture: null, initials: null, color: null };
      if (config.apiKey === 'key-b') return { id: 222, email: 'chefe@desigual.com', username: 'chefe', profilePicture: null, initials: null, color: null };
      return null;
    });
    queryOperationTasks.mockImplementation(async (config: { apiKey: string }, query: { assigneeIds?: number[] }) => {
      if (config.apiKey === 'key-a') {
        expect(query.assigneeIds).toEqual([111]);
        return { tasks: [fakeTask('task-a1', 'list-a')], truncated: false, pagesFetched: 1 };
      }
      expect(query.assigneeIds).toEqual([222]);
      return { tasks: [fakeTask('task-b1', 'list-b')], truncated: false, pagesFetched: 1 };
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tasks.map((t: { id: string }) => t.id).sort()).toEqual(['task-a1', 'task-b1']);
  });

  it('não é membro do workspace B, mas é do A: devolve só as tarefas de A, sem erro', async () => {
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([
        [ORG_A, { organizationId: ORG_A, credentials: CONFIG_A, error: null }],
        [ORG_B, { organizationId: ORG_B, credentials: CONFIG_B, error: null }],
      ]),
    );
    findMemberByEmail.mockImplementation(async (config: { apiKey: string }) =>
      config.apiKey === 'key-a' ? { id: 111, email: 'chefe@desigual.com', username: 'chefe', profilePicture: null, initials: null, color: null } : null,
    );
    queryOperationTasks.mockResolvedValue({ tasks: [fakeTask('task-a1', 'list-a')], truncated: false, pagesFetched: 1 });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tasks.map((t: { id: string }) => t.id)).toEqual(['task-a1']);
    expect(queryOperationTasks).toHaveBeenCalledTimes(1);
  });

  it('não é membro de workspace nenhum -> 409, nunca um 500', async () => {
    resolveClickUpCredentialsForOrganizations.mockResolvedValue(
      new Map([[ORG_A, { organizationId: ORG_A, credentials: CONFIG_A, error: null }]]),
    );
    clientsRows = [CLIENT_A];
    escopoDeOrganizacao.mockResolvedValue({ organizationIds: [ORG_A], ehProvider: false });
    findMemberByEmail.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/clickup/tasks/me' });
    expect(res.statusCode).toBe(409);
    expect(queryOperationTasks).not.toHaveBeenCalled();
  });
});
