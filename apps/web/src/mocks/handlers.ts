import { HttpResponse, http } from 'msw';
import type { AgentName } from '@desigual-os/types';
import type {
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
import { mockClickUpByUserId, mockLastSeenByUserId, mockTeamMembers } from './team';
import { createMessage, getThreadPrefs, listThreadMessages, listThreadPartnerIds, markThreadRead, updateThreadPrefs } from './messages';
import { inviteMockUser, mockAdminUsers, USERS_WITH_HISTORY } from './admin';
import { mockToolCalls } from './tool-calls';

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

const mockClickUpConnection: ClickUpIntegrationStatusWire = {
  connected: false,
  configured: true,
  workspace_id: null,
  workspace_name: null,
  last_synced_at: null,
  connected_at: null,
};

const mockMe: MeResponse = {
  id: 'user-admin-master',
  email: 'admin@institutoalmada.com.br',
  name: 'Instituto Almada',
  roles: ['master'],
  permissions: [
    { resource: '*', action: '*' },
  ],
  avatarUrl: null,
  language: 'pt-BR',
  theme: 'system',
  clickupEmail: null,
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
      clickupListId: null,
      clickupUrl: null,
      projectId: null,
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

  http.get('/clients/:clientId/clickup/tasks', ({ params }) => {
    const client = mockClients.find((c) => c.id === String(params.clientId));
    if (!client) return HttpResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    if (!client.clickupListId) {
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
          url: client.clickupUrl, due_date: null, assignees: [pessoa(1, 'Endrigo Almada', 'EA', '#7C3AED')] },
        { ...base, id: 'cu-2', name: 'Revisar copy do carrossel', status: 'em andamento',
          status_color: '#E1F900', url: client.clickupUrl, due_date: null,
          assignees: [pessoa(2, 'Bento Desigual', 'BD', '#0f9d9f')] },
        { ...base, id: 'cu-3', name: 'Subir relatório mensal', status: 'aberto',
          url: client.clickupUrl, due_date: null, assignees: [] },
      ],
    });
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
    // Sem redirect real: devolve a própria tela de settings com o mesmo
    // parâmetro que o callback verdadeiro usaria.
    return HttpResponse.json({ authorize_url: '/settings?clickup=conectado' });
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
];
