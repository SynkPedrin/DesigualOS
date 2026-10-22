import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

export interface WorkTreeSpace {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  archived: boolean;
  folders: Array<{ id: string; name: string; archived: boolean }>;
  projects: Array<{ id: string; name: string; folderId: string | null; clientId: string | null; status: string; archived: boolean }>;
  lists: Array<{ id: string; name: string; folderId: string | null; projectId: string | null; archived: boolean; openTaskCount: number }>;
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
}

export interface WorkTaskDetail {
  task: WorkTaskWire;
  list: { name: string; spaceId: string } | null;
  subtaskIds: string[];
  comments: Array<{ id: string; parentCommentId: string | null; body: string; authorId: string | null; authorName: string; authorAvatar: string | null; resolvedAt: string | null; createdAt: string }>;
  checklists: Array<{ id: string; name: string; items: Array<{ id: string; parentItemId: string | null; text: string; done: boolean }> }>;
  attachments: Array<{ id: string; fileName: string; mimeType: string | null; sizeBytes: number | null; url: string }>;
  customFields: Array<{ fieldId: string; name: string; type: string; value: unknown }>;
  blockedBy: Array<{ id: string; key: string; title: string }>;
  blocking: Array<{ id: string; key: string; title: string }>;
  related: Array<{ id: string; key: string; title: string }>;
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
  priorities?: number[];
  dueFrom?: string;
  dueTo?: string;
  completed?: boolean | undefined;
  limit?: number | undefined;
  sort?: string;
  includeSubtasks?: boolean;
  includeArchived?: boolean;
  clientId?: string | null;
  createdBy?: string | null;
  enabled?: boolean;
}

export function useWorkTasks(f: WorkTaskFilters) {
  const params = new URLSearchParams();
  if (f.parentTaskId) params.set('parent_task_id', f.parentTaskId);
  else if (f.listId) params.set('list_id', f.listId);
  else if (f.spaceId) params.set('space_id', f.spaceId);
  if (f.q) params.set('q', f.q);
  if (f.assigneeId) params.set('assignee_id', f.assigneeId);
  if (f.priorities?.length) params.set('priorities', f.priorities.join(','));
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
    onSuccess: () => inv('tasks', 'detail'),
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

export function useUpdateTask() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...rest }: TaskPatch) => apiFetch(`/work/tasks/${id}`, jsonInit('PATCH', rest)),
    // Em conflito (409) a lista recarrega: a pessoa vê o que mudou em vez de sobrescrever em silêncio.
    onSettled: () => inv('tasks', 'detail', 'tree', 'inbox'),
  });
}

export function useAddComment(taskId: string) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (body: string) => apiFetch(`/work/tasks/${taskId}/comments`, jsonInit('POST', { body })), onSuccess: () => inv('detail') });
}

export function useChecklistActions(taskId: string) {
  const inv = useInvalidate();
  return {
    criar: useMutation({ mutationFn: (name: string) => apiFetch(`/work/tasks/${taskId}/checklists`, jsonInit('POST', { name })), onSuccess: () => inv('detail') }),
    item: useMutation({ mutationFn: (b: { checklistId: string; text: string }) => apiFetch(`/work/checklists/${b.checklistId}/items`, jsonInit('POST', { text: b.text })), onSuccess: () => inv('detail') }),
    marcar: useMutation({ mutationFn: (b: { itemId: string; done: boolean }) => apiFetch(`/work/checklist-items/${b.itemId}`, jsonInit('PATCH', { done: b.done })), onSuccess: () => inv('detail') }),
  };
}
