/**
 * Shared source of truth for API request/response shapes.
 * Mirrors brain/06 - Contratos de API.md (source of truth agreed with the backend team).
 * Extended incrementally per build phase, not all at once: see docs/api-gaps.md for anything
 * a screen needs that is not yet covered here or on the backend.
 */
import {
  AGENT_NAMES,
  NODE_STATUSES,
  ROLE_NAMES,
  STUDIO_JOB_TYPES,
  type AgentName,
  type ExecutionStatus,
  type NodeStatus,
  type NodeType,
  type QueuePriority,
  type RoleName,
  type StudioJobType,
} from '@desigual-os/types';

export type ISODateString = string;

/** Agent selection as exposed in the UI: the four real agents plus the AUTO router. */
export const AGENT_SELECTIONS = ['auto', ...AGENT_NAMES] as const;
export type AgentSelection = (typeof AGENT_SELECTIONS)[number];

/**
 * Confirmed by the backend team (2026-09-01): `{ error: string }` on every route, no
 * exceptions, `{ message, code }` never happens. Validation failures (Zod) are always
 * `400 { error: "Validation failed", details: [{ path, message }] }`.
 */
export interface ApiError {
  error: string;
  details?: Array<{ path: string; message: string }>;
}

/** GET /me. Confirmed contract from the backend team, auth via Supabase access token. */
export interface Permission {
  resource: string;
  action: string;
}

export const LANGUAGES = ['pt-BR', 'en-US', 'es-ES'] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * GET /me is camelCase for avatarUrl/language/theme/clickupEmail, confirmed by the backend
 * (2026-09-01) — inconsistent with PATCH /me's snake_case response below, a known wart on
 * their side, not a frontend mapping bug.
 */
export interface MeResponse {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: Permission[];
  avatarUrl: string | null;
  language: Language;
  theme: Theme;
  clickupEmail: string | null;
}

/** PATCH /me. Snake_case request and response, confirmed by the backend (2026-09-01). */
export interface UpdateMeRequestWire {
  clickup_email?: string | null | undefined;
  name?: string | undefined;
  language?: Language | undefined;
  theme?: Theme | undefined;
}

export interface UpdateMeResponseWire {
  id: string;
  email: string;
  name: string;
  clickup_email: string | null;
  language: Language;
  theme: Theme;
  avatar_url: string | null;
}

/** POST /me/avatar. multipart/form-data, single `file` field, image/png|jpeg|webp, 25MB cap. */
export interface UpdateAvatarResponseWire {
  id: string;
  avatar_url: string;
}

/**
 * GET /health/infrastructure. Confirmed contract from the backend team (2026-09-01),
 * real endpoint since their Fase 03. The API is snake_case throughout; wire types below
 * mirror the JSON exactly, mapped to camelCase domain types via mapInfrastructureHealth.
 *
 */
export interface NodeSummaryWire {
  node_id: string;
  agent: AgentName;
  type: NodeType;
  status: NodeStatus;
  last_heartbeat_at: ISODateString;
  cpu: number;
  ram: number;
  disk: number;
  latency_ms: number;
  gpu: number | null;
  vram: number | null;
  temperature: number | null;
  queue_depth: number | null;
}

export interface InfrastructureHealthWire {
  total_nodes: number;
  summary: Partial<Record<NodeStatus, number>>;
  all_systems_online: boolean;
  overall_health_percent: number;
  agents_connected: { online: number; total: number };
  last_backup_at: ISODateString | null;
  nodes: NodeSummaryWire[];
}

export interface NodeSummary {
  nodeId: string;
  agent: AgentName;
  type: NodeType;
  status: NodeStatus;
  lastHeartbeatAt: ISODateString;
  cpuPercent: number;
  ramPercent: number;
  diskPercent: number;
  latencyMs: number;
  gpuPercent: number | null;
  vramPercent: number | null;
  temperatureCelsius: number | null;
  queueDepth: number | null;
}

export interface InfrastructureHealth {
  totalNodes: number;
  statusSummary: Partial<Record<NodeStatus, number>>;
  allSystemsOnline: boolean;
  overallHealthPercent: number;
  agentsConnected: { online: number; total: number };
  lastBackupAt: ISODateString | null;
  nodes: NodeSummary[];
}

export function mapInfrastructureHealth(wire: InfrastructureHealthWire): InfrastructureHealth {
  return {
    totalNodes: wire.total_nodes,
    statusSummary: wire.summary,
    allSystemsOnline: wire.all_systems_online,
    overallHealthPercent: wire.overall_health_percent,
    agentsConnected: wire.agents_connected,
    lastBackupAt: wire.last_backup_at,
    nodes: wire.nodes.map((node) => ({
      nodeId: node.node_id,
      agent: node.agent,
      type: node.type,
      status: node.status,
      lastHeartbeatAt: node.last_heartbeat_at,
      cpuPercent: node.cpu,
      ramPercent: node.ram,
      diskPercent: node.disk,
      latencyMs: node.latency_ms,
      gpuPercent: node.gpu,
      vramPercent: node.vram,
      temperatureCelsius: node.temperature,
      queueDepth: node.queue_depth,
    })),
  };
}

export const NODE_STATUS_VALUES = NODE_STATUSES;

/** POST /health/sync — sonda ao vivo dos agentes + diagnóstico. */
export interface AgentSyncServiceWire {
  name: string;
  ok: boolean;
  http_status: number | null;
  error: string | null;
}

export interface AgentSyncAgentWire {
  agent: string;
  node_id: string;
  label: string;
  status: 'online' | 'degraded' | 'offline';
  latency_ms: number;
  services: AgentSyncServiceWire[];
  metrics: { ram: number | null; vram: number | null; queue_depth: number | null };
}

export interface AgentSyncDiagnosisWire {
  agent: string;
  problem: string;
  suggestion: string;
  auto_fixed: boolean;
  severity: 'erro' | 'aviso';
}

export interface AgentSyncReportWire {
  ran_at: ISODateString;
  recorded: number;
  agents: AgentSyncAgentWire[];
  diagnoses: AgentSyncDiagnosisWire[];
}

/**
 * POST /chat, GET /executions, GET /executions/:id. Confirmed real, tested contracts from
 * the backend team (2026-09-01). Sending a message does not return the reply: it enqueues an
 * execution (`status: "queued"`), the actual answer arrives once the execution completes
 * (steps[].output.answer), tracked here via the mock realtime layer (src/lib/realtime).
 */
export const CHAT_AGENT_HINTS = ['AUTO', ...AGENT_NAMES.map((a) => a.toUpperCase())] as const;
export type ChatAgentHint = (typeof CHAT_AGENT_HINTS)[number];

export function agentSelectionToHint(selection: AgentSelection): ChatAgentHint {
  return selection.toUpperCase() as ChatAgentHint;
}

export interface ChatRequestWire {
  message: string;
  client_id: string | null;
  conversation_id?: string;
  agent_hint: ChatAgentHint;
}

export interface ChatResponseWire {
  execution_id: string;
  status: Extract<ExecutionStatus, 'queued'>;
  agent: AgentName;
  conversation_id: string;
}

export interface ChatResponse {
  executionId: string;
  status: Extract<ExecutionStatus, 'queued'>;
  agent: AgentName;
  conversationId: string;
}

export function mapChatResponse(wire: ChatResponseWire): ChatResponse {
  return {
    executionId: wire.execution_id,
    status: wire.status,
    agent: wire.agent,
    conversationId: wire.conversation_id,
  };
}

/** Sources cited by a step's answer: plain strings (e.g. Obsidian file paths like
 * "02 - Stack Tecnologica.md"), confirmed by the backend (2026-09-01). Not an object. */
export interface ExecutionStepWire {
  step_index: number;
  agent: AgentName;
  status: ExecutionStatus;
  output: { answer: string; sources: string[] } | null;
}

export interface ExecutionListItemWire {
  execution_id: string;
  agent: AgentName;
  client_id: string | null;
  intent: string;
  status: ExecutionStatus;
  priority: QueuePriority;
  started_at: ISODateString;
  completed_at: ISODateString | null;
  tokens_input: number;
  tokens_output: number;
}

export interface ExecutionDetailWire extends ExecutionListItemWire {
  estimated_cost: number | null;
  actual_cost: number | null;
  steps: ExecutionStepWire[];
}

export interface ExecutionListItem {
  executionId: string;
  agent: AgentName;
  clientId: string | null;
  intent: string;
  status: ExecutionStatus;
  priority: QueuePriority;
  startedAt: ISODateString;
  completedAt: ISODateString | null;
  tokensInput: number;
  tokensOutput: number;
}

export interface ExecutionStep {
  stepIndex: number;
  agent: AgentName;
  status: ExecutionStatus;
  answer: string | null;
  sources: string[];
}

export interface ExecutionDetail extends ExecutionListItem {
  estimatedCost: number | null;
  actualCost: number | null;
  steps: ExecutionStep[];
}

function mapExecutionListItem(wire: ExecutionListItemWire): ExecutionListItem {
  return {
    executionId: wire.execution_id,
    agent: wire.agent,
    clientId: wire.client_id,
    intent: wire.intent,
    status: wire.status,
    priority: wire.priority,
    startedAt: wire.started_at,
    completedAt: wire.completed_at,
    tokensInput: wire.tokens_input,
    tokensOutput: wire.tokens_output,
  };
}

export function mapExecutionList(wire: { executions: ExecutionListItemWire[] }): ExecutionListItem[] {
  return wire.executions.map(mapExecutionListItem);
}

/**
 * GET /clients, GET /clients/:id, POST /clients (requires `clients:write`, master only).
 * Confirmed real by the backend (2026-09-01), replacing the earlier frontend placeholder.
 */
export interface ClientSummaryWire {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Só vem no workspace do cliente (GET /clients/:id/workspace), não na listagem. */
  clickup_list_id?: string | null;
  clickup_url?: string | null;
}

export interface ClientSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  clickupListId: string | null;
  clickupUrl: string | null;
}

export function mapClientSummary(wire: ClientSummaryWire): ClientSummary {
  return {
    id: wire.id,
    name: wire.name,
    slug: wire.slug,
    status: wire.status,
    clickupListId: wire.clickup_list_id ?? null,
    clickupUrl: wire.clickup_url ?? null,
  };
}

export function mapExecutionDetail(wire: ExecutionDetailWire): ExecutionDetail {
  return {
    ...mapExecutionListItem(wire),
    estimatedCost: wire.estimated_cost,
    actualCost: wire.actual_cost,
    steps: wire.steps.map((step) => ({
      stepIndex: step.step_index,
      agent: step.agent,
      status: step.status,
      answer: step.output?.answer ?? null,
      sources: step.output?.sources ?? [],
    })),
  };
}

/**
 * POST /studio/jobs, GET /studio/jobs/:id, GET /studio/assets. Confirmed real, tested
 * contracts from the backend team (2026-09-01), requires `studio:write` permission on
 * write. image/carousel geram de verdade via ComfyUI (nodes/studio-node); video/reels/
 * upscale ainda falham honesto (sem workflow ComfyUI conectado pra eles ainda).
 *
 * `type` is validated backend-side against `STUDIO_JOB_TYPES` from `@desigual-os/types`
 * (imported, not redeclared here). `resolution` is a free string with no fixed mapping per
 * type on the backend, the per-type default resolutions are a frontend UI decision.
 */
export { STUDIO_JOB_TYPES };
export type { StudioJobType };

export const STUDIO_JOB_STATUSES = ['queued', 'rendering', 'completed', 'failed'] as const;
export type StudioJobStatus = (typeof STUDIO_JOB_STATUSES)[number];

export const STUDIO_QUALITY_PRESETS = ['draft', 'standard', 'high'] as const;
export type StudioQualityPreset = (typeof STUDIO_QUALITY_PRESETS)[number];

export interface StudioCopySlideWire {
  headline: string;
  subtext?: string | null;
}

export interface StudioJobRequestWire {
  client_id: string;
  project_id?: string | null;
  type: StudioJobType;
  prompt?: string | null;
  resolution?: string | null;
  attachments?: StudioJobAttachmentWire[];
  /** Só carousel: quantas imagens gerar (1-10). */
  num_slides?: number;
  /** Só video/reels: guardado mesmo enquanto a geração real não está ligada. */
  duration_seconds?: number;
  quality_preset?: StudioQualityPreset;
  /** image/carousel: se deve gerar copy de marketing e sobrepor texto nas imagens. */
  include_text?: boolean;
}

export interface StudioJobCreatedWire {
  job_id: string;
  status: Extract<StudioJobStatus, 'queued'>;
}

export interface StudioJobAttachmentWire {
  filename: string;
  url: string;
  contentType: string;
}

export interface StudioJobDetailWire {
  job_id: string;
  status: StudioJobStatus;
  progress: number;
  type: StudioJobType;
  prompt: string;
  resolution: string;
  /** Motivo da falha em linguagem de gente. Null quando não falhou. */
  error?: string | null;
  attachments?: StudioJobAttachmentWire[];
  asset_url: string | null;
  /** Carousel com mais de um asset (slides ligados por job_id). */
  asset_urls?: string[] | null;
  /** Legenda do post, gerada pelo passo de copy de marketing. */
  caption?: string | null;
}

export interface StudioJobDetail {
  jobId: string;
  status: StudioJobStatus;
  progress: number;
  type: StudioJobType;
  prompt: string;
  resolution: string;
  error: string | null;
  attachments: StudioJobAttachmentWire[];
  assetUrl: string | null;
  assetUrls: string[] | null;
  caption: string | null;
}

export function mapStudioJobDetail(wire: StudioJobDetailWire): StudioJobDetail {
  return {
    jobId: wire.job_id,
    status: wire.status,
    progress: wire.progress,
    type: wire.type,
    prompt: wire.prompt,
    resolution: wire.resolution,
    error: wire.error ?? null,
    attachments: wire.attachments ?? [],
    assetUrl: wire.asset_url,
    assetUrls: wire.asset_urls ?? null,
    caption: wire.caption ?? null,
  };
}

/** GET /studio/jobs (sem :id) -- os jobs do PRÓPRIO usuário logado, usado pra
 * restaurar "meus jobs em andamento" ao reabrir o Studio (ver StudioContent). */
export interface StudioJobSummaryWire {
  job_id: string;
  status: StudioJobStatus;
  progress: number;
  type: StudioJobType;
  prompt: string | null;
  resolution: string | null;
}

export interface StudioAssetWire {
  id: string;
  client_id: string;
  project_id?: string | null;
  type: StudioJobType;
  filename: string;
  storage_url: string;
  prompt: string;
  /** Checkpoint/modelo que gerou de fato — o "workflow" da spec da Galeria. */
  model?: string | null;
  /** Nome de quem pediu. Null em assets anteriores ao rastreio de autor. */
  created_by?: string | null;
  /** Máquina que processou (ex: NODE_STUDIO_TEST_01). */
  node_id?: string | null;
  /** Ligação com o job que gerou este asset — mais de um asset por job_id vira um grupo (carousel). */
  job_id?: string | null;
  slide_index?: number | null;
  slides_total?: number | null;
  caption?: string | null;
  created_at: ISODateString;
}

export interface StudioAsset {
  id: string;
  clientId: string;
  projectId: string | null;
  type: StudioJobType;
  filename: string;
  storageUrl: string;
  prompt: string;
  model: string | null;
  createdBy: string | null;
  nodeId: string | null;
  jobId: string | null;
  slideIndex: number | null;
  slidesTotal: number | null;
  caption: string | null;
  createdAt: ISODateString;
}

export function mapStudioAsset(wire: StudioAssetWire): StudioAsset {
  return {
    id: wire.id,
    clientId: wire.client_id,
    projectId: wire.project_id ?? null,
    type: wire.type,
    filename: wire.filename,
    storageUrl: wire.storage_url,
    prompt: wire.prompt,
    model: wire.model ?? null,
    createdBy: wire.created_by ?? null,
    nodeId: wire.node_id ?? null,
    jobId: wire.job_id ?? null,
    slideIndex: wire.slide_index ?? null,
    slidesTotal: wire.slides_total ?? null,
    caption: wire.caption ?? null,
    createdAt: wire.created_at,
  };
}

/**
 * Integração ClickUp por colaborador (apps/api/src/integrations/routes.ts).
 * O client_secret vive SÓ no backend: o frontend nunca vê token nenhum, só
 * pede a URL de autorização e manda o browser pra lá.
 */
export interface ClickUpIntegrationStatusWire {
  connected: boolean;
  /** false = o Orchestrator não tem CLICKUP_CLIENT_ID/SECRET configurados. */
  configured: boolean;
  workspace_id?: string | null;
  workspace_name?: string | null;
  last_synced_at?: ISODateString | null;
  connected_at?: ISODateString | null;
}

/**
 * GET /clients/:id/clickup/tasks — tarefas lidas do ClickUp na hora (fonte
 * de verdade), não do espelho local.
 */
export interface ClickUpPersonWire {
  id: number;
  name: string;
  /** Foto do perfil no ClickUp. Null quando a pessoa não subiu nenhuma. */
  avatar_url: string | null;
  initials: string | null;
  color: string | null;
}

export interface ClickUpTaskWire {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  status_color: string | null;
  status_type: string | null;
  priority: string | null;
  priority_color: string | null;
  url: string | null;
  due_date: string | null;
  start_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  time_estimate_ms: number | null;
  tags: { name: string; background: string | null; foreground: string | null }[];
  assignees: ClickUpPersonWire[];
  creator: ClickUpPersonWire | null;
}

export interface ClickUpSyncResultWire {
  spaces_found: number;
  clients_created: number;
  clients_updated: number;
}

/**
 * GET /clickup/tasks/:id/comments — comentários da tarefa lidos do ClickUp na
 * hora (o "chat" da tarefa, mostrado na aba Conversas do workspace do cliente).
 * `date` vem como epoch em ms em string, que é o formato que o ClickUp devolve.
 */
export interface ClickUpCommentWire {
  id: string;
  text: string;
  user_id: number | null;
  username: string | null;
  date: string;
}

/** GET /notifications, PATCH /notifications/:id/read (apps/api/src/notifications/routes.ts).
 * `type` is a free-form string set by whoever creates the notification (e.g.
 * "studio.job.completed", "studio.job.failed") -- the UI doesn't need a closed enum for it,
 * only title/body ever render. */
export interface NotificationWire {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** Caminho interno pra onde a notificação leva (ex: "/studio?asset=<id>"). */
  link?: string | null;
  read: boolean;
  created_at: ISODateString;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: ISODateString;
}

export function mapNotification(wire: NotificationWire): Notification {
  return {
    id: wire.id,
    type: wire.type,
    title: wire.title,
    body: wire.body,
    link: wire.link ?? null,
    read: wire.read,
    createdAt: wire.created_at,
  };
}

/**
 * GET /costs/overview, /costs/by-agent, /costs/by-client, /costs/by-user. Confirmed real,
 * tested contracts from the backend team (2026-09-01). `range` is days, e.g. "7d" / "30d".
 * `total_cost_usd` is always USD (the backend's deliberate choice, matches how LLM providers
 * actually bill): converting to BRL for display, if ever wanted, is a frontend-only concern,
 * there is no exchange rate on the backend.
 */
export type CostRange = '7d' | '30d' | '90d';

export interface CostsOverviewWire {
  range_days: number;
  total_cost_usd: number;
  cost_events: number;
  total_input_tokens: number;
  total_output_tokens: number;
  note: string;
}

export interface CostsOverview {
  rangeDays: number;
  totalCostUsd: number;
  costEvents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  note: string;
}

export function mapCostsOverview(wire: CostsOverviewWire): CostsOverview {
  return {
    rangeDays: wire.range_days,
    totalCostUsd: wire.total_cost_usd,
    costEvents: wire.cost_events,
    totalInputTokens: wire.total_input_tokens,
    totalOutputTokens: wire.total_output_tokens,
    note: wire.note,
  };
}

export interface CostByAgentWire {
  agent: AgentName;
  total_cost_usd: number;
  events: number;
}

export interface CostByAgent {
  agent: AgentName;
  totalCostUsd: number;
  events: number;
}

export function mapCostsByAgent(wire: { by_agent: CostByAgentWire[] }): CostByAgent[] {
  return wire.by_agent.map((row) => ({ agent: row.agent, totalCostUsd: row.total_cost_usd, events: row.events }));
}

export interface CostByClientWire {
  client_id: string | null;
  client_name: string | null;
  total_cost_usd: number;
}

export interface CostByClient {
  clientId: string | null;
  clientName: string | null;
  totalCostUsd: number;
}

export function mapCostsByClient(wire: { by_client: CostByClientWire[] }): CostByClient[] {
  return wire.by_client.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    totalCostUsd: row.total_cost_usd,
  }));
}

export interface CostByUserWire {
  user_id: string | null;
  user_name: string | null;
  total_cost_usd: number;
}

export interface CostByUser {
  userId: string | null;
  userName: string | null;
  totalCostUsd: number;
}

export function mapCostsByUser(wire: { by_user: CostByUserWire[] }): CostByUser[] {
  return wire.by_user.map((row) => ({
    userId: row.user_id,
    userName: row.user_name,
    totalCostUsd: row.total_cost_usd,
  }));
}

/**
 * GET /conversations, GET /conversations/:id/messages. Exact shape confirmed by the backend
 * (2026-09-01). `POST /chat` also takes an optional `conversation_id` to continue a thread
 * instead of always starting a new one, and echoes it back on the response.
 */
export interface ConversationSummaryWire {
  id: string;
  client_id: string | null;
  title: string | null;
  status: string;
  last_agent: AgentName | null;
  last_message_preview: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface ConversationSummary {
  id: string;
  clientId: string | null;
  title: string | null;
  status: string;
  lastAgent: AgentName | null;
  lastMessagePreview: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export function mapConversationSummary(wire: ConversationSummaryWire): ConversationSummary {
  return {
    id: wire.id,
    clientId: wire.client_id,
    title: wire.title,
    status: wire.status,
    lastAgent: wire.last_agent,
    lastMessagePreview: wire.last_message_preview,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

export interface ConversationMessageWire {
  id: string;
  role: 'user' | 'assistant';
  agent: AgentName | null;
  content: string;
  created_at: ISODateString;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  agent: AgentName | null;
  content: string;
  createdAt: ISODateString;
}

export function mapConversationMessage(wire: ConversationMessageWire): ConversationMessage {
  return { id: wire.id, role: wire.role, agent: wire.agent, content: wire.content, createdAt: wire.created_at };
}

/**
 * GET /search?q=. Confirmed real, tested contract from the backend (2026-09-02). Plain ILIKE
 * on name, no fuzzy matching. Always all three keys present (empty arrays, not omitted), max
 * 10 rows per category.
 */
export interface SearchResultsWire {
  users: Array<{ id: string; name: string; email: string; avatar_url: string | null }>;
  clients: Array<{ id: string; name: string; slug: string }>;
  agents: Array<{ id: string; name: string; display_name: string }>;
}

export interface SearchResults {
  users: Array<{ id: string; name: string; email: string; avatarUrl: string | null }>;
  clients: Array<{ id: string; name: string; slug: string }>;
  agents: Array<{ id: string; name: string; displayName: string }>;
}

export function mapSearchResults(wire: SearchResultsWire): SearchResults {
  return {
    users: wire.users.map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url })),
    clients: wire.clients,
    agents: wire.agents.map((a) => ({ id: a.id, name: a.name, displayName: a.display_name })),
  };
}

/** GET /team/members. Confirmed real (2026-09-02), any authenticated user, no permission gate. */
export interface TeamMemberWire {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  roles: string[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roles: string[];
}

export function mapTeamMember(wire: TeamMemberWire): TeamMember {
  return { id: wire.id, name: wire.name, email: wire.email, avatarUrl: wire.avatar_url, roles: wire.roles };
}

/**
 * GET /clients/:id/workspace. Confirmed real (2026-09-02), requires clients:read; projetos
 * são compartilhados pela equipe (2026-09-03), então qualquer master/colaborador autenticado
 * passa — client_users deixou de ser um gate obrigatório aqui, ver apps/api/src/lib/access.ts.
 */
export interface ClientWorkspaceWire {
  client: ClientSummaryWire;
  conversations: Array<{ id: string; title: string | null; status: string; updated_at: ISODateString }>;
  studio_assets: Array<{ id: string; type: StudioJobType; filename: string; storage_url: string; created_at: ISODateString }>;
  executions: Array<{ id: string; execution_id: string; agent: AgentName; status: ExecutionStatus; created_at: ISODateString }>;
  cost_summary: { total_cost: number; execution_count: number };
}

export interface ClientWorkspace {
  client: ClientSummary;
  conversations: Array<{ id: string; title: string | null; status: string; updatedAt: ISODateString }>;
  studioAssets: Array<{ id: string; type: StudioJobType; filename: string; storageUrl: string; createdAt: ISODateString }>;
  executions: Array<{ id: string; executionId: string; agent: AgentName; status: ExecutionStatus; createdAt: ISODateString }>;
  costSummary: { totalCost: number; executionCount: number };
}

export function mapClientWorkspace(wire: ClientWorkspaceWire): ClientWorkspace {
  return {
    client: mapClientSummary(wire.client),
    conversations: wire.conversations.map((c) => ({ id: c.id, title: c.title, status: c.status, updatedAt: c.updated_at })),
    studioAssets: wire.studio_assets.map((a) => ({
      id: a.id,
      type: a.type,
      filename: a.filename,
      storageUrl: a.storage_url,
      createdAt: a.created_at,
    })),
    executions: wire.executions.map((e) => ({
      id: e.id,
      executionId: e.execution_id,
      agent: e.agent,
      status: e.status,
      createdAt: e.created_at,
    })),
    costSummary: { totalCost: wire.cost_summary.total_cost, executionCount: wire.cost_summary.execution_count },
  };
}

/** POST /clients/:id/access. Requires clients:write (master only in the seeded roles). */
export const CLIENT_ACCESS_ROLES = ['viewer', 'editor'] as const;
export type ClientAccessRole = (typeof CLIENT_ACCESS_ROLES)[number];

export interface GrantClientAccessRequestWire {
  email: string;
  role?: ClientAccessRole | undefined;
}

export interface GrantClientAccessResponseWire {
  client_id: string;
  user_id: string;
  role: ClientAccessRole;
}

/**
 * POST /messages, GET /messages/threads, GET /messages/:userId. Confirmed real (2026-09-02),
 * direct messages between users with optional attachment (multipart upload to Supabase
 * Storage, no mimetype whitelist unlike the avatar endpoint, 25MB cap). No WS filtering yet
 * (dm.received broadcasts to every connection), so the frontend polls like everywhere else
 * that doesn't already have realtime wired in (see docs/api-gaps.md on /ws).
 */
export interface MessageWire {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_filename: string | null;
  read: boolean;
  created_at: ISODateString;
}

export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  content: string | null;
  attachmentUrl: string | null;
  attachmentType: string | null;
  attachmentFilename: string | null;
  read: boolean;
  createdAt: ISODateString;
}

export function mapMessage(wire: MessageWire): Message {
  return {
    id: wire.id,
    senderId: wire.sender_id,
    recipientId: wire.recipient_id,
    content: wire.content,
    attachmentUrl: wire.attachment_url,
    attachmentType: wire.attachment_type,
    attachmentFilename: wire.attachment_filename,
    read: wire.read,
    createdAt: wire.created_at,
  };
}

export interface MessageThreadWire {
  user: { id: string; name: string; avatar_url: string | null };
  last_message: MessageWire;
  unread_count: number;
}

export interface MessageThread {
  user: { id: string; name: string; avatarUrl: string | null };
  lastMessage: Message;
  unreadCount: number;
}

export function mapMessageThread(wire: MessageThreadWire): MessageThread {
  return {
    user: { id: wire.user.id, name: wire.user.name, avatarUrl: wire.user.avatar_url },
    lastMessage: mapMessage(wire.last_message),
    unreadCount: wire.unread_count,
  };
}

/**
 * Team management: GET /admin/users, POST /admin/invite, PATCH /admin/users/:id/role,
 * PATCH /admin/users/:id/status. Confirmed real (2026-09-02), master-only (users:read/write).
 * `client_access` on each user shows which client workspaces they were granted, mirroring
 * POST /clients/:id/access.
 */
export { ROLE_NAMES };
export type { RoleName };

export interface AdminUserClientAccessWire {
  client_id: string;
  client_name: string;
  role: ClientAccessRole;
}

/** Status de uma integração do colaborador. Nunca traz token — só metadados. */
export interface AdminUserIntegrationWire {
  provider: string;
  status: string;
  workspace_name: string | null;
  last_synced_at: ISODateString | null;
  connected_at: ISODateString;
}

export interface AdminUserIntegration {
  provider: string;
  status: string;
  workspaceName: string | null;
  lastSyncedAt: ISODateString | null;
  connectedAt: ISODateString;
}

export interface AdminUserWire {
  id: string;
  email: string;
  name: string;
  active: boolean;
  roles: RoleName[];
  avatar_url: string | null;
  client_access: AdminUserClientAccessWire[];
  integrations?: AdminUserIntegrationWire[];
  created_at: ISODateString;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  roles: RoleName[];
  avatarUrl: string | null;
  clientAccess: Array<{ clientId: string; clientName: string; role: ClientAccessRole }>;
  integrations: AdminUserIntegration[];
  createdAt: ISODateString;
}

export function mapAdminUser(wire: AdminUserWire): AdminUser {
  return {
    id: wire.id,
    email: wire.email,
    name: wire.name,
    active: wire.active,
    roles: wire.roles,
    avatarUrl: wire.avatar_url,
    clientAccess: wire.client_access.map((c) => ({ clientId: c.client_id, clientName: c.client_name, role: c.role })),
    integrations: (wire.integrations ?? []).map((i) => ({
      provider: i.provider,
      status: i.status,
      workspaceName: i.workspace_name,
      lastSyncedAt: i.last_synced_at,
      connectedAt: i.connected_at,
    })),
    createdAt: wire.created_at,
  };
}

export interface InviteUserRequestWire {
  email: string;
  name?: string | undefined;
  role: RoleName;
}

export interface InviteUserResponseWire {
  email: string;
  role: RoleName;
  status: 'invited';
}

export interface UpdateUserRoleRequestWire {
  role: RoleName;
}

export interface UpdateUserStatusRequestWire {
  active: boolean;
}

/** PATCH /admin/users/:id — master editing someone else's name, distinct from PATCH /me
 * (self-edit). Confirmed real (2026-09-02). */
export interface UpdateUserNameRequestWire {
  name: string;
}

export interface UpdateUserNameResponseWire {
  id: string;
  name: string;
}

/** GET/POST /automations. Automação agendada (pedido do usuário, 2026-09-03): dispara um
 * agente num horário fixo, a resposta vira mensagem na conversa dedicada dela. */
export interface AutomationWire {
  id: string;
  name: string;
  agent: AgentName;
  prompt: string;
  client_id: string | null;
  conversation_id: string | null;
  schedule: string;
  schedule_label: string;
  enabled: boolean;
  last_run_at: ISODateString | null;
  created_at: ISODateString;
}

export interface Automation {
  id: string;
  name: string;
  agent: AgentName;
  prompt: string;
  clientId: string | null;
  conversationId: string | null;
  schedule: string;
  scheduleLabel: string;
  enabled: boolean;
  lastRunAt: ISODateString | null;
  createdAt: ISODateString;
}

export function mapAutomation(wire: AutomationWire): Automation {
  return {
    id: wire.id,
    name: wire.name,
    agent: wire.agent,
    prompt: wire.prompt,
    clientId: wire.client_id,
    conversationId: wire.conversation_id,
    schedule: wire.schedule,
    scheduleLabel: wire.schedule_label,
    enabled: wire.enabled,
    lastRunAt: wire.last_run_at,
    createdAt: wire.created_at,
  };
}

export interface CreateAutomationRequestWire {
  name: string;
  agent: AgentName;
  prompt: string;
  client_id?: string | null;
  schedule: string;
  schedule_label: string;
}

/** GET /automations/:id/runs — histórico de disparos. */
export interface AutomationRunWire {
  id: string;
  status: string;
  error: string | null;
  started_at: ISODateString;
  completed_at: ISODateString | null;
}

export interface AutomationRun {
  id: string;
  status: string;
  error: string | null;
  startedAt: ISODateString;
  completedAt: ISODateString | null;
}

export function mapAutomationRun(wire: AutomationRunWire): AutomationRun {
  return {
    id: wire.id,
    status: wire.status,
    error: wire.error,
    startedAt: wire.started_at,
    completedAt: wire.completed_at,
  };
}
