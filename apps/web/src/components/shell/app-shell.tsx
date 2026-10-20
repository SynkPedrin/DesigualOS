'use client';

import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { ContextoDaEmpresa } from './contexto-da-empresa';
import { CommandPalette } from './command-palette';
import { NoiseOverlay } from './noise-overlay';
import { NotificationInboxPopup } from './notification-inbox-popup';
import { MockModeBanner } from './mock-mode-banner';
import { MobileNavDrawer } from './mobile-nav-drawer';
import { StudioModal } from '@/components/studio/studio-modal';
import { BentoBolha } from '@/components/chat/bento-bolha';
import { useRealtimeEvents } from '@/hooks/use-realtime-events';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Liga o canal WS do backend ao cache do React Query pra toda a área logada
  // de uma vez: mensagens, notificações e execuções passam a atualizar na
  // hora em vez de esperar o próximo poll (10s/20s antes disso).
  useRealtimeEvents();

  return (
    <div className="flex h-screen justify-center overflow-hidden bg-carbono">
      <NoiseOverlay />
      {/* Sidebar + content together, capped and centered as a unit - on an ultra-wide
       * screen a left-pinned sidebar with only the content centered in what's left looks
       * lopsided (all the extra space dumped on the right). */}
      <div className="flex h-full w-full max-w-[2400px]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* ACIMA DE TUDO, inclusive da barra superior: saber em qual empresa
            * se está não pode competir por atenção com busca e notificação. */}
          <ContextoDaEmpresa />
          <Topbar />
          {/* A PÁGINA NÃO ROLA; O CONTEÚDO ROLA (09/10/2026, pedido da operação).
              * Antes o scroll era deste <main>, então o cabeçalho da tela subia
              * junto com a lista e quem rolava perdia o título, os filtros e a
              * busca de vista — justo o que precisa ficar à mão numa tela de
              * lista. Agora o quadro é fixo, como a sidebar sempre foi, e quem
              * rola é a área de conteúdo logo abaixo. */}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="mx-auto flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto overflow-x-hidden px-8 pb-8"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
      <CommandPalette />
      <StudioModal />
      <NotificationInboxPopup />
      <MockModeBanner />
      <MobileNavDrawer />
      {/* Por FORA do <main>: a bolha do Bento não pode ser remontada pela
        * transição de rota (AnimatePresence lá em cima troca o filho a cada
        * navegação), ou a conversa aberta se perderia a cada clique no menu. */}
      <BentoBolha />
    </div>
  );
}
