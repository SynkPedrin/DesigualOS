'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { useMe } from '@/hooks/use-me';
import { useCalendarEvents } from '@/hooks/use-calendar';
import { useAgendas } from './microsoft-calendar-connect';
import { agruparAgendasDaEquipe, juntarEventos, type AgendaDaEquipe } from './cores-das-agendas';
import type { ModoDaAgenda } from './abas-de-agendas';

/** As agendas do Outlook de toda a equipe, com nome (GET /calendar/agendas). */
export function useAgendasDaEquipe(enabled: boolean) {
  return useQuery({
    queryKey: ['calendar', 'agendas-da-equipe'],
    queryFn: async () => (await apiFetch<{ agendas: AgendaDaEquipe[] }>('/calendar/agendas')).agendas,
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * Os eventos e as abas de agenda do modo escolhido, no Calendário e no Daily. "Geral" traz os eventos da organização
 * inteira (o backend já esconde o motivo dos eventos privados de quem não participa), juntos e agrupados pelo nome da
 * agenda; "Minha agenda" traz só os de quem está vendo, com as agendas vinculadas por essa pessoa.
 */
export function useAgendaDoModo(modo: ModoDaAgenda, from: Date, to: Date) {
  const { data: me } = useMe();
  const minhas = useAgendas();
  const geral = modo === 'geral';
  const daEquipe = useAgendasDaEquipe(geral);
  const pessoais = useCalendarEvents({ from, to, memberId: me?.id }, { enabled: !geral && Boolean(me?.id) });
  const todos = useCalendarEvents({ from, to }, { enabled: geral });
  const grupos = useMemo(() => agruparAgendasDaEquipe(daEquipe.data ?? []), [daEquipe.data]);
  const eventos = useMemo(() => {
    if (!geral) return pessoais.data;
    return todos.data ? juntarEventos(todos.data, grupos.grupoDe, grupos.agendas) : undefined;
  }, [geral, pessoais.data, todos.data, grupos]);

  return {
    eventos,
    isPending: geral ? todos.isPending : pessoais.isPending,
    agendas: geral ? grupos.agendas : minhas.agendas,
    paraAdicionar: minhas.paraAdicionar,
    adicionar: minhas.adicionar,
    adicionando: minhas.adicionando,
  };
}
