import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

const init = (method: string, body?: unknown): RequestInit => (body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const useInv = () => { const qc = useQueryClient(); return (...k: string[]) => Promise.all(k.map((x) => qc.invalidateQueries({ queryKey: ['work', x] }))); };

export interface InboxEntry { id: string; kind: 'task' | 'communication' | 'system'; actorName: string; actorAvatar: string | null; verb: string; subject: string; snippet: string | null; link: string; taskId: string | null; mention: boolean; unread: boolean; createdAt: string }
export interface AtribuidaAMim { taskId: string; key: string; title: string; dueAt: string | null; priority: number; statusName: string; statusColor: string | null; clientName: string | null }
export interface InboxData { items: InboxEntry[]; assigned: AtribuidaAMim[]; unread: number; unreadByKind: { task: number; communication: number; system: number } }
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
  const ok = () => inv('detail', 'tasks', 'tree', 'inbox', 'history');
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

// ── Painel do topo (cartões e lateral)
export interface WorkOverview {
  contagens: { hoje: number; ontem: number; atrasadas: number; bloqueadas: number; clientesAtivos: number; semResponsavel: number; clientesSemAtividade: number };
  proximasEntregas: Array<{ id: string; key: string; title: string; dueAt: string; priority: number; lista: string; clientId: string | null; status: string; color: string }>;
  focoDoDia: Array<{ id: string; key: string; title: string; version: number; feita: boolean; finalId: string | null; initialId: string | null }>;
}
export function useWorkOverview(scope: { spaceId?: string | null; listId?: string | null; clientId?: string | null }) {
  const p = new URLSearchParams();
  if (scope.listId) p.set('list_id', scope.listId);
  else if (scope.spaceId) p.set('space_id', scope.spaceId);
  if (scope.clientId) p.set('client_id', scope.clientId);
  return useQuery({ queryKey: ['work', 'overview', p.toString()], queryFn: () => apiFetch<WorkOverview>(`/work/overview?${p.toString()}`), refetchInterval: 60_000 });
}

export function useBulkUpdate() {
  const inv = useInv();
  return useMutation({
    mutationFn: (b: { ids: string[]; patch: { statusId?: string; priority?: number; assigneeIds?: string[]; dueAt?: string | null } }) => apiFetch<{ okCount: number; failedCount: number }>('/work/tasks/bulk', init('POST', b)),
    onSuccess: () => inv('tasks', 'detail', 'overview'),
  });
}
export function useLinkListToClient() {
  const inv = useInv();
  return useMutation({ mutationFn: (b: { listId: string; clientId: string | null }) => apiFetch(`/work/lists/${b.listId}`, init('PATCH', { clientId: b.clientId })), onSuccess: () => inv('tree', 'tasks', 'overview') });
}

// ── Histórico, seguidores e preferências individuais
export interface HistoryEvent { id: string; createdAt: string; action: string; actorName: string; actorAvatar: string | null; actorKind: string; texto: string }
export function useTaskHistory(taskId: string) {
  return useQuery({ queryKey: ['work', 'history', taskId], queryFn: () => apiFetch<{ events: HistoryEvent[] }>(`/work/tasks/${taskId}/history`) });
}
export function useFollowTask(taskId: string) {
  const inv = useInv();
  return {
    seguir: useMutation({ mutationFn: () => apiFetch(`/work/tasks/${taskId}/follow`, init('POST', {})), onSuccess: () => inv('detail', 'history') }),
    deixar: useMutation({ mutationFn: () => apiFetch(`/work/tasks/${taskId}/follow`, init('DELETE')), onSuccess: () => inv('detail', 'history') }),
  };
}

export const COLUNAS_DA_LISTA = ['andamento', 'responsavel', 'prazo', 'prioridade', 'status', 'cliente', 'tags'] as const;
export type ColunaDaLista = (typeof COLUNAS_DA_LISTA)[number];
export interface WorkPreferences { colunas: ColunaDaLista[]; densidade: 'compacta' | 'confortavel'; agrupar: boolean; visaoPadrao: 'lista' | 'quadro' | 'calendario' | 'tabela' | 'gantt'; mostrarConcluidas: boolean; subtarefasAbertas: boolean }
export const PREFERENCIAS_PADRAO: WorkPreferences = { colunas: ['andamento', 'responsavel', 'prazo', 'prioridade', 'status'], densidade: 'confortavel', agrupar: false, visaoPadrao: 'lista', mostrarConcluidas: false, subtarefasAbertas: false };
export function usePreferences() {
  return useQuery({ queryKey: ['work', 'preferences'], queryFn: () => apiFetch<WorkPreferences>('/work/preferences'), staleTime: 5 * 60_000 });
}
export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Partial<WorkPreferences>) => apiFetch<WorkPreferences>('/work/preferences', init('PUT', p)),
    // Atualiza na hora (sem esperar a rede): mexer numa coluna tem que parecer instantâneo.
    onMutate: async (p) => { const antes = qc.getQueryData<WorkPreferences>(['work', 'preferences']); qc.setQueryData<WorkPreferences>(['work', 'preferences'], { ...(antes ?? PREFERENCIAS_PADRAO), ...p }); return { antes }; },
    onError: (_e, _p, ctx) => { if (ctx?.antes) qc.setQueryData(['work', 'preferences'], ctx.antes); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['work', 'preferences'] }),
  });
}

export interface TaskApproval { id: string; status: 'pending' | 'approved' | 'rejected' | 'changes_requested'; comment: string | null; requestedBy: string; requestedByName: string; approverId: string | null; approverName: string | null; createdAt: string; resolvedAt: string | null }
export function useTaskApprovals(taskId: string) {
  return useQuery({ queryKey: ['work', 'approvals', taskId], queryFn: () => apiFetch<{ approvals: TaskApproval[] }>(`/work/tasks/${taskId}/approvals`) });
}
export function useApprovalActions(taskId: string) {
  const qc = useQueryClient();
  const ok = () => Promise.all(['approvals', 'history', 'inbox', 'detail'].map((k) => qc.invalidateQueries({ queryKey: ['work', k] })));
  return {
    pedir: useMutation({ mutationFn: (b: { approverId?: string | null; note?: string | null }) => apiFetch(`/work/tasks/${taskId}/approvals`, init('POST', b)), onSuccess: ok }),
    responder: useMutation({ mutationFn: (b: { id: string; status: 'approved' | 'rejected' | 'changes_requested'; comment?: string | null }) => { const { id, ...rest } = b; return apiFetch(`/work/approvals/${id}`, init('PATCH', rest)); }, onSuccess: ok }),
  };
}
