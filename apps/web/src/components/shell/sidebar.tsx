'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChevronsLeft, ChevronsRight, LogOut, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useIsMaster } from '@/hooks/use-is-master';
import { useMe } from '@/hooks/use-me';
import { useBrandAssets } from '@/hooks/use-brand-assets';
import { supabase } from '@/lib/supabase/client';
import { NAV_ITEMS } from './nav-items';
import { SidebarChatSections } from './sidebar-chat-sections';

function formatBackupTime(iso: string | null) {
  if (!iso) return 'Sem registro';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'Agora mesmo';
  if (diffMin < 60) return `Há ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  return `Há ${diffHours}h`;
}

export function Sidebar({
  variant = 'desktop',
  onNavigate,
}: {
  /** 'drawer': renderizada dentro do MobileNavDrawer (< md) - sempre expandida, sem o botão
   * de colapsar (não faz sentido num overlay), e some sozinha quando o usuário navega. */
  variant?: 'desktop' | 'drawer';
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const collapsedSetting = useUiStore((state) => state.sidebarCollapsed);
  const collapsed = variant === 'drawer' ? false : collapsedSetting;
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setStudioModalOpen = useUiStore((state) => state.setStudioModalOpen);
  const { isMaster } = useIsMaster();
  const { data: health, isPending, isError } = useInfrastructureHealth(isMaster);
  const { data: me } = useMe();
  const { logoSrc } = useBrandAssets();
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.masterOnly || isMaster);

  async function handleSignOut() {
    await supabase.auth.signOut();
    onNavigate?.();
    router.replace('/login');
  }

  /** Mesmo rota não reseta o estado local do ChatThread - o nonce em ?new= é o
   * gatilho que o chat consome pra voltar à tela vazia (ver chat-thread.tsx). */
  function handleNewChat() {
    onNavigate?.();
    router.push(`/chat?new=${Date.now()}`);
  }

  return (
    <aside
      className={cn(
        'h-full flex-col bg-carbono transition-[width] duration-300 ease-out',
        // Desktop: sidebar fixa, escondida abaixo do breakpoint md (o drawer assume nesse
        // caso, ver mobile-nav-drawer.tsx). Drawer: sempre flex, tamanho controlado pelo
        // container que a envolve.
        variant === 'desktop'
          ? 'hidden h-screen border-r border-grafite-elevado md:flex'
          : 'flex',
        collapsed ? 'w-[76px]' : 'w-64',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-6">
        {!collapsed && (
          <Image src={logoSrc} alt="desigual OS" width={160} height={53} priority className="h-auto w-[150px]" />
        )}
        {variant === 'desktop' ? (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Fechar menu"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className={cn('mx-4 mb-4 rounded-lg bg-grafite px-3 py-3', collapsed && 'mx-2 px-2')}>
        <div className="flex items-center gap-3">
          <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-roxo-eletrico font-mono text-sm font-semibold text-branco-cru">
            {me?.avatarUrl ? (
              <Image src={me.avatarUrl} alt={me.name} fill sizes="36px" unoptimized className="object-cover" />
            ) : (
              (me?.name ?? '?').charAt(0).toUpperCase()
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-branco-cru">{me?.name ?? 'Carregando...'}</p>
              <p className="truncate font-mono text-xs text-nevoa">
                {isMaster ? 'Administrador Master' : 'Colaborador'}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sair"
            title="Sair"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-carbono hover:text-branco-cru"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      <div className={cn('px-3 pb-4', collapsed && 'px-2')}>
        <button
          type="button"
          onClick={handleNewChat}
          aria-label="Novo chat"
          title="Novo chat"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-roxo-eletrico py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
        >
          <Plus size={16} className="shrink-0" />
          {!collapsed && <span className="truncate">Novo chat</span>}
        </button>
      </div>

      <nav aria-label="Navegação principal" className="flex-1 space-y-1 overflow-y-auto px-3">
        {visibleNavItems.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          const itemClassName = cn(
            'relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors',
            isActive ? 'bg-grafite text-branco-cru' : 'text-nevoa hover:bg-grafite/60 hover:text-branco-cru',
          );
          const itemContent = (
            <>
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-bar"
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sinal shadow-sinal"
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                />
              )}
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </>
          );

          // Studio opens as a popup (see StudioModal) instead of navigating away.
          if (item.href === '/studio') {
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => {
                  setStudioModalOpen(true);
                  onNavigate?.();
                }}
                className={itemClassName}
              >
                {itemContent}
              </button>
            );
          }

          return (
            <Link key={item.href} href={item.href} className={itemClassName} onClick={() => onNavigate?.()}>
              {itemContent}
            </Link>
          );
        })}

        {/* Colapsada, a sidebar esconde tudo que não é ícone - as seções somem
         * junto (mesmo destino do widget de saúde). Suspense: a seção usa
         * useSearchParams pro destaque do item ativo. */}
        {!collapsed && (
          <Suspense fallback={null}>
            <SidebarChatSections />
          </Suspense>
        )}
      </nav>

      {isMaster && (
        <div className={cn('m-3 rounded-lg border border-grafite-elevado bg-grafite p-3', collapsed && 'hidden')}>
          {isPending ? (
            <div className="space-y-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-grafite-elevado" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-grafite-elevado" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-grafite-elevado" />
            </div>
          ) : isError ? (
            // Falha ao carregar a saúde é diferente de saúde ruim: sem isto, os campos
            // caíam pra `undefined` e a tela mostrava "undefined%" — parecendo dado real
            // em vez da falta dele.
            <p className="font-mono text-xs text-erro">Não consegui carregar a saúde da infraestrutura.</p>
          ) : (
            <dl className="space-y-1.5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-nevoa">Saúde geral</dt>
                <dd className="tabular-nums text-sinal">{health?.overallHealthPercent}%</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    health?.allSystemsOnline ? 'bg-sucesso' : 'bg-aviso',
                  )}
                />
                <span className="text-nevoa">
                  {health?.allSystemsOnline ? 'Todos os sistemas online' : 'Sistemas com degradação'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-nevoa">Agentes conectados</dt>
                <dd className="tabular-nums text-branco-cru">
                  {health?.agentsConnected.online}/{health?.agentsConnected.total}
                </dd>
              </div>
              {/*
                O EXECUTOR NA TELA. Em 10/09/2026 o worker ficou 10 minutos morto, a fila
                empilhou e este painel dizia "Todos os sistemas online" — porque a saúde só
                olhava as máquinas remotas dos agentes, e nunca o processo que executa os
                pedidos. Quem está operando precisa distinguir "o agente está pensando" de
                "ninguém vai responder", e essa diferença mora aqui.

                `worker === null` é a API antiga, sem o bloco: mostra "sem dado", nunca verde.
              */}
              {health?.worker === null ? (
                <div className="flex items-center justify-between">
                  <dt className="text-nevoa">Execução</dt>
                  <dd className="text-nevoa">sem dado</dd>
                </div>
              ) : health?.worker ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-nevoa">Execução</dt>
                  <dd
                    className={cn(
                      'truncate tabular-nums',
                      health.worker.online ? 'text-branco-cru' : 'text-erro',
                    )}
                    title={health.worker.diagnosis}
                  >
                    {health.worker.online
                      ? health.worker.jobsWaiting > 0
                        ? `${health.worker.jobsWaiting} na fila`
                        : 'em dia'
                      : 'PARADA'}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <dt className="text-nevoa">Último backup</dt>
                <dd className="text-branco-cru">{formatBackupTime(health?.lastBackupAt ?? null)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </aside>
  );
}
