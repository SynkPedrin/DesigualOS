import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/** Estágios terminais: fora deles o card continua pollando (mesma lógica do
 * Studio — lista invertida, pra um status novo nunca congelar a tela). */
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export interface MotionVersionWire {
  version: number;
  quality: string;
  url: string | null;
  createdAt: string;
}

export interface MotionAssetsWire {
  logo: boolean;
  images: number;
  videos: number;
}

export interface MotionStatusWire {
  motionId: string;
  status: string;
  stage: string;
  stageDetail: string | null;
  format: string;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  renderVersion: number;
  previewUrl: string | null;
  finalUrl: string | null;
  error: string | null;
  errorCode: string | null;
  updatedAt: string;
  /** Campos novos do GET /motion/:id (contrato 24/09/2026). Opcionais enquanto
   * o backend termina de publicar — a UI trata ausência como null/vazio. */
  versions?: MotionVersionWire[] | undefined;
  clientName?: string | null | undefined;
  campaignName?: string | null | undefined;
  assets?: MotionAssetsWire | null | undefined;
}

export function useMotion(motionId: string | null) {
  return useQuery({
    queryKey: ['motion', motionId],
    queryFn: () => apiFetch<MotionStatusWire>(`/motion/${motionId}`),
    enabled: Boolean(motionId),
    refetchInterval: (query) => (query.state.data && TERMINAL.has(query.state.data.status) ? false : 4000),
  });
}

export function useUpdateMotion(motionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instruction: string) =>
      apiFetch<MotionStatusWire>(`/motion/${motionId}/update`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['motion', motionId] }),
  });
}

export function useRerenderMotion(motionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<MotionStatusWire>(`/motion/${motionId}/render`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['motion', motionId] }),
  });
}

export interface MotionProviderWire {
  provider: 'claude' | 'chatgpt';
  state: string;
  message: string;
  remedy: string | null;
  account: string | null;
  model: string | null;
  motionCapable: boolean;
  details: Record<string, string | boolean | null>;
  checkedAt: string;
}

export function useMotionProviders() {
  return useQuery({
    queryKey: ['motion', 'providers'],
    queryFn: () => apiFetch<{ providers: MotionProviderWire[] }>('/motion/providers'),
    // A checagem barata não chama a API da Anthropic, mas também não muda
    // sozinha: 60s é frequente o bastante pra notar um logout e raro o
    // bastante pra não spawnar processo a cada foco de janela.
    staleTime: 60_000,
    retry: false,
  });
}

export function useTestClaudeConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ provider: MotionProviderWire }>('/motion/providers/claude/test', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['motion', 'providers'] }),
  });
}
