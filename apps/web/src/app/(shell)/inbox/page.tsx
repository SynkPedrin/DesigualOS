'use client';

import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Search, SquarePen } from 'lucide-react';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { ThreadList, INBOX_FILTERS, type InboxFilterKey } from '@/components/inbox/thread-list';
import { ThreadChat } from '@/components/inbox/thread-chat';
import { ThreadContextPanel } from '@/components/inbox/thread-context-panel';
import { prefetchInboxMessages, useInboxThreads, useStartInboxThread } from '@/hooks/use-inbox';
import { ApiRequestError } from '@/lib/api/client';
import { useWhatsappOpenwaSessions } from '@/hooks/use-whatsapp-openwa';
import { useMe } from '@/hooks/use-me';
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
  // Busca vai ao servidor (todas as conversas, não só as 300 carregadas), com
  // uma pausa curta entre teclas para não disparar uma consulta por letra.
  const [buscaServidor, setBuscaServidor] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setBuscaServidor(busca.trim()), 300);
    return () => clearTimeout(timer);
  }, [busca]);
  const { data: threads, isPending } = useInboxThreads({
    limit: 300,
    ...(filter === 'arquivadas' ? { view: 'archived' as const } : {}),
    ...(buscaServidor ? { q: buscaServidor } : {}),
  });
  const { data: whatsappSessions } = useWhatsappOpenwaSessions();
  const { data: me } = useMe();
  // A Inbox mostra só as conversas da PRÓPRIA conexão; master recebe a lista de
  // todas as sessões (para administrar), então o cabeçalho precisa filtrar pelo dono.
  const activeSession = whatsappSessions?.find((session) => session.owner_user_id === me?.id) ?? null;
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

  // As conversas do topo já ficam carregadas: clicar abre do que está em
  // memória em vez de esperar o banco (~1 s, ele fica nos EUA). Uma por vez,
  // para não competir com o que a pessoa está fazendo agora.
  const queryClient = useQueryClient();
  const topo = (threads ?? []).slice(0, 12).map((t) => t.id).join(',');
  useEffect(() => {
    if (!topo) return;
    let cancelled = false;
    const ids = topo.split(',');
    void (async () => {
      for (const id of ids) {
        if (cancelled) return;
        await prefetchInboxMessages(queryClient, id).catch(() => undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [topo, queryClient]);

  function selectThread(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('t', id);
    router.push(`/inbox?${params.toString()}`, { scroll: false });
  }

  // "Nova conversa": o número é conferido no WhatsApp antes de a conversa existir; a primeira mensagem sai pelo campo
  // de sempre, já com a conversa aberta.
  const [novaAberta, setNovaAberta] = useState(false);
  const [numero, setNumero] = useState('');
  const iniciar = useStartInboxThread();
  function abrirNova(event: FormEvent) {
    event.preventDefault();
    if (!numero.trim()) return;
    iniciar.mutate(numero, {
      onSuccess: (thread) => {
        setNovaAberta(false);
        setNumero('');
        selectThread(thread.id);
      },
    });
  }

  function clearThread() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('t');
    router.push(`/inbox?${params.toString()}`, { scroll: false });
  }

  return (
    // Tela de trabalho, não de leitura (20/10/2026, referência: inbox do
    // GoHighLevel): sem o banner do topo e quase sem margem, para a conversa
    // ocupar a altura toda. As margens negativas anulam o px-8/pb-8 do shell.
    <div className="-mx-6 -mb-6 flex h-[calc(100%+1.5rem)] min-h-0 flex-col pt-2">
      <h1 className="sr-only">Inbox</h1>
      {/* minmax(0,1fr): sem isto a coluna da conversa crescia com o conteúdo
          (um token longo sem espaço) e espremia a lista e o painel do contato. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-grafite-elevado lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <div className={cn('min-h-0 flex-col border-r border-grafite-elevado', selectedId ? 'hidden lg:flex' : 'flex')}>
          <div className="flex items-center justify-between gap-2 border-b border-grafite-elevado px-3 py-2.5">
            <h2 className="font-heading text-sm font-semibold text-branco-cru">Conversas</h2>
            <button type="button" title="Nova conversa" aria-label="Nova conversa" aria-expanded={novaAberta} onClick={() => { setNovaAberta((v) => !v); iniciar.reset(); }} className="flex size-7 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-opacity hover:opacity-90">
              <SquarePen size={14} />
            </button>
          </div>
          {novaAberta && (
            <form onSubmit={abrirNova} onKeyDown={(e) => { if (e.key === 'Escape') setNovaAberta(false); }} className="space-y-1.5 border-b border-grafite-elevado p-3">
              <label htmlFor="nova-conversa-numero" className="text-xs text-nevoa">Número do WhatsApp, com DDD</label>
              <div className="flex gap-2">
                <input
                  id="nova-conversa-numero"
                  autoFocus
                  inputMode="tel"
                  autoComplete="tel"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  placeholder="(18) 99999-9999 ou +1 415…"
                  className="min-w-0 flex-1 rounded-md border border-grafite-elevado bg-grafite px-2.5 py-1.5 text-[13px] text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
                />
                <button type="submit" disabled={!numero.trim() || iniciar.isPending} className="shrink-0 rounded-md bg-roxo-eletrico px-3 text-xs font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-50">
                  {iniciar.isPending ? 'Conferindo…' : 'Abrir'}
                </button>
              </div>
              {iniciar.error && <p className="text-xs text-erro">{iniciar.error instanceof ApiRequestError ? iniciar.error.message : 'Não consegui abrir a conversa. Tente de novo.'}</p>}
            </form>
          )}
          <div className="flex items-center gap-1.5 border-b border-grafite-elevado px-3 py-2">
            <img src="/logos/whatsapp.webp" alt="WhatsApp" className="size-3.5 shrink-0 rounded-sm" />
            <span className="truncate font-mono text-[11px] text-nevoa">{activeSession?.status === 'ready' ? `+${activeSession.phone_number ?? ''} · Conectado` : activeSession ? 'WhatsApp em configuração' : 'WhatsApp não conectado'}</span>
          </div>
          <div className="flex flex-wrap gap-1 border-b border-grafite-elevado p-2">
            {INBOX_FILTERS.map((f) => {
              // Arquivadas vêm de outra consulta: o número só aparece com a aba aberta.
              const count = f.key === 'arquivadas' ? (filter === 'arquivadas' ? threads?.length ?? 0 : null) : filter === 'arquivadas' ? null : f.key === 'todas' ? threads?.length ?? 0 : (threads ?? []).filter((t) => (f.key === 'nao-lidas' ? t.unreadCount > 0 : f.key === 'clientes' ? Boolean(t.clientId) : t.channel === 'whatsapp')).length;
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
                  {f.label}{count !== null && <span className="opacity-70"> {count}</span>}
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
              <ThreadList threads={filtrados} isPending={isPending} selectedId={selectedId} onSelect={selectThread} onHover={(id) => void prefetchInboxMessages(queryClient, id)} />
            )}
          </div>
        </div>

        <div className={cn('min-h-0 min-w-0', selectedId ? 'block' : 'hidden lg:block')}>
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
