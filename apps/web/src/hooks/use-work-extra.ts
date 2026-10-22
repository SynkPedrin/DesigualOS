import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

const init = (method: string, body?: unknown): RequestInit => (body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const useInv = () => { const qc = useQueryClient(); return (...k: string[]) => Promise.all(k.map((x) => qc.invalidateQueries({ queryKey: ['work', x] }))); };

export interface InboxItem { id: string; taskId: string; taskKey: string; taskTitle: string; action: string; actorName: string; actorAvatar: string | null; data: Record<string, unknown>; createdAt: string; unread: boolean }
export function useInbox() {
  return useQuery({ queryKey: ['work', 'inbox'], queryFn: () => apiFetch<{ items: InboxItem[]; unread: number }>('/work/inbox'), refetchInterval: 30_000 });
}
export function useMarkInboxRead() {
  const inv = useInv();
  return useMutation({ mutationFn: () => apiFetch('/work/inbox/read', init('POST')), onSuccess: () => inv('inbox') });
}

export interface RunningTimer { id: string; taskId: string; taskKey: string; taskTitle: string; startedAt: string }
export function useTimer() {
  return useQuery({ queryKey: ['work', 'timer'], queryFn: () => apiFetch<{ running: RunningTimer | null }>('/work/timer'), refetchInterval: 60_000 });
}
export function useTimerActions() {
  const inv = useInv();
  return {
    iniciar: useMutation({ mutationFn: (taskId: string) => apiFetch(`/work/tasks/${taskId}/timer/start`, init('POST')), onSuccess: () => inv('timer', 'time', 'detail') }),
    parar: useMutation({ mutationFn: () => apiFetch('/work/timer/stop', init('POST')), onSuccess: () => inv('timer', 'time', 'detail') }),
    manual: useMutation({ mutationFn: (b: { taskId: string; minutes: number; note?: string }) => apiFetch(`/work/tasks/${b.taskId}/time`, init('POST', { minutes: b.minutes, ...(b.note ? { note: b.note } : {}) })), onSuccess: () => inv('time', 'detail') }),
  };
}
export interface TimeEntry { id: string; userName: string; startedAt: string; endedAt: string | null; durationMs: number; note: string | null; running: boolean }
export function useTimeEntries(taskId: string) {
  return useQuery({ queryKey: ['work', 'time', taskId], queryFn: () => apiFetch<{ entries: TimeEntry[]; totalMs: number }>(`/work/tasks/${taskId}/time`) });
}

export function useSetCustomField(taskId: string) {
  const inv = useInv();
  return useMutation({ mutationFn: (b: { fieldId: string; value: string | number | boolean | string[] | null }) => apiFetch(`/work/tasks/${taskId}/custom-fields/${b.fieldId}`, init('PUT', { value: b.value })), onSuccess: () => inv('detail') });
}
export function useCreateCustomField(spaceId: string | null) {
  const inv = useInv();
  return useMutation({ mutationFn: (b: { name: string; fieldType: string; options?: string[] }) => apiFetch(`/work/spaces/${spaceId}/custom-fields`, init('POST', b)), onSuccess: () => inv('custom-fields', 'detail') });
}
export function useCustomFields(spaceId: string | null) {
  return useQuery({ queryKey: ['work', 'custom-fields', spaceId], enabled: Boolean(spaceId), queryFn: () => apiFetch<{ fields: Array<{ id: string; name: string; fieldType: string; options: Array<{ id: string; label: string }> }> }>(`/work/spaces/${spaceId}/custom-fields`) });
}

export interface WorkAutomation { id: string; name: string; enabled: boolean; spaceId: string | null; listId: string | null; trigger: { type: string; config?: Record<string, unknown> }; conditions: Array<{ field: string; op: string; value?: unknown }>; actions: Array<{ type: string; config?: Record<string, unknown> }>; runCount: number; lastRunAt: string | null }
export function useAutomations() {
  return useQuery({ queryKey: ['work', 'automations'], queryFn: () => apiFetch<{ automations: WorkAutomation[] }>('/work/automations') });
}
export function useAutomationRuns(id: string | null) {
  return useQuery({ queryKey: ['work', 'automation-runs', id], enabled: Boolean(id), queryFn: () => apiFetch<{ runs: Array<{ id: string; taskId: string | null; status: string; detail: Record<string, unknown>; createdAt: string }> }>(`/work/automations/${id}/runs`), refetchInterval: 10_000 });
}
export function useAutomationActions() {
  const inv = useInv();
  return {
    criar: useMutation({ mutationFn: (b: Omit<WorkAutomation, 'id' | 'runCount' | 'lastRunAt' | 'enabled'> & { enabled?: boolean }) => apiFetch('/work/automations', init('POST', b)), onSuccess: () => inv('automations') }),
    alternar: useMutation({ mutationFn: (b: { id: string; enabled: boolean }) => apiFetch(`/work/automations/${b.id}`, init('PATCH', { enabled: b.enabled })), onSuccess: () => inv('automations') }),
    apagar: useMutation({ mutationFn: (id: string) => apiFetch(`/work/automations/${id}`, init('DELETE')), onSuccess: () => inv('automations') }),
  };
}

export interface TemplateRow { id: string; name: string; kind: string; subtasks: number; checklists: number; createdAt: string }
export function useTemplates() {
  return useQuery({ queryKey: ['work', 'templates'], queryFn: () => apiFetch<{ templates: TemplateRow[] }>('/work/templates') });
}
export function useTemplateActions() {
  const inv = useInv();
  return {
    salvar: useMutation({ mutationFn: (b: { taskId: string; name: string }) => apiFetch('/work/templates', init('POST', b)), onSuccess: () => inv('templates') }),
    usar: useMutation({ mutationFn: (b: { id: string; listId: string; title?: string }) => apiFetch(`/work/templates/${b.id}/use`, init('POST', { listId: b.listId, ...(b.title ? { title: b.title } : {}) })), onSuccess: () => inv('tasks', 'tree') }),
    apagar: useMutation({ mutationFn: (id: string) => apiFetch(`/work/templates/${id}`, init('DELETE')), onSuccess: () => inv('templates') }),
    duplicar: useMutation({ mutationFn: (taskId: string) => apiFetch(`/work/tasks/${taskId}/duplicate`, init('POST', {})), onSuccess: () => inv('tasks', 'tree') }),
  };
}
export interface RecurrenceRow { id: string; taskId: string; taskKey: string; taskTitle: string; freq: string; interval: number; active: boolean; nextRunAt: string; lastRunAt: string | null }
export function useRecurrences() {
  return useQuery({ queryKey: ['work', 'recurrences'], queryFn: () => apiFetch<{ recurrences: RecurrenceRow[] }>('/work/recurrences') });
}
export function useRecurrenceActions() {
  const inv = useInv();
  return {
    criar: useMutation({ mutationFn: (b: { taskId: string; freq: string; interval?: number }) => apiFetch(`/work/tasks/${b.taskId}/recurrence`, init('POST', { freq: b.freq, interval: b.interval ?? 1 })), onSuccess: () => inv('recurrences') }),
    ativar: useMutation({ mutationFn: (b: { id: string; active: boolean }) => apiFetch(`/work/recurrences/${b.id}`, init('PATCH', { active: b.active })), onSuccess: () => inv('recurrences') }),
  };
}

export interface WorkReportWire {
  totais: { total: number; abertas: number; concluidas: number; atrasadas: number; sem_responsavel: number; sem_prazo: number };
  porStatus: Array<{ name: string; color: string; category: string; n: number }>;
  porResponsavel: Array<{ id: string; name: string; abertas: number; concluidas: number; atrasadas: number }>;
  porPrioridade: Array<{ priority: number; n: number }>;
  fluxo: Array<{ semana: string; criadas: number; concluidas: number }>;
  cicloMedioDias: number | null;
  tempoPorPessoa30d: Array<{ name: string; horas: number }>;
}
export function useWorkReport(spaceId: string | null) {
  return useQuery({ queryKey: ['work', 'report', spaceId], queryFn: () => apiFetch<WorkReportWire>(`/work/reports${spaceId ? `?space_id=${spaceId}` : ''}`) });
}

export interface SavedView { id: string; name: string; userId: string | null; config: { visao?: string; assigneeId?: string | null; priority?: number | null; listId?: string | null; spaceId?: string | null } }
export function useSavedViews() {
  return useQuery({ queryKey: ['work', 'views'], queryFn: () => apiFetch<{ views: SavedView[] }>('/work/views') });
}
export function useSavedViewActions() {
  const inv = useInv();
  return {
    salvar: useMutation({ mutationFn: (b: { name: string; config: SavedView['config']; shared?: boolean }) => apiFetch('/work/views', init('POST', b)), onSuccess: () => inv('views') }),
    apagar: useMutation({ mutationFn: (id: string) => apiFetch(`/work/views/${id}`, init('DELETE')), onSuccess: () => inv('views') }),
  };
}
