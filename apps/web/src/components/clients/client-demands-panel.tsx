'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LinhasFantasma, SemNadaAinda } from '@/components/control/primitives';
import { useCreateDemand, useDemands } from '@/hooks/use-demands';
import { formatRelativeTime } from '@/lib/format';
import type { DemandSource, DemandStatus } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<DemandStatus, string> = {
  new: 'Nova',
  briefing: 'Em briefing',
  in_production: 'Em produção',
  done: 'Concluída',
  cancelled: 'Cancelada',
};

/**
 * DEMANDAS DESTE CLIENTE — o elo CONVERSA/PEDIDO → BRIEFING → PRODUÇÃO visto
 * a partir da conta, não do inbox. Não duplica a tela de Brief/Aprovação (que
 * vive em `/demands/:id`) — aqui é só "o que foi pedido e em que pé está",
 * com um link pra abrir o resto.
 */
export function ClientDemandsPanel({
  clientId,
  conversationThreadId,
}: {
  clientId: string;
  /** Quando aberto a partir de UMA conversa (Inbox), a demanda criada aqui
   *  carrega o elo — mesmo requisito do botão "Criar demanda" que esta aba
   *  substitui ali, nunca perdido ao virar aba compartilhada. */
  conversationThreadId?: string | null;
}) {
  const { data: demands, isPending, isError } = useDemands({ clientId });
  const createDemand = useCreateDemand();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');

  if (isPending) return <LinhasFantasma linhas={4} />;

  if (isError) {
    return (
      <SemNadaAinda
        titulo="Não consegui ler as demandas deste cliente"
        explicacao="A consulta falhou. É a API, não a conta — se continuar, vale avisar quem cuida do sistema."
      />
    );
  }

  function criar() {
    if (!title.trim()) return;
    const source: DemandSource = conversationThreadId ? 'whatsapp' : 'manual';
    createDemand.mutate(
      { clientId, title: title.trim(), source, conversationThreadId: conversationThreadId ?? null },
      { onSuccess: () => { setTitle(''); setShowForm(false); } },
    );
  }

  return (
    <div className="space-y-4">
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:border-roxo-eletrico/50 hover:text-branco-cru"
        >
          + Lançar demanda manualmente
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título da demanda"
            className="min-w-[240px] flex-1 rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-sm text-branco-cru"
          />
          <button
            type="button"
            disabled={!title.trim() || createDemand.isPending}
            onClick={criar}
            className="rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm font-semibold text-branco-cru disabled:opacity-50"
          >
            {createDemand.isPending ? 'Criando…' : 'Criar'}
          </button>
          <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa">
            Cancelar
          </button>
        </div>
      )}

      {!demands || demands.length === 0 ? (
        <SemNadaAinda
          titulo="Nenhuma demanda deste cliente ainda"
          explicacao="Demandas chegam pelo Inbox (conversa real) ou são lançadas aqui direto — do pedido ao briefing aprovado."
        />
      ) : (
        <ul className="space-y-2">
          {demands.map((d) => (
            <li key={d.id}>
              <Link
                href={`/demands/${d.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-grafite-elevado bg-grafite px-3.5 py-2.5 transition-colors hover:border-roxo-eletrico/60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-branco-cru">{d.title}</p>
                  <p className="text-xs text-nevoa">{formatRelativeTime(d.requestedAt)}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider',
                    d.status === 'done' || d.status === 'cancelled'
                      ? 'border-grafite-elevado bg-carbono text-nevoa'
                      : 'border-sinal/40 bg-sinal/10 text-sinal',
                  )}
                >
                  {STATUS_LABEL[d.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
