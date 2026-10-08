import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapDemand, type Demand, type DemandSource, type DemandWire } from '@/lib/api/contracts';

export function useDemands(filter: { clientId?: string; status?: string; ownerId?: string } = {}) {
  const params = new URLSearchParams();
  if (filter.clientId) params.set('clientId', filter.clientId);
  if (filter.status) params.set('status', filter.status);
  if (filter.ownerId) params.set('ownerId', filter.ownerId);
  const qs = params.toString();

  return useQuery({
    queryKey: ['demands', filter],
    queryFn: async () => {
      const wire = await apiFetch<{ demands: DemandWire[] }>(`/demands${qs ? `?${qs}` : ''}`);
      return wire.demands.map(mapDemand);
    },
    staleTime: 15_000,
  });
}

export function useDemand(demandId: string | null) {
  return useQuery({
    queryKey: ['demand', demandId],
    queryFn: async () => mapDemand(await apiFetch<DemandWire>(`/demands/${demandId}`)),
    enabled: Boolean(demandId),
  });
}

export const DEMAND_FILE_KINDS = ['briefing', 'documento', 'imagem', 'compactado', 'outro'] as const;
export type DemandFileKind = (typeof DEMAND_FILE_KINDS)[number];

export interface DemandFile {
  id: string;
  demandId: string;
  kind: DemandFileKind;
  filename: string;
  storageUrl: string;
  contentType: string;
  sizeBytes: number | null;
  uploadedBy: string | null;
  createdAt: string;
}

interface DemandFileWire {
  id: string;
  demand_id: string;
  kind: DemandFileKind;
  filename: string;
  storage_url: string;
  content_type: string;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

function mapDemandFile(w: DemandFileWire): DemandFile {
  return {
    id: w.id,
    demandId: w.demand_id,
    kind: w.kind,
    filename: w.filename,
    storageUrl: w.storage_url,
    contentType: w.content_type,
    sizeBytes: w.size_bytes,
    uploadedBy: w.uploaded_by,
    createdAt: w.created_at,
  };
}

export function useDemandFiles(demandId: string | null) {
  return useQuery({
    queryKey: ['demand-files', demandId],
    queryFn: async () => {
      const wire = await apiFetch<{ files: DemandFileWire[] }>(`/demands/${demandId}/files`);
      return wire.files.map(mapDemandFile);
    },
    enabled: Boolean(demandId),
  });
}

export function useUploadDemandFile(demandId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: DemandFileKind }) => {
      // Campo `kind` precisa vir ANTES do campo `file` no FormData pro
      // @fastify/multipart do servidor já ter o valor quando processa o file.
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      const wire = await apiFetch<{ file: DemandFileWire }>(`/demands/${demandId}/files`, { method: 'POST', body: form });
      return mapDemandFile(wire.file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demand-files', demandId] });
      queryClient.invalidateQueries({ queryKey: ['demand-activity', demandId] });
    },
  });
}

export function useDeleteDemandFile(demandId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => apiFetch(`/demands/${demandId}/files/${fileId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demand-files', demandId] });
    },
  });
}

export interface DemandActivityEvent {
  id: string;
  type: string;
  summary: string | null;
  userId: string | null;
  userName: string | null;
  userAvatarUrl: string | null;
  occurredAt: string | null;
}

interface ActivityEventWire {
  id: string;
  type: string;
  summary: string | null;
  user_id: string | null;
  user_name: string | null;
  user_avatar_url: string | null;
  occurred_at: string | null;
}

/** Atividade de UMA campanha — quem fez o quê e quando, nome+foto incluídos.
 *  Reaproveita /activity (mesma tabela que já alimenta a tela de Atividade
 *  geral), só recortado por entidade. */
export function useDemandActivity(demandId: string | null) {
  return useQuery({
    queryKey: ['demand-activity', demandId],
    queryFn: async () => {
      const wire = await apiFetch<{ events: ActivityEventWire[] }>(`/activity?entity_type=demand&entity_id=${demandId}`);
      return wire.events.map(
        (e): DemandActivityEvent => ({
          id: e.id,
          type: e.type,
          summary: e.summary,
          userId: e.user_id,
          userName: e.user_name,
          userAvatarUrl: e.user_avatar_url,
          occurredAt: e.occurred_at,
        }),
      );
    },
    enabled: Boolean(demandId),
  });
}

export function useCreateDemand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { clientId: string; conversationThreadId?: string | null; title: string; description?: string | null; source: DemandSource }) =>
      apiFetch<DemandWire>('/demands', { method: 'POST', body: JSON.stringify(input) }).then(mapDemand),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demands'] });
    },
  });
}
