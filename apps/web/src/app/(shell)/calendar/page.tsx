'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import { useIsMaster } from '@/hooks/use-is-master';
import { useCollaborators } from '@/hooks/use-collaborators';
import { useCalendarEvents, useCalendarEventsForMembers, useCancelCalendarEvent } from '@/hooks/use-calendar';
import { WeekView } from '@/components/calendar/week-view';
import { ResourceTimelineView } from '@/components/calendar/resource-timeline-view';
import { ResourcePicker } from '@/components/calendar/resource-picker';
import { CreateEventModal } from '@/components/calendar/create-event-modal';
import { GoogleCalendarConnect } from '@/components/calendar/google-calendar-connect';
import { MicrosoftCalendarConnect } from '@/components/calendar/microsoft-calendar-connect';
import { MeetingBriefPanel } from '@/components/calendar/meeting-brief-panel';
import type { CalendarEventWire } from '@/lib/api/contracts';

/**
 * CALENDÁRIO PESSOAL + CALENDÁRIO DA AGÊNCIA (§6-9 do prompt "CALENDAR +
 * AUTOMATIONS + BENTO V2", 06/10/2026): "a camada temporal da operação" — o
 * mesmo Calendar Service, duas visões (minha semana / agenda de colaboradores
 * selecionados num dia), nunca dois sistemas separados. A visão da agência é
 * gestão (gated por `useIsMaster`, mesma convenção já usada em /workflows) —
 * o backend não distingue capability "própria" de "equipe" hoje, mas cada
 * chamada por member_id já redacta evento privado pra quem não é o dono.
 */
function inicioDaSemana(data: Date): Date {
  const d = new Date(data);
  const diaDaSemana = d.getDay();
  d.setDate(d.getDate() - diaDaSemana);
  d.setHours(0, 0, 0, 0);
  return d;
}

function CalendarPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: me } = useMe();
  const { isMaster } = useIsMaster();
  const [visao, setVisao] = useState<'pessoal' | 'agencia'>('pessoal');
  const [referencia, setReferencia] = useState(() => new Date());
  const [criando, setCriando] = useState<Date | null>(null);
  const [selecionado, setSelecionado] = useState<CalendarEventWire | null>(null);
  const cancelar = useCancelCalendarEvent();

  // Link da notificação do Meeting Prep (`/calendar?evento=<id>`, §51-53) abre
  // o Meeting Brief direto, sem precisar achar a reunião na semana certa.
  const eventoDoLink = searchParams.get('evento');
  function fecharMeetingBrief() {
    router.replace('/calendar', { scroll: false });
  }

  const inicioSemana = useMemo(() => inicioDaSemana(referencia), [referencia]);
  const fimSemana = useMemo(() => new Date(inicioSemana.getTime() + 7 * 24 * 60 * 60_000), [inicioSemana]);
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(inicioSemana.getTime() + i * 24 * 60 * 60_000)), [inicioSemana]);

  const eventos = useCalendarEvents({ from: inicioSemana, to: fimSemana, memberId: me?.id });

  const eventosPorDia = useMemo(() => {
    const mapa = new Map<string, CalendarEventWire[]>();
    for (const evento of eventos.data ?? []) {
      const chave = new Date(evento.start_at).toDateString();
      const lista = mapa.get(chave) ?? [];
      lista.push(evento);
      mapa.set(chave, lista);
    }
    return mapa;
  }, [eventos.data]);

  // Calendário da Agência (§6-9) — mesma `referencia`, mas um dia só por vez
  // (não faz sentido ver a semana inteira de 6 pessoas lado a lado).
  const diaAgencia = useMemo(() => {
    const d = new Date(referencia);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [referencia]);
  const fimDiaAgencia = useMemo(() => new Date(diaAgencia.getTime() + 24 * 60 * 60_000), [diaAgencia]);

  const collaboratorsQuery = useCollaborators();
  const colaboradores = useMemo(
    () => (collaboratorsQuery.data?.collaborators ?? []).map((c) => ({ userId: c.userId, name: c.name, avatarUrl: c.avatarUrl })),
    [collaboratorsQuery.data],
  );
  const [selecionadosAgencia, setSelecionadosAgencia] = useState<Set<string>>(new Set());
  function alternarColaborador(userId: string) {
    setSelecionadosAgencia((atual) => {
      const novo = new Set(atual);
      if (novo.has(userId)) novo.delete(userId);
      else novo.add(userId);
      return novo;
    });
  }
  const idsAgencia = useMemo(() => Array.from(selecionadosAgencia), [selecionadosAgencia]);
  const colaboradoresSelecionados = useMemo(() => colaboradores.filter((c) => selecionadosAgencia.has(c.userId)), [colaboradores, selecionadosAgencia]);
  const { eventosPorMembro, isPending: agenciaPending } = useCalendarEventsForMembers(idsAgencia, diaAgencia, fimDiaAgencia);

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader eyebrow="Calendário" title={visao === 'pessoal' ? 'Sua semana' : 'Agenda da agência'} />
        {isMaster && (
          <div className="flex items-center gap-1 rounded-md border border-grafite-elevado p-1">
            <button
              type="button"
              onClick={() => setVisao('pessoal')}
              className={`rounded px-3 py-1 text-sm transition-colors ${visao === 'pessoal' ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru'}`}
            >
              Minha agenda
            </button>
            <button
              type="button"
              onClick={() => setVisao('agencia')}
              className={`rounded px-3 py-1 text-sm transition-colors ${visao === 'agencia' ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru'}`}
            >
              Agência
            </button>
          </div>
        )}
      </div>

      {/* Outlook primeiro: é o calendário que a operação usa de verdade
       * (07/10/2026, pedido explícito do usuário). Google Calendar continua
       * disponível — não foi removido, só deixou de ser o provider principal. */}
      {visao === 'pessoal' && <MicrosoftCalendarConnect />}
      {visao === 'pessoal' && <GoogleCalendarConnect />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReferencia(new Date(referencia.getTime() - (visao === 'pessoal' ? 7 : 1) * 24 * 60 * 60_000))}
            className="rounded-md border border-grafite-elevado p-1.5 text-nevoa hover:text-branco-cru"
          >
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => setReferencia(new Date())} className="rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru">
            Hoje
          </button>
          <button
            type="button"
            onClick={() => setReferencia(new Date(referencia.getTime() + (visao === 'pessoal' ? 7 : 1) * 24 * 60 * 60_000))}
            className="rounded-md border border-grafite-elevado p-1.5 text-nevoa hover:text-branco-cru"
          >
            <ChevronRight size={16} />
          </button>
          {visao === 'pessoal' ? (
            <p className="ml-2 text-sm text-branco-cru">
              {inicioSemana.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} — {new Date(fimSemana.getTime() - 86_400_000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </p>
          ) : (
            <p className="ml-2 text-sm text-branco-cru">
              {diaAgencia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' })}
            </p>
          )}
          {visao === 'agencia' && (
            <ResourcePicker colaboradores={colaboradores} selecionados={selecionadosAgencia} onAlternar={alternarColaborador} />
          )}
        </div>
        <button
          type="button"
          onClick={() => setCriando(new Date())}
          className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
        >
          <Plus size={14} /> Novo evento
        </button>
      </div>

      {visao === 'pessoal' ? (
        eventos.isPending ? <Skeleton className="h-[700px] w-full" /> : <WeekView dias={dias} eventosPorDia={eventosPorDia} onSelecionarEvento={setSelecionado} />
      ) : agenciaPending && idsAgencia.length > 0 ? (
        <Skeleton className="h-[700px] w-full" />
      ) : (
        <ResourceTimelineView dia={diaAgencia} colaboradores={colaboradoresSelecionados} eventosPorColaborador={eventosPorMembro} onSelecionarEvento={setSelecionado} />
      )}

      {criando && <CreateEventModal initialStart={criando} onClose={() => setCriando(null)} />}

      {selecionado && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4" onClick={() => setSelecionado(null)}>
          <div className="w-full max-w-sm rounded-lg border border-grafite-elevado bg-grafite p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-heading text-sm font-semibold text-branco-cru">{selecionado.visible ? selecionado.title : 'Ocupado'}</h2>
            <p className="mt-1 font-mono text-[11px] text-nevoa">
              {new Date(selecionado.start_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} —{' '}
              {new Date(selecionado.end_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
            {selecionado.visible && selecionado.location && <p className="mt-2 text-sm text-nevoa">{selecionado.location}</p>}
            {selecionado.visible && selecionado.description && <p className="mt-2 text-sm text-nevoa">{selecionado.description}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSelecionado(null)} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">
                Fechar
              </button>
              {selecionado.visible && selecionado.client_id && (
                <button
                  type="button"
                  onClick={() => {
                    const eventoId = selecionado.id;
                    setSelecionado(null);
                    router.replace(`/calendar?evento=${eventoId}`, { scroll: false });
                  }}
                  className="rounded-md border border-grafite-elevado px-3 py-2 text-sm text-nevoa hover:text-branco-cru"
                >
                  Ver contexto da reunião
                </button>
              )}
              {selecionado.visible && selecionado.created_by === me?.id && selecionado.status !== 'cancelled' && (
                <button
                  type="button"
                  onClick={() => {
                    cancelar.mutate(selecionado.id);
                    setSelecionado(null);
                  }}
                  className="rounded-md border border-erro/50 px-3 py-2 text-sm text-erro hover:bg-erro/10"
                >
                  Cancelar evento
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {eventoDoLink && <MeetingBriefPanel eventId={eventoDoLink} onClose={fecharMeetingBrief} />}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageContent />
    </Suspense>
  );
}
