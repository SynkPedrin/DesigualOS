import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import type { CalendarAvailabilitySlotWire, CalendarConflictWire, CalendarEventWire, MeetingBriefWire } from '@/lib/api/contracts';

/** Eventos no intervalo [from, to) — filtra por membro e/ou cliente quando dado. */
export function useCalendarEvents(params: { from: Date; to: Date; memberId?: string | undefined; clientId?: string | undefined }) {
  const search = new URLSearchParams({ from: params.from.toISOString(), to: params.to.toISOString() });
  if (params.memberId) search.set('member_id', params.memberId);
  if (params.clientId) search.set('client_id', params.clientId);

  return useQuery({
    queryKey: ['calendar', 'events', params.from.toISOString(), params.to.toISOString(), params.memberId ?? null, params.clientId ?? null],
    queryFn: async () => {
      const wire = await apiFetch<{ events: CalendarEventWire[] }>(`/calendar/events?${search.toString()}`);
      return wire.events;
    },
  });
}

/** Mesmo endpoint de `useCalendarEvents`, uma chamada por membro (Calendário
 * da Agência, §6-9 — cada coluna é um colaborador, não existe rota que
 * devolva vários member_id de uma vez). Privacidade de quem não é o
 * selecionado continua redactada pelo backend, igual à visão pessoal. */
export function useCalendarEventsForMembers(memberIds: string[], from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const resultados = useQueries({
    queries: memberIds.map((memberId) => ({
      queryKey: ['calendar', 'events', fromIso, toIso, memberId, null],
      queryFn: async () => {
        const search = new URLSearchParams({ from: fromIso, to: toIso, member_id: memberId });
        const wire = await apiFetch<{ events: CalendarEventWire[] }>(`/calendar/events?${search.toString()}`);
        return wire.events;
      },
    })),
  });

  const eventosPorMembro = new Map<string, CalendarEventWire[]>();
  memberIds.forEach((memberId, i) => eventosPorMembro.set(memberId, resultados[i]?.data ?? []));

  return { eventosPorMembro, isPending: resultados.some((r) => r.isPending) };
}

export interface CreateCalendarEventInput {
  title: string;
  description?: string | undefined;
  client_id?: string | undefined;
  start_at: string;
  end_at: string;
  location?: string | undefined;
  meeting_url?: string | undefined;
  visibility?: 'default' | 'private' | undefined;
  participant_user_ids?: string[] | undefined;
  force?: boolean | undefined;
}

/** Corpo do 409 — "Conflito de agenda" (§19). Erro tipado pra UI mostrar o modal certo, não uma mensagem genérica. */
export interface CalendarConflictError {
  error: string;
  conflicts: CalendarConflictWire[];
  suggested_slots: CalendarAvailabilitySlotWire[];
}

export function calendarConflictFrom(error: unknown): CalendarConflictError | null {
  if (!(error instanceof ApiRequestError) || error.status !== 409 || !error.body) return null;
  return error.body as CalendarConflictError;
}

export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCalendarEventInput) => apiFetch<CalendarEventWire>('/calendar/events', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

export function useCancelCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => apiFetch(`/calendar/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

/** Meeting Prep (§51-53) — o mesmo contexto que a notificação do worker aponta, buscado só quando o viewer abre o link. */
export function useMeetingBrief(eventId: string | null) {
  return useQuery({
    queryKey: ['calendar', 'meeting-brief', eventId],
    queryFn: () => apiFetch<MeetingBriefWire>(`/calendar/events/${eventId}/meeting-brief`),
    enabled: Boolean(eventId),
  });
}

/** Disponibilidade em comum — alimenta o feedback "✅ Disponível / ❌ Ocupada" ao montar um evento (§29). */
export function useCalendarAvailability(memberIds: string[], from: Date, to: Date, durationMinutes: number, enabled: boolean) {
  const search = new URLSearchParams({ member_ids: memberIds.join(','), from: from.toISOString(), to: to.toISOString(), duration_minutes: String(durationMinutes) });
  return useQuery({
    queryKey: ['calendar', 'availability', memberIds.join(','), from.toISOString(), to.toISOString(), durationMinutes],
    queryFn: async () => {
      const wire = await apiFetch<{ slots: CalendarAvailabilitySlotWire[] }>(`/calendar/availability?${search.toString()}`);
      return wire.slots;
    },
    enabled: enabled && memberIds.length > 0,
  });
}
