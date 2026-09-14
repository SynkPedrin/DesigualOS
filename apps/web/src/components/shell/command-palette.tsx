'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Users, Bot, Building2 } from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';
import { useIsMaster } from '@/hooks/use-is-master';
import { useSearch } from '@/hooks/use-search';
import { matchesQuery } from '@/lib/search-match';
import { NAV_ITEMS } from './nav-items';

export function CommandPalette() {
  const router = useRouter();
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const setStudioModalOpen = useUiStore((state) => state.setStudioModalOpen);
  const { isMaster } = useIsMaster();
  const [query, setQuery] = useState('');
  const { data: results } = useSearch(query);
  // Depende de `query`, então precisa vir DEPOIS do useState: o .filter roda
  // na hora e ler a const antes da declaração derruba a tela inteira com
  // "Cannot access before initialization" (o TS não acusa porque o uso está
  // dentro do callback). Quebrou produção em 14/09/2026.
  //
  // O filtro do cmdk está desligado (shouldFilter={false}), então a navegação
  // é filtrada aqui. O motivo de desligar está em lib/search-match.ts: o
  // filtro dele escondia cliente que o servidor tinha encontrado.
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => (!item.masterOnly || isMaster) && matchesQuery(item.label, query),
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!open);
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) setQuery('');
    // Entrar num cliente é o caminho mais usado daqui: pagar o custo da rota
    // enquanto a pessoa ainda está digitando tira a espera do Enter.
    if (open) router.prefetch('/clients');
  }, [open, router]);

  function navigateTo(href: string) {
    if (href === '/studio') {
      setStudioModalOpen(true);
      setOpen(false);
      return;
    }
    router.push(href);
    setOpen(false);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      // Quem filtra é o servidor (acento + erro de digitação) e, pra
      // navegação, matchesQuery. Ver lib/search-match.ts.
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-[60] bg-carbono/70 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-24 z-[61] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-grafite-elevado bg-grafite-elevado shadow-elevated"
    >
      <div className="flex items-center border-b border-grafite-elevado px-4">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Buscar telas, usuários, clientes ou ações..."
          className="w-full bg-transparent py-3 text-sm text-branco-cru placeholder:text-nevoa focus:outline-none"
        />
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-nevoa">
          Nenhum resultado encontrado.
        </Command.Empty>
        {/* Clientes vêm ANTES da navegação de propósito: quem digita o nome de
            um cliente quer entrar na conta dele, e o cmdk seleciona o primeiro
            item da lista - com "Navegação" em cima, o Enter caía numa tela. */}
        {results && results.clients.length > 0 && (
          <Command.Group
            heading="Clientes"
            className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa [&_[cmdk-group-items]]:mt-1"
          >
            {results.clients.map((client) => (
              <Command.Item
                key={client.id}
                value={`cliente ${client.name} ${client.slug} ${client.id}`}
                onSelect={() => navigateTo(`/clients?id=${client.id}`)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-nevoa aria-selected:bg-grafite aria-selected:text-branco-cru"
              >
                <Building2 size={16} />
                <span className="min-w-0 flex-1 truncate">{client.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-nevoa">Abrir conta</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {visibleNavItems.length > 0 && (
        <Command.Group
          heading="Navegação"
          className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa [&_[cmdk-group-items]]:mt-1"
        >
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Command.Item
                key={item.href}
                value={`nav-${item.label}`}
                onSelect={() => navigateTo(item.href)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-nevoa aria-selected:bg-grafite aria-selected:text-branco-cru"
              >
                <Icon size={16} />
                {item.label}
              </Command.Item>
            );
          })}
        </Command.Group>
        )}

        {results && results.users.length > 0 && (
          <Command.Group
            heading="Usuários"
            className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa [&_[cmdk-group-items]]:mt-1"
          >
            {results.users.map((user) => (
              <Command.Item
                key={user.id}
                value={`user-${user.id}-${user.name}`}
                onSelect={() => navigateTo(`/messages?to=${user.id}`)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-nevoa aria-selected:bg-grafite aria-selected:text-branco-cru"
              >
                <Users size={16} />
                <span className="min-w-0 flex-1 truncate">{user.name}</span>
                <span className="truncate font-mono text-[10px] text-nevoa">{user.email}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {results && results.agents.length > 0 && (
          <Command.Group
            heading="Agentes"
            className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa [&_[cmdk-group-items]]:mt-1"
          >
            {results.agents.map((agent) => (
              <Command.Item
                key={agent.id}
                value={`agent-${agent.id}-${agent.name}`}
                onSelect={() => navigateTo(`/chat?agent=${agent.name}`)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-nevoa aria-selected:bg-grafite aria-selected:text-branco-cru"
              >
                <Bot size={16} />
                {agent.displayName}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
