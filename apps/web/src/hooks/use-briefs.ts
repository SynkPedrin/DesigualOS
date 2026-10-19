import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { BriefContentWire, BriefWire } from '@/lib/api/contracts';

export function useBriefsByDemand(demandId: string | null) {
  return useQuery({
    queryKey: ['briefs-by-demand', demandId],
    queryFn: async () => (await apiFetch<{ briefs: BriefWire[] }>(`/demands/${demandId}/briefs`)).briefs,
    enabled: Boolean(demandId),
  });
}

export function useBrief(briefId: string | null) {
  return useQuery({
    queryKey: ['brief', briefId],
    queryFn: async () => apiFetch<BriefWire>(`/briefs/${briefId}`),
    enabled: Boolean(briefId),
  });
}

export function useCreateBrief(demandId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: BriefContentWire) =>
      apiFetch<BriefWire>('/briefs', { method: 'POST', body: JSON.stringify({ demandId, content }) }),
    onSuccess: (brief) => {
      queryClient.invalidateQueries({ queryKey: ['demand', demandId] });
      queryClient.invalidateQueries({ queryKey: ['briefs-by-demand', demandId] });
      queryClient.invalidateQueries({ queryKey: ['brief', brief.id] });
    },
  });
}

export function useDraftBriefFromDemand(demandId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<BriefWire & { draft_version: NonNullable<BriefWire['draft_version']> }>(`/demands/${demandId}/draft-brief`, { method: 'POST' }),
    onSuccess: (brief) => {
      queryClient.invalidateQueries({ queryKey: ['demand', demandId] });
      queryClient.invalidateQueries({ queryKey: ['briefs-by-demand', demandId] });
      queryClient.invalidateQueries({ queryKey: ['brief', brief.id] });
    },
  });
}

export function useAddBriefVersion(briefId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: BriefContentWire) => apiFetch(`/briefs/${briefId}/versions`, { method: 'POST', body: JSON.stringify({ content }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['brief', briefId] }),
  });
}

export function useApproveBriefVersion(briefId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => apiFetch<BriefWire>(`/briefs/${briefId}/approve-version`, { method: 'PATCH', body: JSON.stringify({ versionId }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['brief', briefId] }),
  });
}

export function useSendBriefToProduction(briefId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<BriefWire>(`/briefs/${briefId}/send-to-production`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['brief', briefId] }),
  });
}
