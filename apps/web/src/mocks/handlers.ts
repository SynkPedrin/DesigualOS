import { HttpResponse, http } from 'msw';
import type { AgentName } from '@desigual-os/types';
import type {
  BrandKitWire,
  ChatRequestWire,
  ChatResponseWire,
  ClickUpIntegrationStatusWire,
  ClickUpPersonWire,
  CollaboratorWire,
  CreateAutomationRequestWire,
  GrantClientAccessRequestWire,
  InviteUserRequestWire,
  MeResponse,
  ProjectFileKind,
  StudioJobCreatedWire,
  StudioJobRequestWire,
  UpdateAutomationRequestWire,
  UpdateMeRequestWire,
  UpdateMessageThreadPrefsRequestWire,
  UpdateUserNameRequestWire,
  UpdateUserRoleRequestWire,
  UpdateUserStatusRequestWire,
} from '@/lib/api/contracts';
import { mockAgentStatsWire, mockInfrastructureHealthWire, mockSystemEventsWire } from './data';
import { mockBrandKits, mockClients } from './clients';
import { createQueuedExecution, executionStore, resolveAgent } from './executions';
import { createStudioJob, deleteStudioAsset, deleteStudioJob, listActiveStudioJobIds, mockStudioAssets, studioJobStore } from './studio';
import { mockNotifications } from './notifications';
import { buildCostsByAgent, buildCostsByClient, buildCostsByUser, buildCostsOverview } from './costs';
import { addProjectFile, appendAssistantMessage, appendUserMessage, createProject, deleteConversation, deleteProject, deleteProjectFile, getConversation, getConversationMessages, listConversations, listProjectFiles, listProjects, toConversationDetailWire, updateConversation, updateProject } from './conversations';
import { apresentarConector, mockConnectors, salvarConector } from './connectors';
import { mockClickUpByUserId, mockLastSeenByUserId, mockTeamMembers } from './team';
import { createMessage, getThreadPrefs, listThreadMessages, listThreadPartnerIds, markThreadRead, updateThreadPrefs } from './messages';
import { inviteMockUser, mockAdminUsers, USERS_WITH_HISTORY } from './admin';
import { mockToolCalls } from './tool-calls';
import { addInboxMessage, mockInboxMessages, mockInboxThreads, nextInboxMessageId } from './inbox';
import { mockApprovals, mockBriefs, mockBriefVersions, mockDemands, nextMockId } from './demands';
import { mockAgencyTasks } from './clickup-tasks';
import { findTeamMember, mockClientAssignments } from './client-assignments';
import { dicebearAvatarUrl } from './avatar';
import { mockCalendarEventParticipants, mockCalendarEvents } from './calendar';
import { modulosPadrao } from '@desigual-os/types';

/** Chunked to avoid blowing the call stack on `String.fromCharCode(...bytes)` for large files
 * (avatar/attachment uploads allow up to 25MB). */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Conectado nesta demo (07/10/2026) — o resto da tela (Tarefas, tags de
 *  cliente no ClickUp) já conta com sync real; desconectado por padrão
 *  contaria uma história inconsistente com o que as outras telas mostram. */
const mockClickUpConnection: ClickUpIntegrationStatusWire = {
  connected: true,
  configured: true,
  workspace_id: '9014937439',
  workspace_name: 'Desigual OS',
  last_synced_at: new Date(Date.now() - 8 * 60_000).toISOString(),
  connected_at: new Date(Date.now() - 180 * 86_400_000).toISOString(),
};

/** Persona da demo (07/10/2026): Pedro Gabriel, dono/super da agência — ver nota em mocks/team.ts. */
const mockMe: MeResponse = {
  id: 'user-admin-master',
  email: 'pedro@desigual.com.br',
  name: 'Pedro Gabriel',
  roles: ['master'],
  permissions: [
    { resource: '*', action: '*' },
  ],
  avatarUrl: dicebearAvatarUrl('Pedro Gabriel'),
  language: 'pt-BR',
  theme: 'system',
  clickupEmail: 'pedro@desigual.com.br',
};

interface MockAutomation {
  id: string;
  name: string;
  agent: AgentName;
  prompt: string;
  client_id: string | null;
  conversation_id: string | null;
  schedule: string;
  schedule_label: string;
  enabled: boolean;
  estimated_minutes_saved: number | null;
  last_run_at: string | null;
  created_at: string;
}

const mockAutomations: MockAutomation[] = [
  {
    id: 'automation-briefing-manha',
    name: 'Briefing da manhã',
    agent: 'bento',
    prompt: 'Olhe o ClickUp e me diga o que precisa ser feito hoje e quais clientes estão sem resposta.',
    client_id: null,
    conversation_id: null,
    schedule: '0 8 * * *',
    schedule_label: 'Todos os dias às 08:00',
    enabled: true,
    estimated_minutes_saved: 20,
    last_run_at: null,
    created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
];

const mockAutomationRuns = new Map<string, Array<{ id: string; status: string; error: string | null; started_at: string; completed_at: string | null }>>([
  [
    'automation-briefing-manha',
    [
      {
        id: 'run-1',
        status: 'dispatched',
        error: null,
        started_at: new Date(Date.now() - 86_400_000).toISOString(),
        completed_at: new Date(Date.now() - 86_400_000 + 2000).toISOString(),
      },
    ],
  ],
]);

export const handlers = [
  http.get('/health/infrastructure', () => {
    return HttpResponse.json(mockInfrastructureHealthWire);
  }),

  http.get('/health/events', () => {
    return HttpResponse.json({ events: mockSystemEventsWire });
  }),

  http.get('/agents/stats', () => {
    return HttpResponse.json({ agents: mockAgentStatsWire });
  }),

  http.get('/me', () => {
    return HttpResponse.json(mockMe);
  }),

  http.get('/clients', () => {
    return HttpResponse.json({ clients: mockClients });
  }),

  http.post('/clients', async ({ request }) => {
    const body = (await request.json()) as { name: string; slug: string };
    if (mockClients.some((client) => client.slug === body.slug)) {
      return HttpResponse.json({ error: `Client with slug '${body.slug}' already exists` }, { status: 409 });
    }
    const created = {
      id: `client-${body.slug}`,
      name: body.name,
      slug: body.slug,
      status: 'active',
      clickup_list_id: null,
      clickup_url: null,
      project_id: null,
      natureza: 'CLIENTE' as const,
      // Cliente recém-criado nunca se mexeu — e isso é `null`, não zero dias.
      ultima_atividade: null,
      pedidos_30d: 0,
    };
    mockClients.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.post('/chat', async ({ request }) => {
    const body = (await request.json()) as ChatRequestWire;
    if (!body.message?.trim()) {
      return HttpResponse.json({ error: 'Mensagem não pode ser vazia.' }, { status: 400 });
    }
    const agent = resolveAgent(body.agent_hint, body.message);
    const conversationId = appendUserMessage(body.conversation_id ?? null, body.client_id, body.message, body.attachment ?? null);
    const execution = createQueuedExecution(agent, body.message, body.client_id, (answer) => {
      appendAssistantMessage(conversationId, agent, answer);
    });
    const response: ChatResponseWire = {
      execution_id: execution.execution_id,
      status: 'queued',
      agent,
      conversation_id: conversationId,
    };
    return HttpResponse.json(response, { status: 202 });
  }),

  http.get('/executions', ({ request }) => {
    const clientId = new URL(request.url).searchParams.get('client_id');
    const executions = Array.from(executionStore.values())
      .filter((e) => !clientId || e.client_id === clientId)
      .sort((a, b) => new Date(b.started_at ?? 0).getTime() - new Date(a.started_at ?? 0).getTime())
      .map(({ estimated_cost: _estimatedCost, actual_cost: _actualCost, steps: _steps, ...rest }) => rest);
    return HttpResponse.json({ executions });
  }),

  http.get('/executions/:executionId', ({ params }) => {
    const execution = executionStore.get(String(params.executionId));
    if (!execution) {
      return HttpResponse.json({ error: 'Execução não encontrada.' }, { status: 404 });
    }
    return HttpResponse.json(execution);
  }),

  http.post('/studio/jobs', async ({ request }) => {
    const body = (await request.json()) as StudioJobRequestWire;
    const job = createStudioJob(body);
    const response: StudioJobCreatedWire = { job_id: job.job_id, status: 'queued' };
    return HttpResponse.json(response, { status: 202 });
  }),

  // Sem :jobId: lista os jobs do usuário (mock só tem um usuário, ver mockMe). Espelha
  // GET /studio/jobs do backend real, usado pra restaurar "meus jobs em andamento" ao
  // reabrir o Studio (StudioContent/useMyActiveStudioJobs).
  http.get('/studio/jobs', ({ request }) => {
    const status = new URL(request.url).searchParams.get('status');
    const ids = status === 'active' ? listActiveStudioJobIds() : Array.from(studioJobStore.keys());
    const jobs = ids
      .map((id) => studioJobStore.get(id))
      .filter((job): job is NonNullable<typeof job> => Boolean(job))
      .map((job) => ({ job_id: job.job_id, status: job.status, progress: job.progress, type: job.type, prompt: job.prompt, resolution: job.resolution }));
    return HttpResponse.json({ jobs });
  }),

  http.get('/studio/jobs/:jobId', ({ params }) => {
    const job = studioJobStore.get(String(params.jobId));
    if (!job) {
      return HttpResponse.json({ error: 'Job não encontrado.' }, { status: 404 });
    }
    return HttpResponse.json(job);
  }),

  // DELETE /studio/jobs/:id — remove o job e todos os assets do grupo (cascade).
  http.delete('/studio/jobs/:jobId', ({ params }) => {
    if (!deleteStudioJob(String(params.jobId))) {
      return HttpResponse.json({ error: 'Job não encontrado.' }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // Filtros client_id/type/q (prompt+filename) + paginação limit/offset de verdade,
  // no mesmo shape do backend: { assets, total } com total pós-filtro.
  http.get('/studio/assets', ({ request }) => {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('client_id');
    const type = url.searchParams.get('type');
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 24));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    let filtered = [...mockStudioAssets].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (clientId) filtered = filtered.filter((asset) => asset.client_id === clientId);
    if (type) filtered = filtered.filter((asset) => asset.type === type);
    if (q) {
      filtered = filtered.filter(
        (asset) => asset.prompt.toLowerCase().includes(q) || asset.filename.toLowerCase().includes(q),
      );
    }
    return HttpResponse.json({ assets: filtered.slice(offset, offset + limit), total: filtered.length });
  }),

  http.delete('/studio/assets/:assetId', ({ params }) => {
    if (!deleteStudioAsset(String(params.assetId))) {
      return HttpResponse.json({ error: 'Asset não encontrado.' }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/clients/:clientId/brand-kit', ({ params }) => {
    const clientId = String(params.clientId);
    if (!mockClients.some((c) => c.id === clientId)) {
      return HttpResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }
    const kit = mockBrandKits[clientId] ?? {
      client_id: clientId,
      logo_url: null,
      colors: [],
      fonts: [],
      tone_of_voice: null,
      reference_images: [],
    };
    return HttpResponse.json(kit);
  }),

  // PUT /clients/:id/brand-kit — write path do Brand Kit. Como o backend
  // real, campo omitido mantém o valor atual (merge); null/[] limpa.
  http.put('/clients/:clientId/brand-kit', async ({ params, request }) => {
    const clientId = String(params.clientId);
    if (!mockClients.some((c) => c.id === clientId)) {
      return HttpResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }
    const body = (await request.json()) as Partial<BrandKitWire>;
    const current = mockBrandKits[clientId] ?? {
      client_id: clientId,
      logo_url: null,
      colors: [],
      fonts: [],
      tone_of_voice: null,
      reference_images: [],
    };
    const merged: BrandKitWire = {
      client_id: clientId,
      logo_url: body.logo_url !== undefined ? body.logo_url : current.logo_url,
      colors: body.colors ?? current.colors,
      fonts: body.fonts ?? current.fonts,
      tone_of_voice: body.tone_of_voice !== undefined ? body.tone_of_voice : current.tone_of_voice,
      reference_images: body.reference_images ?? current.reference_images,
    };
    mockBrandKits[clientId] = merged;
    return HttpResponse.json(merged);
  }),

  // Aba "Visão geral" do cliente (modal do cliente e Inbox) — sem handler
  // de mock até aqui, 404 silencioso em qualquer sessão de demonstração.
  // Deriva do MESMO fixture que a Central de Tasks usa (mockAgencyTasks),
  // nunca um número paralelo inventado.
  http.get('/clients/:clientId/overview', ({ params }) => {
    const clientId = String(params.clientId);
    const tasks = mockAgencyTasks.filter((t) => t.client?.id === clientId);
    const assets = mockStudioAssets.filter((a) => a.client_id === clientId);

    const porStatus = new Map<string, { status: string; color: string | null; count: number }>();
    for (const t of tasks) {
      if (!t.status) continue;
      const atual = porStatus.get(t.status) ?? { status: t.status, color: null, count: 0 };
      atual.count += 1;
      porStatus.set(t.status, atual);
    }

    return HttpResponse.json({
      clickup:
        tasks.length === 0
          ? null
          : {
              total_tasks: tasks.length,
              open_tasks: tasks.filter((t) => t.status_type !== 'closed').length,
              by_status: [...porStatus.values()],
              latest_comments: [],
            },
      conversations: { total: 0, latest: [] },
      studio: {
        total: assets.length,
        latest: assets.slice(0, 4).map((a) => ({ id: a.id, type: a.type, filename: a.filename, storage_url: a.storage_url, created_at: a.created_at })),
      },
    });
  }),

  http.get('/clients/:clientId/clickup/tasks', ({ params }) => {
    const client = mockClients.find((c) => c.id === String(params.clientId));
    if (!client) return HttpResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    if (!client.clickup_list_id) {
      return HttpResponse.json({ error: 'Client is not linked to a ClickUp list yet.' }, { status: 409 });
    }
    const pessoa = (id: number, name: string, initials: string, color: string): ClickUpPersonWire =>
      ({ id, name, avatar_url: null, initials, color });
    const base = { description: null, status_color: '#87909e', status_type: 'open', priority: null,
      priority_color: null, start_date: null, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), time_estimate_ms: null, tags: [], creator: null };
    return HttpResponse.json({
      tasks: [
        { ...base, id: 'cu-1', name: 'Aprovar criativos da campanha de setembro', status: 'aberto',
          url: client.clickup_url, due_date: null, assignees: [pessoa(1, 'Endrigo Almada', 'EA', '#7C3AED')] },
        { ...base, id: 'cu-2', name: 'Revisar copy do carrossel', status: 'em andamento',
          status_color: '#E1F900', url: client.clickup_url, due_date: null,
          assignees: [pessoa(2, 'Bento Desigual', 'BD', '#0f9d9f')] },
        { ...base, id: 'cu-3', name: 'Subir relatório mensal', status: 'aberto',
          url: client.clickup_url, due_date: null, assignees: [] },
      ],
    });
  }),

  // Workspace Builder (§5-13, 06/10/2026) — sem handler, a sidebar falha
  // aberta (mostra tudo) mas o ⌘K/página nunca tinham como demonstrar o
  // gate de módulo em modo mock. `configured: false` = ninguém mexeu ainda
  // no workspace desta pessoa, cai no padrão do papel (mesma regra do
  // backend real).
  // Conectores por empresa (WhatsApp/W-API, 07/10/2026) — sem `:id` real de
  // tenant em modo mock, os handlers aceitam qualquer valor de `:id`.
  http.get('/organizations/:id/connectors', ({ params }) => {
    const linhas = mockConnectors.filter((c) => c.organizationId === params.id);
    return HttpResponse.json({ connectors: linhas.map(apresentarConector) });
  }),

  http.get('/organizations/:id/connectors/whatsapp/health', ({ params }) => {
    const linha = mockConnectors.find((c) => c.organizationId === params.id && c.provider === 'whatsapp');
    if (!linha) return HttpResponse.json({ connected: false, configured: false });
    // Modo mock não fala com nenhum provedor de verdade — "configurado" nunca vira "conectado" sozinho.
    return HttpResponse.json({ connected: false, configured: true, detail: 'Modo mock: nenhuma chamada real ao provedor.' });
  }),

  http.put('/organizations/:id/connectors/:provider', async ({ params, request }) => {
    const body = (await request.json()) as { credentials?: Record<string, string> };
    const salvo = salvarConector(params.id as string, params.provider as string, body.credentials ?? {});
    return HttpResponse.json(apresentarConector(salvo));
  }),

  http.delete('/organizations/:id/connectors/:provider', ({ params }) => {
    const indice = mockConnectors.findIndex((c) => c.organizationId === params.id && c.provider === params.provider);
    if (indice === -1) return HttpResponse.json({ error: 'Conector não encontrado.' }, { status: 404 });
    mockConnectors.splice(indice, 1);
    return HttpResponse.json({ ok: true });
  }),

  http.get('/me/workspace', () => {
    return HttpResponse.json({
      template_id: null,
      modules: [...modulosPadrao(mockMe.roles.includes('master'))],
      configured: false,
    });
  }),

  // Calendário (Fase 1 do redesenho de front, 06/10/2026) — "Hoje" e
  // `/calendar` consomem o mesmo endpoint.
  http.get('/calendar/events', ({ request }) => {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const clientId = url.searchParams.get('client_id');
    const memberId = url.searchParams.get('member_id');
    let events = mockCalendarEvents;
    if (from) events = events.filter((e) => e.start_at >= from);
    if (to) events = events.filter((e) => e.start_at < to);
    if (clientId) events = events.filter((e) => e.client_id === clientId);
    // Sem isso, a Agenda da Agência mostrava os MESMOS eventos em toda coluna
    // (nenhum handler filtrava por pessoa). Evento criado dinamicamente (POST,
    // sem entrada no mapa) cai no fallback created_by — nunca some de quem criou.
    if (memberId) events = events.filter((e) => (mockCalendarEventParticipants[e.id] ?? [e.created_by]).includes(memberId));
    return HttpResponse.json({ events: [...events].sort((a, b) => a.start_at.localeCompare(b.start_at)) });
  }),

  http.post('/calendar/events', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const evento = {
      id: `cal-event-mock-${mockCalendarEvents.length + 1}`,
      client_id: (body.client_id as string) ?? null,
      start_at: body.start_at as string,
      end_at: body.end_at as string,
      timezone: 'America/Sao_Paulo',
      status: 'confirmed',
      visible: true,
      title: (body.title as string) ?? null,
      description: (body.description as string) ?? null,
      location: (body.location as string) ?? null,
      meeting_url: (body.meeting_url as string) ?? null,
      source: 'desigual_os',
      created_by: mockMe.id,
    };
    mockCalendarEvents.push(evento);
    return HttpResponse.json(evento, { status: 201 });
  }),

  http.delete('/calendar/events/:id', ({ params }) => {
    const idx = mockCalendarEvents.findIndex((e) => e.id === params.id);
    if (idx === -1) return HttpResponse.json({ error: 'Event not found' }, { status: 404 });
    mockCalendarEvents.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),

  // Central de Tasks (P1-H, 06/10/2026) — "Minhas tarefas" x "Todas as
  // tarefas da agência", mesmo contrato AgencyTaskWire usado pela Central
  // real e pelo board Kanban.
  http.get('/clickup/tasks/agency', () => {
    return HttpResponse.json({ tasks: mockAgencyTasks, truncated: false });
  }),

  http.get('/clickup/tasks/me', () => {
    if (!mockMe.clickupEmail) {
      return HttpResponse.json({ error: 'No ClickUp email linked for this user yet.' }, { status: 409 });
    }
    const minhas = mockAgencyTasks.filter((t) => t.assignees.includes(mockMe.name));
    return HttpResponse.json({ tasks: minhas, truncated: false });
  }),

  // Quem responde por este cliente (P0-C/P1-K, 06/10/2026) — distinto de
  // acesso ao workspace.
  http.get('/clients/:clientId/assignments', ({ params }) => {
    const assignments = mockClientAssignments.filter((a) => a.client_id === String(params.clientId));
    return HttpResponse.json({ assignments: assignments.map(({ client_id: _clientId, ...rest }) => rest) });
  }),

  http.put('/clients/:clientId/assignments', async ({ params, request }) => {
    const clientId = String(params.clientId);
    const body = (await request.json()) as { userId: string; responsibility: string };
    const existing = mockClientAssignments.find(
      (a) => a.client_id === clientId && a.user_id === body.userId && a.responsibility === body.responsibility,
    );
    if (!existing) {
      const member = findTeamMember(body.userId);
      mockClientAssignments.push({
        client_id: clientId,
        user_id: body.userId,
        user_name: member?.name ?? body.userId,
        user_email: member?.email ?? '',
        responsibility: body.responsibility,
      });
    }
    return HttpResponse.json({ client_id: clientId, user_id: body.userId, responsibility: body.responsibility }, { status: 201 });
  }),

  http.delete('/clients/:clientId/assignments', async ({ params, request }) => {
    const clientId = String(params.clientId);
    const body = (await request.json()) as { userId: string; responsibility: string };
    const idx = mockClientAssignments.findIndex(
      (a) => a.client_id === clientId && a.user_id === body.userId && a.responsibility === body.responsibility,
    );
    if (idx === -1) return HttpResponse.json({ error: 'Assignment not found' }, { status: 404 });
    mockClientAssignments.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),

  http.get('/clickup/tasks/:taskId/comments', ({ params }) => {
    const agora = Date.now();
    const base = [
      { text: 'Subi a primeira versão dos criativos, dá uma olhada?', username: 'Endrigo Almada', user_id: 1 },
      { text: 'Ajustei a copy do slide 3 como combinado. @Bento revisa a legenda?', username: 'Bento Desigual', user_id: 2 },
    ];
    return HttpResponse.json({
      comments: base.map((comment, index) => ({
        id: `${String(params.taskId)}-c${index + 1}`,
        text: comment.text,
        user_id: comment.user_id,
        username: comment.username,
        date: String(agora - (base.length - index) * 3_600_000),
      })),
    });
  }),

  // Integração ClickUp: no mock não existe OAuth de verdade (nem deveria - o
  // secret é backend-only), então o estado vive nesta variável e o "conectar"
  // apenas simula o retorno do callback.
  http.get('/integrations/clickup/status', () => {
    return HttpResponse.json(mockClickUpConnection);
  }),

  http.get('/integrations/clickup/authorize', () => {
    Object.assign(mockClickUpConnection, {
      connected: true,
      configured: true,
      workspace_id: '9014937439',
      workspace_name: 'Agência Desigual (mock)',
      connected_at: new Date().toISOString(),
    });
    // Sem redirect real: devolve a própria tela de integrações com o mesmo
    // parâmetro que o callback verdadeiro usaria.
    return HttpResponse.json({ authorize_url: '/integrations?clickup=conectado' });
  }),

  http.delete('/integrations/clickup', () => {
    Object.assign(mockClickUpConnection, { connected: false, workspace_id: null, workspace_name: null, last_synced_at: null });
    return HttpResponse.json({ connected: false });
  }),

  http.post('/integrations/clickup/sync', () => {
    mockClickUpConnection.last_synced_at = new Date().toISOString();
    return HttpResponse.json({ spaces_found: mockClients.length, clients_created: 0, clients_updated: mockClients.length });
  }),

  http.get('/notifications', ({ request }) => {
    const onlyUnread = new URL(request.url).searchParams.get('unread_only') === 'true';
    const notifications = onlyUnread ? mockNotifications.filter((n) => !n.read) : mockNotifications;
    return HttpResponse.json({ notifications: notifications.slice(0, 30) });
  }),

  http.patch('/notifications/:id/read', ({ params }) => {
    const notification = mockNotifications.find((n) => n.id === String(params.id));
    if (!notification) {
      return HttpResponse.json({ error: 'Notificação não encontrada.' }, { status: 404 });
    }
    notification.read = true;
    return HttpResponse.json({ id: notification.id, read: true });
  }),

  http.get('/costs/overview', ({ request }) => {
    const range = new URL(request.url).searchParams.get('range');
    return HttpResponse.json(buildCostsOverview(range));
  }),

  http.get('/costs/by-agent', () => {
    return HttpResponse.json(buildCostsByAgent());
  }),

  http.get('/costs/by-client', () => {
    return HttpResponse.json(buildCostsByClient());
  }),

  http.get('/costs/by-user', () => {
    return HttpResponse.json(buildCostsByUser());
  }),

  http.get('/conversations', ({ request }) => {
    const agent = new URL(request.url).searchParams.get('agent') as AgentName | null;
    return HttpResponse.json({ conversations: listConversations(agent) });
  }),

  http.get('/conversations/:conversationId/messages', ({ params }) => {
    const conversationId = String(params.conversationId);
    const messages = getConversationMessages(conversationId);
    if (!messages) {
      return HttpResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    }
    return HttpResponse.json({ conversation_id: conversationId, messages });
  }),

  http.get('/conversations/:conversationId', ({ params }) => {
    const conversation = getConversation(String(params.conversationId));
    if (!conversation) {
      return HttpResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    }
    return HttpResponse.json(toConversationDetailWire(conversation));
  }),

  http.patch('/conversations/:conversationId', async ({ params, request }) => {
    const patch = (await request.json()) as { title?: string | null; project_id?: string | null; visibility?: 'private' | 'public' };
    const conversation = updateConversation(String(params.conversationId), patch);
    if (!conversation) {
      return HttpResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    }
    return HttpResponse.json(toConversationDetailWire(conversation));
  }),

  http.delete('/conversations/:conversationId', ({ params }) => {
    if (!deleteConversation(String(params.conversationId))) {
      return HttpResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/projects', () => {
    return HttpResponse.json({ projects: listProjects() });
  }),

  http.post('/projects', async ({ request }) => {
    const body = (await request.json()) as { name: string; client_id?: string | null };
    return HttpResponse.json({ project: createProject(body.name, body.client_id ?? null) }, { status: 201 });
  }),

  http.patch('/projects/:projectId', async ({ params, request }) => {
    const patch = (await request.json()) as { name?: string; client_id?: string | null };
    const project = updateProject(String(params.projectId), patch);
    if (!project) {
      return HttpResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 });
    }
    return HttpResponse.json({ project });
  }),

  http.delete('/projects/:projectId', ({ params }) => {
    if (!deleteProject(String(params.projectId))) {
      return HttpResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/projects/:projectId/files', ({ params }) => {
    return HttpResponse.json({ files: listProjectFiles(String(params.projectId)) });
  }),

  http.post('/projects/:projectId/files', async ({ params, request }) => {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return HttpResponse.json({ error: 'No file sent' }, { status: 400 });
    }
    const kindField = formData.get('kind');
    const kind: ProjectFileKind =
      kindField === 'identidade_visual' || kindField === 'briefing' ? kindField : 'referencia';
    // Mesmo stand-in do avatar/anexo: imagem vira data URI pra thumbnail
    // renderizar de verdade; outros tipos ganham uma URL simbólica.
    const storageUrl = file.type.startsWith('image/')
      ? `data:${file.type};base64,${await fileToBase64(file)}`
      : `#arquivo-mock-${file.name}`;
    const created = addProjectFile(String(params.projectId), {
      kind,
      filename: file.name,
      storageUrl,
      contentType: file.type || 'application/octet-stream',
    });
    if (!created) {
      return HttpResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 });
    }
    return HttpResponse.json({ file: created }, { status: 201 });
  }),

  http.delete('/projects/:projectId/files/:fileId', ({ params }) => {
    if (!deleteProjectFile(String(params.projectId), String(params.fileId))) {
      return HttpResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // POST /uploads — upload genérico (anexo do composer). Mock stand-in: o
  // endpoint real sobe pro Supabase Storage; aqui imagem vira data URI pra
  // thumbnail renderizar, outros tipos ganham URL simbólica.
  http.post('/uploads', async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return HttpResponse.json({ error: 'No file sent' }, { status: 400 });
    }
    const url = file.type.startsWith('image/')
      ? `data:${file.type};base64,${await fileToBase64(file)}`
      : `#anexo-mock-${file.name}`;
    return HttpResponse.json({ filename: file.name, url, contentType: file.type || 'application/octet-stream' }, { status: 201 });
  }),

  http.get('/search', ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
    if (!q) return HttpResponse.json({ users: [], clients: [], agents: [] });
    return HttpResponse.json({
      users: mockTeamMembers.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 10),
      clients: mockClients.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10),
      agents: (['bento', 'jarbas', 'suzy', 'studio', 'otto'] as const)
        .filter((a) => a.includes(q))
        .map((a) => ({ id: a, name: a, display_name: a.charAt(0).toUpperCase() + a.slice(1) }))
        .slice(0, 10),
    });
  }),

  http.get('/team/members', () => {
    return HttpResponse.json({ members: mockTeamMembers });
  }),

  http.get('/clients/:clientId/workspace', ({ params }) => {
    const clientId = String(params.clientId);
    const client = mockClients.find((c) => c.id === clientId);
    if (!client) {
      return HttpResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }
    const conversations = listConversations(null).filter((c) => c.client_id === clientId);
    const studioAssets = mockStudioAssets.filter((a) => a.client_id === clientId);
    const executions = Array.from(executionStore.values()).filter((e) => e.client_id === clientId);
    const totalCost = executions.reduce((sum, e) => sum + (e.actual_cost ?? e.estimated_cost ?? 0), 0);

    return HttpResponse.json({
      client,
      conversations: conversations.map((c) => ({ id: c.id, title: c.title, status: c.status, updated_at: c.updated_at })),
      studio_assets: studioAssets.map((a) => ({
        id: a.id,
        type: a.type,
        filename: a.filename,
        storage_url: a.storage_url,
        created_at: a.created_at,
      })),
      executions: executions.map((e) => ({
        id: e.execution_id,
        execution_id: e.execution_id,
        agent: e.agent,
        status: e.status,
        created_at: e.started_at,
      })),
      cost_summary: { total_cost: totalCost, execution_count: executions.length },
    });
  }),

  http.post('/clients/:clientId/access', async ({ request, params }) => {
    const clientId = String(params.clientId);
    const client = mockClients.find((c) => c.id === clientId);
    if (!client) {
      return HttpResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }
    const body = (await request.json()) as GrantClientAccessRequestWire;
    const member = mockTeamMembers.find((m) => m.email.toLowerCase() === body.email.toLowerCase());
    if (!member) {
      return HttpResponse.json(
        { error: `Nenhuma conta desigual OS encontrada para '${body.email}'. Use POST /admin/invite primeiro.` },
        { status: 404 },
      );
    }
    return HttpResponse.json({ client_id: clientId, user_id: member.id, role: body.role ?? 'viewer' }, { status: 201 });
  }),

  http.patch('/me', async ({ request }) => {
    const body = (await request.json()) as UpdateMeRequestWire;
    if (body.name !== undefined) mockMe.name = body.name;
    if (body.language !== undefined) mockMe.language = body.language;
    if (body.theme !== undefined) mockMe.theme = body.theme;
    if (body.clickup_email !== undefined) mockMe.clickupEmail = body.clickup_email;
    return HttpResponse.json({
      id: mockMe.id,
      email: mockMe.email,
      name: mockMe.name,
      clickup_email: mockMe.clickupEmail,
      language: mockMe.language,
      theme: mockMe.theme,
      avatar_url: mockMe.avatarUrl,
    });
  }),

  http.post('/me/avatar', async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return HttpResponse.json({ error: 'Validation failed', details: [{ path: 'file', message: 'required' }] }, { status: 400 });
    }
    // Mock stand-in: real endpoint uploads to Supabase Storage and returns that URL. Encodes
    // the actual uploaded file as a data URI so the picked photo really shows up, instead of
    // a fixed placeholder (which is confusing: looks like the upload didn't do anything).
    mockMe.avatarUrl = `data:${file.type};base64,${await fileToBase64(file)}`;
    return HttpResponse.json({ id: mockMe.id, avatar_url: mockMe.avatarUrl });
  }),

  http.get('/messages/threads', () => {
    const threads = listThreadPartnerIds(mockMe.id).map((partnerId) => {
      const partner = mockTeamMembers.find((m) => m.id === partnerId);
      const partnerMessages = listThreadMessages(mockMe.id, partnerId);
      // Safe by construction: partnerId only appears here when listThreadMessages found at
      // least one message for it.
      const lastMessage = partnerMessages[partnerMessages.length - 1]!;
      const unreadCount = partnerMessages.filter((m) => m.recipient_id === mockMe.id && !m.read).length;
      const prefs = getThreadPrefs(mockMe.id, partnerId);
      return {
        user: {
          id: partnerId,
          name: partner?.name ?? 'Usuário',
          avatar_url: partner?.avatar_url ?? null,
          last_seen_at: mockLastSeenByUserId[partnerId] ?? null,
        },
        last_message: lastMessage,
        unread_count: unreadCount,
        favorited: prefs.favorited,
        archived: prefs.archived,
      };
    });
    threads.sort((a, b) => new Date(b.last_message.created_at).getTime() - new Date(a.last_message.created_at).getTime());
    const totalUnread = threads.reduce((sum, thread) => sum + thread.unread_count, 0);
    return HttpResponse.json({ threads, total_unread: totalUnread });
  }),

  http.patch('/messages/threads/:partnerId', async ({ request, params }) => {
    const partnerId = String(params.partnerId);
    if (!mockTeamMembers.some((m) => m.id === partnerId)) {
      return HttpResponse.json({ error: `User '${partnerId}' not found` }, { status: 404 });
    }
    const body = (await request.json()) as UpdateMessageThreadPrefsRequestWire;
    return HttpResponse.json(updateThreadPrefs(mockMe.id, partnerId, body));
  }),

  http.get('/collaborators', () => {
    // Deriva do mock de equipe: ClickUp em alguns membros (join por e-mail),
    // presença via mockLastSeenByUserId. clickup_synced: true no modo mock.
    const collaborators: CollaboratorWire[] = mockTeamMembers.map((member) => {
      const clickup = mockClickUpByUserId[member.id] ?? null;
      return {
        user_id: member.id,
        name: member.name,
        email: member.email,
        avatar_url: clickup?.profile_picture ?? member.avatar_url ?? null,
        roles: member.roles,
        clickup,
        last_seen_at: mockLastSeenByUserId[member.id] ?? null,
      };
    });
    return HttpResponse.json({ collaborators, clickup_synced: true });
  }),

  http.get('/messages/:userId', ({ params }) => {
    const partnerId = String(params.userId);
    const messages = listThreadMessages(mockMe.id, partnerId);
    markThreadRead(mockMe.id, partnerId);
    return HttpResponse.json({ messages });
  }),

  http.post('/messages', async ({ request }) => {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const recipientId = String(formData.get('recipient_id') ?? '');
      const content = String(formData.get('content') ?? '');
      const file = formData.get('file') as File | null;
      if (!recipientId || (!content && !file)) {
        return HttpResponse.json({ error: 'Validation failed', details: [{ path: 'content', message: 'required' }] }, { status: 400 });
      }
      const message = createMessage({
        senderId: mockMe.id,
        recipientId,
        content: content || null,
        attachmentUrl: file ? `data:${file.type};base64,${await fileToBase64(file)}` : null,
        attachmentType: file?.type ?? null,
        attachmentFilename: file?.name ?? null,
      });
      return HttpResponse.json(message, { status: 201 });
    }

    const body = (await request.json()) as { recipient_id: string; content: string };
    if (!body.recipient_id || !body.content?.trim()) {
      return HttpResponse.json({ error: 'Validation failed', details: [{ path: 'content', message: 'required' }] }, { status: 400 });
    }
    if (body.recipient_id === mockMe.id) {
      return HttpResponse.json({ error: 'Não é possível enviar mensagem para si mesmo.' }, { status: 400 });
    }
    const message = createMessage({ senderId: mockMe.id, recipientId: body.recipient_id, content: body.content });
    return HttpResponse.json(message, { status: 201 });
  }),

  http.get('/admin/users', () => {
    return HttpResponse.json({ users: mockAdminUsers });
  }),

  http.post('/admin/invite', async ({ request }) => {
    const body = (await request.json()) as InviteUserRequestWire;
    if (mockAdminUsers.some((user) => user.email.toLowerCase() === body.email.toLowerCase())) {
      return HttpResponse.json({ error: 'Já existe uma conta com este e-mail.' }, { status: 400 });
    }
    inviteMockUser(body.email, body.name, body.role);
    return HttpResponse.json({ email: body.email, role: body.role, status: 'invited' }, { status: 201 });
  }),

  http.patch('/admin/users/:userId', async ({ request, params }) => {
    const user = mockAdminUsers.find((u) => u.id === String(params.userId));
    if (!user) {
      return HttpResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }
    const body = (await request.json()) as UpdateUserNameRequestWire;
    user.name = body.name;
    return HttpResponse.json({ id: user.id, name: user.name });
  }),

  http.patch('/admin/users/:userId/role', async ({ request, params }) => {
    const user = mockAdminUsers.find((u) => u.id === String(params.userId));
    if (!user) {
      return HttpResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }
    const body = (await request.json()) as UpdateUserRoleRequestWire;
    user.roles = [body.role];
    return HttpResponse.json({ id: user.id, role: body.role });
  }),

  http.patch('/admin/users/:userId/status', async ({ request, params }) => {
    const user = mockAdminUsers.find((u) => u.id === String(params.userId));
    if (!user) {
      return HttpResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }
    const body = (await request.json()) as UpdateUserStatusRequestWire;
    user.active = body.active;
    return HttpResponse.json({ id: user.id, active: body.active });
  }),

  http.delete('/admin/users/:userId', ({ params }) => {
    const userId = String(params.userId);
    const index = mockAdminUsers.findIndex((u) => u.id === userId);
    if (index === -1) {
      return HttpResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }
    if (USERS_WITH_HISTORY.has(userId)) {
      return HttpResponse.json(
        { error: 'Este usuário já tem histórico (execuções, auditoria ou mensagens). Use inativar em vez de excluir.' },
        { status: 409 },
      );
    }
    mockAdminUsers.splice(index, 1);
    return HttpResponse.json({ id: userId, deleted: true });
  }),

  http.get('/automations', () => {
    return HttpResponse.json({ automations: mockAutomations });
  }),

  http.post('/automations', async ({ request }) => {
    const body = (await request.json()) as CreateAutomationRequestWire;
    const created: MockAutomation = {
      id: `automation-${Date.now()}`,
      name: body.name,
      agent: body.agent,
      prompt: body.prompt,
      client_id: body.client_id ?? null,
      conversation_id: null,
      schedule: body.schedule,
      schedule_label: body.schedule_label,
      enabled: true,
      estimated_minutes_saved: body.estimated_minutes_saved ?? null,
      last_run_at: null,
      created_at: new Date().toISOString(),
    };
    mockAutomations.unshift(created);
    mockAutomationRuns.set(created.id, []);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get('/automations/metrics', () => {
    const activeCount = mockAutomations.filter((a) => a.enabled).length;
    const allRuns = [...mockAutomationRuns.values()].flat();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const runsToday = allRuns.filter((run) => new Date(run.started_at) >= startOfToday).length;
    const finishedRuns = allRuns.filter((run) => run.completed_at !== null);
    const successRate = finishedRuns.length > 0
      ? (finishedRuns.filter((run) => run.error === null).length / finishedRuns.length) * 100
      : null;
    const timeSavedMinutes = allRuns.length > 0
      ? allRuns.reduce((total, run) => {
          const automation = mockAutomations.find((a) => mockAutomationRuns.get(a.id)?.includes(run));
          return total + (automation?.estimated_minutes_saved ?? 0);
        }, 0)
      : null;
    return HttpResponse.json({
      active_count: activeCount,
      active_delta_month: null,
      runs_today: runsToday,
      runs_today_delta: null,
      success_rate: successRate,
      success_delta_week: null,
      time_saved_minutes: timeSavedMinutes,
    });
  }),

  http.post('/automations/:id/run', ({ params }) => {
    const id = String(params.id);
    const automation = mockAutomations.find((a) => a.id === id);
    if (!automation) {
      return HttpResponse.json({ error: 'Automação não encontrada.' }, { status: 404 });
    }
    const run = {
      id: `run-${Date.now()}`,
      status: 'queued',
      error: null,
      started_at: new Date().toISOString(),
      completed_at: null,
    };
    const runs = mockAutomationRuns.get(id) ?? [];
    runs.unshift(run);
    mockAutomationRuns.set(id, runs);
    return HttpResponse.json({ status: 'queued' }, { status: 202 });
  }),

  http.patch('/automations/:id', async ({ request, params }) => {
    const id = String(params.id);
    const automation = mockAutomations.find((a) => a.id === id);
    if (!automation) {
      return HttpResponse.json({ error: 'Automação não encontrada.' }, { status: 404 });
    }
    const body = (await request.json()) as UpdateAutomationRequestWire;
    if (body.name !== undefined) automation.name = body.name;
    if (body.prompt !== undefined) automation.prompt = body.prompt;
    if (body.agent !== undefined) automation.agent = body.agent;
    if (body.client_id !== undefined) automation.client_id = body.client_id;
    if (body.enabled !== undefined) automation.enabled = body.enabled;
    if (body.schedule !== undefined) automation.schedule = body.schedule;
    if (body.schedule_label !== undefined) automation.schedule_label = body.schedule_label;
    if (body.estimated_minutes_saved !== undefined) automation.estimated_minutes_saved = body.estimated_minutes_saved;
    return HttpResponse.json(automation);
  }),

  http.delete('/automations/:id', ({ params }) => {
    const id = String(params.id);
    const index = mockAutomations.findIndex((a) => a.id === id);
    if (index === -1) {
      return HttpResponse.json({ error: 'Automação não encontrada.' }, { status: 404 });
    }
    mockAutomations.splice(index, 1);
    mockAutomationRuns.delete(id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/automations/:id/runs', ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json({ runs: mockAutomationRuns.get(id) ?? [] });
  }),

  http.get('/tool-calls', () => {
    return HttpResponse.json({ tool_calls: mockToolCalls });
  }),

  http.post('/tool-calls/:id/approve', ({ params }) => {
    const id = String(params.id);
    const index = mockToolCalls.findIndex((call) => call.id === id);
    if (index === -1) {
      return HttpResponse.json({ error: 'Tool call já aprovada ou não encontrada.' }, { status: 409 });
    }
    const [approved] = mockToolCalls.splice(index, 1);
    return HttpResponse.json({ id: approved!.id, tool: approved!.tool, status: 'completed' });
  }),

  // INBOX (P1-A/C, 06/10/2026). O adapter real de WhatsApp está
  // BLOCKED_EXTERNAL (sem credencial de instância Evolution nesta sessão) —
  // isto é fixture de dev, nunca produção (NEXT_PUBLIC_API_MODE=live não
  // passa por aqui).
  http.get('/inbox/threads', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const assigned = url.searchParams.get('assigned');
    let threads = mockInboxThreads;
    if (status) threads = threads.filter((t) => t.status === status);
    if (assigned === 'unassigned') threads = threads.filter((t) => !t.assigned_to_user_id);
    if (assigned === 'me') threads = threads.filter((t) => t.assigned_to_user_id === mockMe.id);
    return HttpResponse.json({ threads: [...threads].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')) });
  }),

  http.get('/inbox/threads/:id', ({ params }) => {
    const thread = mockInboxThreads.find((t) => t.id === params.id);
    if (!thread) return HttpResponse.json({ error: 'Thread not found' }, { status: 404 });
    return HttpResponse.json(thread);
  }),

  http.get('/inbox/threads/:id/messages', ({ params }) => {
    return HttpResponse.json({ messages: mockInboxMessages[String(params.id)] ?? [] });
  }),

  http.post('/inbox/threads/:id/messages', async ({ params, request }) => {
    const threadId = String(params.id);
    const thread = mockInboxThreads.find((t) => t.id === threadId);
    if (!thread) return HttpResponse.json({ error: 'Thread not found' }, { status: 404 });
    const body = (await request.json()) as { text: string };
    const mensagem = {
      id: nextInboxMessageId(),
      direction: 'outbound' as const,
      sender_contact_id: null,
      sender_user_id: mockMe.id,
      content: body.text,
      attachment_url: null,
      delivery_status: 'sent',
      created_at: new Date().toISOString(),
    };
    addInboxMessage(threadId, mensagem);
    return HttpResponse.json(mensagem, { status: 201 });
  }),

  http.patch('/inbox/threads/:id/assign', async ({ params, request }) => {
    const thread = mockInboxThreads.find((t) => t.id === params.id);
    if (!thread) return HttpResponse.json({ error: 'Thread not found' }, { status: 404 });
    const body = (await request.json()) as { userId: string | null };
    thread.assigned_to_user_id = body.userId;
    return HttpResponse.json({ id: thread.id, assigned_to_user_id: thread.assigned_to_user_id });
  }),

  // DEMAND / BRIEF / APPROVAL (P1-D/E/F/G/I, 06/10/2026) — core workflow.
  http.get('/demands', ({ request }) => {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId');
    const status = url.searchParams.get('status');
    const ownerId = url.searchParams.get('ownerId');
    let demands = mockDemands;
    if (clientId) demands = demands.filter((d) => d.client_id === clientId);
    if (status) demands = demands.filter((d) => d.status === status);
    if (ownerId) demands = demands.filter((d) => d.owner_id === ownerId);
    return HttpResponse.json({ demands });
  }),

  http.get('/demands/:id', ({ params }) => {
    const demand = mockDemands.find((d) => d.id === params.id);
    if (!demand) return HttpResponse.json({ error: 'Demand not found' }, { status: 404 });
    return HttpResponse.json(demand);
  }),

  http.post('/demands', async ({ request }) => {
    const body = (await request.json()) as { clientId: string; title: string; description?: string | null; source: string; conversationThreadId?: string | null };
    const client = mockClients.find((c) => c.id === body.clientId);
    const demand = {
      id: nextMockId('demand'),
      client_id: body.clientId,
      client_name: client?.name ?? null,
      owner_id: mockMe.id,
      title: body.title,
      description: body.description ?? null,
      source: body.source as 'whatsapp' | 'manual' | 'bento',
      status: 'new' as const,
      priority: 'normal' as const,
      requested_at: new Date().toISOString(),
      due_date: null,
      clickup_task_url: null,
    };
    mockDemands.unshift(demand);
    return HttpResponse.json(demand, { status: 201 });
  }),

  http.patch('/demands/:id/status', async ({ params, request }) => {
    const demand = mockDemands.find((d) => d.id === params.id);
    if (!demand) return HttpResponse.json({ error: 'Demand not found' }, { status: 404 });
    const body = (await request.json()) as { status: typeof demand.status };
    demand.status = body.status;
    return HttpResponse.json(demand);
  }),

  http.post('/briefs', async ({ request }) => {
    const body = (await request.json()) as { demandId: string; content: Record<string, unknown> };
    const briefId = nextMockId('brief');
    const brief = { id: briefId, client_id: mockDemands.find((d) => d.id === body.demandId)?.client_id ?? '', demand_id: body.demandId, status: 'draft' as const, approved_version_id: null, external_task_id: null, external_task_provider: null };
    mockBriefs[briefId] = brief;
    mockBriefVersions[briefId] = [{ id: nextMockId('version'), brief_id: briefId, version: 1, content: body.content, source: 'human_edit', created_at: new Date().toISOString() }];
    return HttpResponse.json(brief, { status: 201 });
  }),

  http.get('/demands/:id/briefs', ({ params }) => {
    const briefs = Object.values(mockBriefs).filter((b) => b.demand_id === params.id);
    return HttpResponse.json({ briefs });
  }),

  http.post('/demands/:id/draft-brief', ({ params }) => {
    const demand = mockDemands.find((d) => d.id === params.id);
    if (!demand) return HttpResponse.json({ error: 'Demand not found' }, { status: 404 });
    const briefId = nextMockId('brief');
    const draftVersion = { id: nextMockId('version'), brief_id: briefId, version: 1, content: { notes: demand.description ?? '(sem conversa vinculada nesta fixture)' }, source: 'ai_draft' as const, created_at: new Date().toISOString() };
    const brief = { id: briefId, client_id: demand.client_id, demand_id: demand.id, status: 'draft' as const, approved_version_id: null, external_task_id: null, external_task_provider: null };
    mockBriefs[briefId] = brief;
    mockBriefVersions[briefId] = [draftVersion];
    return HttpResponse.json({ ...brief, draft_version: draftVersion }, { status: 201 });
  }),

  http.get('/briefs/:id', ({ params }) => {
    const brief = mockBriefs[String(params.id)];
    if (!brief) return HttpResponse.json({ error: 'Brief not found' }, { status: 404 });
    return HttpResponse.json({ ...brief, versions: mockBriefVersions[brief.id] ?? [] });
  }),

  http.post('/briefs/:id/versions', async ({ params, request }) => {
    const brief = mockBriefs[String(params.id)];
    if (!brief) return HttpResponse.json({ error: 'Brief not found' }, { status: 404 });
    const body = (await request.json()) as { content: Record<string, unknown> };
    const versoes = mockBriefVersions[brief.id] ?? [];
    const nova = { id: nextMockId('version'), brief_id: brief.id, version: versoes.length + 1, content: body.content, source: 'human_edit' as const, created_at: new Date().toISOString() };
    mockBriefVersions[brief.id] = [...versoes, nova];
    return HttpResponse.json(nova, { status: 201 });
  }),

  http.patch('/briefs/:id/approve-version', async ({ params, request }) => {
    const brief = mockBriefs[String(params.id)];
    if (!brief) return HttpResponse.json({ error: 'Brief not found' }, { status: 404 });
    const body = (await request.json()) as { versionId: string };
    brief.approved_version_id = body.versionId;
    brief.status = 'approved';
    return HttpResponse.json(brief);
  }),

  http.post('/briefs/:id/send-to-production', ({ params }) => {
    const brief = mockBriefs[String(params.id)];
    if (!brief) return HttpResponse.json({ error: 'Brief not found' }, { status: 404 });
    if (!brief.approved_version_id) return HttpResponse.json({ error: 'Brief has no approved version yet.' }, { status: 409 });
    brief.status = 'sent_to_production';
    brief.external_task_id = `clickup-mock-${brief.id}`;
    brief.external_task_provider = 'clickup';
    const demand = mockDemands.find((d) => d.id === brief.demand_id);
    if (demand) demand.status = 'in_production';
    return HttpResponse.json(brief);
  }),

  http.get('/approvals', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let approvals = mockApprovals;
    if (status) approvals = approvals.filter((a) => a.status === status);
    return HttpResponse.json({ approvals });
  }),

  http.post('/approvals', async ({ request }) => {
    const body = (await request.json()) as { clientId?: string | null; resourceType: string; resourceId: string };
    const approval = {
      id: nextMockId('approval'),
      client_id: body.clientId ?? null,
      resource_type: body.resourceType as 'brief',
      resource_id: body.resourceId,
      version: null,
      requested_by: mockMe.id,
      approver_id: null,
      status: 'pending' as const,
      comment: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };
    mockApprovals.unshift(approval);
    return HttpResponse.json(approval, { status: 201 });
  }),

  http.patch('/approvals/:id', async ({ params, request }) => {
    const approval = mockApprovals.find((a) => a.id === params.id);
    if (!approval) return HttpResponse.json({ error: 'Approval not found' }, { status: 404 });
    if (approval.resolved_at) return HttpResponse.json({ error: 'Already resolved' }, { status: 409 });
    const body = (await request.json()) as { status: 'approved' | 'rejected' | 'changes_requested'; comment?: string };
    approval.status = body.status;
    approval.comment = body.comment ?? null;
    approval.approver_id = mockMe.id;
    approval.resolved_at = new Date().toISOString();
    return HttpResponse.json(approval);
  }),

  // Control Plane (demo "dia real de operação", 07/10/2026) — /panorama,
  // /agency-control-center, /mcp/status e /signals nunca tiveram handler de
  // mock, então a home (`Visão geral`) sempre mostrou "não consegui montar" em
  // modo mock. Números coerentes com o resto da demo (mockDemands/mockApprovals/mockClients).
  http.get('/panorama', () => {
    return HttpResponse.json({
      carteira: { clientes: mockClients.filter((c) => c.natureza === 'CLIENTE').length, internos: 0 },
      equipe: { pessoas: mockTeamMembers.length, usando: mockTeamMembers.length, sem_clickup: 0 },
      inteligencia: {
        pedidos_30d: 212,
        por_agente: [
          { agente: 'bento', total: 148 },
          { agente: 'jarbas', total: 41 },
          { agente: 'otto', total: 23 },
        ],
        serie_14d: Array.from({ length: 14 }, (_, i) => {
          const total = 8 + ((i * 3) % 11);
          return { dia: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10), total, ok: total - (i % 2), falhou: i % 2 };
        }),
        taxa_de_falha_14d: 0.04,
      },
      conhecimento: { memorias: 86 },
      atencao: { sinais_abertos: 2 },
      gerado_em: new Date().toISOString(),
    });
  }),

  http.get('/agency-control-center', () => {
    const pendentes = mockDemands.filter((d) => d.status !== 'done' && d.status !== 'cancelled');
    const atrasadas = pendentes.filter((d) => d.due_date !== null && new Date(d.due_date).getTime() < Date.now());
    return HttpResponse.json({
      kpis: {
        clientes_ativos: mockClients.filter((c) => c.status === 'active').length,
        conversas_aguardando: 2,
        demandas_abertas: pendentes.length,
        atrasados: atrasadas.length,
        aguardando_aprovacao: mockApprovals.filter((a) => a.status === 'pending').length,
        previstas_hoje: 4,
      },
      funil_de_workflow: {
        novas: mockDemands.filter((d) => d.status === 'new').length,
        briefing: mockDemands.filter((d) => d.status === 'briefing').length,
        producao: mockDemands.filter((d) => d.status === 'in_production').length,
        revisao: 0,
        aprovacao: mockApprovals.filter((a) => a.status === 'pending').length,
        concluido: mockDemands.filter((d) => d.status === 'done').length,
      },
      clientes_em_atencao: [
        { client_id: 'client-cosentino', client_name: 'Cosentino', responsavel: 'Pedro Gabriel', demandas_atrasadas: 0, aprovacoes_pendentes: 1 },
        { client_id: 'client-g4-educacao', client_name: 'G4 Educação', responsavel: 'Pedro Gabriel', demandas_atrasadas: 0, aprovacoes_pendentes: 1 },
      ],
      operacao_por_colaborador: mockTeamMembers.map((m) => ({
        id: m.id,
        name: m.name,
        clientes: m.id === 'user-admin-master' ? 4 : 2,
        em_andamento: m.id === 'user-admin-master' ? 5 : 2,
        atrasados: m.id === 'user-admin-master' ? 2 : 0,
        aprovacoes_pendentes: m.id === 'user-admin-master' ? 1 : 0,
      })),
      media_summary: { clientes_com_meta_conectado: 3, clientes_com_google_ads_conectado: 2, performance_agregada_disponivel: false },
      clickup_summary: {
        total_tarefas: mockAgencyTasks.length,
        abertas: mockAgencyTasks.filter((t) => t.status_type !== 'closed').length,
        atrasadas: mockAgencyTasks.filter((t) => t.due_date !== null && t.due_date < Date.now() && t.status_type !== 'closed').length,
        por_status: Object.entries(
          mockAgencyTasks.reduce<Record<string, number>>((acc, t) => {
            const chave = t.status ?? 'sem status';
            acc[chave] = (acc[chave] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([status, total]) => ({ status, total })),
      },
      integration_health: {
        clickup: { status: 'ok', last_event_at: new Date(Date.now() - 20 * 60_000).toISOString() },
        whatsapp: { status: 'ok' },
        meta: { status: 'ok', collaborator_connections: 1 },
        google_ads: { status: 'ok', collaborator_connections: 1 },
        calendar: { status: 'nao_implementado' },
      },
      gerado_em: new Date().toISOString(),
    });
  }),

  // Mídia (demo "dia real de operação", 07/10/2026) — Meta/Google Ads por
  // colaborador, conectadas nesta demo pra "Integrações" não mostrar tudo
  // cinza (regra #83 do briefing: zero integração fake apresentada como
  // real, mas aqui É pra parecer um dia normal de agência conectada).
  http.get('/integrations/meta/status', () => {
    return HttpResponse.json({ connected: true, configured: true, connected_at: new Date(Date.now() - 12 * 86_400_000).toISOString() });
  }),

  http.get('/integrations/google-ads/status', () => {
    return HttpResponse.json({ connected: true, configured: true, connected_at: new Date(Date.now() - 30 * 86_400_000).toISOString() });
  }),

  http.get('/mcp/status', () => {
    return HttpResponse.json({
      endpoint: 'https://mcp.desigual-os.com/sse',
      base: 'https://mcp.desigual-os.com',
      conexoes_vivas: 1,
      pessoas_conectadas: 1,
      pessoas: [{ user_id: mockMe.id, nome: mockMe.name, scopes: ['clients:read', 'demands:read'], conexoes: 1, desde: new Date(Date.now() - 3 * 3_600_000).toISOString() }],
      chamadas_24h: 37,
      sucessos_24h: 35,
      por_ferramenta: [
        { tool: 'get_demands', total: 14, sucesso: 14 },
        { tool: 'get_clients', total: 11, sucesso: 10 },
        { tool: 'get_pending_business_approvals', total: 12, sucesso: 11 },
      ],
      conexoes_recentes: [
        { id: 'mcp-conn-1', session_id: 'sess-1', user_id: mockMe.id, nome: mockMe.name, summary: 'Sessão do Claude Code', at: new Date(Date.now() - 3 * 3_600_000).toISOString(), scopes: ['clients:read'], chamadas_24h: 37, conexao_viva: true },
      ],
      ultimas: [
        { tool: 'get_demands', result: 'ok', user_name: mockMe.name, client_id: 'client-cosentino', request_id: 'req-1', at: new Date(Date.now() - 5 * 60_000).toISOString() },
      ],
    });
  }),

  http.get('/signals', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? 'open';
    const signals = [
      {
        id: 'signal-1',
        rule: 'demanda_parada',
        agent: 'bento',
        severity: 'medium' as const,
        title: 'Demanda sem movimento há 2 dias',
        body: '"Mídia Patrocinada" da Cosentino está em briefing sem atualização.',
        recommended_action: 'Confirmar com o time de tráfego se o planejamento já começou.',
        client_id: 'client-cosentino',
        client_name: 'Cosentino',
        entity: 'demand-midia-patrocinada',
        confidence: 0.8,
        status: 'open',
        created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      },
      {
        id: 'signal-2',
        rule: 'aprovacao_proxima_do_prazo',
        agent: 'jarbas',
        severity: 'high' as const,
        title: 'Aprovação de campanha vence em breve',
        body: 'A campanha de outubro da Cosentino está aguardando aprovação há mais de 2h.',
        recommended_action: 'Avisar o responsável para revisar hoje.',
        client_id: 'client-cosentino',
        client_name: 'Cosentino',
        entity: 'approval-campanha-outubro',
        confidence: 0.72,
        status: 'open',
        created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      },
    ].filter((s) => (status === 'all' ? true : s.status === status));
    return HttpResponse.json({ total: signals.length, mostrando: signals.length, signals });
  }),

  // Google Calendar + Notion + Consentimento + Motion providers (demo
  // "dia real de operação", 07/10/2026) — nenhum tinha handler de mock, então
  // essas seções de /calendar e /integrations sempre mostravam "não consegui
  // carregar". Google Calendar e consentimento aparecem CONECTADOS (coerente
  // com o resto da demo); Notion e os provedores de motion aparecem
  // honestamente desconectados — não fazem parte da história de hoje.
  http.get('/integrations/google-calendar/status', () => {
    return HttpResponse.json({ connected: true, configured: true, connected_at: new Date(Date.now() - 45 * 86_400_000).toISOString() });
  }),

  http.get('/calendar/google/accounts', () => {
    return HttpResponse.json({
      accounts: [
        { id: 'gcal-pedro', external_calendar_id: 'pedro@desigual.com.br', is_primary: true, connected: true, last_synced_at: new Date(Date.now() - 15 * 60_000).toISOString() },
      ],
    });
  }),

  // Microsoft/Outlook Calendar (07/10/2026) — é o provider que a operação
  // usa de verdade; aparece CONECTADO no mock pelo mesmo motivo do Google
  // acima (coerência com a demo "dia real de operação").
  http.get('/integrations/microsoft-calendar/status', () => {
    return HttpResponse.json({ connected: true, configured: true, connected_at: new Date(Date.now() - 45 * 86_400_000).toISOString() });
  }),

  http.get('/calendar/microsoft/accounts', () => {
    return HttpResponse.json({
      accounts: [
        { id: 'mscal-pedro', external_calendar_id: 'pedro@agenciadesigual.com.br', is_primary: true, connected: true, last_synced_at: new Date(Date.now() - 15 * 60_000).toISOString() },
      ],
    });
  }),

  http.get('/integrations/notion/status', () => {
    return HttpResponse.json({ connected: false, configured: true, workspace_name: null, connected_at: null, destinos: [] });
  }),

  http.get('/consent/fontes', () => {
    return HttpResponse.json({
      fontes: [
        { id: 'whatsapp', nome: 'WhatsApp', permite: ['Ler e responder conversas de clientes', 'Anexar arquivos recebidos'] },
        { id: 'clickup', nome: 'ClickUp', permite: ['Ler tarefas, prazos e responsáveis', 'Atualizar status ao mover um cartão de pipeline'] },
        { id: 'meta_ads', nome: 'Meta Ads', permite: ['Ler campanhas e métricas de Instagram/Facebook dos clientes conectados'] },
        { id: 'google_ads', nome: 'Google Ads', permite: ['Ler campanhas e métricas de busca/display dos clientes conectados'] },
        { id: 'google_calendar', nome: 'Google Calendar', permite: ['Ler e criar eventos na agenda conectada'] },
      ],
      nao_faz: ['Ler conversas privadas do Claude', 'Enviar mensagem sem uma pessoa confirmar', 'Compartilhar dado de um cliente com outro'],
    });
  }),

  http.get('/consent', () => {
    return HttpResponse.json({
      consentimentos: [
        {
          id: 'consent-1',
          quando: new Date(Date.now() - 45 * 86_400_000).toISOString(),
          quem: mockMe.name,
          fontes: ['whatsapp', 'clickup', 'meta_ads', 'google_ads', 'google_calendar'],
          texto_apresentado: 'Autorizo o Desigual OS a conectar e usar: WhatsApp, ClickUp, Meta Ads, Google Ads, Google Calendar.',
        },
      ],
    });
  }),

  http.post('/consent', async ({ request }) => {
    const body = (await request.json()) as { fontes: string[]; texto_apresentado: string };
    return HttpResponse.json({ id: `consent-${Date.now()}`, quando: new Date().toISOString() });
  }),

  // /activity (demo "dia real de operação", 07/10/2026) — nunca teve handler
  // de mock, então "Na operação" em /activity sempre mostrava "não consegui
  // ler". task_name/changes preenchidos de propósito: sem isso a frase cai
  // no fallback pobre "Atualizou uma tarefa" (ver apresentacao/atividade.ts).
  http.get('/activity', ({ request }) => {
    const url = new URL(request.url);
    const limite = Number(url.searchParams.get('limit') ?? 50);
    const clientId = url.searchParams.get('client_id');
    const source = url.searchParams.get('source');
    const eventosBase = [
      { id: 'act-1', source: 'clickup', type: 'task.updated', client_id: 'client-cosentino', client_name: 'Cosentino', actor: 'Pedro Gabriel', occurred_at: new Date(Date.now() - 18 * 60_000).toISOString(), payload: { task_name: 'Responder cliente Cosentino', changes: [{ rotulo: 'status', de: 'Para fazer', para: 'Em produção' }] } },
      { id: 'act-2', source: 'clickup', type: 'task.created', client_id: 'client-g4-educacao', client_name: 'G4 Educação', actor: null, occurred_at: new Date(Date.now() - 42 * 60_000).toISOString(), payload: { task_name: 'Enviar proposta, G4' } },
      { id: 'act-3', source: 'chat', type: 'CLIENT_DECISION', client_id: 'client-clinica-bela', client_name: 'Clínica Belá', actor: 'Pedro Gabriel', occurred_at: new Date(Date.now() - 3_600_000).toISOString(), payload: { summary: 'Decidido: campanha semanal recorrente, sem revisão prévia de copy.' } },
      { id: 'act-4', source: 'clickup', type: 'task.updated', client_id: 'client-autovisual', client_name: 'Autovisual', actor: null, occurred_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), payload: { task_name: 'Confirmar cronograma de vídeos, Autovisual', changes: [{ rotulo: 'prazo', para: '07/10' }] } },
      { id: 'act-5', source: 'mcp', type: 'CONNECTION_CREATED', client_id: null, client_name: null, actor: null, occurred_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), payload: {} },
      { id: 'act-6', source: 'clickup', type: 'task.updated', client_id: 'client-cosentino', client_name: 'Cosentino', actor: 'Pedro Gabriel', occurred_at: new Date(Date.now() - 18 * 3_600_000).toISOString(), payload: { task_name: 'Confirmar cronograma de vídeos', changes: [{ rotulo: 'status', de: 'Para fazer', para: 'Concluído' }] } },
    ].filter((e) => (clientId ? e.client_id === clientId : true)).filter((e) => (source ? e.source === source : true));
    return HttpResponse.json({
      events: eventosBase.slice(0, limite),
      sources: [
        { source: 'clickup', total: eventosBase.filter((e) => e.source === 'clickup').length },
        { source: 'chat', total: eventosBase.filter((e) => e.source === 'chat').length },
        { source: 'mcp', total: eventosBase.filter((e) => e.source === 'mcp').length },
      ],
      organizacao: { id: 'org-desigual', name: 'Desigual' },
    });
  }),

  http.get('/motion/providers', () => {
    const base = { remedy: 'Conecte em Configurações → Motion.', account: null, model: null, motionCapable: false, details: {}, checkedAt: new Date().toISOString() };
    return HttpResponse.json({
      providers: [
        { ...base, provider: 'claude' as const, state: 'disconnected', message: 'Claude não conectado ainda.' },
        { ...base, provider: 'chatgpt' as const, state: 'disconnected', message: 'ChatGPT não conectado ainda.' },
      ],
    });
  }),
];
