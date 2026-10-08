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
const verifyClickUpSignature = vi.fn();
const parseTaskChangedEvent = vi.fn();
const getTaskResumo = vi.fn();
const recordOperationalEvent = vi.fn();
const resolverPessoaPorClickupUserId = vi.fn();
const resolverPessoaPorEmail = vi.fn();
const getTeamMembers = vi.fn();
const resolveClickUpCredentials = vi.fn();
const organizacaoDeTrabalhoDe = vi.fn();

class FakeConnectorConfigError extends Error {}

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
    resolverPessoaPorClickupUserId: (...args: unknown[]) => resolverPessoaPorClickupUserId(...args),
    resolverPessoaPorEmail: (...args: unknown[]) => resolverPessoaPorEmail(...args),
  };
});

vi.mock('@desigual-os/tool-gateway', () => ({
  createAttributedTask: (...args: unknown[]) => createAttributedTask(...args),
  createTaskComment: vi.fn(),
  deleteTask: vi.fn(),
  findMemberByEmail: vi.fn(),
  getTaskComments: (...args: unknown[]) => getTaskComments(...args),
  getTaskListId: (...args: unknown[]) => getTaskListId(...args),
  getTaskResumo: (...args: unknown[]) => getTaskResumo(...args),
  getTeamMembers: (...args: unknown[]) => getTeamMembers(...args),
  parseTaskChangedEvent: (...args: unknown[]) => parseTaskChangedEvent(...args),
  parseTaskCommentPostedEvent: vi.fn(),
  queryOperationTasks: vi.fn(),
  recordToolResult: vi.fn(),
  replyToComment: vi.fn(),
  requestToolCall: (...args: unknown[]) => requestToolCall(...args),
  updateTask: vi.fn(),
  uploadTaskAttachment: vi.fn(),
  verifyClickUpSignature: (...args: unknown[]) => verifyClickUpSignature(...args),
  resolveClickUpCredentials: (...args: unknown[]) => resolveClickUpCredentials(...args),
  ConnectorConfigError: FakeConnectorConfigError,
}));

vi.mock('../organizations/contexto', () => ({
  organizacaoDeTrabalhoDe: (...args: unknown[]) => organizacaoDeTrabalhoDe(...args),
}));

const precisaResincronizar = vi.fn();
const sincronizarCampanhasDoCliente = vi.fn();

vi.mock('@desigual-os/context-engine', () => ({
  precisaResincronizar: (...args: unknown[]) => precisaResincronizar(...args),
  sincronizarCampanhasDoCliente: (...args: unknown[]) => sincronizarCampanhasDoCliente(...args),
}));

vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@desigual-os/orchestrator', () => ({
  getRedisConnection: vi.fn(),
  publishWsEvent: vi.fn(),
  recordLearning: vi.fn(),
  recordOperationalEvent: (...args: unknown[]) => recordOperationalEvent(...args),
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

/**
 * Entregas 3+4 (01/10/2026): o webhook vira produtor CANÔNICO do evento —
 * organization_id preenchido (fim do fallback transicional do
 * get_recent_events) e autor resolvido pelo entity graph quando o payload traz
 * history_items[].user. Sem link e sem e-mail casado, actor segue null e
 * payload.actor_resolution registra 'nao_resolvido' — nunca inventado.
 */
describe('POST /clickup/webhook como produtor canônico de eventos', () => {
  const CLIENTE_COM_ORG = { ...OWNER_CLIENT, organizationId: 'org-1' };
  const payloadComAutor = {
    event: 'taskUpdated',
    task_id: 'task-1',
    webhook_id: 'wh-1',
    history_items: [
      { id: 'hi-1', date: '1790844000000', field: 'status', user: { id: 12345678, username: 'Ana Souza', email: 'ana@desigual.com' } },
    ],
  };

  async function postWebhook(body: unknown) {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/clickup/webhook',
      headers: { 'content-type': 'application/json', 'x-signature': 'assinatura-valida' },
      payload: JSON.stringify(body),
    });
    // O handler responde 200 ANTES de processar (o ClickUp só precisa do
    // recebimento). O processamento inteiro é uma cadeia de microtasks sobre
    // mocks que resolvem na hora, então um macrotask basta pra esperá-lo.
    await new Promise((resolve) => setImmediate(resolve));
    return response;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKUP_API_KEY = 'pk_teste';
    process.env.CLICKUP_TEAM_ID = 'team-1';
    process.env.CLICKUP_WEBHOOK_SECRET = 'segredo-teste';
    precisaResincronizar.mockResolvedValue(false);
    verifyClickUpSignature.mockReturnValue(true);
    parseTaskChangedEvent.mockReturnValue({ event: 'taskUpdated', taskId: 'task-1', listId: 'list-1' });
    dbSelectWhere.mockResolvedValue([CLIENTE_COM_ORG]);
    recordOperationalEvent.mockResolvedValue({ status: 'recorded', eventId: 'ev-1' });
    resolverPessoaPorClickupUserId.mockResolvedValue(null);
    resolverPessoaPorEmail.mockResolvedValue(null);
    getTaskResumo.mockResolvedValue({ listId: 'list-1', name: 'Campanha Outubro', status: 'em aprovação' });
  });

  it('autor com link no entity graph -> evento com org, actor, userId e actor_resolution=link', async () => {
    resolverPessoaPorClickupUserId.mockResolvedValue({ userId: 'user-1', employeeId: 'emp-1', name: 'Ana Souza' });

    const response = await postWebhook(payloadComAutor);

    expect(response.statusCode).toBe(200);
    expect(resolverPessoaPorClickupUserId).toHaveBeenCalledWith('org-1', '12345678');
    expect(recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'clickup',
        type: 'task.updated',
        externalId: 'taskUpdated:task-1:wh-1',
        organizationId: 'org-1',
        clientId: 'client-1',
        entityType: 'task',
        entityId: 'task-1',
        taskId: 'task-1',
        actor: 'Ana Souza',
        userId: 'user-1',
        employeeId: 'emp-1',
        occurredAt: new Date(1790844000000),
        payload: expect.objectContaining({ actor_resolution: 'link' }),
      }),
    );
  });

  it('sem link mas e-mail casa -> resolve por e-mail, actor_resolution=email e oferece o clickupUserId pra gravar o link', async () => {
    resolverPessoaPorEmail.mockResolvedValue({ userId: 'user-2', employeeId: 'emp-2', name: 'Ana Souza' });

    const response = await postWebhook(payloadComAutor);

    expect(response.statusCode).toBe(200);
    expect(resolverPessoaPorEmail).toHaveBeenCalledWith('org-1', 'ana@desigual.com', '12345678');
    expect(recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'Ana Souza',
        userId: 'user-2',
        organizationId: 'org-1',
        payload: expect.objectContaining({ actor_resolution: 'email' }),
      }),
    );
  });

  it('autor desconhecido -> org preenchida, actor null, actor_resolution=nao_resolvido, sem erro', async () => {
    const response = await postWebhook(payloadComAutor);

    expect(response.statusCode).toBe(200);
    expect(recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actor: null,
        userId: null,
        payload: expect.objectContaining({ actor_resolution: 'nao_resolvido' }),
      }),
    );
  });

  it('payload sem history_items -> evento gravado sem autor e sem quebrar', async () => {
    const response = await postWebhook({ event: 'taskUpdated', task_id: 'task-1', webhook_id: 'wh-2' });

    expect(response.statusCode).toBe(200);
    expect(resolverPessoaPorClickupUserId).not.toHaveBeenCalled();
    expect(recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: null, payload: expect.objectContaining({ actor_resolution: 'nao_resolvido' }) }),
    );
  });

  it('reentrega do ClickUp (mesmo external_id) é tolerada: 200 e o handler segue sem duplicar efeitos', async () => {
    recordOperationalEvent.mockResolvedValue({ status: 'duplicate', eventId: 'ev-1' });

    const primeira = await postWebhook(payloadComAutor);
    const segunda = await postWebhook(payloadComAutor);

    expect(primeira.statusCode).toBe(200);
    expect(segunda.statusCode).toBe(200);
    // A dedup de verdade é o índice único (source, external_id) no banco; aqui se
    // trava que as duas entregas chegam ao event store com a MESMA chave.
    const [primeiraChamada, segundaChamada] = recordOperationalEvent.mock.calls;
    expect(primeiraChamada![0].externalId).toBe('taskUpdated:task-1:wh-1');
    expect(segundaChamada![0].externalId).toBe(primeiraChamada![0].externalId);
  });

  it('assinatura inválida -> 401 e nada é gravado', async () => {
    verifyClickUpSignature.mockReturnValue(false);

    const response = await postWebhook(payloadComAutor);

    expect(response.statusCode).toBe(401);
    expect(recordOperationalEvent).not.toHaveBeenCalled();
  });

  /**
   * O BURACO MEDIDO EM 02/10/2026: nos 872 eventos de tarefa gravados até
   * aqui, `summary` era nulo nos 872 e o payload guardava só
   * {event, list_id, actor_resolution}. Nome da tarefa e mudança de status
   * nunca entraram, e sem eles a linha do tempo só conseguia escrever
   * "Atualizou uma tarefa".
   *
   * Cada teste usa um task_id próprio: o handler guarda o resumo da tarefa por
   * 60s para não pagar um GET por webhook numa edição em lote, e reaproveitar
   * o id faria um teste ler o cache do outro.
   */
  it('grava nome da tarefa, mudança de status e a frase pronta', async () => {
    parseTaskChangedEvent.mockReturnValue({ event: 'taskUpdated', taskId: 'task-rico', listId: 'list-1' });
    getTaskResumo.mockResolvedValue({ listId: 'list-1', name: 'Campanha Outubro', status: 'em aprovação' });

    await postWebhook({
      event: 'taskUpdated',
      task_id: 'task-rico',
      webhook_id: 'wh-2',
      history_items: [
        {
          field: 'status',
          date: '1790844000000',
          user: { id: 12345678, username: 'Ana Souza' },
          before: { status: 'em produção' },
          after: { status: 'em aprovação' },
        },
      ],
    });

    expect(recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Moveu "Campanha Outubro" de em produção para em aprovação',
        payload: expect.objectContaining({
          task_name: 'Campanha Outubro',
          status_from: 'em produção',
          status_to: 'em aprovação',
          changes: [{ campo: 'status', rotulo: 'status', de: 'em produção', para: 'em aprovação' }],
        }),
      }),
    );
  });

  it('se a busca do nome falha, o evento ainda é gravado — degrada, não desiste', async () => {
    parseTaskChangedEvent.mockReturnValue({ event: 'taskUpdated', taskId: 'task-sem-nome', listId: 'list-1' });
    getTaskResumo.mockRejectedValue(new Error('ClickUp fora do ar'));

    const response = await postWebhook({
      event: 'taskUpdated',
      task_id: 'task-sem-nome',
      webhook_id: 'wh-3',
      history_items: [{ field: 'status', before: { status: 'a fazer' }, after: { status: 'fazendo' } }],
    });

    expect(response.statusCode).toBe(200);
    const gravado = recordOperationalEvent.mock.calls[0]![0];
    // A mudança de status sobrevive (vem do próprio payload), o nome não é
    // inventado, e o id da tarefa nunca vaza pra frase.
    expect(gravado.summary).toBe('Moveu uma tarefa de a fazer para fazendo');
    expect(gravado.payload.task_name).toBeNull();
    expect(gravado.summary).not.toContain('task-sem-nome');
  });

  it('sem list_id no payload e sem conseguir ler a tarefa, não grava evento órfão', async () => {
    parseTaskChangedEvent.mockReturnValue({ event: 'taskUpdated', taskId: 'task-orfa', listId: null });
    getTaskResumo.mockRejectedValue(new Error('ClickUp fora do ar'));

    const response = await postWebhook({ event: 'taskUpdated', task_id: 'task-orfa', webhook_id: 'wh-4' });

    expect(response.statusCode).toBe(200);
    expect(recordOperationalEvent).not.toHaveBeenCalled();
  });

  it('tarefa apagada não é buscada na API — o 404 seria garantido', async () => {
    parseTaskChangedEvent.mockReturnValue({ event: 'taskDeleted', taskId: 'task-morta', listId: 'list-1' });

    await postWebhook({ event: 'taskDeleted', task_id: 'task-morta', webhook_id: 'wh-5' });

    expect(getTaskResumo).not.toHaveBeenCalled();
    expect(recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.deleted', summary: 'Apagou uma tarefa' }),
    );
  });
});

/**
 * GET /clickup/members — auditoria P0-A (06/10/2026): a rota lia
 * CLICKUP_API_KEY/CLICKUP_TEAM_ID direto do ambiente, ignorando se a empresa
 * de trabalho do chamador já tem conector próprio em organization_connectors.
 * Estes testes travam a resolução por organização e o "nunca cai pro
 * fallback quando o conector existe e está quebrado".
 */
describe('GET /clickup/members — resolução por organização', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKUP_API_KEY = 'pk_global';
    process.env.CLICKUP_TEAM_ID = 'team-global';
    organizacaoDeTrabalhoDe.mockResolvedValue({ id: 'org-1', name: 'Cosentino', slug: 'cosentino' });
    getTeamMembers.mockResolvedValue([{ id: 1, email: 'gui@desigual.com', username: 'Gui' }]);
  });

  it('empresa COM conector próprio: usa a credencial DELA, nunca a global', async () => {
    resolveClickUpCredentials.mockResolvedValue({ apiKey: 'pk_da_empresa', teamId: 'team-da-empresa' });
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/clickup/members' });

    expect(response.statusCode).toBe(200);
    expect(getTeamMembers).toHaveBeenCalledWith({ apiKey: 'pk_da_empresa', teamId: 'team-da-empresa' });
  });

  it('empresa SEM conector próprio: cai no fallback global (comportamento de sempre)', async () => {
    resolveClickUpCredentials.mockResolvedValue(null);
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/clickup/members' });

    expect(response.statusCode).toBe(200);
    expect(getTeamMembers).toHaveBeenCalledWith({ apiKey: 'pk_global', teamId: 'team-global' });
  });

  it('empresa com conector QUEBRADO: 409, NUNCA cai pro workspace global', async () => {
    resolveClickUpCredentials.mockRejectedValue(new FakeConnectorConfigError('O conector clickup desta empresa está desativada.'));
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/clickup/members' });

    expect(response.statusCode).toBe(409);
    expect(getTeamMembers).not.toHaveBeenCalled();
  });

  it('sem empresa de trabalho resolvida (provider fora de contexto) e sem conector: usa o fallback global', async () => {
    organizacaoDeTrabalhoDe.mockResolvedValue(null);
    resolveClickUpCredentials.mockResolvedValue(null);
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/clickup/members' });

    expect(response.statusCode).toBe(200);
    expect(resolveClickUpCredentials).toHaveBeenCalledWith(null);
    expect(getTeamMembers).toHaveBeenCalledWith({ apiKey: 'pk_global', teamId: 'team-global' });
  });
});
