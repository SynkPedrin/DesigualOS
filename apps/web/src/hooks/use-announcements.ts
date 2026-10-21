'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * ANÚNCIOS DE FUNCIONALIDADE — o que o servidor diz que esta pessoa pode ver
 * (elegibilidade é decidida lá: módulo, rollout, conta ativa) e o que ela já
 * fez com cada um. O estado mora no banco: outra aba ou outro aparelho veem o
 * mesmo. localStorage aqui só guarda a etapa do tutorial para recarregar a
 * página no meio — a decisão de abrir nunca vem dele.
 */

export type EstadoDoAnuncio = 'not_seen' | 'dismissed' | 'in_progress' | 'completed';

export interface AcaoDoAnuncio {
  label: string;
  action: 'start_tutorial' | 'navigate' | 'dismiss';
  href?: string;
}

export interface Anuncio {
  id: string;
  key: string;
  type: string;
  title: string;
  subtitle: string | null;
  description: string;
  version: number;
  preview_image_url: string | null;
  primary_cta: AcaoDoAnuncio;
  secondary_cta: AcaoDoAnuncio | null;
  tutorial_id: string | null;
  tutorial_version: number;
  priority: number;
  icon: string | null;
  auto_open: boolean;
  state: EstadoDoAnuncio;
  tutorial_step: number | null;
  completed_at: string | null;
}

export type EventoDoAnuncio = 'shown' | 'dismissed' | 'started' | 'step' | 'completed';

export const anunciosKey = ['announcements'] as const;

export function useAnnouncements(enabled = true) {
  return useQuery({
    queryKey: anunciosKey,
    queryFn: () => apiFetch<{ announcements: Anuncio[] }>('/announcements').then((r) => r.announcements),
    enabled,
    staleTime: 5 * 60_000,
    // Anúncio é cortesia: falhou, não insiste nem mostra erro — tenta de novo na próxima entrada.
    retry: false,
  });
}

/** Registra um evento. Falha de rede não trava nada na tela (o tutorial segue); só não grava. */
export async function registrarEventoDoAnuncio(key: string, event: EventoDoAnuncio, step?: number | null) {
  return apiFetch<{ first: boolean; announcement: Anuncio }>(`/announcements/${encodeURIComponent(key)}/events`, {
    method: 'POST',
    body: JSON.stringify({ event, ...(step !== undefined && step !== null ? { step } : {}) }),
  });
}

export function useAnnouncementEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; event: EventoDoAnuncio; step?: number | null }) => registrarEventoDoAnuncio(v.key, v.event, v.step),
    onSuccess: (r) => {
      qc.setQueryData<Anuncio[]>(anunciosKey, (lista) => lista?.map((a) => (a.key === r.announcement.key ? r.announcement : a)));
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Administração (Desigual)
// ---------------------------------------------------------------------------

export interface AnuncioAdmin {
  key: string;
  type: string;
  title: string;
  active: boolean;
  rollout: 'off' | 'qa' | 'all';
  priority: number;
  audience: { modules?: string[]; roles?: string[]; organization_ids?: string[] };
  qa_user_ids: string[];
  published_at: string;
  expires_at: string | null;
  tutorial_id: string | null;
  stats: { vistos: number; apresentados: number; dispensados: number; em_andamento: number; concluidos: number };
}

export function useAnnouncementsAdmin(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: () => apiFetch<{ announcements: AnuncioAdmin[] }>('/admin/announcements').then((r) => r.announcements),
    enabled,
  });
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string } & Partial<Pick<AnuncioAdmin, 'active' | 'rollout' | 'priority' | 'qa_user_ids'>>) => {
      const { key, ...corpo } = v;
      return apiFetch(`/admin/announcements/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(corpo) });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      void qc.invalidateQueries({ queryKey: anunciosKey });
    },
  });
}
