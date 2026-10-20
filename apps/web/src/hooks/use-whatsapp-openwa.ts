import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

export interface WhatsappSyncJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | string;
  phase: string;
  processed_contacts: number;
  processed_chats: number;
  processed_messages: number;
  duplicate_messages: number;
  imported_media: number;
  failures: Array<{ chatId?: string; message: string }>;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface WhatsappOpenwaSession {
  id: string;
  provider: string;
  external_session_id: string;
  owner_user_id: string;
  phone_number: string | null;
  push_name: string | null;
  status: string;
  engine_loaded: boolean;
  connected_at: string | null;
  last_seen_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  counts: { contacts: number; conversations: number; messages: number };
  latest_sync: WhatsappSyncJob | null;
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
  void queryClient.invalidateQueries({ queryKey: ['openwa-sessions'] });
  if (id) void queryClient.invalidateQueries({ queryKey: ['openwa-session', id] });
}

export function useWhatsappOpenwaSessions() {
  return useQuery({
    queryKey: ['openwa-sessions'],
    queryFn: async () => (await apiFetch<{ sessions: WhatsappOpenwaSession[] }>('/openwa/sessions')).sessions,
    // Cabeçalho da Inbox e cartão de Integrações; a tela de conexão tem o próprio polling rápido.
    refetchInterval: 60_000,
  });
}

export function useWhatsappOpenwaSession(id: string | null, poll = false) {
  return useQuery({
    queryKey: ['openwa-session', id],
    queryFn: () => apiFetch<WhatsappOpenwaSession>(`/openwa/sessions/${id}`),
    enabled: Boolean(id),
    refetchInterval: poll ? 2500 : 10_000,
    retry: (count, error) => count < 2 && !(error instanceof Error && 'status' in error && [400, 401, 403, 404].includes(Number(error.status))),
  });
}

export function useConnectWhatsappOpenwa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<WhatsappOpenwaSession>('/openwa/sessions', { method: 'POST' }),
    onSuccess: (session) => {
      queryClient.setQueryData(['openwa-session', session.id], session);
      invalidate(queryClient, session.id);
    },
  });
}

export function useWhatsappOpenwaQr(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['openwa-qr', id],
    queryFn: () => apiFetch<{ qr_code: string; status: string; fetched_at: string }>(`/openwa/sessions/${id}/qr`),
    enabled: Boolean(id) && enabled,
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useReconnectWhatsappOpenwa(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<WhatsappOpenwaSession>(`/openwa/sessions/${id}/reconnect`, { method: 'POST' }),
    onSuccess: () => invalidate(queryClient, id),
  });
}

export function useDisconnectWhatsappOpenwa(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<WhatsappOpenwaSession>(`/openwa/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(queryClient, id),
  });
}

export function useSyncWhatsappOpenwa(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<WhatsappSyncJob>(`/openwa/sessions/${id}/sync`, { method: 'POST' }),
    onSuccess: () => invalidate(queryClient, id),
  });
}

export function useWhatsappOpenwaSyncHistory(id: string | null) {
  return useQuery({
    queryKey: ['openwa-sync-history', id],
    queryFn: async () => (await apiFetch<{ jobs: WhatsappSyncJob[] }>(`/openwa/sessions/${id}/sync`)).jobs,
    enabled: Boolean(id),
    refetchInterval: 5000,
  });
}

export function useRetryWhatsappOpenwaSync(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => apiFetch(`/openwa/sync-jobs/${jobId}/retry`, { method: 'POST' }),
    onSuccess: () => {
      invalidate(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ['openwa-sync-history', id] });
    },
  });
}
