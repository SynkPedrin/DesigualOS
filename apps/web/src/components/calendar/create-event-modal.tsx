'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Check, XCircle } from 'lucide-react';
import { useCollaborators } from '@/hooks/use-collaborators';
import { useCalendarAvailability, useCreateCalendarEvent, calendarConflictFrom, type CalendarConflictError } from '@/hooks/use-calendar';
import { useMe } from '@/hooks/use-me';
import { ApiRequestError } from '@/lib/api/client';

/**
 * "+ Novo evento" (§28/§29 do prompt "CALENDAR + AUTOMATIONS + BENTO V2"):
 * feedback de disponibilidade EM TEMPO REAL por participante ao escolher o
 * horário, e o modal de conflito (§19) quando o backend recusa por conflito
 * HARD — nunca cria silenciosamente.
 */
function paraInputDatetimeLocal(data: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}T${pad(data.getHours())}:${pad(data.getMinutes())}`;
}

export function CreateEventModal({ initialStart, onClose }: { initialStart: Date; onClose: () => void }) {
  const { data: me } = useMe();
  const collaborators = useCollaborators();
  const create = useCreateCalendarEvent();

  const [title, setTitle] = useState('');
  const [startInput, setStartInput] = useState(paraInputDatetimeLocal(initialStart));
  const [endInput, setEndInput] = useState(paraInputDatetimeLocal(new Date(initialStart.getTime() + 30 * 60_000)));
  const [location, setLocation] = useState('');
  const [visibility, setVisibility] = useState<'default' | 'private'>('default');
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [conflito, setConflito] = useState<CalendarConflictError | null>(null);

  const startAt = new Date(startInput);
  const endAt = new Date(endInput);
  const duracaoMinutos = Math.max(5, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));

  const todosParticipantes = useMemo(() => [...(me?.id ? [me.id] : []), ...participantIds], [me?.id, participantIds]);
  const disponibilidade = useCalendarAvailability(todosParticipantes, startAt, endAt, duracaoMinutos, todosParticipantes.length > 0 && !Number.isNaN(startAt.getTime()) && endAt > startAt);
  // Se existe um slot em comum que começa exatamente no horário pedido, todo mundo está livre.
  const todosLivres = disponibilidade.data?.some((slot) => new Date(slot.start).getTime() <= startAt.getTime() && new Date(slot.end).getTime() >= endAt.getTime()) ?? null;

  function alternarParticipante(userId: string) {
    setParticipantIds((atual) => {
      const novo = new Set(atual);
      if (novo.has(userId)) novo.delete(userId);
      else novo.add(userId);
      return novo;
    });
  }

  function submeter(force: boolean) {
    create.mutate(
      {
        title,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        location: location || undefined,
        visibility,
        participant_user_ids: [...participantIds],
        force,
      },
      {
        onSuccess: () => onClose(),
        onError: (error) => {
          const conflitoDetectado = calendarConflictFrom(error);
          if (conflitoDetectado) setConflito(conflitoDetectado);
        },
      },
    );
  }

  if (conflito) {
    return (
      <div className="fixed inset-0 z-[95] flex items-center justify-center bg-carbono/80 p-4">
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm rounded-lg border border-aviso/40 bg-grafite p-5">
          <h2 className="font-heading text-sm font-semibold text-branco-cru">Conflito de agenda</h2>
          <div className="mt-3 space-y-1.5">
            {conflito.conflicts.map((c) => (
              <p key={c.member_id} className="text-xs text-nevoa">
                Participante já ocupado entre{' '}
                <span className="text-branco-cru">
                  {new Date(c.busy_slot.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}–
                  {new Date(c.busy_slot.end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                .
              </p>
            ))}
          </div>
          {conflito.suggested_slots.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">Horários sugeridos</p>
              <div className="flex flex-wrap gap-1.5">
                {conflito.suggested_slots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => {
                      setStartInput(paraInputDatetimeLocal(new Date(slot.start)));
                      setEndInput(paraInputDatetimeLocal(new Date(slot.end)));
                      setConflito(null);
                    }}
                    className="rounded-md border border-grafite-elevado px-2 py-1 text-xs text-branco-cru hover:border-roxo-eletrico/50"
                  >
                    {new Date(slot.start).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConflito(null)} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">
              Escolher outro horário
            </button>
            <button type="button" onClick={() => submeter(true)} className="rounded-md border border-aviso/50 px-3 py-2 text-sm text-aviso hover:bg-aviso/10">
              Continuar mesmo assim
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-lg border border-grafite-elevado bg-grafite p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Novo evento</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-nevoa hover:text-branco-cru">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título"
            className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none" />
            <input type="datetime-local" value={endInput} onChange={(e) => setEndInput(e.target.value)} className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none" />
          </div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Local ou link da reunião"
            className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
          />

          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">Participantes</p>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {(collaborators.data?.collaborators ?? [])
                .filter((p) => p.userId !== me?.id)
                .map((p) => (
                  <label key={p.userId} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm text-branco-cru hover:bg-grafite-elevado/40">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={participantIds.has(p.userId)} onChange={() => alternarParticipante(p.userId)} className="accent-roxo-eletrico" />
                      {p.name}
                    </span>
                    {participantIds.has(p.userId) && todosParticipantes.length > 0 && !disponibilidade.isPending && (
                      <span className="flex items-center gap-1 text-[11px]">
                        {todosLivres ? (
                          <span className="flex items-center gap-1 text-sucesso">
                            <Check size={12} /> Disponível
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-erro">
                            <XCircle size={12} /> Ocupado(a)
                          </span>
                        )}
                      </span>
                    )}
                  </label>
                ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-nevoa">
            <input type="checkbox" checked={visibility === 'private'} onChange={(e) => setVisibility(e.target.checked ? 'private' : 'default')} className="accent-roxo-eletrico" />
            Evento privado (outros só veem &quot;ocupado&quot;)
          </label>

          {create.isError && !conflito && (
            <p className="text-xs text-erro">{create.error instanceof ApiRequestError ? create.error.message : 'Não foi possível criar o evento.'}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!title.trim() || endAt <= startAt || create.isPending}
              onClick={() => submeter(false)}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50"
            >
              {create.isPending ? 'Criando…' : 'Criar evento'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
