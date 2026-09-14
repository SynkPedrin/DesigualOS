import { z } from 'zod';

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

// Timeout de rede (achado da auditoria de production readiness, 2026-09):
// fetch sem signal pendura pra sempre se o ClickUp travar, segurando junto a
// rota/conversa que disparou a chamada. O erro vira mensagem legível aqui
// porque os call sites (rotas da API) só propagam error.message.
const CLICKUP_FETCH_TIMEOUT_MS = 20_000;

async function fetchClickUp(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(CLICKUP_FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`ClickUp não respondeu em ${CLICKUP_FETCH_TIMEOUT_MS / 1000}s (timeout de rede)`);
    }
    throw error;
  }
}

/**
 * Um único acesso de API do ClickUp, compartilhado (pedido do usuário: mais
 * simples que OAuth por colaborador). Atribuição de tarefa a uma pessoa
 * específica é resolvida por e-mail (users.clickup_email), não por login
 * individual: o Bento "tem" o ClickUp, não cada colaborador.
 */
export interface ClickUpConfig {
  apiKey: string;
  teamId: string;
}

// O GET /team/:teamId do ClickUp devolve mais campos em member.user do que
// usávamos (profilePicture, initials, color). Eles alimentam o diretório de
// colaboradores (GET /collaborators) sem nenhuma chamada extra à API.
const teamMemberSchema = z.object({
  user: z.object({
    id: z.number(),
    email: z.string(),
    username: z.string(),
    profilePicture: z.string().nullish(),
    initials: z.string().nullish(),
    color: z.string().nullish(),
  }),
});

const teamResponseSchema = z.object({
  team: z.object({ members: z.array(teamMemberSchema) }),
});

export interface ClickUpMember {
  id: number;
  email: string;
  username: string;
  profilePicture: string | null;
  initials: string | null;
  color: string | null;
}

export async function getTeamMembers(config: ClickUpConfig): Promise<ClickUpMember[]> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/team/${config.teamId}`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(`ClickUp team lookup failed (${response.status}): ${await response.text()}`);
  }
  const parsed = teamResponseSchema.parse(await response.json());
  return parsed.team.members.map((member) => ({
    id: member.user.id,
    email: member.user.email,
    username: member.user.username,
    profilePicture: member.user.profilePicture ?? null,
    initials: member.user.initials ?? null,
    color: member.user.color ?? null,
  }));
}

export async function findMemberByEmail(config: ClickUpConfig, email: string): Promise<ClickUpMember | null> {
  const members = await getTeamMembers(config);
  return members.find((member) => member.email.toLowerCase() === email.toLowerCase()) ?? null;
}

function normalizePersonName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Resolve um nome falado ("jamile", "jamille", "tami", "pedro") contra os
 * membros REAIS do workspace. Ordem: nome completo exato > primeiro nome
 * exato > prefixo de nome completo > nome contido. Sem match único, devolve
 * null em vez de chutar (a camada de cima decide como perguntar).
 */
export async function findMemberByName(config: ClickUpConfig, name: string): Promise<ClickUpMember | null> {
  const members = await getTeamMembers(config);
  const wanted = normalizePersonName(name);
  if (!wanted) return null;

  const full = members.filter((m) => normalizePersonName(m.username) === wanted);
  if (full.length === 1) return full[0]!;

  const firstName = members.filter((m) => normalizePersonName(m.username).split(' ')[0] === wanted.split(' ')[0]);
  if (firstName.length === 1) return firstName[0]!;

  const prefix = members.filter((m) => normalizePersonName(m.username).startsWith(wanted));
  if (prefix.length === 1) return prefix[0]!;

  const contained = members.filter((m) => normalizePersonName(m.username).includes(wanted));
  if (contained.length === 1) return contained[0]!;

  return null;
}

const createdTaskSchema = z.object({ id: z.string(), url: z.string() });

export interface CreateTaskParams {
  listId: string;
  name: string;
  description?: string;
  assigneeId?: number;
  /** 1=urgente, 2=alta, 3=normal, 4=baixa (escala do ClickUp). */
  priority?: 1 | 2 | 3 | 4;
  /** Epoch em ms (formato do ClickUp). */
  dueDate?: number;
  tags?: string[];
}

export interface CreatedTask {
  id: string;
  url: string;
}

export async function createTask(config: ClickUpConfig, params: CreateTaskParams): Promise<CreatedTask> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/list/${params.listId}/task`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      description: params.description,
      assignees: params.assigneeId ? [params.assigneeId] : undefined,
      priority: params.priority,
      due_date: params.dueDate,
      tags: params.tags && params.tags.length > 0 ? params.tags : undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`ClickUp task creation failed (${response.status}): ${await response.text()}`);
  }
  return createdTaskSchema.parse(await response.json());
}

/**
 * BL-01 (auditoria forense 12/09/2026): não existia NENHUMA escrita de task
 * além de create/delete - "edita a descrição" era estruturalmente
 * impossível. Campos seguem o PUT /task/{id} oficial: assignees com
 * add/rem separados, due_date em epoch ms, priority na escala 1-4.
 */
export interface UpdateTaskParams {
  name?: string;
  description?: string;
  status?: string;
  priority?: 1 | 2 | 3 | 4;
  dueDate?: number | null;
  addAssignees?: number[];
  removeAssignees?: number[];
}

export async function updateTask(config: ClickUpConfig, taskId: string, params: UpdateTaskParams): Promise<void> {
  const body: Record<string, unknown> = {};
  if (params.name !== undefined) body.name = params.name;
  if (params.description !== undefined) body.description = params.description;
  if (params.status !== undefined) body.status = params.status;
  if (params.priority !== undefined) body.priority = params.priority;
  if (params.dueDate !== undefined) body.due_date = params.dueDate;
  if (params.addAssignees?.length || params.removeAssignees?.length) {
    body.assignees = {
      ...(params.addAssignees?.length ? { add: params.addAssignees } : {}),
      ...(params.removeAssignees?.length ? { rem: params.removeAssignees } : {}),
    };
  }
  if (Object.keys(body).length === 0) {
    throw new Error('updateTask chamado sem nenhum campo para atualizar');
  }
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}`, {
    method: 'PUT',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    // Status é por LISTA no ClickUp (workflows custom). Em vez de um 400 seco
    // ("Status does not exist", medido ao vivo em 13/09/2026), o erro passa a
    // listar os status válidos daquela lista - o chamador (humano ou agente)
    // consegue corrigir na hora em vez de adivinhar.
    if (response.status === 400 && detail.includes('Status does not exist')) {
      const valid = await listStatusesForTask(config, taskId).catch(() => null);
      throw new Error(
        valid && valid.length > 0
          ? `Status inválido para esta lista. Status disponíveis: ${valid.join(', ')}`
          : `ClickUp task update failed (400): ${detail}`,
      );
    }
    throw new Error(`ClickUp task update failed (${response.status}): ${detail}`);
  }
}

/** Status válidos da lista da task (workflow custom por lista no ClickUp). */
export async function listStatusesForTask(config: ClickUpConfig, taskId: string): Promise<string[]> {
  const listId = await getTaskListId(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/list/${listId}`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(`ClickUp list fetch failed (${response.status})`);
  }
  const body = (await response.json()) as { statuses?: { status: string }[] };
  return (body.statuses ?? []).map((entry) => entry.status);
}

/**
 * BL-05: anexo real no ClickUp. O arquivo mora no nosso Storage (URL
 * pública); baixamos e reenviamos como multipart pro POST oficial de
 * attachment. Nunca confirma sem o 200 da API.
 */
export async function uploadTaskAttachment(config: ClickUpConfig, taskId: string, fileUrl: string, filename: string): Promise<{ id: string | null }> {
  const fileResponse = await fetchClickUp(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Download do anexo falhou (${fileResponse.status})`);
  }
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  const form = new FormData();
  form.append('attachment', new Blob([buffer]), filename);

  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/attachment`, {
    method: 'POST',
    headers: { Authorization: config.apiKey },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`ClickUp attachment upload failed (${response.status}): ${await response.text()}`);
  }
  // O ClickUp devolve o anexo criado; o id volta pra API como prova de que
  // o arquivo existe de verdade na task (nunca confirmar sem isto).
  const body = (await response.json().catch(() => null)) as { id?: string } | null;
  return { id: body?.id ?? null };
}

/**
 * Deletar tarefa é exatamente o exemplo de "ação crítica" citado na seção
 * 6.6 (Tool Gateway) do prompt mestre, por isso passa pela aprovação
 * humana central (ver packages/tool-gateway/src/gateway.ts), diferente de
 * createTask, que qualquer colaborador já pode disparar direto.
 */
export async function deleteTask(config: ClickUpConfig, taskId: string): Promise<void> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}`, {
    method: 'DELETE',
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(`ClickUp task deletion failed (${response.status}): ${await response.text()}`);
  }
}

const commentSchema = z.object({
  id: z.string(),
  comment_text: z.string().optional().default(''),
  user: z.object({ id: z.number(), username: z.string() }).optional(),
  date: z.string(),
});

const commentsResponseSchema = z.object({ comments: z.array(commentSchema) });

export interface ClickUpComment {
  id: string;
  text: string;
  userId: number | null;
  username: string | null;
  date: string;
}

export async function getTaskComments(config: ClickUpConfig, taskId: string): Promise<ClickUpComment[]> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/comment`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(`ClickUp comment lookup failed (${response.status}): ${await response.text()}`);
  }
  const parsed = commentsResponseSchema.parse(await response.json());
  return parsed.comments.map((comment) => ({
    id: comment.id,
    text: comment.comment_text,
    userId: comment.user?.id ?? null,
    username: comment.user?.username ?? null,
    date: comment.date,
  }));
}

const taskLookupSchema = z.object({
  id: z.string(),
  list: z.object({ id: z.string() }),
});

/** Lista à qual a tarefa pertence: como o POST de comentário confirma que a
 * tarefa é de um cliente conhecido antes de escrever nela. */
export async function getTaskListId(config: ClickUpConfig, taskId: string): Promise<string> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(`ClickUp task lookup failed (${response.status}): ${await response.text()}`);
  }
  return taskLookupSchema.parse(await response.json()).list.id;
}

const createdCommentSchema = z.object({
  id: z.coerce.string(),
  date: z.coerce.string().optional(),
});

export interface CreatedTaskComment {
  id: string;
  text: string;
  date: string | null;
}

/**
 * Comentário novo no topo da tarefa (não resposta de thread; pra isso existe
 * replyToComment). A resposta do ClickUp não devolve o texto, então o texto
 * retornado é o que acabamos de enviar.
 */
export async function createTaskComment(config: ClickUpConfig, taskId: string, text: string): Promise<CreatedTaskComment> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/comment`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment_text: text }),
  });
  if (!response.ok) {
    throw new Error(`ClickUp comment creation failed (${response.status}): ${await response.text()}`);
  }
  const created = createdCommentSchema.parse(await response.json());
  return { id: created.id, text, date: created.date ?? null };
}

/**
 * Responde NA THREAD de um comentário específico (`parent`), igual ao
 * padrão já usado pelo Jarbas de verdade (clickup-reply.sh). `notifyAll`
 * espelha o `true` que o Jarbas manda por padrão (notifica quem participou
 * da thread).
 */
export async function replyToComment(config: ClickUpConfig, taskId: string, parentCommentId: string, text: string, notifyAll = true): Promise<string> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/comment`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment_text: text, notify_all: notifyAll, parent: parentCommentId }),
  });
  if (!response.ok) {
    throw new Error(`ClickUp reply failed (${response.status}): ${await response.text()}`);
  }
  // O id da resposta precisa voltar pro chamador: o webhook a registra como
  // "já respondida" pra não responder à própria resposta (loop infinito).
  return createdCommentSchema.parse(await response.json()).id;
}
