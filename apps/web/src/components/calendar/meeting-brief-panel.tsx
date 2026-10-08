'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useMeetingBrief } from '@/hooks/use-calendar';
import { ApiRequestError } from '@/lib/api/client';

/**
 * MeetingBriefPanel — Meeting Prep (§51-53 do prompt "CALENDAR + AUTOMATIONS
 * + BENTO V2", 06/10/2026). Aberto pelo link da notificação
 * (`/calendar?evento=<id>`) ou ao clicar numa reunião de cliente na agenda:
 * o mesmo contexto que o worker já tinha montado pra avisar, só que puxado
 * na hora em vez de reaproveitado da notificação (a notificação só carrega
 * título/link; o corpo completo vive aqui, sempre fresco).
 */
export function MeetingBriefPanel({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { data: brief, isPending, isError, error } = useMeetingBrief(eventId);

  const mensagemDeErro =
    error instanceof ApiRequestError ? error.message : 'Não foi possível carregar o contexto desta reunião.';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-grafite-elevado bg-grafite p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Meeting Brief</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-nevoa transition-colors hover:text-branco-cru">
            <X size={16} />
          </button>
        </div>

        {isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : isError || !brief ? (
          <p className="text-sm text-erro">{mensagemDeErro}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-heading text-base font-semibold text-branco-cru">{brief.event.title ?? 'Reunião'}</p>
              <p className="mt-0.5 text-sm text-nevoa">{brief.client.name}</p>
              <p className="mt-1 font-mono text-[11px] text-nevoa">
                {new Date(brief.event.start_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} —{' '}
                {new Date(brief.event.end_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
              {brief.event.location && <p className="mt-1 text-sm text-nevoa">{brief.event.location}</p>}
              {brief.event.meeting_url && (
                <a href={brief.event.meeting_url} target="_blank" rel="noreferrer" className="mt-1 block text-sm text-roxo-eletrico hover:underline">
                  {brief.event.meeting_url}
                </a>
              )}
            </div>

            <Secao titulo="Participantes">
              <ul className="space-y-1 text-sm text-branco-cru">
                {brief.participants.internal.map((p) => (
                  <li key={p.user_id}>{p.name}</li>
                ))}
                {brief.participants.external.map((p, i) => (
                  <li key={p.contact_id ?? i} className="text-nevoa">
                    {p.name ?? p.email ?? 'Convidado externo'}
                  </li>
                ))}
              </ul>
            </Secao>

            <Secao titulo={`Demandas abertas (${brief.demands.open_count})`}>
              {brief.demands.items.length === 0 ? (
                <p className="text-sm text-nevoa">Nenhuma.</p>
              ) : (
                <ul className="space-y-1 text-sm text-branco-cru">
                  {brief.demands.items.map((d) => (
                    <li key={d.id}>{d.title}</li>
                  ))}
                </ul>
              )}
            </Secao>

            <Secao titulo={`Briefs em aberto (${brief.briefs.open_count})`}>
              {brief.briefs.items.length === 0 ? (
                <p className="text-sm text-nevoa">Nenhum.</p>
              ) : (
                <ul className="space-y-1 text-sm text-branco-cru">
                  {brief.briefs.items.map((b) => (
                    <li key={b.id}>{b.demand_title}</li>
                  ))}
                </ul>
              )}
            </Secao>

            <Secao titulo={`Aprovações pendentes (${brief.approvals.pending_count})`}>
              {brief.approvals.items.length === 0 ? <p className="text-sm text-nevoa">Nenhuma.</p> : <p className="text-sm text-branco-cru">{brief.approvals.pending_count} aguardando decisão.</p>}
            </Secao>

            {brief.last_conversation && (
              <Secao titulo="Última conversa">
                <p className="text-sm text-branco-cru">{brief.last_conversation.title ?? 'Sem título'}</p>
              </Secao>
            )}

            {brief.previous_meeting && (
              <Secao titulo="Reunião anterior">
                <p className="text-sm text-branco-cru">{brief.previous_meeting.title ?? 'Sem título'}</p>
                {brief.previous_meeting.description && <p className="mt-1 text-sm text-nevoa">{brief.previous_meeting.description}</p>}
              </Secao>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">{titulo}</p>
      {children}
    </div>
  );
}
