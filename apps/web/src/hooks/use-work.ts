import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';

export interface WorkTreeSpace {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  archived: boolean;
  folders: Array<{ id: string; name: string; archived: boolean }>;
  projects: Array<{ id: string; name: string; folderId: string | null; clientId: string | null; status: string; archived: boolean }>;
  lists: Array<{ id: string; name: string; folderId: string | null; projectId: string | null; clientId: string | null; archived: boolean; openTaskCount: number }>;
}

export interface WorkStatus {
  id: string;
  name: string;
  color: string;
  category: string;
  position: number;
  isInitial: boolean;
  isFinal: boolean;
}

export interface WorkTaskWire {
  id: string;
  number: number;
  key: string;
  listId: string;
  parentTaskId: string | null;
  depth: number;
  title: string;
  description: string | null;
  statusId: string;
  status: { id: string; name: string; color: string; category: string; isFinal: boolean } | null;
  priority: number;
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  estimateMinutes: number | null;
  tags: string[];
  version: number;
  archivedAt: string | null;
  assigneeIds: string[];
  subtaskCount: number;
  subtaskDone: number;
  clientId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface WorkMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  /** Pessoa que ainda não entrou no OS: existe só no ClickUp, mas recebe tarefa igual. */
  soNoClickUp?: boolean;
}

export interface WorkTaskDetail {
  task: WorkTaskWire;
  list: { name: string; spaceId: string } | null;
  subtaskIds: string[];
  comments: Array<{ id: string; parentCommentId: string | null; body: string; authorId: string | null; authorName: string; authorAvatar: string | null; resolvedAt: string | null; createdAt: string }>;
  checklists: Array<{ id: string; name: string; items: Array<{ id: string; parentItemId: string | null; text: string; done: boolean }> }>;
  attachments: Array<{ id: string; fileName: string; mimeType: string | null; sizeBytes: number | null; url: string; storage?: 'external' | 'storage' }>;
  customFields: Array<{ fieldId: string; name: string; type: string; value: unknown }>;
  blockedBy: Array<{ id: string; key: string; title: string }>;
  blocking: Array<{ id: string; key: string; title: string }>;
  related: Array<{ id: string; key: string; title: string }>;
  followers: Array<{ id: string; name: string; avatar: string | null }>;
  following: boolean;
  fieldDefs: Array<{ id: string; name: string; type: string; options: Array<{ id: string; label: string }> }>;
  trackedMs: number;
}

/** 0 sem prioridade · 1 urgente · 2 alta · 3 normal · 4 baixa — a mesma convenção do banco. */
export const PRIORIDADES: Record<number, { label: string; color: string }> = {
  0: { label: 'Sem prioridade', color: '' },
  1: { label: 'Urgente', color: '#ef4444' },
  2: { label: 'Alta', color: '#f5b400' },
  3: { label: 'Normal', color: '#3b82f6' },
  4: { label: 'Baixa', color: '#9ca3af' },
};

export function useWorkTree(incluirArquivados = false) {
  return useQuery({ queryKey: ['work', 'tree', incluirArquivados], queryFn: () => apiFetch<{ spaces: WorkTreeSpace[] }>(`/work/tree${incluirArquivados ? '?include_archived=true' : ''}`) });
}

export function useWorkMembers() {
  return useQuery({ queryKey: ['work', 'members'], queryFn: () => apiFetch<{ members: WorkMember[] }>('/work/members'), staleTime: 5 * 60_000 });
}

export function useSpaceStatuses(spaceId: string | null) {
  return useQuery({
    queryKey: ['work', 'statuses', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => apiFetch<{ statuses: WorkStatus[] }>(`/work/spaces/${spaceId}/statuses`),
  });
}

export interface WorkTaskFilters {
  listId?: string | null;
  spaceId?: string | null;
  parentTaskId?: string | null;
  q?: string | undefined;
  assigneeId?: string | null;
  createdBy?: string | null;
  followerId?: string | null;
  tag?: string | null;
  dueNone?: boolean;
  unassigned?: boolean;
  priorities?: number[];
  statusIds?: string[];
  dueFrom?: string;
  dueTo?: string;
  completed?: boolean | undefined;
  limit?: number | undefined;
  sort?: string;
  includeSubtasks?: boolean;
  includeArchived?: boolean;
  clientId?: string | null;
  enabled?: boolean;
}

export function useWorkTasks(f: WorkTaskFilters) {
  const params = new URLSearchParams();
  if (f.parentTaskId) params.set('parent_task_id', f.parentTaskId);
  else if (f.listId) params.set('list_id', f.listId);
  else if (f.spaceId) params.set('space_id', f.spaceId);
  if (f.q) params.set('q', f.q);
  if (f.assigneeId) params.set('assignee_id', f.assigneeId);
  if (f.createdBy) params.set('created_by', f.createdBy);
  if (f.followerId) params.set('follower_id', f.followerId);
  if (f.tag) params.set('tag', f.tag);
  if (f.dueNone) params.set('due_none', 'true');
  if (f.unassigned) params.set('unassigned', 'true');
  if (f.priorities?.length) params.set('priorities', f.priorities.join(','));
  if (f.statusIds?.length) params.set('status_ids', f.statusIds.join(','));
  if (f.dueFrom) params.set('due_from', f.dueFrom);
  if (f.dueTo) params.set('due_to', f.dueTo);
  if (f.includeSubtasks) params.set('include_subtasks', 'true');
  if (f.includeArchived) params.set('include_archived', 'true');
  if (f.clientId) params.set('client_id', f.clientId);
  if (f.completed !== undefined) params.set('completed', String(f.completed));
  params.set('sort', f.sort ?? 'position');
  params.set('limit', String(f.limit ?? 2000));
  return useQuery({
    queryKey: ['work', 'tasks', params.toString()],
    enabled: f.enabled ?? true,
    queryFn: () => apiFetch<{ total: number; rows: WorkTaskWire[] }>(`/work/tasks?${params.toString()}`),
  });
}

export function useTaskDetail(id: string | null) {
  return useQuery({ queryKey: ['work', 'detail', id], enabled: Boolean(id), queryFn: () => apiFetch<WorkTaskDetail>(`/work/tasks/${id}/detail`) });
}

const jsonInit = (method: string, body: unknown, headers?: Record<string, string>): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: ['work', k] })));
}

export function useCreateSpace() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (name: string) => apiFetch('/work/spaces', jsonInit('POST', { name })), onSuccess: () => inv('tree', 'statuses') });
}

export function useCreateList() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (b: { spaceId: string; name: string; folderId?: string | null }) => apiFetch('/work/lists', jsonInit('POST', b)),
    onSuccess: () => inv('tree'),
  });
}

export function useCreateStatus(spaceId: string | null) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => apiFetch(`/work/spaces/${spaceId}/statuses`, jsonInit('POST', { name, category: 'active' })),
    onSuccess: () => inv('statuses'),
  });
}

export function useCreateTask() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (b: { listId: string; title: string; statusId?: string; parentTaskId?: string; priority?: number; dueAt?: string | null; assigneeIds?: string[] }) =>
      // Uma chave por tentativa: o duplo clique reenvia a mesma chave da mutação, nunca cria duas tarefas.
      apiFetch('/work/tasks', jsonInit('POST', b, { 'Idempotency-Key': crypto.randomUUID() })),
    onSuccess: () => inv('tasks', 'detail', 'tree', 'overview'),
  });
}

export interface TaskPatch {
  id: string;
  expectedVersion: number;
  title?: string;
  description?: string | null;
  statusId?: string;
  priority?: number;
  dueAt?: string | null;
  startAt?: string | null;
  assigneeIds?: string[];
  tags?: string[];
  estimateMinutes?: number | null;
  clientId?: string | null;
}

/** Campos que a tela pode mostrar já mudados, sem esperar o servidor. O status vem à parte (precisa do objeto). */
const CAMPOS_OTIMISTAS = ['title', 'description', 'priority', 'dueAt', 'startAt', 'assigneeIds', 'tags', 'estimateMinutes', 'clientId'] as const;

function aplicarNaTarefa(t: WorkTaskWire, id: string, mudanca: Partial<WorkTaskWire>): WorkTaskWire {
  return t.id === id ? { ...t, ...mudanca } : t;
}

/** Troca a tarefa em qualquer formato guardado sob ['work', ...]: detalhe ({ task }), listas ({ rows }) ou array. */
function aplicarNoCache(dado: unknown, id: string, mudanca: Partial<WorkTaskWire>): unknown {
  if (!dado || typeof dado !== 'object') return dado;
  if (Array.isArray(dado)) return dado.map((x) => (x && typeof x === 'object' && 'id' in x && 'assigneeIds' in x ? aplicarNaTarefa(x as WorkTaskWire, id, mudanca) : x));
  const o = dado as Record<string, unknown>;
  if (o.task && typeof o.task === 'object' && (o.task as WorkTaskWire).id === id) return { ...o, task: aplicarNaTarefa(o.task as WorkTaskWire, id, mudanca) };
  if (Array.isArray(o.rows)) return { ...o, rows: aplicarNoCache(o.rows, id, mudanca) };
  return dado;
}

export function useUpdateTask() {
  const inv = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    // Uma de cada vez, na ordem dos cliques: dois responsáveis marcados em seguida chegavam fora de ordem e o
    // segundo (com a lista velha) desfazia o primeiro — o "clico no responsável e ele buga" (29/10/2026).
    scope: { id: 'work-task-patch' },
    // A tela muda NA HORA; o servidor confirma depois. Antes, cada clique esperava a ida e a volta e a recarga.
    onMutate: ({ id, ...rest }: TaskPatch) => {
      const mudanca: Partial<WorkTaskWire> = {};
      for (const k of CAMPOS_OTIMISTAS) if (k in rest) (mudanca as Record<string, unknown>)[k] = (rest as Record<string, unknown>)[k];
      // Status também muda na hora, com o objeto que a tela já tem em cache. Antes esperava salvar e recarregar a
      // lista: ~5 s com o banco em us-east-1, o "mudar status demora 10 segundos" (30/10/2026).
      if (rest.statusId) {
        const st = qc.getQueriesData<{ statuses: WorkStatus[] }>({ queryKey: ['work', 'statuses'] })
          .flatMap(([, d]) => d?.statuses ?? []).find((x) => x.id === rest.statusId);
        if (st) {
          mudanca.statusId = st.id;
          mudanca.status = { id: st.id, name: st.name, color: st.color, category: st.category, isFinal: st.isFinal };
        }
      }
      if (!Object.keys(mudanca).length) return { antes: [] as Array<[readonly unknown[], unknown]> };
      // NÃO cancela buscas em andamento: cancelar a do detalhe de uma tarefa recém-aberta (ainda sem dado) a deixava
      // em "Carregando…" para sempre (visto em produção, 29/10/2026). Se uma busca velha chegar depois, a recarga do
      // fim desta mutação corrige.
      const antes = qc.getQueriesData({ queryKey: ['work'] });
      for (const [chave, dado] of antes) {
        const novo = aplicarNoCache(dado, id, mudanca);
        if (novo !== dado) qc.setQueryData(chave, novo);
      }
      return { antes };
    },
    mutationFn: async ({ id, expectedVersion, ...rest }: TaskPatch) => {
      try {
        return await apiFetch(`/work/tasks/${id}`, jsonInit('PATCH', { ...rest, expectedVersion }));
      } catch (e) {
        // Conflito (409): outra pessoa — ou uma AUTOMAÇÃO logo após criar a tarefa — mexeu antes. Em vez de falhar em
        // silêncio, busca a versão atual e reaplica UMA vez a mudança que a pessoa acabou de pedir.
        if (!(e instanceof ApiRequestError) || e.status !== 409) throw e;
        const atual = await apiFetch<WorkTaskWire>(`/work/tasks/${id}`);
        return apiFetch(`/work/tasks/${id}`, jsonInit('PATCH', { ...rest, expectedVersion: atual.version }));
      }
    },
    onSettled: () => inv('tasks', 'detail', 'tree', 'inbox', 'overview', 'history'),
    onError: (e, _vars, ctx) => {
      for (const [chave, dado] of ctx?.antes ?? []) qc.setQueryData(chave, dado); // volta ao que era
      toast(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar a alteração.', 'error');
    },
  });
}

export function useAddComment(taskId: string) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (body: string) => apiFetch(`/work/tasks/${taskId}/comments`, jsonInit('POST', { body })), onSuccess: () => inv('detail', 'history') });
}

export function useChecklistActions(taskId: string) {
  const inv = useInvalidate();
  return {
    criar: useMutation({ mutationFn: (name: string) => apiFetch(`/work/tasks/${taskId}/checklists`, jsonInit('POST', { name })), onSuccess: () => inv('detail') }),
    item: useMutation({ mutationFn: (b: { checklistId: string; text: string }) => apiFetch(`/work/checklists/${b.checklistId}/items`, jsonInit('POST', { text: b.text })), onSuccess: () => inv('detail') }),
    marcar: useMutation({ mutationFn: (b: { itemId: string; done: boolean }) => apiFetch(`/work/checklist-items/${b.itemId}`, jsonInit('PATCH', { done: b.done })), onSuccess: () => inv('detail') }),
  };
}
