'use client';

import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { useUiStore } from '@/stores/ui-store';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { ContextoDaEmpresa } from './contexto-da-empresa';
import { CommandPalette } from './command-palette';
import { NoiseOverlay } from './noise-overlay';
import { FundoVivo } from './fundo-vivo';
import { NotificationInboxPopup } from './notification-inbox-popup';
import { MockModeBanner } from './mock-mode-banner';
import { MobileNavDrawer } from './mobile-nav-drawer';
import { StudioModal } from '@/components/studio/studio-modal';
import { BentoBolha } from '@/components/chat/bento-bolha';
import { useRealtimeEvents } from '@/hooks/use-realtime-events';
import { TourProvider } from '@/components/tour/tour-provider';
import { AnnouncementHost } from '@/components/announcements/announcement-host';
import { TelaInicial } from './tela-inicial';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Liga o canal WS do backend ao cache do React Query pra toda a área logada
  // de uma vez: mensagens, notificações e execuções passam a atualizar na
  // hora em vez de esperar o próximo poll (10s/20s antes disso).
  useRealtimeEvents();

  // Lembra se a barra lateral estava recolhida e dá o atalho ⌘/Ctrl+B.
  useEffect(() => {
    useUiStore.getState().hidratarSidebar();
    function aoTeclar(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  return (
    <TourProvider>
    <div className="flex h-screen justify-center overflow-hidden bg-carbono">
      <FundoVivo />
      <NoiseOverlay />
      {/* Sidebar + content together, capped and centered as a unit - on an ultra-wide
       * screen a left-pinned sidebar with only the content centered in what's left looks
       * lopsided (all the extra space dumped on the right). */}
      <div className="relative z-10 flex h-full w-full max-w-[2400px]">
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
              * rola é a área de conteúdo logo abaixo.
              * `px-4` no telefone (03/11/2026): as margens de desktop comiam um sexto da tela.
              * `[&>*]:w-full`: este quadro é uma coluna flex, e a raiz de página com `mx-auto max-w-[...]` (a maioria)
              * deixava de esticar e ficava da largura do seu texto mais comprido sem quebra. No telefone, Saúde e
              * Atividade saíam com o dobro da tela, cortadas pelo `overflow-x-hidden`. Com largura cheia, o `max-w`
              * continua limitando e o `mx-auto` continua centralizando. */}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="mx-auto flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto overflow-x-hidden px-4 pb-8 md:px-8 [&>*]:w-full [&>*]:min-w-0"
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
      {/* Novidades: abre sozinho uma vez por pessoa, depois que perfil e permissões chegaram. */}
      <AnnouncementHost />
      <TelaInicial />
    </div>
    </TourProvider>
  );
}
