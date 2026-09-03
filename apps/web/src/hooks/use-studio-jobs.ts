import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapStudioJobDetail,
  type StudioJobAttachmentWire,
  type StudioJobCreatedWire,
  type StudioJobDetailWire,
  type StudioJobRequestWire,
  type StudioJobSummaryWire,
  type StudioJobType,
  type StudioQualityPreset,
} from '@/lib/api/contracts';

const ACTIVE_STATUSES = new Set(['queued', 'rendering']);

export function useCreateStudioJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      clientId: string;
      type: StudioJobType;
      prompt: string;
      resolution: string;
      attachments?: StudioJobAttachmentWire[];
      numSlides?: number;
      durationSeconds?: number;
      qualityPreset?: StudioQualityPreset;
      includeText?: boolean;
    }) => {
      const body: StudioJobRequestWire = {
        client_id: input.clientId,
        type: input.type,
        prompt: input.prompt,
        resolution: input.resolution,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        ...(input.numSlides !== undefined ? { num_slides: input.numSlides } : {}),
        ...(input.durationSeconds !== undefined ? { duration_seconds: input.durationSeconds } : {}),
        ...(input.qualityPreset !== undefined ? { quality_preset: input.qualityPreset } : {}),
        ...(input.includeText !== undefined ? { include_text: input.includeText } : {}),
      };
      const wire = await apiFetch<StudioJobCreatedWire>('/studio/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return wire;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
    },
  });
}

export function useStudioJob(jobId: string | null) {
  return useQuery({
    queryKey: ['studio', 'jobs', jobId],
    queryFn: async () => mapStudioJobDetail(await apiFetch<StudioJobDetailWire>(`/studio/jobs/${jobId}`)),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (query.state.data && ACTIVE_STATUSES.has(query.state.data.status) ? 500 : false),
  });
}

/**
 * Jobs próprios ainda em andamento (queued/rendering). Usado pra restaurar a
 * "Fila de jobs" quando o Studio é reaberto: sem isso, activeJobIds
 * (StudioContent) é só memória de componente e some ao fechar o modal ou
 * navegar pra outra tela, mesmo que o job continue rodando no worker de
 * verdade (BullMQ não depende da aba aberta pra processar).
 */
export function useMyActiveStudioJobs() {
  return useQuery({
    queryKey: ['studio', 'jobs', 'mine', 'active'],
    queryFn: async () => {
      const wire = await apiFetch<{ jobs: StudioJobSummaryWire[] }>('/studio/jobs?status=active');
      return wire.jobs.map((job) => job.job_id);
    },
    // Baixa frequência de propósito: isso só existe pra pegar jobs que
    // terminaram enquanto o Studio estava fechado. Enquanto o Studio está
    // aberto, quem dá a cadência real de UI é o polling de 500ms de
    // useStudioJob pra cada card já mostrado.
    refetchInterval: 5000,
  });
}

/**
 * Sobe um arquivo de referência (imagem/PDF) e devolve a URL pra anexar no
 * job. FormData sem Content-Type manual: o browser precisa montar o boundary
 * do multipart sozinho (ver apiFetch).
 */
export function useUploadStudioReference() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<StudioJobAttachmentWire>('/studio/references', { method: 'POST', body: form });
    },
  });
}
