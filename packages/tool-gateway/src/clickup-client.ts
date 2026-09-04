import { z } from 'zod';

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

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

const teamMemberSchema = z.object({
  user: z.object({ id: z.number(), email: z.string(), username: z.string() }),
});

const teamResponseSchema = z.object({
  team: z.object({ members: z.array(teamMemberSchema) }),
});

export interface ClickUpMember {
  id: number;
  email: string;
  username: string;
}

export async function getTeamMembers(config: ClickUpConfig): Promise<ClickUpMember[]> {
  const response = await fetch(`${CLICKUP_API_BASE}/team/${config.teamId}`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(`ClickUp team lookup failed (${response.status}): ${await response.text()}`);
  }
  const parsed = teamResponseSchema.parse(await response.json());
  return parsed.team.members.map((member) => member.user);
}

export async function findMemberByEmail(config: ClickUpConfig, email: string): Promise<ClickUpMember | null> {
  const members = await getTeamMembers(config);
  return members.find((member) => member.email.toLowerCase() === email.toLowerCase()) ?? null;
}

const createdTaskSchema = z.object({ id: z.string(), url: z.string() });

export interface CreateTaskParams {
  listId: string;
  name: string;
  description?: string;
  assigneeId?: number;
}

export interface CreatedTask {
  id: string;
  url: string;
}

export async function createTask(config: ClickUpConfig, params: CreateTaskParams): Promise<CreatedTask> {
  const response = await fetch(`${CLICKUP_API_BASE}/list/${params.listId}/task`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      description: params.description,
      assignees: params.assigneeId ? [params.assigneeId] : undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`ClickUp task creation failed (${response.status}): ${await response.text()}`);
  }
  return createdTaskSchema.parse(await response.json());
}

/**
 * Deletar tarefa é exatamente o exemplo de "ação crítica" citado na seção
 * 6.6 (Tool Gateway) do prompt mestre, por isso passa pela aprovação
 * humana central (ver packages/tool-gateway/src/gateway.ts), diferente de
 * createTask, que qualquer colaborador já pode disparar direto.
 */
export async function deleteTask(config: ClickUpConfig, taskId: string): Promise<void> {
  const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}`, {
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
  const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}/comment`, {
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
  const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}`, {
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
  const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}/comment`, {
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
export async function replyToComment(config: ClickUpConfig, taskId: string, parentCommentId: string, text: string, notifyAll = true): Promise<void> {
  const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}/comment`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment_text: text, notify_all: notifyAll, parent: parentCommentId }),
  });
  if (!response.ok) {
    throw new Error(`ClickUp reply failed (${response.status}): ${await response.text()}`);
  }
}
