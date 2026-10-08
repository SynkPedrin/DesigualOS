'use client';

import type { CalendarEventWire } from '@/lib/api/contracts';

/**
 * Grade semanal do Calendar Core (§70 do prompt "CALENDAR + AUTOMATIONS +
 * BENTO V2": "não uma grade HTML básica" — isto posiciona por horário real,
 * não lista plana). Expediente 7h-21h; fora disso o evento ainda aparece
 * (nunca corta dado), só comprimido na borda.
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
  return Math.max(0, Math.min(100, (minutosDesdeInicio / (TOTAL_HORAS * 72)) * 100));
}

export function WeekView({
  dias,
  eventosPorDia,
  onSelecionarEvento,
}: {
  dias: Date[];
  eventosPorDia: Map<string, CalendarEventWire[]>;
  onSelecionarEvento: (evento: CalendarEventWire) => void;
}) {
  const hoje = new Date();
  const ehHoje = (d: Date) => d.toDateString() === hoje.toDateString();

  return (
    <div className="flex overflow-hidden rounded-lg border border-grafite-elevado">
      {/* Coluna de horas */}
      <div className="w-14 shrink-0 border-r border-grafite-elevado bg-grafite">
        <div className="h-10 border-b border-grafite-elevado" />
        <div className="relative" style={{ height: `${TOTAL_HORAS * 72}px` }}>
          {Array.from({ length: TOTAL_HORAS }, (_, i) => (
            <div key={i} className="absolute left-0 right-0 border-t border-grafite-elevado/60 px-1 text-[10px] text-nevoa" style={{ top: `${(i / TOTAL_HORAS) * 100}%` }}>
              {HORA_INICIO + i}h
            </div>
          ))}
        </div>
      </div>

      {/* Colunas dos dias */}
      {dias.map((dia) => {
        const chave = dia.toDateString();
        const eventos = eventosPorDia.get(chave) ?? [];
        return (
          <div key={chave} className="min-w-0 flex-1 border-r border-grafite-elevado last:border-r-0">
            <div className={`flex h-10 flex-col items-center justify-center border-b border-grafite-elevado ${ehHoje(dia) ? 'bg-roxo-eletrico/10' : ''}`}>
              <p className="font-mono text-[10px] uppercase text-nevoa">{dia.toLocaleDateString('pt-BR', { weekday: 'short' })}</p>
              <p className={`text-sm font-semibold ${ehHoje(dia) ? 'text-roxo-eletrico' : 'text-branco-cru'}`}>{dia.getDate()}</p>
            </div>
            <div className="relative" style={{ height: `${TOTAL_HORAS * 72}px` }}>
              {Array.from({ length: TOTAL_HORAS }, (_, i) => (
                <div key={i} className="absolute left-0 right-0 border-t border-grafite-elevado/40" style={{ top: `${(i / TOTAL_HORAS) * 100}%` }} />
              ))}
              {eventos.map((evento) => {
                const topo = offsetPercent(new Date(evento.start_at), dia);
                const fimPct = offsetPercent(new Date(evento.end_at), dia);
                const altura = Math.max(fimPct - topo, 3);
                const duracaoMinutos = (new Date(evento.end_at).getTime() - new Date(evento.start_at).getTime()) / 60_000;
                const cancelado = evento.status === 'cancelled';
                return (
                  <button
                    key={evento.id}
                    type="button"
                    onClick={() => onSelecionarEvento(evento)}
                    className={`absolute left-1 right-1 overflow-hidden rounded-md border px-2.5 py-1 text-left text-xs leading-tight transition-colors ${
                      cancelado
                        ? 'border-grafite-elevado bg-grafite-elevado/40 text-nevoa line-through'
                        : evento.visible
                          ? 'border-roxo-eletrico/40 bg-roxo-eletrico/20 text-branco-cru hover:border-roxo-eletrico/70'
                          : 'border-grafite-elevado bg-grafite-elevado text-nevoa'
                    }`}
                    style={{ top: `${topo}%`, height: `${altura}%` }}
                  >
                    <span className="block truncate font-semibold">{evento.visible ? evento.title : 'Ocupado'}</span>
                    {duracaoMinutos >= 20 && (
                      <span className="block truncate font-mono text-[10px] leading-tight opacity-80">
                        {new Date(evento.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {evento.visible && evento.location ? ` · ${evento.location}` : ''}
                      </span>
                    )}
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
