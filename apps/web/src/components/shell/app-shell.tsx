'use client';

import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { CommandPalette } from './command-palette';
import { NoiseOverlay } from './noise-overlay';
import { NotificationInboxPopup } from './notification-inbox-popup';
import { MockModeBanner } from './mock-mode-banner';
import { MobileNavDrawer } from './mobile-nav-drawer';
import { StudioModal } from '@/components/studio/studio-modal';
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
          <Topbar />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="mx-auto flex min-h-full w-full flex-col px-8 py-8"
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
    </div>
  );
}
