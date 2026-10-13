'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Surface } from '@/components/ui/surface';
import { formatRelativeTime } from '@/lib/format';
import { useCreateDemand, useDemands } from '@/hooks/use-demands';
import { useClients } from '@/hooks/use-clients';
import type { DemandStatus } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const FILTERS: Array<{ key: DemandStatus | 'all'; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'new', label: 'Novas' },
  { key: 'briefing', label: 'Em briefing' },
  { key: 'in_production', label: 'Em produção' },
  { key: 'done', label: 'Concluídas' },
  { key: 'cancelled', label: 'Canceladas' },
];

const STATUS_LABEL: Record<DemandStatus, string> = {
  new: 'Nova',
  briefing: 'Em briefing',
  in_production: 'Em produção',
  done: 'Concluída',
  cancelled: 'Cancelada',
};

const STATUS_CLASS: Record<DemandStatus, string> = {
  new: 'border-sinal/40 bg-sinal/10 text-sinal',
  briefing: 'border-roxo-eletrico/40 bg-roxo-eletrico/10 text-roxo-eletrico',
  in_production: 'border-aviso/40 bg-aviso/10 text-aviso',
  done: 'border-grafite-elevado bg-carbono text-nevoa',
  cancelled: 'border-grafite-elevado bg-carbono text-nevoa',
};

export default function DemandsPage() {
  const [filter, setFilter] = useState<DemandStatus | 'all'>('all');
  const [criando, setCriando] = useState(false);
  const { data: demands, isPending, isError, refetch } = useDemands(filter === 'all' ? {} : { status: filter });

  return (
    <div>
      <PageHeader
        eyebrow="Operação"
        title="Campanhas"
        description="O que a equipe trabalha para cada cliente, pedido, briefing, arquivos e histórico, tudo num lugar só."
        actions={
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3.5 py-2 text-[13px] font-medium text-branco-cru transition-opacity hover:opacity-90"
          >
            <Plus size={14} />
            Nova campanha
          </button>
        }
      />

      {criando && <NovaCampanhaModal onClose={() => setCriando(false)} />}

      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.key ? 'bg-sinal text-carbono' : 'bg-grafite text-nevoa hover:bg-grafite-elevado',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        <InlineSectionError message="Não conseguimos carregar as campanhas." onRetry={() => refetch()} />
      ) : !demands || demands.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nenhuma campanha aqui"
          description="Campanhas chegam pelo Inbox (botão 'Criar demanda' numa conversa), são lançadas pela equipe, ou pelo botão 'Nova campanha' acima."
        />
      ) : (
        <div className="space-y-2">
          {demands.map((demand) => (
            <Link key={demand.id} href={`/demands/${demand.id}`}>
              <Surface className="flex items-center justify-between gap-4 p-4 transition-colors hover:border-roxo-eletrico/60">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-branco-cru">{demand.title}</p>
                  <p className="truncate text-xs text-nevoa">{demand.clientName ?? 'Sem cliente vinculado'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-nevoa">{formatRelativeTime(demand.requestedAt)}</span>
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider',
                      STATUS_CLASS[demand.status],
                    )}
                  >
                    {STATUS_LABEL[demand.status]}
                  </span>
                </div>
              </Surface>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * NOVA CAMPANHA — fica visível a todo mundo (acesso de /demands já é da
 * empresa inteira, nunca por dono), e vinculada a um cliente é obrigatório:
 * não existe campanha "solta". Quando o cliente já tem ClickUp conectado
 * (`clickupListId`), o backend espelha como tarefa lá sozinho — esta tela não
 * precisa saber disso, só criar a campanha.
 */
function NovaCampanhaModal({ onClose }: { onClose: () => void }) {
  const { data: clients } = useClients();
  const criar = useCreateDemand();
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const podeSalvar = clientId !== '' && title.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbono/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-grafite-elevado bg-grafite p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold text-branco-cru">Nova campanha</h2>
          <button type="button" onClick={onClose} className="text-nevoa hover:text-branco-cru">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-[13px] text-nevoa">Cliente</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-[14px] text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
            >
              <option value="">Selecione…</option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[13px] text-nevoa">Nome da campanha</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Campanha de Outubro"
              className="mt-1 w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-[14px] text-branco-cru placeholder:text-nevoa/50 focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="block text-[13px] text-nevoa">Descrição (opcional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-[14px] leading-relaxed text-branco-cru placeholder:text-nevoa/50 focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </label>

          {criar.isError && <p className="text-[13px] text-erro">{criar.error instanceof Error ? criar.error.message : 'Não consegui criar.'}</p>}

          <button
            type="button"
            disabled={!podeSalvar || criar.isPending}
            onClick={() =>
              criar.mutate(
                { clientId, title: title.trim(), description: description.trim() || null, source: 'manual' },
                { onSuccess: onClose },
              )
            }
            className="w-full rounded-md bg-roxo-eletrico px-4 py-2 text-[14px] font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {criar.isPending ? 'Criando...' : 'Criar campanha'}
          </button>
        </div>
      </div>
    </div>
  );
}
