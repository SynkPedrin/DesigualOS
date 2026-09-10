import type { AgentName } from '@desigual-os/types';
import type { ConversationMessageWire, ConversationSummaryWire, ProjectFileKind, ProjectFileWire, ProjectWire } from '@/lib/api/contracts';
import { mockClients } from './clients';

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

interface MockConversation {
  summary: ConversationSummaryWire;
  messages: ConversationMessageWire[];
}

let conversationSeq = 0;
function nextConversationId(): string {
  conversationSeq += 1;
  return `conv-${conversationSeq}`;
}

function buildSeedConversation(
  agent: AgentName,
  clientId: string | null,
  updatedMinutesAgo: number,
  exchanges: Array<{ user: string; assistant: string }>,
): MockConversation {
  const id = nextConversationId();
  const messages: ConversationMessageWire[] = [];
  let cursor = updatedMinutesAgo + exchanges.length * 2;
  for (const exchange of exchanges) {
    messages.push({
      id: `${id}-u${messages.length}`,
      role: 'user',
      agent: null,
      content: exchange.user,
      attachment_url: null,
      attachment_type: null,
      attachment_filename: null,
      created_at: minutesAgo(cursor),
    });
    cursor -= 1;
    messages.push({
      id: `${id}-a${messages.length}`,
      role: 'assistant',
      agent,
      content: exchange.assistant,
      attachment_url: null,
      attachment_type: null,
      attachment_filename: null,
      created_at: minutesAgo(cursor),
    });
    cursor -= 1;
  }

  const lastExchange = exchanges[exchanges.length - 1];
  const createdAt = minutesAgo(updatedMinutesAgo + exchanges.length * 2);
  return {
    summary: {
      id,
      client_id: clientId,
      project_id: null,
      user_id: 'mock-user',
      title: null,
      status: 'open',
      visibility: 'public',
      last_agent: agent,
      last_message_preview: lastExchange?.assistant.slice(0, 96) ?? null,
      created_at: createdAt,
      updated_at: minutesAgo(updatedMinutesAgo),
    },
    messages,
  };
}

const seedPlan: MockConversation[] = [
  buildSeedConversation('jarbas', mockClients[0]?.id ?? null, 15, [
    {
      user: 'Como está a campanha de setembro?',
      assistant: 'O CPA está dentro da meta e o ROAS acumulado do período segue estável, dá pra escalar o orçamento com segurança.',
    },
  ]),
  buildSeedConversation('suzy', mockClients[1]?.id ?? null, 60, [
    {
      user: 'Quais leads precisam de follow-up hoje?',
      assistant: 'Separei 4 leads quentes que responderam nas últimas 24h, sugiro priorizar o contato ainda hoje.',
    },
  ]),
  buildSeedConversation('bento', null, 180, [
    {
      user: 'Qual o processo pra pedir reembolso?',
      assistant: 'O processo está documentado no ClickUp, é só abrir uma tarefa na lista "Financeiro" com o comprovante anexado.',
    },
  ]),
  buildSeedConversation('studio', mockClients[2]?.id ?? null, 300, [
    {
      user: 'Preciso de um carrossel pra divulgar o novo produto',
      assistant: 'Preparei um briefing de criativo usando o Brand Kit do cliente, recomendo três variações pra teste A/B.',
    },
  ]),
  buildSeedConversation('jarbas', mockClients[0]?.id ?? null, 720, [
    {
      user: 'Faz um relatório da campanha do mês passado',
      assistant: 'Relatório pronto: investimento total dentro do orçado, CPA 8% abaixo da meta.',
    },
  ]),
];

export const conversationStore = new Map<string, MockConversation>(seedPlan.map((c) => [c.summary.id, c]));

export function listConversations(agent: AgentName | null): ConversationSummaryWire[] {
  return Array.from(conversationStore.values())
    .filter((c) => !agent || c.summary.last_agent === agent)
    .sort((a, b) => new Date(b.summary.updated_at).getTime() - new Date(a.summary.updated_at).getTime())
    .map((c) => c.summary);
}

export function getConversationMessages(id: string): ConversationMessageWire[] | null {
  return conversationStore.get(id)?.messages ?? null;
}

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `msg-${messageSeq}`;
}

/** POST /chat with no conversation_id starts a new one; with one, appends to it (confirmed
 * real behavior, 2026-09-01). Returns the conversation id either way. */
export function appendUserMessage(
  conversationId: string | null,
  clientId: string | null,
  message: string,
  attachment?: { url: string; filename: string; contentType: string } | null,
): string {
  const now = new Date().toISOString();
  const messageWire: ConversationMessageWire = {
    id: nextMessageId(),
    role: 'user',
    agent: null,
    content: message,
    attachment_url: attachment?.url ?? null,
    attachment_type: attachment?.contentType ?? null,
    attachment_filename: attachment?.filename ?? null,
    created_at: now,
  };
  if (conversationId && conversationStore.has(conversationId)) {
    const conversation = conversationStore.get(conversationId)!;
    conversation.messages.push(messageWire);
    conversation.summary.updated_at = now;
    return conversationId;
  }

  const id = nextConversationId();
  conversationStore.set(id, {
    summary: {
      id,
      client_id: clientId,
      project_id: null,
      user_id: 'mock-user',
      title: null,
      status: 'open',
      visibility: 'private',
      last_agent: null,
      last_message_preview: null,
      created_at: now,
      updated_at: now,
    },
    messages: [messageWire],
  });
  return id;
}

export function appendAssistantMessage(conversationId: string, agent: AgentName, content: string) {
  const conversation = conversationStore.get(conversationId);
  if (!conversation) return;
  const now = new Date().toISOString();
  conversation.messages.push({ id: nextMessageId(), role: 'assistant', agent, content, attachment_url: null, attachment_type: null, attachment_filename: null, created_at: now });
  conversation.summary.last_agent = agent;
  conversation.summary.last_message_preview = content.slice(0, 96);
  conversation.summary.updated_at = now;
}

// --- Projetos do chat (mock da API /projects, 2026-09-04) ---

let projectSeq = 0;
export const projectStore = new Map<string, ProjectWire>();

export function listProjects(): ProjectWire[] {
  return Array.from(projectStore.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function createProject(name: string, clientId: string | null): ProjectWire {
  projectSeq += 1;
  const now = new Date().toISOString();
  const project: ProjectWire = {
    id: `proj-${projectSeq}`,
    name,
    client_id: clientId,
    created_by: 'mock-user',
    created_at: now,
    updated_at: now,
  };
  projectStore.set(project.id, project);
  return project;
}

export function updateProject(id: string, patch: { name?: string; client_id?: string | null }): ProjectWire | null {
  const project = projectStore.get(id);
  if (!project) return null;
  if (patch.name !== undefined) project.name = patch.name;
  if (patch.client_id !== undefined) project.client_id = patch.client_id;
  project.updated_at = new Date().toISOString();
  return project;
}

/** DELETE desvincula as conversas (voltam pra seção "Conversas"), não apaga. */
export function deleteProject(id: string): boolean {
  for (const conversation of conversationStore.values()) {
    if (conversation.summary.project_id === id) conversation.summary.project_id = null;
  }
  return projectStore.delete(id);
}

export function getConversation(id: string): ConversationSummaryWire | null {
  return conversationStore.get(id)?.summary ?? null;
}

/** Shape do GET/PATCH /conversations/:id: o summary sem os campos derivados de mensagem. */
export function toConversationDetailWire(summary: ConversationSummaryWire) {
  return {
    id: summary.id,
    client_id: summary.client_id,
    project_id: summary.project_id,
    user_id: summary.user_id,
    title: summary.title,
    status: summary.status,
    visibility: summary.visibility,
    created_at: summary.created_at,
    updated_at: summary.updated_at,
  };
}

export function updateConversation(
  id: string,
  patch: { title?: string | null; project_id?: string | null; visibility?: 'private' | 'public' },
): ConversationSummaryWire | null {
  const conversation = conversationStore.get(id);
  if (!conversation) return null;
  if (patch.title !== undefined) conversation.summary.title = patch.title;
  if (patch.project_id !== undefined) conversation.summary.project_id = patch.project_id;
  if (patch.visibility !== undefined) conversation.summary.visibility = patch.visibility;
  conversation.summary.updated_at = new Date().toISOString();
  return conversation.summary;
}

export function deleteConversation(id: string): boolean {
  return conversationStore.delete(id);
}

// --- Arquivos de projeto (mock da API /projects/:id/files, 2026-09-05) ---

let projectFileSeq = 0;
const projectFileStore = new Map<string, ProjectFileWire>();

export function listProjectFiles(projectId: string): ProjectFileWire[] {
  return Array.from(projectFileStore.values())
    .filter((file) => file.project_id === projectId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function addProjectFile(
  projectId: string,
  input: { kind: ProjectFileKind; filename: string; storageUrl: string; contentType: string },
): ProjectFileWire | null {
  const project = projectStore.get(projectId);
  if (!project) return null;
  projectFileSeq += 1;
  const hasText = input.contentType.startsWith('text/') || /\.(md|txt)$/i.test(input.filename);
  const file: ProjectFileWire = {
    id: `pfile-${projectFileSeq}`,
    project_id: projectId,
    client_id: project.client_id,
    kind: input.kind,
    filename: input.filename,
    storage_url: input.storageUrl,
    content_type: input.contentType,
    has_text: hasText,
    created_at: new Date().toISOString(),
  };
  projectFileStore.set(file.id, file);
  return file;
}

export function deleteProjectFile(projectId: string, fileId: string): boolean {
  const file = projectFileStore.get(fileId);
  if (!file || file.project_id !== projectId) return false;
  return projectFileStore.delete(fileId);
}
