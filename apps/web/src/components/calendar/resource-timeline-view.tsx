'use client';

import type { CalendarEventWire } from '@/lib/api/contracts';
import { EntityAvatar } from '@/components/ui/entity-avatar';

/**
 * Calendário da Agência (§6-9 do prompt "CALENDAR + AUTOMATIONS + BENTO V2"):
 * uma coluna por colaborador, não um dia — "quem está livre agora" em vez de
 * "o que eu tenho esta semana". Mesma grade de horário do WeekView (7h-21h,
 * nunca corta evento fora do expediente), mesmo endpoint (`/calendar/events`
 * por member_id), só a chave da coluna muda de dia para pessoa. Eventos
 * privados de outra pessoa já chegam redactados pelo backend (`visible:false`
 * → "Ocupado") — esta tela não decide privacidade, só exibe o que veio.
 */
const HORA_INICIO = 7;
const HORA_FIM = 21;
const TOTAL_HORAS = HORA_FIM - HORA_INICIO;

function inicioDoDia(data: Date): Date {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

function offsetPercent(data: Date, diaBase: Date): number {
  const minutosDoDia = (data.getTime() - inicioDoDia(diaBase).getTime()) / 60_000;
  const minutosDesdeInicio = minutosDoDia - HORA_INICIO * 60;
  return Math.max(0, Math.min(100, (minutosDesdeInicio / (TOTAL_HORAS * 60)) * 100));
}

export interface ColaboradorDaAgenda {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export function ResourceTimelineView({
  dia,
  colaboradores,
  eventosPorColaborador,
  onSelecionarEvento,
}: {
  dia: Date;
  colaboradores: ColaboradorDaAgenda[];
  eventosPorColaborador: Map<string, CalendarEventWire[]>;
  onSelecionarEvento: (evento: CalendarEventWire) => void;
}) {
  if (colaboradores.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-grafite-elevado text-sm text-nevoa">
        Selecione ao menos um colaborador para ver a agenda da agência.
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden rounded-lg border border-grafite-elevado">
      <div className="w-14 shrink-0 border-r border-grafite-elevado bg-grafite">
        <div className="h-16 border-b border-grafite-elevado" />
        <div className="relative" style={{ height: `${TOTAL_HORAS * 48}px` }}>
          {Array.from({ length: TOTAL_HORAS }, (_, i) => (
            <div key={i} className="absolute left-0 right-0 border-t border-grafite-elevado/60 px-1 text-[10px] text-nevoa" style={{ top: `${(i / TOTAL_HORAS) * 100}%` }}>
              {HORA_INICIO + i}h
            </div>
          ))}
        </div>
      </div>

      {colaboradores.map((colaborador) => {
        const eventos = eventosPorColaborador.get(colaborador.userId) ?? [];
        return (
          <div key={colaborador.userId} className="min-w-0 flex-1 border-r border-grafite-elevado last:border-r-0">
            <div className="flex h-16 flex-col items-center justify-center gap-1 border-b border-grafite-elevado px-1">
              <EntityAvatar name={colaborador.name} photoUrl={colaborador.avatarUrl} kind="person" size="sm" />
              <p className="w-full truncate text-center text-[11px] font-medium text-branco-cru">{colaborador.name}</p>
            </div>
            <div className="relative" style={{ height: `${TOTAL_HORAS * 48}px` }}>
              {Array.from({ length: TOTAL_HORAS }, (_, i) => (
                <div key={i} className="absolute left-0 right-0 border-t border-grafite-elevado/40" style={{ top: `${(i / TOTAL_HORAS) * 100}%` }} />
              ))}
              {eventos.map((evento) => {
                const topo = offsetPercent(new Date(evento.start_at), dia);
                const fimPct = offsetPercent(new Date(evento.end_at), dia);
                const altura = Math.max(fimPct - topo, 3);
                const cancelado = evento.status === 'cancelled';
                return (
                  <button
                    key={evento.id}
                    type="button"
                    onClick={() => onSelecionarEvento(evento)}
                    className={`absolute left-0.5 right-0.5 overflow-hidden rounded-sm border px-1.5 py-0.5 text-left text-[10px] transition-colors ${
                      cancelado
                        ? 'border-grafite-elevado bg-grafite-elevado/40 text-nevoa line-through'
                        : evento.visible
                          ? 'border-roxo-eletrico/40 bg-roxo-eletrico/20 text-branco-cru hover:border-roxo-eletrico/70'
                          : 'border-grafite-elevado bg-grafite-elevado text-nevoa'
                    }`}
                    style={{ top: `${topo}%`, height: `${altura}%` }}
                  >
                    <span className="block truncate font-medium">{evento.visible ? evento.title : 'Ocupado'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
