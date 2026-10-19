'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, SquarePen } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { ThreadList, INBOX_FILTERS, type InboxFilterKey } from '@/components/inbox/thread-list';
import { ThreadChat } from '@/components/inbox/thread-chat';
import { ThreadContextPanel } from '@/components/inbox/thread-context-panel';
import { useInboxThreads } from '@/hooks/use-inbox';
import { useWhatsappOpenwaSessions } from '@/hooks/use-whatsapp-openwa';
import type { InboxThread } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

function ContactsList({ threads, selectedId, onSelect }: { threads: InboxThread[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const contatos = threads.filter((t) => t.channel === 'whatsapp');
  if (contatos.length === 0) {
    return <p className="p-4 text-center text-sm text-nevoa">Nenhum contato neste número ainda.</p>;
  }
  return (
    <ul className="divide-y divide-grafite-elevado overflow-y-auto">
      {contatos.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onSelect(t.id)}
            className={cn(
              'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-grafite-elevado/60',
              selectedId === t.id && 'bg-grafite-elevado',
            )}
          >
            <InboxAvatar name={t.clientName ?? t.contactName} photoUrl={t.contactAvatarUrl} kind={t.clientId ? 'client' : 'person'} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-branco-cru">{t.clientName ?? t.contactName}</p>
              <p className="truncate font-mono text-xs text-nevoa">{t.contactPhone ?? 'Sem número'}</p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function InboxPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?view=contatos` (link da sidebar, "Contatos") abre direto nessa aba —
  // sem isso o link teria que cair sempre em "Todas" e pedir mais um clique.
  const viewInicial = searchParams.get('view') === 'contatos' ? 'contatos' : 'todas';
  const [filter, setFilter] = useState<InboxFilterKey>(viewInicial);
  const [busca, setBusca] = useState('');
  const selectedId = searchParams.get('t');

  // As 4 abas filtram no CLIENTE, não refazem a query: a lista inteira já
  // veio (conversa é um recurso pequeno, sem paginação hoje), então recortar
  // em memória evita 4 variações de queryKey pra 12 conversas.
  const { data: threads, isPending } = useInboxThreads({});
  const { data: whatsappSessions } = useWhatsappOpenwaSessions();
  const activeSession = whatsappSessions?.find((session) => session.status === 'ready') ?? whatsappSessions?.[0] ?? null;
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (threads ?? []).filter((t) => {
      if (filter === 'nao-lidas' && t.unreadCount === 0) return false;
      if (filter === 'clientes' && !t.clientId) return false;
      if (filter === 'contatos' && t.channel !== 'whatsapp') return false;
      if (termo) {
        const nome = (t.clientName ?? t.contactName).toLowerCase();
        const numero = (t.contactPhone ?? '').toLowerCase();
        if (!nome.includes(termo) && !numero.includes(termo) && !(t.lastMessagePreview ?? '').toLowerCase().includes(termo)) return false;
      }
      return true;
    });
  }, [threads, filter, busca]);

  function selectThread(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('t', id);
    router.push(`/inbox?${params.toString()}`, { scroll: false });
  }

  function clearThread() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('t');
    router.push(`/inbox?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PageHeader eyebrow="Atendimento" title="Inbox" description="Conversas com clientes, por WhatsApp." />
      </div>

      <div className="mt-6 grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-grafite-elevado lg:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_300px]">
        <div className={cn('min-h-0 flex-col border-r border-grafite-elevado', selectedId ? 'hidden lg:flex' : 'flex')}>
          <div className="flex items-center justify-between gap-2 border-b border-grafite-elevado px-3 py-2.5">
            <h2 className="font-heading text-sm font-semibold text-branco-cru">Conversas</h2>
            <button type="button" title="Nova conversa" className="flex size-7 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-opacity hover:opacity-90">
              <SquarePen size={14} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 border-b border-grafite-elevado px-3 py-2">
            <img src="/logos/whatsapp.webp" alt="WhatsApp" className="size-3.5 shrink-0 rounded-sm" />
            <span className="truncate font-mono text-[11px] text-nevoa">{activeSession?.status === 'ready' ? `+${activeSession.phone_number ?? ''} · Conectado` : activeSession ? 'WhatsApp em configuração' : 'WhatsApp não conectado'}</span>
          </div>
          <div className="flex flex-wrap gap-1 border-b border-grafite-elevado p-2">
            {INBOX_FILTERS.map((f) => {
              const count = f.key === 'todas' ? threads?.length ?? 0 : (threads ?? []).filter((t) => (f.key === 'nao-lidas' ? t.unreadCount > 0 : f.key === 'clientes' ? Boolean(t.clientId) : t.channel === 'whatsapp')).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    filter === f.key ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado',
                  )}
                >
                  {f.label} <span className="opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="border-b border-grafite-elevado p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar conversas..."
                className="w-full rounded-md border border-grafite-elevado bg-grafite py-1.5 pl-8 pr-2 text-[13px] text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filter === 'contatos' ? (
              <ContactsList threads={filtrados} selectedId={selectedId} onSelect={selectThread} />
            ) : (
              <ThreadList threads={filtrados} isPending={isPending} selectedId={selectedId} onSelect={selectThread} />
            )}
          </div>
        </div>

        <div className={cn('min-h-0', selectedId ? 'block' : 'hidden lg:block')}>
          <ThreadChat threadId={selectedId} onBack={clearThread} />
        </div>

        <div className="hidden min-h-0 overflow-y-auto border-l border-grafite-elevado xl:block">
          <ThreadContextPanel threadId={selectedId} />
        </div>
      </div>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageContent />
    </Suspense>
  );
}
