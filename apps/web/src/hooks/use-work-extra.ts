import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

const init = (method: string, body?: unknown): RequestInit => (body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const useInv = () => { const qc = useQueryClient(); return (...k: string[]) => Promise.all(k.map((x) => qc.invalidateQueries({ queryKey: ['work', x] }))); };

export interface InboxEntry { id: string; kind: 'task' | 'communication' | 'system'; actorName: string; actorAvatar: string | null; verb: string; subject: string; snippet: string | null; link: string; taskId: string | null; mention: boolean; unread: boolean; createdAt: string }
export interface InboxData { items: InboxEntry[]; unread: number; unreadByKind: { task: number; communication: number; system: number } }
export function useInbox(enabled = true) {
  return useQuery({ queryKey: ['work', 'inbox'], enabled, queryFn: () => apiFetch<InboxData>('/work/inbox'), refetchInterval: 30_000 });
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

// ── Editar / excluir tudo da tarefa
export function useTaskCrud(taskId: string) {
  const inv = useInv();
  const ok = () => inv('detail', 'tasks', 'tree', 'inbox');
  return {
    editarComentario: useMutation({ mutationFn: (b: { id: string; body: string }) => apiFetch(`/work/comments/${b.id}`, init('PATCH', { body: b.body })), onSuccess: ok }),
    apagarComentario: useMutation({ mutationFn: (id: string) => apiFetch(`/work/comments/${id}`, init('DELETE')), onSuccess: ok }),
    renomearChecklist: useMutation({ mutationFn: (b: { id: string; name: string }) => apiFetch(`/work/checklists/${b.id}`, init('PATCH', { name: b.name })), onSuccess: ok }),
    apagarChecklist: useMutation({ mutationFn: (id: string) => apiFetch(`/work/checklists/${id}`, init('DELETE')), onSuccess: ok }),
    editarItem: useMutation({ mutationFn: (b: { id: string; text?: string; done?: boolean; assigneeId?: string | null }) => { const { id, ...rest } = b; return apiFetch(`/work/checklist-items/${id}`, init('PATCH', rest)); }, onSuccess: ok }),
    apagarItem: useMutation({ mutationFn: (id: string) => apiFetch(`/work/checklist-items/${id}`, init('DELETE')), onSuccess: ok }),
    anexar: useMutation({ mutationFn: (b: { url: string; fileName?: string }) => apiFetch(`/work/tasks/${taskId}/attachments`, init('POST', b)), onSuccess: ok }),
    apagarAnexo: useMutation({ mutationFn: (id: string) => apiFetch(`/work/attachments/${id}`, init('DELETE')), onSuccess: ok }),
    dependencia: useMutation({ mutationFn: (b: { dependsOnId: string; kind: 'blocking' | 'related' }) => apiFetch(`/work/tasks/${taskId}/dependencies`, init('POST', b)), onSuccess: ok }),
    removerDependencia: useMutation({ mutationFn: (other: string) => apiFetch(`/work/tasks/${taskId}/dependencies/${other}`, init('DELETE')), onSuccess: ok }),
    arquivar: useMutation({ mutationFn: (arquivar: boolean) => apiFetch(`/work/tasks/${taskId}/${arquivar ? 'archive' : 'restore'}`, init('POST')), onSuccess: ok }),
    excluir: useMutation({ mutationFn: () => apiFetch(`/work/tasks/${taskId}`, init('DELETE')), onSuccess: ok }),
    mover: useMutation({ mutationFn: (listId: string) => apiFetch(`/work/tasks/${taskId}/move`, init('POST', { listId })), onSuccess: ok }),
  };
}
export function useMoveTask() {
  const inv = useInv();
  return useMutation({ mutationFn: (b: { id: string; listId: string }) => apiFetch(`/work/tasks/${b.id}/move`, init('POST', { listId: b.listId })), onSuccess: () => inv('tasks', 'detail', 'tree') });
}
export function useTaskArchiveActions() {
  const inv = useInv();
  return {
    arquivar: useMutation({ mutationFn: (b: { id: string; arquivar: boolean }) => apiFetch(`/work/tasks/${b.id}/${b.arquivar ? 'archive' : 'restore'}`, init('POST')), onSuccess: () => inv('tasks', 'detail', 'tree') }),
    excluir: useMutation({ mutationFn: (id: string) => apiFetch(`/work/tasks/${id}`, init('DELETE')), onSuccess: () => inv('tasks', 'detail', 'tree') }),
  };
}

// ── Árvore: renomear / arquivar / excluir espaço, pasta, lista
export function useContainerActions() {
  const inv = useInv();
  const ok = () => inv('tree', 'tasks', 'statuses');
  return {
    renomear: useMutation({
      mutationFn: (b: { kind: 'space' | 'folder' | 'list'; id: string; name: string }) => apiFetch(`/work/${b.kind === 'space' ? 'spaces' : b.kind === 'folder' ? 'folders' : 'lists'}/${b.id}`, init('PATCH', { name: b.name })),
      onSuccess: ok,
    }),
    arquivar: useMutation({ mutationFn: (b: { kind: 'space' | 'folder' | 'list'; id: string; arquivar: boolean }) => apiFetch(`/work/${b.kind === 'space' ? 'spaces' : b.kind === 'folder' ? 'folders' : 'lists'}/${b.id}/${b.arquivar ? 'archive' : 'restore'}`, init('POST')), onSuccess: ok }),
    excluir: useMutation({ mutationFn: (b: { kind: 'space' | 'folder' | 'list'; id: string }) => apiFetch(`/work/${b.kind}/${b.id}`, init('DELETE')), onSuccess: ok }),
    criarPasta: useMutation({ mutationFn: (b: { spaceId: string; name: string }) => apiFetch('/work/folders', init('POST', b)), onSuccess: ok }),
  };
}

export function useTestAutomation() {
  const inv = useInv();
  return useMutation({ mutationFn: (b: { id: string; taskId: string }) => apiFetch<{ status: 'ok' | 'failed' | 'skipped'; detail: Record<string, unknown> }>(`/work/automations/${b.id}/test`, init('POST', { taskId: b.taskId })), onSuccess: () => inv('automations', 'automation-runs', 'tasks', 'detail') });
}
export function useUpdateAutomation() {
  const inv = useInv();
  return useMutation({ mutationFn: (b: { id: string } & Partial<Omit<WorkAutomation, 'id' | 'runCount' | 'lastRunAt'>>) => { const { id, ...rest } = b; return apiFetch(`/work/automations/${id}`, init('PATCH', rest)); }, onSuccess: () => inv('automations') });
}
