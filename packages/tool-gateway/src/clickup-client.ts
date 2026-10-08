import { z } from 'zod';
import { assertListInScope, assertTaskInScope } from './write-scope.js';

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

// Timeout de rede (achado da auditoria de production readiness, 2026-09):
// fetch sem signal pendura pra sempre se o ClickUp travar, segurando junto a
// rota/conversa que disparou a chamada. O erro vira mensagem legível aqui
// porque os call sites (rotas da API) só propagam error.message.
const CLICKUP_FETCH_TIMEOUT_MS = 20_000;

/**
 * P1-09 (release readiness audit, 22/09/2026): `uploadTaskAttachment`
 * recebia `fileUrl` direto de `z.string().url()` (apps/api/src/clickup/
 * routes.ts) e fazia fetch nele sem restrição nenhuma de destino — SSRF
 * clássico: um usuário autenticado podia apontar pra `http://169.254.169.254/
 * latest/meta-data/...` (endpoint de metadata de nuvem), `http://localhost:
 * <porta-interna>`, ou qualquer serviço da rede interna, e o backend baixava
 * e reenviava o conteúdo como se fosse o anexo do usuário.
 *
 * Anexo real deste sistema SEMPRE vem do nosso próprio Storage
 * (`<SUPABASE_URL>/storage/v1/object/public/<bucket>/...`, ver
 * apps/api/src/lib/storage.ts) — nunca de um host arbitrário que o cliente
 * escolha. Em vez de tentar enumerar toda faixa de IP privada/link-local/
 * metadata (frágil: sempre falta uma), a correção restringe a ORIGEM ao
 * único host que este sistema efetivamente usa. Fail-closed: sem
 * SUPABASE_URL configurada, nenhum anexo passa.
 */
export function assertSafeAttachmentUrl(fileUrl: string, env: NodeJS.ProcessEnv = process.env): void {
  const supabaseUrl = env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL not configured — attachment download refused (no trusted origin to allow)');
  }
  let parsed: URL;
  let allowedOrigin: URL;
  try {
    parsed = new URL(fileUrl);
    allowedOrigin = new URL(supabaseUrl);
  } catch {
    throw new Error('Invalid attachment URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Attachment URL must be https');
  }
  const allowedPrefix = '/storage/v1/object/public/';
  if (parsed.origin !== allowedOrigin.origin || !parsed.pathname.startsWith(allowedPrefix)) {
    throw new Error('Attachment URL is not from an authorized storage bucket');
  }
}

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
  /**
   * Só setado por `bento-action-guard.ts`, depois de confirmar org+capacidade
   * (RBAC clickup:write) e que a conta NÃO é o bot de QA — ver o comentário
   * em `write-scope.ts:assertListInScope`. Ausente/false = cerca de lista
   * continua valendo como sempre (comportamento inalterado pra Otto, Jarbas,
   * Suzy, Studio, automações e rotas HTTP que não setam este campo).
   */
  writeScope?: { authorizedForProduction: boolean };
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

/**
 * Rede de segurança contra o planejador (LLM) devolver o verbo da operação
 * junto do nome ("remove Jamile Galdino" em vez de só "Jamile Galdino") —
 * achado real em QA (25/09/2026): a busca por membro falhava porque
 * procurava um funcionário chamado literalmente "remove Jamile Galdino".
 * Ponto único de normalização (usado por resolveMemberByName E
 * findMemberByName) — corrige o problema pra qualquer caller, não só o que
 * o expôs primeiro.
 */
const LEADING_OPERATION_VERB_RE = /^(tira|retira|remov\w*|exclu\w*|apaga|adicion\w*|acrescent\w*|coloca|bota|p[õo]e|ponha|inclu\w*|troca|substitu\w*)\s+(o|a|os|as|do|da|de)?\s*/i;

function normalizePersonName(text: string): string {
  const base = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return base.replace(LEADING_OPERATION_VERB_RE, '').trim();
}

/**
 * Resolve um nome falado ("jamile", "jamille", "tami", "pedro") contra os
 * membros REAIS do workspace. Ordem: nome completo exato > primeiro nome
 * exato > prefixo de nome completo > nome contido. Sem match único, devolve
 * null em vez de chutar (a camada de cima decide como perguntar).
 */
export type MemberResolution =
  | { status: 'resolved'; member: ClickUpMember; matchedBy: 'full' | 'first_name' | 'prefix' | 'contained' }
  /**
   * Achou UM parecido e não tem certeza. Não é resolução e não é ausência: é
   * pergunta. "Não encontrei o Guilherme, achei o Gui — é ele?"
   *
   * Existe porque atribuir tarefa à pessoa errada é pior que não atribuir, e
   * porque a decisão é de quem está pedindo, não do sistema.
   */
  | { status: 'sugestao'; sugerido: ClickUpMember }
  | { status: 'ambiguous'; candidates: ClickUpMember[] }
  | { status: 'not_found'; candidates: [] };

/**
 * Igual ao findMemberByName, mas DIZ POR QUE não resolveu.
 *
 * "não achei" e "achei três" pedem respostas diferentes de quem está
 * conversando: a primeira é um nome errado, a segunda é uma escolha. Colapsar
 * as duas em `null` obrigava a camada de cima a inventar uma pergunta só, e
 * era o que sobrava quando a Tammy escrevia "pro Gui" — ou o Bento seguia sem
 * responsável, ou pedia de novo o que ela já tinha dito.
 */
export async function resolveMemberByName(config: ClickUpConfig, name: string): Promise<MemberResolution> {
  const members = await getTeamMembers(config);
  const wanted = normalizePersonName(name);
  if (!wanted) return { status: 'not_found', candidates: [] };

  /**
   * APELIDO CADASTRADO: o caso inverso dos quatro níveis abaixo.
   *
   * Todos eles assumem que o nome REGISTRADO é maior ou igual ao falado ("Gui"
   * acha "Gui Fulano"). Falta quando a pessoa está no ClickUp só pelo apelido e
   * quem fala usa o nome inteiro.
   *
   * Relato da Tammy (29/09/2026): ela pediu a ata, desmembrou as demandas, e na
   * hora de subir a task veio "No ClickUp member matches Guilherme". No
   * workspace ele está como "Gui" (gui@segundocerebro.pro). A demanda estava
   * certa, o nome estava certo, e a task não subiu.
   *
   * ELE SUGERE, NÃO RESOLVE. Correção da operação no mesmo dia: "ele não achou
   * o Gui, ele tem que perguntar — não encontrei o Guilherme, achei o Gui, é
   * ele?". Atribuir tarefa por semelhança de nome é o tipo de acerto que
   * ninguém confere e o tipo de erro que ninguém percebe.
   *
   * A trava de forma, mesmo pra sugerir: só vale pra membro cadastrado com UM
   * token de 3 letras ou mais. Isso descarta "Gi" (2
   * letras) e qualquer nome composto, como "Ana Luiza", que senão engoliria
   * "Anabela". Fica no ÚLTIMO nível: qualquer casamento mais direto ganha dele.
   */
  const primeiroFalado = wanted.split(' ')[0] ?? '';
  const porApelido = members.filter((m) => {
    const registrado = normalizePersonName(m.username);
    if (registrado.includes(' ') || registrado.length < 3) return false;
    return primeiroFalado.length > registrado.length && primeiroFalado.startsWith(registrado);
  });

  const niveis: Array<{ matchedBy: 'full' | 'first_name' | 'prefix' | 'contained'; hits: ClickUpMember[] }> = [
    { matchedBy: 'full', hits: members.filter((m) => normalizePersonName(m.username) === wanted) },
    { matchedBy: 'first_name', hits: members.filter((m) => normalizePersonName(m.username).split(' ')[0] === wanted.split(' ')[0]) },
    { matchedBy: 'prefix', hits: members.filter((m) => normalizePersonName(m.username).startsWith(wanted)) },
    { matchedBy: 'contained', hits: members.filter((m) => normalizePersonName(m.username).includes(wanted)) },
  ];

  // O nível mais específico que encontrou ALGUMA coisa decide. Se ele achou
  // exatamente um, resolveu; se achou vários, é ambíguo de verdade — descer
  // pro nível seguinte só aumentaria o conjunto.
  for (const nivel of niveis) {
    if (nivel.hits.length === 1) return { status: 'resolved', member: nivel.hits[0]!, matchedBy: nivel.matchedBy };
    if (nivel.hits.length > 1) return { status: 'ambiguous', candidates: nivel.hits };
  }

  // Nenhum casamento direto: o apelido só SUGERE. Quem confirma é a pessoa.
  if (porApelido.length === 1) return { status: 'sugestao', sugerido: porApelido[0]! };

  return { status: 'not_found', candidates: [] };
}

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

  /**
   * O APELIDO CADASTRADO, que é o caso inverso de todos os quatro acima.
   *
   * Os anteriores assumem que o nome REGISTRADO é maior ou igual ao falado
   * ("Gui" acha "Gui Fulano"). Falta quando a pessoa está cadastrada só pelo
   * apelido e quem fala usa o nome inteiro.
   *
   * Relato da operação (29/09/2026): a Tammy pediu pra subir uma task e o
   * sistema respondeu "No ClickUp member matches Guilherme". No ClickUp ele
   * está como "Gui" (gui@segundocerebro.pro). A demanda estava certa, o nome
   * estava certo, e a task não subiu.
   *
   * A TRAVA, porque errar a pessoa é pior que não achar: só vale para membro
   * cadastrado com UM token de pelo menos 3 letras. Isso exclui de propósito:
   *
   *   "Gi" (2 letras)  — está no workspace e "gi" não é prefixo de "guilherme",
   *                      mas 2 letras casariam demais em outros nomes;
   *   "Ana Luiza"      — dois tokens, então "Anabela" não vira "Ana Luiza";
   *   "Gabriel Prado" e "Gabriel Serafim Sena" — dois tokens cada, e mesmo se
   *                      fossem um só, dariam dois candidatos e cairiam fora
   *                      pela regra de candidato único.
   *
   * Candidato único ou nada: com dois, quem tem que perguntar é o agente.
   */
  const primeiroFalado = wanted.split(' ')[0] ?? '';
  const apelido = members.filter((m) => {
    const registrado = normalizePersonName(m.username);
    if (registrado.includes(' ') || registrado.length < 3) return false;
    return primeiroFalado.length > registrado.length && primeiroFalado.startsWith(registrado);
  });
  if (apelido.length === 1) return apelido[0]!;

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
  /** Id da task-mãe: é assim que o ClickUp cria SUBTAREFA (28/09/2026). */
  parent?: string;
  /** Epoch ms. */
  startDate?: number;
}

export interface CreatedTask {
  id: string;
  url: string;
}

export async function createTask(config: ClickUpConfig, params: CreateTaskParams): Promise<CreatedTask> {
  assertListInScope(params.listId, process.env, config.writeScope?.authorizedForProduction);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/list/${params.listId}/task`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      description: params.description,
      assignees: params.assigneeId ? [params.assigneeId] : undefined,
      priority: params.priority,
      due_date: params.dueDate,
      start_date: params.startDate,
      parent: params.parent,
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
  /** Epoch ms. Null limpa. Campo separado do vencimento (28/09/2026). */
  startDate?: number | null;
  /** Estimativa em MILISSEGUNDOS, que é a unidade do ClickUp. Null limpa. */
  timeEstimate?: number | null;
}

export async function updateTask(config: ClickUpConfig, taskId: string, params: UpdateTaskParams): Promise<void> {
  await assertTaskInScope(config, taskId);
  const body: Record<string, unknown> = {};
  if (params.name !== undefined) body.name = params.name;
  if (params.description !== undefined) body.description = params.description;
  if (params.status !== undefined) body.status = params.status;
  if (params.priority !== undefined) body.priority = params.priority;
  if (params.dueDate !== undefined) body.due_date = params.dueDate;
  if (params.startDate !== undefined) body.start_date = params.startDate;
  if (params.timeEstimate !== undefined) body.time_estimate = params.timeEstimate;
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
/** Teto de download do anexo (P1-09): consumo de memória por usuário autorizado é o outro lado do SSRF. */
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export async function uploadTaskAttachment(config: ClickUpConfig, taskId: string, fileUrl: string, filename: string): Promise<{ id: string | null }> {
  await assertTaskInScope(config, taskId);
  assertSafeAttachmentUrl(fileUrl);
  // `redirect: 'error'` (não o "follow" padrão do fetch): a origem já foi
  // validada acima, mas um redirect seguido às cegas contornaria essa
  // validação inteira — o host de destino real seria outro, nunca checado.
  const fileResponse = await fetchClickUp(fileUrl, { redirect: 'error' });
  if (!fileResponse.ok) {
    throw new Error(`Download do anexo falhou (${fileResponse.status})`);
  }
  const declaredLength = Number(fileResponse.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > ATTACHMENT_MAX_BYTES) {
    throw new Error(`Anexo maior que o limite permitido (${ATTACHMENT_MAX_BYTES} bytes)`);
  }
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  if (buffer.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new Error(`Anexo maior que o limite permitido (${ATTACHMENT_MAX_BYTES} bytes)`);
  }
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
  await assertTaskInScope(config, taskId);
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
  /**
   * Nome e status são opcionais NO SCHEMA, não na API: ela sempre manda os
   * dois. Opcional aqui para que uma resposta parcial (ou uma tarefa em
   * estado estranho) devolva a lista mesmo assim — este lookup é o que
   * autoriza escrever na tarefa, e falhá-lo por causa do nome seria trocar
   * uma função que funciona por uma que quebra.
   */
  name: z.string().nullish(),
  status: z.object({ status: z.string().nullish() }).nullish(),
});

export interface ClickUpTaskResumo {
  listId: string;
  name: string | null;
  status: string | null;
}

/**
 * O MESMO GET que já era feito, com os campos que já vinham na resposta e
 * eram descartados.
 *
 * `getTaskListId` fazia `GET /task/:id` e jogava fora tudo menos `list.id`. O
 * webhook do ClickUp não manda o nome da tarefa em evento nenhum, então sem
 * isto a linha do tempo só consegue dizer "Atualizou uma tarefa". Mesma
 * chamada, mesmo custo de rede: muda só o que a gente guarda dela.
 */
export async function getTaskResumo(config: ClickUpConfig, taskId: string): Promise<ClickUpTaskResumo> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(`ClickUp task lookup failed (${response.status}): ${await response.text()}`);
  }
  const t = taskLookupSchema.parse(await response.json());
  return {
    listId: t.list.id,
    name: t.name?.trim() ? t.name.trim() : null,
    status: t.status?.status?.trim() ? t.status.status.trim() : null,
  };
}

/** Lista à qual a tarefa pertence: como o POST de comentário confirma que a
 * tarefa é de um cliente conhecido antes de escrever nela. */
export async function getTaskListId(config: ClickUpConfig, taskId: string): Promise<string> {
  return (await getTaskResumo(config, taskId)).listId;
}

const taskDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.object({ status: z.string() }).nullish(),
  /**
   * ClickUp devolve prioridade como objeto ou null (sem prioridade
   * definida) — nunca o número solto. Achado real no E2E de release
   * (22/09/2026, bloqueava DELETE e qualquer getTask de task com
   * prioridade): o campo `priority.priority` é o RÓTULO em texto ("urgent"/
   * "high"/"normal"/"low"), não o dígito — `z.coerce.number()` nele vira
   * NaN e o schema inteiro falha, derrubando toda leitura da task
   * (confirmado batendo direto na API: `{"color":"#f8ae00","id":"2",
   * "orderindex":"2","priority":"high"}`). O número 1-4 real é `priority.id`.
   */
  priority: z.object({ id: z.coerce.number().int().min(1).max(4) }).nullish(),
  due_date: z.union([z.string(), z.number(), z.null()]).optional(),
  start_date: z.union([z.string(), z.number(), z.null()]).optional(),
  time_estimate: z.union([z.string(), z.number(), z.null()]).optional(),
  tags: z.array(z.object({ name: z.string() })).optional().default([]),
  watchers: z.array(z.object({ id: z.number(), username: z.string().nullish() })).optional().default([]),
  checklists: z
    .array(z.object({ name: z.string().nullish(), items: z.array(z.object({ name: z.string().nullish() })).optional().default([]) }))
    .optional()
    .default([]),
  list: z.object({ id: z.string() }).nullish(),
  assignees: z
    .array(z.object({ id: z.number(), username: z.string().nullish() }))
    .optional()
    .default([]),
  // Descrição e anexos entram pra que o read-back consiga CONFERIR material
  // de referência. Sem eles não havia como distinguir "o link está na task"
  // de "eu acho que coloquei o link na task" — e essa distinção é a única
  // coisa que separa um recibo de uma promessa.
  description: z.string().nullish(),
  text_content: z.string().nullish(),
  attachments: z
    .array(z.object({ id: z.string().nullish(), title: z.string().nullish(), url: z.string().nullish() }))
    .optional()
    .default([]),
});

export interface TaskDetail {
  id: string;
  name: string;
  status: string | null;
  /** 1=urgent, 2=high, 3=normal, 4=low (escala do ClickUp); null = sem prioridade definida. */
  priority: 1 | 2 | 3 | 4 | null;
  dueDate: number | null;
  /** Início e estimativa (ms) — lidos pro read-back, 28/09/2026. */
  startDate: number | null;
  timeEstimate: number | null;
  /** Tags aplicadas, em minúsculo como o ClickUp devolve. */
  tags: string[];
  /** Checklists da task — o read-back precisa deles pra CONFERIR, não supor. */
  checklists: Array<{ name: string; items: string[] }>;
  /**
   * Quem SEGUE a task. `null` quando o ClickUp não devolveu o campo — não é a
   * mesma coisa que `[]` (devolveu e está vazio), e confundir os dois fazia o
   * read-back acusar falha sem ter conferido nada.
   */
  watchers: Array<{ id: number; username: string | null }> | null;
  listId: string | null;
  assignees: Array<{ id: number; username: string | null }>;
  /** Corpo da task — é onde o bloco de REFERÊNCIAS/MATERIAIS é conferido. */
  description: string;
  /** Anexos REAIS na task (upload que o ClickUp aceitou), nunca links. */
  attachments: Array<{ id: string | null; title: string | null; url: string | null }>;
}

/**
 * READ-BACK completo (seção 32): reler a task DEPOIS de uma escrita e conferir
 * os campos. getTaskListId só provava que a task existe; isto devolve nome,
 * status, prazo e responsáveis reais, que é o que o guard compara com o que
 * a ação prometeu antes de dizer "validada".
 */
/** ClickUp devolve epoch/estimativa como string, número ou null, sem padrão. */
function numeroOuNull(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getTask(config: ClickUpConfig, taskId: string): Promise<TaskDetail> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(`ClickUp task lookup failed (${response.status}): ${await response.text()}`);
  }
  const raw = taskDetailSchema.parse(await response.json());
  const due = raw.due_date == null ? null : Number(raw.due_date);
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status?.status ?? null,
    priority: (raw.priority?.id as 1 | 2 | 3 | 4 | undefined) ?? null,
    dueDate: due != null && Number.isFinite(due) ? due : null,
    startDate: numeroOuNull(raw.start_date),
    timeEstimate: numeroOuNull(raw.time_estimate),
    tags: (raw.tags ?? []).map((t) => t.name),
    checklists: (raw.checklists ?? []).map((c) => ({ name: c.name ?? '', items: (c.items ?? []).map((i) => i.name ?? '') })),
    // `null` = o ClickUp não devolveu o campo nesta resposta. Diferente de
    // `[]`, que é "devolveu e não há ninguém seguindo". Quem confere read-back
    // precisa dessa diferença pra não acusar falha sem ter olhado.
    watchers: raw.watchers === undefined ? null : raw.watchers.map((w) => ({ id: w.id, username: w.username ?? null })),
    listId: raw.list?.id ?? null,
    assignees: (raw.assignees ?? []).map((a) => ({ id: a.id, username: a.username ?? null })),
    description: raw.description ?? raw.text_content ?? '',
    attachments: (raw.attachments ?? []).map((a) => ({ id: a.id ?? null, title: a.title ?? null, url: a.url ?? null })),
  };
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
  await assertTaskInScope(config, taskId);
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
  await assertTaskInScope(config, taskId);
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

/* ------------------------------------------------------------------ */
/* 28/09/2026 — primitivas que faltavam pro Bento operar o ClickUp     */
/* inteiro. Todas passam por assertTaskInScope: a cerca de escrita     */
/* vale pra elas como vale pro PUT /task.                             */
/* ------------------------------------------------------------------ */

/** Nome de tag é case-insensitive no ClickUp e não aceita barra. */
function tagSegura(tag: string): string {
  return encodeURIComponent(tag.trim());
}

export async function addTaskTag(config: ClickUpConfig, taskId: string, tag: string): Promise<void> {
  await assertTaskInScope(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/tag/${tagSegura(tag)}`, {
    method: 'POST',
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    const detail = await response.text();
    // A tag precisa existir NO SPACE antes de ser aplicada. O erro cru do
    // ClickUp não diz isso, e quem lê a resposta fica sem saber o que fazer.
    throw new Error(
      detail.includes('not found') || response.status === 404
        ? `A tag "${tag}" não existe neste space do ClickUp. Crie a tag no space antes de aplicá-la.`
        : `ClickUp add tag failed (${response.status}): ${detail}`,
    );
  }
}

export async function removeTaskTag(config: ClickUpConfig, taskId: string, tag: string): Promise<void> {
  await assertTaskInScope(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/tag/${tagSegura(tag)}`, {
    method: 'DELETE',
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) throw new Error(`ClickUp remove tag failed (${response.status}): ${await response.text()}`);
}

/**
 * Dependência entre tasks. `dependsOn` = esta task espera a outra;
 * `dependencyOf` = a outra espera esta. Os dois nomes são os do ClickUp, e
 * inverter os dois é o erro clássico — por isso não existe um "linkTasks"
 * genérico aqui.
 */
export async function addTaskDependency(
  config: ClickUpConfig,
  taskId: string,
  params: { dependsOn?: string; dependencyOf?: string },
): Promise<void> {
  if (!params.dependsOn && !params.dependencyOf) throw new Error('addTaskDependency exige dependsOn OU dependencyOf');
  await assertTaskInScope(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/dependency`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(params.dependsOn ? { depends_on: params.dependsOn } : {}),
      ...(params.dependencyOf ? { dependency_of: params.dependencyOf } : {}),
    }),
  });
  if (!response.ok) throw new Error(`ClickUp add dependency failed (${response.status}): ${await response.text()}`);
}

export interface ClickUpCustomField {
  id: string;
  name: string;
  type: string;
  /** Opções de dropdown/label, quando o campo tem. */
  options: Array<{ id: string; name: string }>;
}

const customFieldsSchema = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      type_config: z
        .object({ options: z.array(z.object({ id: z.string(), name: z.string().nullish(), label: z.string().nullish() })).nullish() })
        .nullish(),
    }),
  ),
});

/** Campos personalizados DA LISTA — é onde eles são definidos no ClickUp. */
export async function listCustomFields(config: ClickUpConfig, listId: string): Promise<ClickUpCustomField[]> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/list/${listId}/field`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) throw new Error(`ClickUp list custom fields failed (${response.status}): ${await response.text()}`);
  const parsed = customFieldsSchema.parse(await response.json());
  return parsed.fields.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    options: (f.type_config?.options ?? []).map((o) => ({ id: o.id, name: o.name ?? o.label ?? '' })),
  }));
}

/**
 * Escreve UM campo personalizado. O `value` já vai no formato que aquele tipo
 * de campo espera (id da opção em dropdown, epoch ms em data, número em
 * number) — quem traduz do texto humano é a camada de cima, que enxerga as
 * opções reais do campo.
 */
export async function setCustomFieldValue(
  config: ClickUpConfig,
  taskId: string,
  fieldId: string,
  value: unknown,
): Promise<void> {
  await assertTaskInScope(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/field/${fieldId}`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error(`ClickUp set custom field failed (${response.status}): ${await response.text()}`);
}

/** Cria um checklist na task e devolve o id, pra popular os itens. */
export async function createChecklist(config: ClickUpConfig, taskId: string, name: string): Promise<string> {
  await assertTaskInScope(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}/checklist`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`ClickUp create checklist failed (${response.status}): ${await response.text()}`);
  const json = (await response.json()) as { checklist?: { id?: string } };
  const id = json.checklist?.id;
  if (!id) throw new Error('ClickUp criou o checklist mas não devolveu o id');
  return id;
}

export async function addChecklistItem(config: ClickUpConfig, checklistId: string, name: string): Promise<void> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/checklist/${checklistId}/checklist_item`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`ClickUp add checklist item failed (${response.status}): ${await response.text()}`);
}

/* ------------------------------------------------------------------ */
/* 28/09/2026 — capacidades conferidas UMA A UMA contra o ClickUp real */
/* ------------------------------------------------------------------ */

/**
 * WATCHERS. Conferido: `PUT /task/{id}` com `{watchers:{add:[id]}}` responde
 * 200 e o seguidor aparece na releitura. Não está no docs oficial da v2, e é
 * por isso que foi testado antes de existir aqui.
 */
export async function updateTaskWatchers(
  config: ClickUpConfig,
  taskId: string,
  params: { add?: number[]; remove?: number[] },
): Promise<void> {
  if (!params.add?.length && !params.remove?.length) return;
  await assertTaskInScope(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/task/${taskId}`, {
    method: 'PUT',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      watchers: {
        ...(params.add?.length ? { add: params.add } : {}),
        ...(params.remove?.length ? { rem: params.remove } : {}),
      },
    }),
  });
  if (!response.ok) throw new Error(`ClickUp watchers failed (${response.status}): ${await response.text()}`);
}

/**
 * "MOVER" NÃO EXISTE na API v2 — e isto é o achado, não uma limitação do
 * código. Conferido em 28/09/2026: `POST /list/{destino}/task/{id}` responde
 * 200 e a task passa a aparecer NAS DUAS listas (`locations`); o
 * `DELETE /list/{origem}/task/{id}` da lista de origem responde **400**,
 * porque o ClickUp não deixa remover a task da casa dela.
 *
 * Então a função se chama pelo que ela faz. Chamar isto de "mover" faria o
 * agente dizer "movi" com a task em dois lugares — e alguém contando a mesma
 * demanda duas vezes no relatório.
 */
export async function addTaskToList(config: ClickUpConfig, taskId: string, listId: string): Promise<void> {
  await assertTaskInScope(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/list/${listId}/task/${taskId}`, {
    method: 'POST',
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    const detalhe = await response.text();
    throw new Error(
      detalhe.includes('multiple lists') || response.status === 403
        ? 'O ClickUp recusou: adicionar uma task a outra lista exige o ClickApp "Tasks in Multiple Lists" ligado no workspace.'
        : `ClickUp add-to-list failed (${response.status}): ${detalhe}`,
    );
  }
}

/** Tira a task de uma lista SECUNDÁRIA. A lista de origem não pode ser removida (400). */
export async function removeTaskFromList(config: ClickUpConfig, taskId: string, listId: string): Promise<void> {
  await assertTaskInScope(config, taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/list/${listId}/task/${taskId}`, {
    method: 'DELETE',
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 400
        ? 'O ClickUp não deixa remover a task da lista de origem dela — só de listas adicionais.'
        : `ClickUp remove-from-list failed (${response.status}): ${await response.text()}`,
    );
  }
}

export interface EstruturaCriada {
  id: string;
  name: string;
}

/** Cria PASTA num space. Conferido: 200 e id real. */
export async function createFolder(config: ClickUpConfig, spaceId: string, name: string): Promise<EstruturaCriada> {
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/space/${spaceId}/folder`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`ClickUp create folder failed (${response.status}): ${await response.text()}`);
  const json = (await response.json()) as { id?: string; name?: string };
  if (!json.id) throw new Error('ClickUp criou a pasta e não devolveu id');
  return { id: json.id, name: json.name ?? name };
}

/**
 * Cria LISTA, num space (`spaceId`) ou dentro de uma pasta (`folderId`).
 * Conferido no space: 200 e id real.
 */
export async function createList(
  config: ClickUpConfig,
  destino: { spaceId?: string; folderId?: string },
  name: string,
): Promise<EstruturaCriada> {
  const url = destino.folderId
    ? `${CLICKUP_API_BASE}/folder/${destino.folderId}/list`
    : `${CLICKUP_API_BASE}/space/${destino.spaceId}/list`;
  if (!destino.folderId && !destino.spaceId) throw new Error('createList exige spaceId OU folderId');
  const response = await fetchClickUp(url, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`ClickUp create list failed (${response.status}): ${await response.text()}`);
  const json = (await response.json()) as { id?: string; name?: string };
  if (!json.id) throw new Error('ClickUp criou a lista e não devolveu id');
  return { id: json.id, name: json.name ?? name };
}

/**
 * TIME TRACKING. Conferido em 28/09/2026 e RECUSADO pelo workspace, nas duas
 * formas — cronômetro (`/time_entries/start`) e lançamento manual
 * (`/time_entries`): `TIMEENTRY_072 — Cannot track time for this task`.
 *
 * A função existe assim mesmo, e de propósito: quando o ClickApp de tempo for
 * ligado, ela passa a funcionar sem mais nenhuma linha de código. Até lá, o
 * erro que sobe é o do ClickUp, traduzido — o agente diz por que não deu, em
 * vez de fingir que a operação não existe.
 */
export async function registrarTempo(
  config: ClickUpConfig,
  teamId: string,
  params: { taskId: string; inicioMs: number; duracaoMs: number; descricao?: string },
): Promise<void> {
  await assertTaskInScope(config, params.taskId);
  const response = await fetchClickUp(`${CLICKUP_API_BASE}/team/${teamId}/time_entries`, {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tid: params.taskId,
      start: params.inicioMs,
      duration: params.duracaoMs,
      ...(params.descricao ? { description: params.descricao } : {}),
    }),
  });
  if (!response.ok) {
    const detalhe = await response.text();
    throw new Error(
      detalhe.includes('TIMEENTRY_072')
        ? 'O ClickUp recusou o apontamento de horas: o controle de tempo está desligado neste workspace (ClickApp "Time Tracking").'
        : `ClickUp time entry failed (${response.status}): ${detalhe}`,
    );
  }
}
