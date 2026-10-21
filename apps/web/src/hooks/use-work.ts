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
  lists: Array<{ id: string; name: string; folderId: string | null; projectId: string | null; archived: boolean }>;
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
  listId: string;
  parentTaskId: string | null;
  depth: number;
  title: string;
  description: string | null;
  statusId: string;
  priority: number;
  dueAt: string | null;
  completedAt: string | null;
  tags: string[];
  version: number;
  archivedAt: string | null;
}

export const PRIORIDADES: Record<number, string> = { 0: 'Sem prioridade', 1: 'Urgente', 2: 'Alta', 3: 'Normal', 4: 'Baixa' };

export function useWorkTree() {
  return useQuery({ queryKey: ['work', 'tree'], queryFn: () => apiFetch<{ spaces: WorkTreeSpace[] }>('/work/tree') });
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
  q?: string | undefined;
  completed?: boolean | undefined;
}

export function useWorkTasks(f: WorkTaskFilters) {
  const params = new URLSearchParams();
  if (f.listId) params.set('list_id', f.listId);
  else if (f.spaceId) params.set('space_id', f.spaceId);
  if (f.q) params.set('q', f.q);
  if (f.completed !== undefined) params.set('completed', String(f.completed));
  params.set('sort', 'position');
  params.set('limit', '200');
  return useQuery({
    queryKey: ['work', 'tasks', params.toString()],
    queryFn: () => apiFetch<{ total: number; rows: WorkTaskWire[] }>(`/work/tasks?${params.toString()}`),
  });
}

function json(body: unknown, headers?: Record<string, string>): RequestInit {
  return { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } };
}

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: ['work', k] })));
}

export function useCreateSpace() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (name: string) => apiFetch('/work/spaces', json({ name })), onSuccess: () => inv('tree') });
}

export function useCreateList() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (b: { spaceId: string; name: string; folderId?: string | null; projectId?: string | null }) => apiFetch('/work/lists', json(b)),
    onSuccess: () => inv('tree'),
  });
}

export function useCreateTask() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (b: { listId: string; title: string; priority?: number }) =>
      // Chave nova por tentativa de criação: duplo clique reenvia a mesma chave do mutate, não uma nova.
      apiFetch('/work/tasks', json(b, { 'Idempotency-Key': crypto.randomUUID() })),
    onSuccess: () => inv('tasks'),
  });
}

export function useUpdateTask() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (b: { id: string; expectedVersion: number; statusId?: string; priority?: number; title?: string }) => {
      const { id, ...rest } = b;
      return apiFetch(`/work/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(rest), headers: { 'Content-Type': 'application/json' } });
    },
    // Em conflito (409) a lista recarrega: a pessoa vê o que mudou em vez de sobrescrever.
    onSettled: () => inv('tasks'),
  });
}
