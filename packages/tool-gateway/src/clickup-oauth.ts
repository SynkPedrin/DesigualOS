import { z } from 'zod';

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';
const CLICKUP_AUTHORIZE_BASE = 'https://app.clickup.com/api';

export interface ClickUpOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Passo 1 do OAuth: URL pra onde o browser do colaborador é mandado.
 * Confirmado na doc oficial (developer.clickup.com/docs/authentication):
 * https://app.clickup.com/api?client_id=&redirect_uri=&state=
 *
 * `state` é obrigatório na prática (mesmo sendo opcional na doc): é ele que
 * amarra o callback ao usuário que iniciou o fluxo e protege contra CSRF —
 * ver buildOAuthState/parseOAuthState em apps/api/src/integrations.
 */
export function buildClickUpAuthorizeUrl(config: ClickUpOAuthConfig, state: string): string {
  const url = new URL(CLICKUP_AUTHORIZE_BASE);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });

/**
 * Passo 2: troca o `code` do callback por um access token.
 *
 * A doc do endpoint (reference/getaccesstoken) descreve os parâmetros no
 * BODY, mas implementações reais do ClickUp historicamente também aceitam
 * (e em algumas versões só aceitam) query string. Mandar nos dois lugares é
 * um custo de uma linha e elimina a classe inteira de erro "400 sem motivo
 * aparente" — o ClickUp ignora o duplicado.
 */
export async function exchangeClickUpCode(config: ClickUpOAuthConfig, code: string): Promise<string> {
  const url = new URL(`${CLICKUP_API_BASE}/oauth/token`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('client_secret', config.clientSecret);
  url.searchParams.set('code', code);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`ClickUp token exchange failed (${response.status}): ${await response.text()}`);
  }
  return tokenResponseSchema.parse(await response.json()).access_token;
}

/**
 * Token pessoal (pk_...) vai cru no header; token de OAuth vai como Bearer
 * (doc de autenticação). Como o sistema tem os dois tipos convivendo (a API
 * key compartilhada antiga e as conexões por colaborador), quem monta o
 * header decide pelo formato do token em vez de exigir uma flag em todo
 * call site.
 */
export function clickUpAuthHeader(token: string): string {
  return token.startsWith('pk_') ? token : `Bearer ${token}`;
}

const authorizedTeamsSchema = z.object({
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
});

export interface ClickUpTeam {
  id: string;
  name: string;
}

/** Workspaces (times) que ESTE token pode ver — usado logo após conectar. */
export async function getAuthorizedTeams(token: string): Promise<ClickUpTeam[]> {
  const response = await fetch(`${CLICKUP_API_BASE}/team`, {
    headers: { Authorization: clickUpAuthHeader(token) },
  });
  if (!response.ok) {
    throw new Error(`ClickUp authorized teams lookup failed (${response.status}): ${await response.text()}`);
  }
  return authorizedTeamsSchema.parse(await response.json()).teams;
}

const spacesSchema = z.object({
  spaces: z.array(z.object({ id: z.string(), name: z.string() })),
});

export interface ClickUpSpace {
  id: string;
  name: string;
}

export async function getSpaces(token: string, teamId: string): Promise<ClickUpSpace[]> {
  const response = await fetch(`${CLICKUP_API_BASE}/team/${teamId}/space?archived=false`, {
    headers: { Authorization: clickUpAuthHeader(token) },
  });
  if (!response.ok) {
    throw new Error(`ClickUp spaces lookup failed (${response.status}): ${await response.text()}`);
  }
  return spacesSchema.parse(await response.json()).spaces;
}

const foldersSchema = z.object({
  folders: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      lists: z.array(z.object({ id: z.string(), name: z.string(), task_count: z.union([z.number(), z.string()]).nullish() })).optional(),
    }),
  ),
});

export type ClickUpClientStatus = 'active' | 'pontual' | 'inactive';

export interface ClickUpClientList {
  listId: string;
  name: string;
  status: ClickUpClientStatus;
  taskCount: number | null;
  folderName: string;
}

/**
 * Um folder guarda clientes? Detectado pelo NOME (contém "cliente"), não por
 * id fixo: id de folder muda se alguém recriar a pasta, e um nome novo tipo
 * "CLIENTES 2027" passa a ser reconhecido sozinho. Estrutura real conferida
 * em 03/09/2026: CLIENTES ATIVOS / CLIENTES PONTUAIS / CLIENTES INATIVOS.
 */
function clientFolderStatus(folderName: string): ClickUpClientStatus | null {
  const normalized = folderName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (!normalized.includes('cliente')) return null;
  if (normalized.includes('inativ')) return 'inactive';
  if (normalized.includes('pontua')) return 'pontual';
  return 'active';
}

/**
 * Listas marcadas à mão como "[EX-CLIENTE 2026-08-14] Fulano" continuam
 * dentro de CLIENTES ATIVOS no ClickUp (achado real: 4 casos). Importar
 * isso como cliente ativo seria mentira, então o prefixo vira status
 * inativo e some do nome exibido.
 */
const EX_CLIENT_PREFIX = /^\s*\[\s*ex-?cliente[^\]]*\]\s*/i;

export function normalizeClientListName(rawName: string): { name: string; wasExClient: boolean } {
  const wasExClient = EX_CLIENT_PREFIX.test(rawName);
  return { name: rawName.replace(EX_CLIENT_PREFIX, '').trim(), wasExClient };
}

/**
 * Descobre os clientes da agência no ClickUp: varre os spaces do workspace,
 * pega os folders que guardam clientes e devolve cada LISTA como um cliente.
 */
export async function getClientLists(token: string, teamId: string): Promise<ClickUpClientList[]> {
  const headers = { Authorization: clickUpAuthHeader(token) };
  const spaces = await getSpaces(token, teamId);
  const clients: ClickUpClientList[] = [];

  for (const space of spaces) {
    const response = await fetch(`${CLICKUP_API_BASE}/space/${space.id}/folder?archived=false`, { headers });
    if (!response.ok) {
      throw new Error(`ClickUp folders lookup failed (${response.status}): ${await response.text()}`);
    }

    for (const folder of foldersSchema.parse(await response.json()).folders) {
      const folderStatus = clientFolderStatus(folder.name);
      if (!folderStatus) continue;

      for (const list of folder.lists ?? []) {
        const { name, wasExClient } = normalizeClientListName(list.name);
        if (!name) continue;
        clients.push({
          listId: list.id,
          name,
          status: wasExClient ? 'inactive' : folderStatus,
          taskCount: list.task_count === null || list.task_count === undefined ? null : Number(list.task_count),
          folderName: folder.name,
        });
      }
    }
  }

  return clients;
}

const clickUpUserSchema = z.object({
  id: z.number(),
  username: z.string().nullish(),
  email: z.string().nullish(),
  initials: z.string().nullish(),
  color: z.string().nullish(),
  profilePicture: z.string().nullish(),
});

const tasksSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string().nullish(),
      description: z.string().nullish(),
      text_content: z.string().nullish(),
      status: z.object({ status: z.string(), color: z.string().nullish(), type: z.string().nullish() }).nullish(),
      priority: z.object({ priority: z.string().nullish(), color: z.string().nullish() }).nullish(),
      due_date: z.string().nullish(),
      start_date: z.string().nullish(),
      date_created: z.string().nullish(),
      date_updated: z.string().nullish(),
      time_estimate: z.number().nullish(),
      tags: z.array(z.object({ name: z.string(), tag_bg: z.string().nullish(), tag_fg: z.string().nullish() })).optional(),
      assignees: z.array(clickUpUserSchema).optional(),
      creator: clickUpUserSchema.nullish(),
      list: z.object({ id: z.string(), name: z.string().nullish() }).nullish(),
    }),
  ),
});

export interface ClickUpPerson {
  id: number;
  name: string;
  /** Foto de perfil do ClickUp. Null quando a pessoa nunca subiu uma. */
  avatarUrl: string | null;
  initials: string | null;
  color: string | null;
}

export interface ClickUpTaskSummary {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  statusColor: string | null;
  statusType: string | null;
  priority: string | null;
  priorityColor: string | null;
  url: string | null;
  /** Datas em ISO. O ClickUp devolve epoch em milissegundos, como STRING. */
  dueDate: string | null;
  startDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  timeEstimateMs: number | null;
  tags: { name: string; background: string | null; foreground: string | null }[];
  assignees: ClickUpPerson[];
  creator: ClickUpPerson | null;
}

/** Epoch em ms (string, como o ClickUp manda) -> ISO. Null continua null. */
function toIso(epochMs: string | null | undefined): string | null {
  if (!epochMs) return null;
  const parsed = Number(epochMs);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toPerson(user: z.infer<typeof clickUpUserSchema>): ClickUpPerson {
  return {
    id: user.id,
    name: user.username ?? user.email ?? String(user.id),
    avatarUrl: user.profilePicture ?? null,
    initials: user.initials ?? null,
    color: user.color ?? null,
  };
}

/** Tarefas de um cliente (= de uma lista), pra tela do cliente no Desigual OS. */
export async function getTasksInList(token: string, listId: string, includeClosed = false): Promise<ClickUpTaskSummary[]> {
  const url = new URL(`${CLICKUP_API_BASE}/list/${listId}/task`);
  url.searchParams.set('archived', 'false');
  url.searchParams.set('subtasks', 'false');
  if (includeClosed) url.searchParams.set('include_closed', 'true');

  const response = await fetch(url, { headers: { Authorization: clickUpAuthHeader(token) } });
  if (!response.ok) {
    throw new Error(`ClickUp tasks lookup failed (${response.status}): ${await response.text()}`);
  }

  return tasksSchema.parse(await response.json()).tasks.map((task) => ({
    id: task.id,
    name: task.name,
    // `description` vem vazia quando a tarefa foi escrita no editor rico;
    // `text_content` é o mesmo conteúdo em texto puro. Usa o que existir.
    description: task.description || task.text_content || null,
    status: task.status?.status ?? null,
    statusColor: task.status?.color ?? null,
    statusType: task.status?.type ?? null,
    priority: task.priority?.priority ?? null,
    priorityColor: task.priority?.color ?? null,
    url: task.url ?? null,
    dueDate: toIso(task.due_date),
    startDate: toIso(task.start_date),
    createdAt: toIso(task.date_created),
    updatedAt: toIso(task.date_updated),
    timeEstimateMs: task.time_estimate ?? null,
    tags: (task.tags ?? []).map((tag) => ({ name: tag.name, background: tag.tag_bg ?? null, foreground: tag.tag_fg ?? null })),
    assignees: (task.assignees ?? []).map(toPerson),
    creator: task.creator ? toPerson(task.creator) : null,
  }));
}
