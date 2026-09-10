'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMotionValue } from 'framer-motion';
import { Archive, Inbox, MessageSquarePlus, MessagesSquare, Star } from 'lucide-react';
import { AgentCard, useAgentNodeStatuses } from '@/components/chat/agent-spotlight';
import { ChatAmbient } from '@/components/chat/chat-ambient';
import { FEATURED_AGENTS } from '@/lib/agent-meta';
import type { MessagesFilter } from './messages-sidebar';

const SHORTCUTS: Array<{
  id: 'nova' | MessagesFilter;
  icon: typeof Inbox;
  label: string;
  description: string;
}> = [
  { id: 'nova', icon: MessageSquarePlus, label: 'Nova conversa', description: 'Escolha um colaborador e comece a conversar.' },
  { id: 'nao-lidas', icon: Inbox, label: 'Mensagens não lidas', description: 'Veja o que chegou e ainda não foi lido.' },
  { id: 'favoritas', icon: Star, label: 'Favoritas', description: 'Suas conversas fixadas em um só lugar.' },
  { id: 'arquivadas', icon: Archive, label: 'Conversas arquivadas', description: 'Reviva uma conversa arquivada.' },
];

/**
 * Tela vazia do hub: mesma linguagem ambiente da home do /chat (ChatAmbient +
 * cards grandes dos agentes). Os 4 atalhos são funcionais - abrem o picker de
 * colaboradores ou trocam o filtro da lista ao lado, nunca decorativos.
 */
export function MessagesEmptyState({
  onNewConversation,
  onFilterChange,
}: {
  onNewConversation: () => void;
  onFilterChange: (filter: MessagesFilter) => void;
}) {
  const router = useRouter();
  const agentStatuses = useAgentNodeStatuses();
  // Cards estáticos aqui: o microparallax é exclusivo da home do /chat.
  const parallaxX = useMotionValue(0);
  const parallaxY = useMotionValue(0);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ChatAmbient dimmed={false} />

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-10 px-6 py-10">
        <div className="flex flex-col items-center gap-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-nevoa">Chat privado com a IA</p>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            {FEATURED_AGENTS.map((agent, index) => (
              <AgentCard
                key={agent}
                agent={agent}
                index={index}
                selected={false}
                status={agentStatuses?.[agent] ?? null}
                parallaxX={parallaxX}
                parallaxY={parallaxY}
                onSelect={(selected) => router.push(`/chat?agent=${selected}`)}
              />
            ))}
          </div>
          <Link
            href="/agents"
            className="rounded-md border border-grafite-elevado bg-grafite px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
          >
            Configurar agentes
          </Link>
        </div>

        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl border border-roxo-eletrico/30 bg-roxo-eletrico/10 text-roxo-eletrico shadow-glow">
            <MessagesSquare size={24} />
          </span>
          <h1 className="font-display text-4xl font-black uppercase leading-none tracking-tight text-branco-cru md:text-5xl">
            Nenhuma conversa{' '}
            <span className="bg-gradient-to-r from-roxo-eletrico to-magenta-spark bg-clip-text text-transparent">
              selecionada
            </span>
          </h1>
          <p className="max-w-md text-sm text-nevoa">
            Selecione uma conversa ao lado ou inicie uma nova conversa.
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.id}
              type="button"
              onClick={() => (shortcut.id === 'nova' ? onNewConversation() : onFilterChange(shortcut.id))}
              className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-left backdrop-blur-md transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-roxo-eletrico/50 hover:shadow-glow motion-reduce:hover:translate-y-0"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-grafite-elevado bg-grafite text-nevoa transition-colors group-hover:border-roxo-eletrico/40 group-hover:text-branco-cru">
                <shortcut.icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-branco-cru">{shortcut.label}</span>
                <span className="mt-0.5 block text-xs text-nevoa">{shortcut.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
